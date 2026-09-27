(() => {
  "use strict";
  const C = window.WEDDING;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const store = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {}
    },
  };
  const make = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  $$("[data-chat]").forEach((a) => (a.href = C.chatUrl));
  $("[data-map]").href = C.mapUrl;

  // Календарь: дата без зависимости от часового пояса устройства гостя.
  const [year, month, day] = C.date.split("-").map(Number);
  const first = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const calendar = $("[data-calendar]");
  for (let i = 0; i < first; i++)
    calendar.append(make("span", "calendar-blank", ""));
  for (let n = 1; n <= daysInMonth; n++) {
    const el = make(
      "span",
      n === day ? "wedding-day" : "",
      n === day ? "" : String(n),
    );
    if (n === day) {
      el.setAttribute("aria-label", "12 декабря — день свадьбы");
      el.innerHTML =
        '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 43C19 39 3 28 3 16 3 3 18 2 24 11 30 2 45 3 45 16 45 28 29 39 24 43Z"/></svg><b>12</b>';
    }
    calendar.append(el);
  }
  function updateCountdown() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(new Date());
    const part = (k) => Number(parts.find((p) => p.type === k).value);
    const left = Math.round(
      (Date.UTC(year, month - 1, day) -
        Date.UTC(part("year"), part("month") - 1, part("day"))) /
        86400000,
    );
    const word =
      left % 10 === 1 && left % 100 !== 11
        ? "день"
        : left % 10 >= 2 &&
            left % 10 <= 4 &&
            !(left % 100 >= 12 && left % 100 <= 14)
          ? "дня"
          : "дней";
    $("[data-countdown]").textContent =
      left > 0
        ? `До нашей встречи ${left} ${word}`
        : left === 0
          ? "Сегодня наш день ♡"
          : "Спасибо, что были с нами ♡";
  }
  updateCountdown();
  setInterval(updateCountdown, 60000);

  function swatch([name, color], detail = "") {
    const el = make("div", "swatch");
    const dot = make("span", "swatch-color");
    dot.style.setProperty("--swatch", color);
    dot.setAttribute("aria-hidden", "true");
    el.append(dot, make("span", "swatch-name", name));
    if (detail) el.append(make("span", "swatch-detail", detail));
    return el;
  }
  $$("[data-palette]").forEach((panel) => {
    C.colors.forEach((c) => panel.append(swatch(c)));
    if (panel.dataset.palette === "men")
      panel.append(swatch(["Снежный белый", "#F5F5F0"], "только рубашка"));
  });
  C.avoid.forEach((c) => $("[data-avoid]").append(swatch(c)));
  const tabs = $$("[role=tab]");
  function selectTab(tab, focus = false) {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden =
        !selected;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (e) => {
      let next;
      if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (e.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = tabs.length - 1;
      if (next !== undefined) {
        e.preventDefault();
        selectTab(tabs[next], true);
      }
    });
  });

  for (const c of C.contacts) {
    const el = make("article", "contact reveal");
    const img = make("img");
    img.src = `assets/images/${c.photo}`;
    img.alt = c.name;
    img.width = 130;
    img.height = 174;
    img.loading = "lazy";
    img.style.objectPosition = c.position;
    const text = make("div");
    const a = make("a", "text-link");
    a.href = "tel:" + c.phone;
    a.textContent = c.phone.replace(
      /(\+7)(\d{3})(\d{3})(\d{2})(\d{2})/,
      "$1 $2 $3 $4 $5",
    );
    const arrow = make("span", "", "↗");
    arrow.setAttribute("aria-hidden", "true");
    a.append(arrow);
    text.append(
      make("p", "contact-role", c.role),
      make("h3", "", c.name),
      make("p", "contact-note", c.note),
      a,
    );
    el.append(img, text);
    $("[data-contacts]").append(el);
  }
  function choice(text, name, type) {
    const label = make("label", "choice");
    const input = make("input");
    input.type = type;
    input.name = name;
    input.value = text;
    label.append(input, make("span", "", text));
    return label;
  }
  C.drinks.forEach((v) =>
    $("[data-drinks]").append(choice(v, "drinks", "checkbox")),
  );
  C.food.forEach((v) => $("[data-food]").append(choice(v, "food", "radio")));

  // Анкета. Сообщение об успехе появляется только после подтверждения сервера.
  const form = $("#guest-form"),
    status = $("#form-status"),
    submit = $(".submit-button"),
    copy = $("#copy-response");
  const draftKey = "wedding-2026-guest-draft";
  let lastPayload = "",
    requestId = "";
  function payload() {
    const data = new FormData(form);
    return {
      name: String(data.get("name") || "").trim(),
      attendance: String(data.get("attendance") || ""),
      drinks: data.getAll("drinks"),
      food: String(data.get("food") || ""),
      note: String(data.get("note") || "").trim(),
      website: String(data.get("website") || ""),
    };
  }
  function updateAttendance() {
    const absent = $("[name=attendance]:checked", form)?.value === "no";
    $("#preferences").hidden = absent;
    $$("input", $("#preferences")).forEach((e) => (e.disabled = absent));
  }
  // Восстанавливаем только незавершённый ответ; браузер может запрещать localStorage.
  try {
    const saved = JSON.parse(store.get(draftKey) || "null");
    if (saved) {
      $("#guest-name").value = saved.name || "";
      $("#guest-note").value = saved.note || "";
      $$("[name=attendance],[name=drinks],[name=food]", form).forEach((e) => {
        e.checked = Array.isArray(saved[e.name])
          ? saved[e.name].includes(e.value)
          : saved[e.name] === e.value;
      });
    }
  } catch {}
  updateAttendance();
  form.addEventListener("input", () => {
    updateAttendance();
    store.set(draftKey, JSON.stringify(payload()));
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = payload(),
      serialized = JSON.stringify(data);
    if (serialized !== lastPayload) {
      lastPayload = serialized;
      requestId =
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    submit.disabled = true;
    status.textContent = "Отправляем ваш ответ…";
    copy.hidden = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      if (location.protocol === "file:") throw new Error("offline");
      const response = await fetch(C.rsvpEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, id: requestId }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error("send");
      store.remove(draftKey);
      form.hidden = true;
      $("#form-success").hidden = false;
      $("#form-success").focus();
      status.textContent = "";
    } catch {
      store.set(draftKey, JSON.stringify(data));
      status.textContent =
        "Сейчас не получилось отправить анкету. Ваши ответы остались в форме. Попробуйте ещё раз или скопируйте их и передайте организатору.";
      copy.hidden = false;
    } finally {
      clearTimeout(timeout);
      submit.disabled = false;
    }
  });
  copy.addEventListener("click", async () => {
    const d = payload();
    const text = `Анкета гостя — свадьба Михаила и Екатерины\nИмя: ${d.name}\nПрисутствие: ${d.attendance === "yes" ? "Да" : d.attendance === "no" ? "Нет" : "Не выбрано"}\nНапитки: ${d.drinks.join(", ") || "Не указаны"}\nГорячее: ${d.food || "Не указано"}\nПожелания: ${d.note || "Нет"}`;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent =
        "Ответы скопированы. Передайте их, пожалуйста, организатору лично.";
    } catch {
      const a = make("textarea");
      a.value = text;
      a.setAttribute("readonly", "");
      a.style.cssText = "position:fixed;top:0;left:0;opacity:.01";
      document.body.append(a);
      a.select();
      const copied = document.execCommand("copy");
      a.remove();
      status.textContent = copied
        ? "Ответы скопированы. Передайте их организатору лично."
        : "Копирование недоступно. Можно сделать скриншот заполненной анкеты и передать организатору.";
    }
  });
  $("#another-guest").addEventListener("click", () => {
    form.reset();
    updateAttendance();
    lastPayload = "";
    requestId = "";
    store.remove(draftKey);
    copy.hidden = true;
    form.hidden = false;
    $("#form-success").hidden = true;
    $("#guest-name").focus();
  });

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const motionButton = $(".motion-toggle");
  let paused = store.get("wedding-motion") === "paused";
  function setMotionUI() {
    document.body.classList.toggle("motion-paused", paused);
    motionButton.setAttribute("aria-pressed", String(paused));
    motionButton.setAttribute(
      "aria-label",
      paused ? "Включить анимацию" : "Приостановить анимацию",
    );
    motionButton.textContent = paused ? "Включить анимацию" : "Пауза анимации";
  }
  setMotionUI();
  if ("IntersectionObserver" in window && !reduced.matches) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            observer.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -20px 0px" },
    );
    $$(".timeline article,.contacts-grid article,.wishes-grid article").forEach(
      (e, i) => e.style.setProperty("--delay", `${(i % 4) * 70}ms`),
    );
    $$(".reveal").forEach((e) => observer.observe(e));
    document.body.classList.add("motion-ready");
  }
  // Небольшое число частиц только на первом экране; вне экрана цикл останавливается.
  const canvas = $("#snow"),
    ctx = canvas.getContext("2d");
  let width = 0,
    height = 0,
    flakes = [],
    raf = 0,
    last = 0,
    heroVisible = true;
  function resize() {
    const box = canvas.getBoundingClientRect();
    width = box.width;
    height = box.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    flakes = Array.from({ length: width < 760 ? 24 : 48 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 0.7 + Math.random() * 1.7,
      speed: 8 + Math.random() * 14,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.35 + Math.random() * 0.4,
    }));
  }
  function tick(now) {
    raf = 0;
    if (paused || reduced.matches || document.hidden || !heroVisible) return;
    const delta = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    ctx.clearRect(0, 0, width, height);
    flakes.forEach((f) => {
      f.y += f.speed * delta;
      f.x += Math.sin(now / 4000 + f.phase) * 3 * delta;
      if (f.y > height + 5) {
        f.y = -5;
        f.x = Math.random() * width;
      }
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${f.alpha})`;
      ctx.fill();
    });
    raf = requestAnimationFrame(tick);
  }
  function syncMotion() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (reduced.matches || paused) ctx.clearRect(0, 0, width, height);
    if (!paused && !reduced.matches && !document.hidden && heroVisible)
      raf = requestAnimationFrame(tick);
  }
  resize();
  if ("ResizeObserver" in window)
    new ResizeObserver(() => {
      resize();
      syncMotion();
    }).observe($("#home"));
  else window.addEventListener("resize", resize);
  if ("IntersectionObserver" in window)
    new IntersectionObserver(([e]) => {
      heroVisible = e.isIntersecting;
      syncMotion();
    }).observe($("#home"));
  motionButton.addEventListener("click", () => {
    paused = !paused;
    store.set("wedding-motion", paused ? "paused" : "running");
    setMotionUI();
    syncMotion();
  });
  reduced.addEventListener("change", () => {
    if (reduced.matches) document.body.classList.remove("motion-ready");
    syncMotion();
  });
  document.addEventListener("visibilitychange", syncMotion);
  syncMotion();
})();
