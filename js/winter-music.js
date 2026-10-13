(() => {
  "use strict";
  const button = document.getElementById("music-toggle");
  const label = button?.querySelector("[data-music-label]");
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!button || !Audio) return;
  button.hidden = false;
  let wanted = true;
  try { wanted = localStorage.getItem("wedding-music") !== "off"; } catch {}
  let context, master, timer = 0, nextNote = 0, step = 0;
  // An original quiet instrumental motif; no remote audio requests.
  const melody = [62, 69, 74, 78, 76, 69, 66, null, 59, 66, 71, 74, 73, 66, 62, null,
    55, 62, 67, 71, 69, 67, 62, null, 57, 64, 69, 73, 71, 64, 61, null];
  const beat = .92;
  function reflect() {
    const playing = wanted && context?.state === "running" && !document.hidden;
    button.setAttribute("aria-pressed", String(Boolean(playing)));
    button.setAttribute("aria-label", playing ? "Выключить фоновую музыку" : "Включить фоновую музыку");
    label.textContent = playing ? "Выключить музыку" : "Включить музыку";
  }
  function tone(note, time) {
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(.1, time + .05);
    envelope.gain.exponentialRampToValueAtTime(.001, time + 3.6);
    envelope.connect(master);
    const oscillators = [1, 2].map((partial, index) => {
      const oscillator = context.createOscillator();
      const level = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 440 * 2 ** ((note - 69) / 12) * partial;
      level.gain.value = index ? .12 : 1;
      oscillator.connect(level).connect(envelope);
      oscillator.start(time);
      oscillator.stop(time + 3.7);
      oscillator.onended = () => { oscillator.disconnect(); level.disconnect(); };
      return oscillator;
    });
    oscillators[0].addEventListener("ended", () => envelope.disconnect());
  }
  function schedule() {
    if (!wanted || document.hidden || context?.state !== "running") return;
    while (nextNote < context.currentTime + .35) {
      const note = melody[step % melody.length];
      if (note != null) tone(note, nextNote);
      step++;
      nextNote += beat;
    }
  }
  function activate() {
    if (!wanted || document.hidden) return;
    clearInterval(timer);
    timer = 0;
    if (!context) {
      context = new Audio();
      master = context.createGain();
      master.gain.value = .2;
      master.connect(context.destination);
      context.addEventListener("statechange", () => {
        if (context.state !== "running") { clearInterval(timer); timer = 0; }
        reflect();
      });
    }
    const run = () => {
      if (!wanted || document.hidden || context.state !== "running") return;
      clearInterval(timer);
      master.gain.setTargetAtTime(.2, context.currentTime, .5);
      nextNote = Math.max(nextNote, context.currentTime + .1);
      schedule();
      timer = setInterval(schedule, 200);
      reflect();
    };
    // Browsers may keep this pending until the first permitted user gesture.
    context.resume().then(run).catch(reflect);
    reflect();
  }
  function pause() {
    clearInterval(timer);
    timer = 0;
    if (context) context.suspend().catch(() => {});
    reflect();
  }
  button.addEventListener("click", () => {
    if (wanted && context?.state === "running") { wanted = false; pause(); }
    else { wanted = true; activate(); }
    try { localStorage.setItem("wedding-music", wanted ? "on" : "off"); } catch {}
    reflect();
  });
  function unlock(event) {
    if (button.contains(event.target) || event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    if (wanted && context?.state !== "running") activate();
  }
  document.addEventListener("pointerup", unlock, {passive: true});
  document.addEventListener("keydown", unlock);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); else activate(); });
  window.addEventListener("pagehide", pause);
  window.addEventListener("pageshow", () => { if (wanted) activate(); });
  if (wanted) activate();
  reflect();
})();
