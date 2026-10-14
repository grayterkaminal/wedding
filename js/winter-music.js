(() => {
  "use strict";
  const button = document.getElementById("music-toggle");
  const audio = document.getElementById("wedding-music");
  if (!button || !audio || typeof audio.play !== "function" || audio.error) return;
  button.hidden = false;
  let wanted = true;
  try { wanted = localStorage.getItem("wedding-music") !== "off"; } catch {}
  const volume = .6;
  const gestures = ["pointerdown", "pointerup", "touchend", "keydown", "click"];
  let fade = 0;
  function reflect() {
    const playing = !audio.paused;
    button.setAttribute("aria-pressed", String(playing));
    button.setAttribute("aria-label", playing ? "Выключить музыку" : "Включить музыку");
  }
  function fadeIn() {
    clearInterval(fade);
    const from = Date.now();
    // iOS keeps volume read-only, so there the track simply starts at full level.
    fade = setInterval(() => {
      const progress = Math.min(1, (Date.now() - from) / 2000);
      audio.volume = volume * progress;
      if (progress === 1) clearInterval(fade);
    }, 50);
  }
  function unlock(event) {
    if (!button.contains(event.target)) play();
  }
  function waitForGesture() {
    gestures.forEach((type) => document.addEventListener(type, unlock, {capture: true, passive: true}));
  }
  function stopWaiting() {
    gestures.forEach((type) => document.removeEventListener(type, unlock, {capture: true}));
  }
  function started() {
    stopWaiting();
    fadeIn();
  }
  function play() {
    if (!wanted || document.hidden || !audio.paused) return;
    clearInterval(fade);
    audio.volume = 0;
    // Browsers reject sound before the first permitted user gesture; try again on it.
    const attempt = audio.play();
    if (attempt) attempt.then(started, waitForGesture); else started();
  }
  function pause() {
    clearInterval(fade);
    audio.pause();
  }
  button.addEventListener("click", () => {
    wanted = audio.paused;
    try { localStorage.setItem("wedding-music", wanted ? "on" : "off"); } catch {}
    if (wanted) play();
    else { stopWaiting(); pause(); }
  });
  audio.addEventListener("play", reflect);
  audio.addEventListener("pause", reflect);
  audio.addEventListener("error", () => { stopWaiting(); button.hidden = true; });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); else play(); });
  window.addEventListener("pagehide", pause);
  window.addEventListener("pageshow", play);
  reflect();
  play();
})();
