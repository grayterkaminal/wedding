(() => {
  "use strict";
  // Decorative only: does not read or change the RSVP form or guest data.
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const sections = [...document.querySelectorAll(".hero, .invitation, .program, .atmosphere, .footer")];
  const visible = new Set();
  const positions = [[6, 14], [91, 32], [12, 69], [85, 77], [3, 46], [95, 6]];
  for (const section of sections) {
    const layer = document.createElement("div");
    layer.className = "winter-dust";
    layer.setAttribute("aria-hidden", "true");
    positions.forEach(([x, y], index) => {
      const flake = document.createElement("span");
      flake.className = "winter-flake";
      flake.style.setProperty("--flake-x", `${x}%`);
      flake.style.setProperty("--flake-y", `${y}%`);
      flake.style.setProperty("--flake-size", `${18 + index % 3 * 7}px`);
      flake.style.setProperty("--flake-duration", `${17 + index * 2}s`);
      flake.style.setProperty("--flake-delay", `${-index * 4}s`);
      layer.append(flake);
    });
    section.prepend(layer);
  }
  function sync() {
    sections.forEach(section => section.classList.toggle("frost-awake",
      visible.has(section) && !document.hidden && !reduced.matches));
  }
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(({target, isIntersecting}) => {
        if (isIntersecting) visible.add(target);
        else visible.delete(target);
      });
      sync();
    });
    sections.forEach(section => observer.observe(section));
  } else {
    sections.forEach(section => visible.add(section));
  }
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener("change", sync);
  sync();

  // The viewport is the reading zone on both touchscreens and desktop.
  // The layout stays still: only opacity and a small visual offset change.
  const text = [...document.querySelectorAll([
    ".intro-copy .reveal", ".date-copy .reveal", ".section-heading .reveal",
    ".atmosphere-inner .reveal", ".venue-heading .reveal", ".timeline article.reveal",
    ".wish.reveal", ".chat-grid > div > .reveal", ".rsvp-copy .reveal", ".footer > .reveal",
  ].join(","))];
  let frame = 0;
  function updateText() {
    frame = 0;
    const height = window.innerHeight;
    const reads = text.map(element => {
      const {top, bottom} = element.getBoundingClientRect();
      const fade = Math.max(0, Math.min(1, bottom / (height * .18), (height - top) / (height * .18)));
      const offset = top > height / 2 ? (1 - fade) * 20 : -(1 - fade) * 20;
      return {element, fade, offset};
    });
    reads.forEach(({element, fade, offset}) => {
      element.classList.toggle("scroll-text", !reduced.matches);
      element.style.setProperty("--scroll-opacity", reduced.matches ? 1 : fade);
      element.style.setProperty("--scroll-offset", reduced.matches ? "0px" : `${offset}px`);
    });
  }
  function queueText() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(updateText);
  }
  window.addEventListener("scroll", queueText, {passive: true});
  window.addEventListener("resize", queueText, {passive: true});
  document.addEventListener("visibilitychange", queueText);
  reduced.addEventListener("change", queueText);
  if ("ResizeObserver" in window) new ResizeObserver(queueText).observe(document.body);
  document.fonts?.ready.then(queueText);
  queueText();
})();
