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
  const snowSections = [...document.querySelectorAll("main > section, body > footer.footer")];
  const formSurfaces = [...document.querySelectorAll(
    ".form-wrap input[type='text'], .form-wrap textarea, .form-wrap .submit-button",
  )];
  const revealStates = new Map();
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
  let sectionResizeObserver;
  let frame = 0;
  let lastPaint = 0;
  let dirty = true;
  let resizePending = true;
  let revealReconcilePending = false;
  let layoutVersion = 0;
  let width = 0;
  let height = 0;
  let mobile = false;
  let sceneBlend = 120;
  let snowTarget = 0;
  let snowOpacity = 0;
  let snowBounds = [];
  let quietZones = [];
  let flakes = [];
  const glitterSprites = {};
  let heroTimer = 0;
  let heroReady = false;
  let heroReplayArmed = false;
  let heroEntrancePending = false;
  let motionWasReduced = reduced.matches;
  let preferenceTimer = 0;
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
    clearTimeout(preferenceTimer);
    clearSnow();
    revealObserver?.disconnect();
    sceneObserver?.disconnect();
    sectionResizeObserver?.disconnect();
    revealAll();
    body.classList.add("hero-entered");
    body.classList.remove("palace-ready");
    resetPointers();
    scenes.forEach((scene) => scene.classList.remove("scene-awake"));
  }

  function protectedReveal(element) {
    return element.matches("form, .form-wrap, [data-no-reveal]")
      || Boolean(element.closest("form")) || Boolean(element.querySelector("form"))
      || Boolean(element.contains(document.activeElement))
      || element.matches("details[open], [aria-expanded='true']")
      || Boolean(element.querySelector("details[open], [aria-expanded='true']"));
  }

  function setRevealDelays() {
    // Small groups read as one entrance, without making a newly reached mobile
    // paragraph wait for content that has already scrolled out of view.
    const maxDelay = mobile ? 180 : 360;
    document.querySelectorAll(
      ".intro-copy, .date-copy, .atmosphere-inner, .section-heading, .venue-heading, "
      + ".chat-grid > div, .rsvp-copy, .timeline, .contacts-grid, .wishes-grid",
    ).forEach((group) => {
      group.querySelectorAll(".reveal").forEach((element, index) => {
        element.style.setProperty("--delay", `${Math.min(index * 75, 300, maxDelay)}ms`);
      });
    });
    document.querySelectorAll(".reveal[data-reveal-delay]").forEach((element) => {
      const delay = Number(element.dataset.revealDelay);
      if (Number.isFinite(delay)) {
        element.style.setProperty("--delay", `${clamp(delay, 0, maxDelay)}ms`);
      }
    });
  }

  function setupReveals() {
    revealObserver?.disconnect();
    if (reduced.matches || !("IntersectionObserver" in window)) {
      revealAll();
      return;
    }
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting, boundingClientRect: box, intersectionRatio }) => {
        const state = revealStates.get(target);
        if (!state) return;
        if (reduced.matches || protectedReveal(target)) {
          target.classList.add("is-visible");
          state.armed = false;
          return;
        }
        const viewportHeight = window.innerHeight;
        const viewportKey = `${window.innerWidth}:${viewportHeight}`;
        const exitSide = box.bottom <= 0 ? -1 : box.top >= viewportHeight ? 1 : 0;
        if (!isIntersecting && exitSide && box.width > 0 && box.height > 0) {
          // Move hidden text away from its exit edge, never back into the viewport.
          target.style.setProperty("--reveal-shift", `${exitSide * (mobile ? 14 : 18)}px`);
          target.classList.remove("is-visible");
          state.armed = true;
          state.side = exitSide;
          state.scrollY = window.scrollY;
          state.viewport = viewportKey;
          state.layoutVersion = layoutVersion;
        } else if (isIntersecting && intersectionRatio > 0) {
          // Ignore observer changes caused only by the reveal transform itself.
          const returning = !state.seen || !state.side || state.viewport !== viewportKey
            || state.layoutVersion !== layoutVersion
            || (state.side < 0 ? window.scrollY < state.scrollY : window.scrollY > state.scrollY);
          if (!state.armed || returning) {
            target.classList.add("is-visible");
            state.armed = false;
            state.seen = true;
          }
        }
      });
    }, { threshold: [0, 0.015], rootMargin: "0px" });

    setRevealDelays();
    document.querySelectorAll(".reveal").forEach((element) => {
      const shown = element.classList.contains("is-visible");
      revealStates.set(element, {
        armed: !shown, seen: shown, side: 0, scrollY: window.scrollY, viewport: "", layoutVersion,
      });
      element.style.setProperty("--reveal-shift", `${mobile ? 14 : 18}px`);
      // Forms and their containing surface are always readable and usable.
      if (element.matches("form, .form-wrap") || element.closest("form") || element.querySelector("form")) {
        element.classList.add("is-visible");
        return;
      }
      revealObserver.observe(element);
    });
    body.classList.add("motion-ready");
  }

  function reconcileReveals() {
    revealReconcilePending = false;
    if (reduced.matches) return;
    const entries = [...revealStates].filter(([, state]) => state.armed)
      .map(([element, state]) => ({ element, state, box: element.getBoundingClientRect() }));
    entries.forEach(({ element, state, box }) => {
      if (box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < height) {
        element.classList.add("is-visible");
        state.armed = false;
        state.seen = true;
      }
    });
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
    const wasMobile = mobile;
    width = nextWidth;
    height = nextHeight;
    mobile = width < 760;
    if (wasMobile !== mobile) setRevealDelays();
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
        const count = mobile ? 120 : 220;
        flakes = Array.from({ length: count }, (_, index) => {
          const layer = index % 10 < 4 ? 0 : index % 10 < 8 ? 1 : 2;
          return {
            layer,
            x: Math.random() * width,
            y: Math.random() * height,
            radius: [0.7, 1.1, 1.7][layer] + Math.random() * [0.35, 0.5, 0.6][layer],
            speed: [5, 10, 16][layer] + Math.random() * [4, 7, 8][layer],
            alpha: [0.5, 0.63, 0.78][layer] + Math.random() * 0.12,
            phase: Math.random() * Math.PI * 2,
            angle: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.18,
            shimmerPeriod: 1100 + Math.random() * 650,
            tintPhase: Math.random() * Math.PI * 2,
            tintPeriod: 1400 + Math.random() * 1000,
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
    const sectionMeasurements = snowSections.map((scene) => ({ scene, box: scene.getBoundingClientRect() }));
    const measurements = sectionMeasurements.filter(({ scene }) => sceneBoxes.has(scene) || scenes.includes(scene));
    quietZones = formSurfaces.map((element) => element.getBoundingClientRect())
      .filter((box) => box.bottom > 0 && box.top < height && box.width > 0 && box.height > 0);
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
      } else if (pointer.inside && box.width && box.height) {
        pointer.targetX = clamp((pointer.clientX - box.left) / box.width * 2 - 1, -1, 1) * 7;
        pointer.targetY = clamp((pointer.clientY - box.top) / box.height * 2 - 1, -1, 1) * 7;
      }
      if (scene.id === "home") syncHeroReplay(scene, box);
    });
    sectionMeasurements.forEach(({ scene, box }) => {
      const isHero = scene.id === "home";
      const isEvening = scene.id === "atmosphere";
      const dark = isHero || isEvening || scene.dataset.snow === "dark";
      const left = Math.max(box.left, 0);
      const right = Math.min(box.right, width);
      const top = Math.max(box.top, 0);
      const bottom = Math.min(box.bottom, height);
      if (right <= left || bottom <= top) return;
      snowBounds.push({
        left, top, width: right - left, height: bottom - top,
        sourceTop: box.top, sourceBottom: box.bottom,
        hero: isHero, dark,
      });
    });
    // The field belongs to the viewport. Sections only inform its silver/white
    // palette; they never clip it, thin it out or switch it off at a seam.
    snowTarget = width > 0 && height > 0 ? 1 : 0;
    dirty = false;
  }

  function snowDarkness(flake) {
    let darkness = 0;
    snowBounds.forEach((box) => {
      if (flake.x < box.left || flake.x > box.left + box.width
        || flake.y < box.top || flake.y > box.top + box.height) return;
      const entry = box.hero ? 1 : smoothstep((flake.y - box.sourceTop) / sceneBlend);
      const tone = box.dark ? smoothstep((box.sourceBottom - flake.y) / (sceneBlend * 1.5)) : 0;
      darkness += (tone - darkness) * entry;
    });
    return darkness;
  }

  function syncHeroReplay(hero, box) {
    if (!heroReady || reduced.matches || document.hidden) return;
    if (box.bottom <= 0 && !hero.contains(document.activeElement)) {
      clearTimeout(heroTimer);
      heroReplayArmed = true;
      heroEntrancePending = false;
      body.classList.remove("hero-entered");
    } else if (heroReplayArmed && box.bottom > 0 && box.top < height) {
      heroReplayArmed = false;
      heroEntrancePending = false;
      body.classList.add("hero-entered");
    }
  }

  function finishHeroEntrance() {
    if (failed) return;
    if (document.hidden) {
      heroEntrancePending = true;
      return;
    }
    heroEntrancePending = false;
    const hero = scenes.find((scene) => scene.id === "home");
    const box = hero && sceneBoxes.get(hero);
    if (!reduced.matches && box?.bottom <= 0 && !hero.contains(document.activeElement)) {
      heroReplayArmed = true;
      body.classList.remove("hero-entered");
    } else {
      heroReplayArmed = false;
      body.classList.add("hero-entered");
    }
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

  function makeSnowGlitter() {
    // Small cached light textures: a bright pin-point, a fading halo, and faint
    // tapered rays. The crystalline shape only emerges during a passing glint.
    // Gradients are made once, never rebuilt in the animation loop.
    const colors = { night: [163, 197, 238], day: [83, 119, 159], white: [255, 255, 255] };
    Object.entries(colors).forEach(([name, channels]) => {
      const rgba = (alpha) => `rgba(${channels.join(",")},${alpha})`;
      glitterSprites[name] = {};
      ["glow", "rays"].forEach((kind) => {
        const sprite = document.createElement("canvas");
        sprite.width = sprite.height = 64;
        const paint = sprite.getContext("2d");
        if (kind === "glow") {
          const light = paint.createRadialGradient(32, 32, 0, 32, 32, 32);
          light.addColorStop(0, rgba(1));
          light.addColorStop(0.14, rgba(0.98));
          light.addColorStop(0.28, rgba(0.52));
          light.addColorStop(0.5, rgba(0.12));
          light.addColorStop(0.85, rgba(0));
          paint.fillStyle = light;
          paint.fillRect(0, 0, 64, 64);
        } else {
          [1, 0.63, 0.74, 0.9, 0.56, 0.68].forEach((reach, arm) => {
            const length = reach * 28;
            paint.save();
            paint.translate(32, 32);
            paint.rotate(arm * Math.PI / 3);
            const light = paint.createLinearGradient(0, 0, length, 0);
            light.addColorStop(0, rgba(0.85));
            light.addColorStop(0.24, rgba(0.45));
            light.addColorStop(1, rgba(0));
            paint.fillStyle = light;
            paint.beginPath();
            paint.moveTo(0, -2.2);
            paint.lineTo(length, 0);
            paint.lineTo(0, 2.2);
            paint.closePath();
            paint.fill();
            paint.restore();
          });
        }
        glitterSprites[name][kind] = sprite;
      });
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
    // A continuous foreground field also crosses photographs and cards. The
    // canvas cannot intercept input, and typed fields remain free of particles.
    flakes.forEach((flake) => {
      flake.y += flake.speed * delta;
      flake.angle += flake.spin * delta;
      flake.x += (Math.sin(now / 5200 + flake.phase) * (2 + flake.layer * 2) + 2) * delta;
      if (flake.y > height + 20) {
        flake.y = -20;
        flake.x = Math.random() * width;
      }
      if (flake.x > width + 20) flake.x = -20;
      else if (flake.x < -20) flake.x = width + 20;
      const nearInput = quietZones.some((box) => flake.x >= box.left - 8 && flake.x <= box.right + 8
        && flake.y >= box.top - 8 && flake.y <= box.bottom + 8);
      if (nearInput) return;
      // A visible baseline survives between glints. Pale surfaces keep a cool
      // silver tint; matching light footprints avoid hollow, bubble-like rings.
      const darkness = snowDarkness(flake);
      const shimmer = (0.5 + Math.sin(now / flake.shimmerPeriod + flake.phase) * 0.5) ** 2;
      const tint = 0.5 + Math.sin(now / flake.tintPeriod + flake.tintPhase) * 0.5;
      const white = 0.25 + tint * 0.3 + shimmer * 0.45;
      const brightness = flake.alpha * (0.6 + shimmer * 0.45) + 0.2 * shimmer ** 2;
      const alpha = snowOpacity * Math.min(0.98, brightness);
      const halo = flake.radius * 2.6;
      const core = halo * (1 - darkness * 0.3);
      const aspect = 0.65 + darkness * 0.35;
      context.save();
      context.translate(flake.x, flake.y);
      context.rotate(flake.angle);
      if (darkness < 1) {
        context.globalAlpha = alpha * (1 - darkness) * (0.85 - white * 0.1);
        context.drawImage(glitterSprites.day.glow, -halo, -halo * aspect, halo * 2, halo * aspect * 2);
      }
      if (darkness > 0) {
        context.globalAlpha = alpha * darkness * (0.62 - white * 0.18);
        context.drawImage(glitterSprites.night.glow, -halo, -halo, halo * 2, halo * 2);
      }
      context.globalAlpha = alpha * (0.25 + white * 0.35 + darkness * 0.4);
      context.drawImage(glitterSprites.white.glow, -core, -core * aspect, core * 2, core * aspect * 2);
      if (flake.layer > 0) {
        const ray = flake.radius * (1.6 + shimmer * 0.55);
        const glint = 0.2 + smoothstep((shimmer - 0.1) / 0.9) * 0.8;
        context.globalAlpha = alpha * glint * (1 - darkness) * 0.8;
        context.drawImage(glitterSprites.day.rays, -ray, -ray, ray * 2, ray * 2);
        context.globalAlpha = alpha * glint * (0.4 + white * 0.6);
        context.drawImage(glitterSprites.white.rays, -ray, -ray, ray * 2, ray * 2);
      }
      context.restore();
    });
  }

  function tick(now) {
    frame = 0;
    if (document.hidden || reduced.matches) {
      // A media query can update before its change event is delivered.
      // Finish cleanup here too, rather than leaving the last painted state.
      syncMotion();
      return;
    }
    if (motionWasReduced) {
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
      if (revealReconcilePending) reconcileReveals();
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
    revealReconcilePending = true;
    layoutVersion += 1;
    dirty = true;
    if (reduced.matches) {
      resizeViewport();
      measureScenes();
    } else requestFrame();
  }

  function syncMotion() {
    if (failed) return;
    const restoring = motionWasReduced && !reduced.matches;
    motionWasReduced = reduced.matches;
    stopFrame();
    clearTimeout(preferenceTimer);
    if (document.hidden) clearTimeout(heroTimer);
    root.classList.toggle("motion-asleep", document.hidden);
    if (document.hidden || reduced.matches || !finePointer.matches) resetPointers();
    if (reduced.matches) {
      revealObserver?.disconnect();
      revealAll();
      clearTimeout(heroTimer);
      heroReplayArmed = false;
      heroEntrancePending = false;
      body.classList.add("palace-ready", "hero-entered");
    } else if (restoring) {
      setupReveals();
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
    if (document.hidden || reduced.matches) {
      clearSnow();
      watchPreferenceResume();
    }
    else {
      if (heroEntrancePending && heroReady) {
        clearTimeout(heroTimer);
        heroTimer = setTimeout(finishHeroEntrance, 160);
      }
      dirty = true;
      resizePending = true;
      requestFrame();
    }
  }

  function watchPreferenceResume() {
    // No animation frames run while reduced. This low-frequency fallback also
    // handles browsers which update a MediaQueryList without dispatching change.
    if (failed || document.hidden || !reduced.matches) return;
    preferenceTimer = setTimeout(() => {
      preferenceTimer = 0;
      if (reduced.matches) watchPreferenceResume();
      else syncMotion();
    }, 400);
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
      heroReady = true;
      requestResize();
      if (reduced.matches || body.classList.contains("hero-entered")) {
        body.classList.add("hero-entered");
      } else {
        heroEntrancePending = true;
        if (!document.hidden) heroTimer = setTimeout(finishHeroEntrance, 800);
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
      if (context) makeSnowGlitter();
    }
    addGlows();
    resizeViewport();
    setupReveals();
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
    if ("ResizeObserver" in window) {
      sectionResizeObserver = new ResizeObserver(requestResize);
      document.querySelectorAll("main, body > footer.footer").forEach((element) => {
        sectionResizeObserver.observe(element);
      });
    }
    window.addEventListener("scroll", () => {
      dirty = true;
      requestFrame();
    }, { passive: true });
    window.addEventListener("resize", requestResize, { passive: true });
    window.addEventListener("focus", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    document.addEventListener("focusin", ({ target }) => {
      let element = target.closest?.(".reveal");
      while (element) {
        element.classList.add("is-visible");
        const state = revealStates.get(element);
        if (state) {
          state.armed = false;
          state.seen = true;
        }
        element = element.parentElement?.closest(".reveal");
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
