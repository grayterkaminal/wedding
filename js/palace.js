(() => {
  "use strict";

  // All movement is decorative. Forms, navigation and reading text stay still.
  const body = document.body;
  const root = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const smoothstep = (value) => {
    const t = clamp(value);
    return t * t * (3 - 2 * t);
  };
  const scenes = [...document.querySelectorAll("#home, #date, #atmosphere")];
  const visible = new Set();
  const sceneBoxes = new Map();
  const pointers = new Map(scenes.map((scene) => [scene, {
    x: 0, y: 0, targetX: 0, targetY: 0, clientX: 0, clientY: 0, inside: false,
  }]));
  const glowLayers = [];
  const canvas = document.getElementById("snow");
  let context = null;
  let revealObserver;
  let sceneObserver;
  let frame = 0;
  let lastPaint = 0;
  let dirty = true;
  let resizePending = true;
  let width = 0;
  let height = 0;
  let mobile = false;
  let sceneBlend = 120;
  let snowTarget = 0;
  let snowOpacity = 0;
  let snowBounds = [];
  let flakes = [];
  let heroTimer = 0;
  let failed = false;

  function revealAll() {
    body.classList.remove("motion-ready");
    document.querySelectorAll(".reveal").forEach((element) => {
      element.classList.add("is-visible");
    });
  }

  function stopFrame() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastPaint = 0;
  }

  function clearSnow() {
    snowOpacity = 0;
    if (context) context.clearRect(0, 0, width, height);
    if (canvas) canvas.hidden = true;
  }

  function failOpen() {
    failed = true;
    stopFrame();
    clearTimeout(heroTimer);
    clearSnow();
    revealObserver?.disconnect();
    sceneObserver?.disconnect();
    revealAll();
    body.classList.add("hero-entered");
    body.classList.remove("palace-ready");
    resetPointers();
    scenes.forEach((scene) => scene.classList.remove("scene-awake"));
  }

  function setupReveals() {
    if (reduced.matches || !("IntersectionObserver" in window)) {
      revealAll();
      return;
    }
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        target.classList.add("is-visible");
        revealObserver.unobserve(target);
      });
    }, { threshold: 0.04, rootMargin: "0px 0px -24px 0px" });

    document.querySelectorAll(
      ".intro-copy, .date-copy, .atmosphere-inner, .timeline, .contacts-grid, .wishes-grid",
    ).forEach((group) => {
      group.querySelectorAll(".reveal").forEach((element, index) => {
        element.style.setProperty("--delay", `${Math.min(index, 4) * 75}ms`);
      });
    });
    document.querySelectorAll(".reveal").forEach((element) => {
      // Never hide a form or an element already revealed earlier in the visit.
      if (element.matches("form") || element.querySelector("form")) {
        element.classList.add("is-visible");
      }
      if (!element.classList.contains("is-visible")) revealObserver.observe(element);
    });
    body.classList.add("motion-ready");
  }

  // Coordinates refer to the uncropped source artwork, not the viewport.
  const points = {
    home: [
      [46, 48, "window-glow", 1],
      [56, 52.6, "window-glow", 0.75],
      [72, 55.3, "window-glow", 0.68],
      [23, 67, "window-glow", 0.55],
    ],
    date: [[39, 78, "ring-glow", 0.9]],
    atmosphere: [
      [17.2, 44.8, "candle-glow", 0.82],
      [26.5, 40.9, "candle-glow", 1],
      [43.4, 40.9, "candle-glow", 1],
      [51, 44.2, "candle-glow", 0.82],
      [67.7, 50.1, "candle-glow", 0.55],
      [92.8, 50.9, "candle-glow", 0.5],
      [37, 31.3, "crystal-glow", 0.7],
      [27.6, 50.8, "crystal-glow", 0.8],
      [38, 57.5, "crystal-glow", 0.65],
    ],
  };

  function addGlows() {
    scenes.forEach((scene) => {
      const wrapper = scene.querySelector(".scene-image");
      if (!wrapper) return;
      const image = wrapper.querySelector("img");
      const items = (points[scene.id] || []).map(([x, y, className, scale], index) => {
        const element = document.createElement("span");
        element.className = `scene-glow ${className}`;
        element.setAttribute("aria-hidden", "true");
        element.style.setProperty("--x", `${x}%`);
        element.style.setProperty("--y", `${y}%`);
        element.style.setProperty("--delay", `${-index * 1.73}s`);
        element.style.setProperty("--glow-scale", scale);
        wrapper.append(element);
        return { element, x, y };
      });
      glowLayers.push({ wrapper, image, items });
      image?.addEventListener("load", requestResize);
    });
  }

  function positionValue(value, available) {
    if (value === "left" || value === "top") return 0;
    if (value === "right" || value === "bottom") return available;
    if (value === "center") return available / 2;
    if (value?.endsWith("%")) return available * (parseFloat(value) / 100);
    if (value?.endsWith("px")) return parseFloat(value);
    return available / 2;
  }

  function mapGlows() {
    glowLayers.forEach(({ wrapper, image, items }) => {
      if (!image?.naturalWidth || !wrapper.clientWidth || !wrapper.clientHeight) return;
      const wrapperBox = wrapper.getBoundingClientRect();
      const imageBox = image.getBoundingClientRect();
      const sx = wrapper.clientWidth / wrapperBox.width;
      const sy = wrapper.clientHeight / wrapperBox.height;
      const imageWidth = imageBox.width * sx;
      const imageHeight = imageBox.height * sy;
      const style = getComputedStyle(image);
      const fit = style.objectFit;
      let drawnWidth = imageWidth;
      let drawnHeight = imageHeight;
      if (fit === "cover" || fit === "contain") {
        const scale = (fit === "cover" ? Math.max : Math.min)(
          imageWidth / image.naturalWidth, imageHeight / image.naturalHeight,
        );
        drawnWidth = image.naturalWidth * scale;
        drawnHeight = image.naturalHeight * scale;
      }
      const position = style.objectPosition.split(/\s+/);
      const left = (imageBox.left - wrapperBox.left) * sx
        + positionValue(position[0], imageWidth - drawnWidth);
      const top = (imageBox.top - wrapperBox.top) * sy
        + positionValue(position[1] || "50%", imageHeight - drawnHeight);
      items.forEach(({ element, x, y }) => {
        element.style.setProperty("--glow-x", `${(left + drawnWidth * x / 100).toFixed(2)}px`);
        element.style.setProperty("--glow-y", `${(top + drawnHeight * y / 100).toFixed(2)}px`);
      });
    });
  }

  function resizeViewport() {
    const nextWidth = root.clientWidth || window.innerWidth;
    const nextHeight = window.innerHeight || root.clientHeight;
    const changed = width !== nextWidth || height !== nextHeight;
    width = nextWidth;
    height = nextHeight;
    mobile = width < 760;
    sceneBlend = parseFloat(getComputedStyle(root).getPropertyValue("--scene-blend"))
      || (width > 1000 ? 200 : width > 600 ? 160 : 120);
    if (width <= 1000 || !finePointer.matches) resetPointers();
    if (context && canvas) {
      const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
      const backingWidth = Math.round(width * dpr);
      const backingHeight = Math.round(height * dpr);
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (changed || !flakes.length) {
        flakes = Array.from({ length: mobile ? 50 : 90 }, (_, index) => {
          const layer = index % 10 < 5 ? 0 : index % 10 < 9 ? 1 : 2;
          return {
            layer,
            x: Math.random() * width,
            y: Math.random() * height,
            radius: [0.45, 0.95, 2.1][layer] + Math.random() * [0.5, 0.75, 1.3][layer],
            speed: [6, 13, 24][layer] + Math.random() * [5, 10, 12][layer],
            alpha: [0.2, 0.36, 0.2][layer] + Math.random() * 0.2,
            phase: Math.random() * Math.PI * 2,
            carry: index % 4 === 0,
          };
        });
      }
    }
    mapGlows();
    resizePending = false;
  }

  function measureScenes() {
    snowTarget = 0;
    snowBounds = [];
    const measurements = scenes.map((scene) => ({ scene, box: scene.getBoundingClientRect() }));
    measurements.forEach(({ scene, box }) => sceneBoxes.set(scene, box));
    measurements.forEach(({ scene, box }) => {
      const inView = box.bottom > 0 && box.top < height && box.right > 0 && box.left < width;
      if (inView) visible.add(scene);
      else visible.delete(scene);
      const progress = clamp((height - box.top) / (height + box.height));
      const drift = reduced.matches ? 0 : (progress - 0.5) * (mobile ? 18 : 32);
      scene.style.setProperty("--scene-progress", progress.toFixed(4));
      scene.style.setProperty("--scene-drift", `${drift.toFixed(2)}px`);
      scene.classList.toggle("scene-awake", inView && !reduced.matches && !document.hidden);
      if (scene.id !== "home") {
        // Follow the incoming overlap, not the text or the full section height.
        const passage = clamp((height - box.top) / (height + sceneBlend));
        const travel = smoothstep(passage) * 2 - 1;
        scene.style.setProperty("--veil-drift", `${(reduced.matches ? 0 : travel * (mobile ? 12 : 18)).toFixed(2)}px`);
        scene.style.setProperty("--veil-lift", `${(reduced.matches ? 0 : -travel * (mobile ? 4 : 6)).toFixed(2)}px`);
        const light = reduced.matches ? 0.28 : 0.16 + Math.sin(passage * Math.PI) ** 2 * 0.5;
        scene.style.setProperty("--veil-light", light.toFixed(3));
      }
      const pointer = pointers.get(scene);
      if (!inView || (pointer.inside && (pointer.clientX < box.left || pointer.clientX > box.right
        || pointer.clientY < box.top || pointer.clientY > box.bottom))) {
        pointer.targetX = 0;
        pointer.targetY = 0;
        pointer.inside = false;
      }
    });
    const dateBox = measurements.find(({ scene }) => scene.id === "date")?.box;
    measurements.forEach(({ scene, box }) => {
      if (scene.id !== "home" && scene.id !== "atmosphere") return;
      const isHero = scene.id === "home";
      const dateAdjoins = isHero && dateBox && dateBox.top <= box.bottom + 1
        && dateBox.bottom > box.bottom;
      const sourceBottom = dateAdjoins ? Math.min(box.bottom + 120, dateBox.bottom) : box.bottom;
      const left = Math.max(box.left, 0);
      const right = Math.min(box.right, width);
      const top = Math.max(box.top, 0);
      const bottom = Math.min(sourceBottom, height);
      if (right <= left || bottom <= top) return;
      const fadeLength = Math.min(160, Math.max(90, sceneBlend * 0.7));
      snowBounds.push({
        left, top, width: right - left, height: bottom - top,
        sourceTop: box.top, sourceBottom, mainBottom: box.bottom,
        fadeStart: dateAdjoins ? Math.max(box.top, dateBox.top) : box.bottom - fadeLength,
        fadeIn: isHero ? 70 : Math.max(sceneBlend, fadeLength),
        fadeOut: fadeLength,
        hero: isHero, carry: Boolean(dateAdjoins),
        intensity: isHero ? 0.9 : 0.5,
      });
    });
    snowTarget = snowBounds.length ? 1 : 0;
    dirty = false;
  }

  function snowAt(flake, box) {
    if (flake.x < box.left || flake.x > box.left + box.width
      || flake.y < box.sourceTop || flake.y > box.sourceBottom) return 0;
    let alpha = smoothstep((flake.y - box.sourceTop) / box.fadeIn);
    if (box.hero && box.carry) {
      if (flake.y > box.mainBottom) {
        if (!flake.carry) return 0;
        alpha *= 0.28 * (1 - smoothstep((flake.y - box.mainBottom)
          / Math.max(1, box.sourceBottom - box.mainBottom)));
      } else if (flake.y > box.fadeStart) {
        const fade = smoothstep((flake.y - box.fadeStart)
          / Math.max(1, box.mainBottom - box.fadeStart));
        alpha *= 1 - fade * (flake.carry ? 0.72 : 1);
      }
    } else {
      alpha *= smoothstep((box.sourceBottom - flake.y) / box.fadeOut);
    }
    return alpha * box.intensity;
  }

  function resetPointers() {
    pointers.forEach((pointer, scene) => {
      pointer.x = pointer.y = pointer.targetX = pointer.targetY = 0;
      pointer.inside = false;
      scene.style.setProperty("--pointer-x", "0px");
      scene.style.setProperty("--pointer-y", "0px");
    });
  }

  function updatePointers(delta) {
    if (width <= 1000 || !finePointer.matches) return false;
    let moving = false;
    const ease = 1 - Math.exp(-delta * 8);
    pointers.forEach((pointer, scene) => {
      const dx = pointer.targetX - pointer.x;
      const dy = pointer.targetY - pointer.y;
      if (Math.abs(dx) < 0.015 && Math.abs(dy) < 0.015) {
        if (pointer.x === pointer.targetX && pointer.y === pointer.targetY) return;
        pointer.x = pointer.targetX;
        pointer.y = pointer.targetY;
      } else {
        pointer.x += dx * ease;
        pointer.y += dy * ease;
        moving = true;
      }
      scene.style.setProperty("--pointer-x", `${pointer.x.toFixed(3)}px`);
      scene.style.setProperty("--pointer-y", `${pointer.y.toFixed(3)}px`);
    });
    return moving;
  }

  function setupPointers() {
    scenes.forEach((scene) => {
      scene.addEventListener("pointermove", (event) => {
        if (width <= 1000 || !finePointer.matches || reduced.matches || document.hidden) return;
        if (event.pointerType === "touch") return;
        const box = sceneBoxes.get(scene);
        if (!box?.width || !box.height) return;
        const pointer = pointers.get(scene);
        pointer.clientX = event.clientX;
        pointer.clientY = event.clientY;
        pointer.inside = true;
        pointer.targetX = clamp((event.clientX - box.left) / box.width * 2 - 1, -1, 1) * 7;
        pointer.targetY = clamp((event.clientY - box.top) / box.height * 2 - 1, -1, 1) * 7;
        requestFrame();
      }, { passive: true });
      const leave = () => {
        const pointer = pointers.get(scene);
        pointer.targetX = pointer.targetY = 0;
        pointer.inside = false;
        requestFrame();
      };
      scene.addEventListener("pointerleave", leave, { passive: true });
      scene.addEventListener("pointercancel", leave, { passive: true });
    });
  }

  function paintSnow(now, delta) {
    if (!context || !canvas || snowTarget <= 0) {
      clearSnow();
      return;
    }
    canvas.hidden = false;
    snowOpacity += (snowTarget - snowOpacity) * Math.min(1, delta * 3.5);
    context.clearRect(0, 0, width, height);
    // Alpha feathers the edges; the outer clip keeps particles away from later content.
    context.save();
    context.beginPath();
    snowBounds.forEach((box) => context.rect(box.left, box.top, box.width, box.height));
    context.clip();
    context.fillStyle = "#fff";
    flakes.forEach((flake) => {
      flake.y += flake.speed * delta;
      flake.x += (Math.sin(now / 5200 + flake.phase) * (2 + flake.layer * 2) + 2) * delta;
      if (flake.y > height + 8) {
        flake.y = -8;
        flake.x = Math.random() * width;
      }
      if (flake.x > width + 8) flake.x = -8;
      else if (flake.x < -8) flake.x = width + 8;
      const edgeAlpha = snowBounds.reduce((alpha, box) => Math.max(alpha, snowAt(flake, box)), 0);
      if (edgeAlpha < 0.003) return;
      context.globalAlpha = snowOpacity * flake.alpha * edgeAlpha;
      context.beginPath();
      context.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
      context.fill();
    });
    context.restore();
  }

  function tick(now) {
    frame = 0;
    if (document.hidden || reduced.matches) {
      // A media query can update before its change event is delivered.
      // Finish cleanup here too, rather than leaving the last painted state.
      syncMotion();
      return;
    }
    // One clock owns both scenery and snow; mobile drawing is capped at 30fps.
    if (lastPaint && now - lastPaint < (mobile ? 1000 / 30 : 1000 / 60) - 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    try {
      const delta = lastPaint ? Math.min((now - lastPaint) / 1000, 0.06) : 1 / 30;
      lastPaint = now;
      if (resizePending) resizeViewport();
      if (dirty) measureScenes();
      const pointerMoving = updatePointers(delta);
      paintSnow(now, delta);
      if (snowTarget > 0 || pointerMoving || dirty || resizePending) frame = requestAnimationFrame(tick);
      else lastPaint = 0;
    } catch {
      failOpen();
    }
  }

  function requestFrame() {
    if (!failed && !frame && !document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
  }

  function requestResize() {
    resizePending = true;
    dirty = true;
    if (reduced.matches) {
      resizeViewport();
      measureScenes();
    } else requestFrame();
  }

  function syncMotion() {
    if (failed) return;
    stopFrame();
    root.classList.toggle("motion-asleep", document.hidden);
    if (document.hidden || reduced.matches || !finePointer.matches) resetPointers();
    if (reduced.matches) {
      revealObserver?.disconnect();
      revealAll();
      clearTimeout(heroTimer);
      body.classList.add("palace-ready", "hero-entered");
    }
    scenes.forEach((scene) => {
      scene.classList.toggle("scene-awake", visible.has(scene) && !document.hidden && !reduced.matches);
      if (reduced.matches) {
        scene.style.setProperty("--scene-drift", "0px");
        scene.style.setProperty("--veil-drift", "0px");
        scene.style.setProperty("--veil-lift", "0px");
        scene.style.setProperty("--veil-light", "0.28");
      }
    });
    if (document.hidden || reduced.matches) clearSnow();
    else {
      dirty = true;
      resizePending = true;
      requestFrame();
    }
  }

  function startHero() {
    const image = document.querySelector("#home .scene-image img");
    const decoded = image?.decode ? image.decode().catch(() => {}) : Promise.resolve();
    const fonts = document.fonts?.ready || Promise.resolve();
    let timeout;
    Promise.race([
      Promise.all([decoded, fonts]),
      new Promise((resolve) => { timeout = setTimeout(resolve, 2200); }),
    ]).then(() => {
      clearTimeout(timeout);
      if (failed) return;
      requestResize();
      if (reduced.matches || body.classList.contains("hero-entered")) {
        body.classList.add("hero-entered");
      } else {
        heroTimer = setTimeout(() => body.classList.add("hero-entered"), 800);
      }
    }).catch(failOpen);
  }

  try {
    if (canvas) {
      // Move the single canvas out of section clipping/stacking contexts.
      body.append(canvas);
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;";
      canvas.hidden = true;
      context = canvas.getContext("2d", { alpha: true });
    }
    addGlows();
    setupReveals();
    resizeViewport();
    measureScenes();
    setupPointers();
    if ("IntersectionObserver" in window) {
      sceneObserver = new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          if (isIntersecting) visible.add(target);
          else visible.delete(target);
        });
        dirty = true;
        requestFrame();
      });
      scenes.forEach((scene) => sceneObserver.observe(scene));
    }
    window.addEventListener("scroll", () => {
      dirty = true;
      requestFrame();
    }, { passive: true });
    window.addEventListener("resize", requestResize, { passive: true });
    document.addEventListener("visibilitychange", syncMotion);
    document.addEventListener("focusin", ({ target }) => {
      const element = target.closest?.(".reveal");
      if (element) {
        element.classList.add("is-visible");
        revealObserver?.unobserve(element);
      }
    });
    if (reduced.addEventListener) reduced.addEventListener("change", syncMotion);
    else reduced.addListener(syncMotion);
    if (finePointer.addEventListener) finePointer.addEventListener("change", syncMotion);
    else finePointer.addListener(syncMotion);
    // Hide entrance text in this same task; decoding must not trigger a late hide.
    body.classList.add("palace-ready");
    startHero();
    syncMotion();
  } catch {
    failOpen();
  }
})();
