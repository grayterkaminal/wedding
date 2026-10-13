(() => {
  "use strict";

  // All movement is decorative. Forms, navigation and reading text stay still.
  const body = document.body;
  const root = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const scenes = [...document.querySelectorAll("#home, #date, #atmosphere")];
  const visible = new Set();
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
    measurements.forEach(({ scene, box }) => {
      const inView = box.bottom > 0 && box.top < height;
      if (inView) visible.add(scene);
      else visible.delete(scene);
      const progress = clamp((height - box.top) / (height + box.height));
      const drift = reduced.matches ? 0 : (progress - 0.5) * (mobile ? 18 : 32);
      scene.style.setProperty("--scene-progress", progress.toFixed(4));
      scene.style.setProperty("--scene-drift", `${drift.toFixed(2)}px`);
      scene.classList.toggle("scene-awake", inView && !reduced.matches && !document.hidden);
      if (inView && (scene.id === "home" || scene.id === "atmosphere")) {
        const left = Math.max(box.left, 0);
        const right = Math.min(box.right, width);
        const top = Math.max(box.top, 0);
        const bottom = Math.min(box.bottom, height);
        if (right <= left) return;
        snowBounds.push({ left, top, width: right - left, height: bottom - top });
        const coverage = clamp((bottom - top) / Math.min(height, box.height));
        snowTarget = Math.max(snowTarget, coverage * (scene.id === "home" ? 0.9 : 0.5));
      }
    });
    dirty = false;
  }

  function paintSnow(now, delta) {
    if (!context || !canvas || snowTarget <= 0) {
      clearSnow();
      return;
    }
    canvas.hidden = false;
    snowOpacity += (snowTarget - snowOpacity) * Math.min(1, delta * 3.5);
    context.clearRect(0, 0, width, height);
    // The viewport canvas is clipped to the artwork, including partial scenes.
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
      context.globalAlpha = snowOpacity * flake.alpha;
      context.beginPath();
      context.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
      context.fill();
    });
    context.restore();
  }

  function tick(now) {
    frame = 0;
    if (document.hidden || reduced.matches) return;
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
      paintSnow(now, delta);
      if (snowTarget > 0 || dirty || resizePending) frame = requestAnimationFrame(tick);
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
    if (reduced.matches) {
      revealObserver?.disconnect();
      revealAll();
      clearTimeout(heroTimer);
      body.classList.add("palace-ready", "hero-entered");
    }
    scenes.forEach((scene) => {
      scene.classList.toggle("scene-awake", visible.has(scene) && !document.hidden && !reduced.matches);
      if (reduced.matches) scene.style.setProperty("--scene-drift", "0px");
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
    // Hide entrance text in this same task; decoding must not trigger a late hide.
    body.classList.add("palace-ready");
    startHero();
    syncMotion();
  } catch {
    failOpen();
  }
})();
