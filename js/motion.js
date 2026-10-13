(() => {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  const sections = [...document.querySelectorAll(
    ".date-section, .atmosphere, .program, .chat-section",
  )];

  // Свет остается за текстом. Двигаются только видимые декоративные слои.
  sections.forEach((section) => {
    section.classList.add("ambient-section");
    const light = document.createElement("div");
    light.className = "ambient-light";
    light.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 5; i++) {
      const glint = document.createElement("span");
      glint.className = "ambient-glint";
      glint.style.setProperty("--glint-index", i);
      light.append(glint);
    }
    section.prepend(light);
  });
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        target.classList.toggle("ambient-awake", isIntersecting);
      });
    });
    sections.forEach((section) => observer.observe(section));
  } else {
    sections.forEach((section) => section.classList.add("ambient-awake"));
  }

  document.querySelectorAll(".intro-copy, .date-copy, .atmosphere-inner").forEach((group) => {
    group.querySelectorAll(".reveal").forEach((element, index) => {
      element.style.setProperty("--delay", `${index * 80}ms`);
    });
  });

  // Небольшая глубина фона на компьютере, без движения текста и формы.
  const hero = document.querySelector(".hero");
  const backdrop = hero?.querySelector(".hero-backdrop");
  let frame = 0;
  let x = 0;
  let y = 0;
  const resetDepth = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    backdrop?.style.removeProperty("transform");
  };
  hero?.addEventListener("pointermove", (event) => {
    if (reduced.matches || !finePointer.matches || !backdrop || document.hidden) return;
    const box = hero.getBoundingClientRect();
    x = ((event.clientX - box.left) / box.width - 0.5) * 16;
    y = ((event.clientY - box.top) / box.height - 0.5) * 12;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      backdrop.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.025)`;
    });
  });
  hero?.addEventListener("pointerleave", resetDepth);
  reduced.addEventListener("change", resetDepth);
  finePointer.addEventListener("change", resetDepth);
  function syncVisibility() {
    document.documentElement.classList.toggle("motion-asleep", document.hidden);
    if (document.hidden) resetDepth();
  }
  document.addEventListener("visibilitychange", syncVisibility);
  syncVisibility();
})();
