// Node.js 18+; зависимости не нужны. Запуск: node server.mjs
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, appendFile, mkdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import vm from "node:vm";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000),
  host = process.env.HOST || "127.0.0.1";

const googleRsvpUrl = String(process.env.GOOGLE_RSVP_URL || "").trim();
const rsvpApiToken = String(process.env.RSVP_API_TOKEN || "").trim();

const dataDir = path.resolve(
  process.env.DATA_DIR || path.join(root, "responses"),
);
await mkdir(dataDir, { recursive: true });

const context = { window: {}, encodeURIComponent };
vm.runInNewContext(
  await readFile(path.join(root, "js/config.js"), "utf8"),
  context,
);
const config = context.window.WEDDING;

const dbPath = path.join(dataDir, "responses.jsonl"),
  csvPath = path.join(dataDir, "responses.csv");

const seen = new Set();
let queue = Promise.resolve();

try {
  for (const line of (await readFile(dbPath, "utf8")).split("\n")) {
    if (line) seen.add(JSON.parse(line).id);
  }
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

const header = [
  "Дата получения",
  "ID",
  "Имя и фамилия",
  "Присутствие",
  "Напитки",
  "Горячее",
  "Пожелания",
];

const csvValue = (v) =>
  '"' +
  String(v ?? "")
    .replace(/^[\s]*[=+@-]/, "'$&")
    .replace(/"/g, '""')
    .replace(/[\r\n]+/g, " ") +
  '"';

function csvRow(r) {
  return (
    [
      r.receivedAt,
      r.id,
      r.name,
      r.attendance === "yes" ? "Да" : "Нет",
      r.drinks.join(", "),
      r.food,
      r.note,
    ]
      .map(csvValue)
      .join(";") + "\r\n"
  );
}

// JSONL — основной локальный журнал. CSV пересобирается при запуске.
const existing = [];
try {
  for (const line of (await readFile(dbPath, "utf8")).split("\n"))
    if (line) existing.push(JSON.parse(line));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

const { writeFile } = await import("node:fs/promises");
await writeFile(
  csvPath,
  "\uFEFF" +
    header.map(csvValue).join(";") +
    "\r\n" +
    existing.map(csvRow).join(""),
  "utf8",
);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ics": "text/calendar; charset=utf-8",
};

function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}

function valid(d) {
  return (
    d &&
    typeof d === "object" &&
    typeof d.name === "string" &&
    d.name.trim().length >= 2 &&
    d.name.length <= 100 &&
    ["yes", "no"].includes(d.attendance) &&
    Array.isArray(d.drinks) &&
    d.drinks.length <= config.drinks.length &&
    d.drinks.every((x) => config.drinks.includes(x)) &&
    typeof d.food === "string" &&
    (d.food === "" || config.food.includes(d.food)) &&
    typeof d.note === "string" &&
    d.note.length <= 1000 &&
    (d.id === undefined ||
      (typeof d.id === "string" && /^[a-zA-Z0-9-]{10,100}$/.test(d.id)))
  );
}

async function saveToGoogle(record) {
  // Без переменных окружения сервер продолжает работать локально.
  if (!googleRsvpUrl && !rsvpApiToken) return;

  // Частичная конфигурация опасна: лучше показать ошибку, чем потерять ответ.
  if (!googleRsvpUrl || !rsvpApiToken) {
    throw new Error(
      "Google RSVP настроен не полностью: нужны GOOGLE_RSVP_URL и RSVP_API_TOKEN",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(googleRsvpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: rsvpApiToken,
        id: record.id,
        name: record.name,
        attendance: record.attendance,
        drinks: record.drinks,
        food: record.food,
        note: record.note,
        website: "",
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    let result;

    try {
      result = JSON.parse(text);
    } catch {
      throw new Error("Google RSVP вернул некорректный ответ");
    }

    if (!response.ok || result.ok !== true) {
      throw new Error(
        "Google RSVP не сохранил ответ: " + String(result.error || response.status),
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  try {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/api/rsvp") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return json(res, 405, { ok: false });
      }

      if (
        !String(req.headers["content-type"] || "").startsWith(
          "application/json",
        )
      )
        return json(res, 415, { ok: false });

      if (
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      )
        return json(res, 403, { ok: false });

      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 16000)
          return json(res, 413, { ok: false });
      }

      let data;
      try {
        data = JSON.parse(body);
      } catch {
        return json(res, 400, { ok: false });
      }

      if (data.website) return json(res, 400, { ok: false });
      if (!valid(data)) return json(res, 422, { ok: false });

      const record = {
        id: data.id || randomUUID(),
        receivedAt: new Date().toISOString(),
        name: data.name.trim(),
        attendance: data.attendance,
        drinks: data.attendance === "yes" ? [...new Set(data.drinks)] : [],
        food: data.attendance === "yes" ? data.food : "",
        note: data.note.trim(),
      };

      // Сначала сохраняем локальную резервную копию.
      const save = queue.then(async () => {
        if (seen.has(record.id)) return;

        await appendFile(dbPath, JSON.stringify(record) + "\n", "utf8");
        seen.add(record.id);

        try {
          await appendFile(csvPath, csvRow(record), "utf8");
        } catch {
          console.error(
            "CSV не обновлён. Перезапустите сервер для восстановления из JSONL.",
          );
        }
      });

      queue = save.catch(() => {});
      await save;

      // Если Google интеграция включена, успех отдаём только после записи в таблицу.
      try {
        await saveToGoogle(record);
      } catch (error) {
        console.error("Не удалось сохранить анкету в Google Sheets:", error);
        return json(res, 502, { ok: false });
      }

      return json(res, 200, { ok: true, id: record.id });
    }

    if (!["GET", "HEAD"].includes(req.method))
      return json(res, 405, { ok: false });

    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return json(res, 400, { ok: false });
    }

    if (pathname === "/") pathname = "/index.html";

    if (
      !(pathname === "/index.html" || /^\/(assets|css|js)\//.test(pathname)) ||
      pathname.split("/").some((p) => p === ".." || p.startsWith("."))
    )
      return json(res, 404, { ok: false });

    const file = path.resolve(root, "." + pathname);
    if (!file.startsWith(root + path.sep)) return json(res, 404, { ok: false });

    const info = await stat(file);
    if (!info.isFile()) return json(res, 404, { ok: false });

    const ext = path.extname(file);
    if (!types[ext]) return json(res, 404, { ok: false });

    res.writeHead(200, {
      "Content-Type": types[ext],
      "Cache-Control": "no-cache",
    });

    if (req.method === "HEAD") return res.end();
    res.end(await readFile(file));
  } catch (e) {
    if (!res.headersSent)
      json(res, e.code === "ENOENT" ? 404 : 500, { ok: false });
    else res.end();
  }
});

server.listen(port, host, () => {
  const googleStatus =
    googleRsvpUrl && rsvpApiToken ? "подключён" : "не настроен (локальный режим)";
  console.log(
    `Приглашение: http://${host}:${port}\nОтветы гостей: ${csvPath}\nGoogle Sheets: ${googleStatus}`,
  );
});
