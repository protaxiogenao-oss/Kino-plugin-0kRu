// OK.ru Video (antes OK Cine) — plugin de Kino para https://ok.ru/video/
// Películas, series completas y eventos WWE en español latino y subtitulados.
// author: Hotaru Yume — creator: hotaruyume
//
// v1.2.5
// - kino-plugin.json: hints de settings recortados a ≤80 caracteres
//   (Kino rechazaba el manifiesto con «error en settings»).
//
// v1.2.4
// - Login mejorado para móvil y cuentas con Google:
//   * La ventana web abre la página de entrada de OK (formulario
//     teléfono/correo + contraseña) y avisa que "Entrar con Google"
//     suele fallar dentro de Kino: usa contraseña o pega la cookie.
//   * Mensajes más claros si la ventana no captura sesión.
//   * Hint del campo cookie con pasos para Edge/Chrome en Android
//     (sin PC): bookmarklet o ver cookies con Firefox.
// - La sesión sigue siendo opcional: sin ella Home, búsqueda y
//   reproducción funcionan; solo faltan "Mis canales" y "Mis suscripciones".
//
// v1.2.3
// - Fila "WWE Español" más resistente + búsquedas con variantes en español.
//
// v1.2.2
// - "Eventos WWE en español latino" (búsqueda) desaparece: la fila
//   "WWE Español" con los videos del canal Donluchas la reemplaza.
// - La fila "WWE Español" ya trae el canal Donluchas de serie.
//
// v1.2.0
// - El plugin se llama "OK.ru Video".
// - Inicio de sesión fácil: botón "Iniciar sesión con navegador".
// - Nueva fila "WWE Español" con los videos del canal Donluchas.
//
// v1.1.0
// - Home con caché por fila, presupuesto de tiempo, sesión opcional.

const BASE = "https://ok.ru";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
};

// Canal fijo de la fila "WWE Español": Donluchas (https://ok.ru/profile/601979821580).
// En Ajustes se puede poner el enlace de otro canal de OK.ru (ajuste canalWwe).
const CANAL_WWE_PATH = "/profile/601979821580";

// Filas de Inicio: cada una es una búsqueda curada en español.
const HOME_ROWS = [
  { id: "peli-latino", title: "Películas completas en latino", genre: "peliculas", q: "pelicula completa español latino" },
  { id: "series-latino", title: "Series completas en latino", genre: "series", q: "serie completa español latino" },
  { id: "anime-sub", title: "Anime sub español", genre: "anime", q: "anime sub español" },
  { id: "accion", title: "Acción y aventura en latino", genre: "peliculas", q: "pelicula accion español latino" },
  { id: "comedia", title: "Comedia en español", genre: "peliculas", q: "pelicula comedia español latino" },
  { id: "terror", title: "Terror y suspenso", genre: "peliculas", q: "pelicula terror español latino" },
  { id: "novelas", title: "Telenovelas y dramas", genre: "series", q: "telenovela completa español latino" },
  { id: "infantil", title: "Infantil y animación", genre: "infantil", q: "pelicula infantil español latino" },
  { id: "documental", title: "Documentales en español", genre: "documentales", q: "documental español latino" },
];

// Tiempos (ms). Kino da 20 s a home/browse/episodes/resolve y 15 s a search,
// con 3 vencidos seguidos desactiva el plugin: este presupuesto nunca llega.
const T_PAGE = 7000;        // por pedido dentro de home/search
const T_PAGE_LONG = 15000;  // por pedido dentro de episodes/resolve
const HOME_SOFT_MS = 12000; // presupuesto total para armar Home

// Cada página de "Ver más" de una búsqueda usa una variante en español,
// así la persona recibe resultados nuevos en vez de la misma lista.
const EXPANSIONS = ["", " latino", " español", " sub español", " completa", " pelicula completa", " serie completa"];

// Calidad de OK.ru: nombre del flujo → [alto en píxeles, etiqueta].
const QUALITY = {
  mobile: [144, "144p"],
  lowest: [240, "240p"],
  low: [360, "360p"],
  sd: [480, "480p"],
  hd: [720, "720p"],
  full: [1080, "1080p"],
};

/* ─────────────── utilidades de texto ─────────────── */

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#0?34;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Las tarjetas de resultados viven dentro de un JSON con \u003C y \".
function unescapeJsonText(s) {
  return String(s)
    .replace(/\\u003[cC]/g, "<")
    .replace(/\\u003[eE]/g, ">")
    .replace(/\\u0026/g, "&")
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/");
}

function cleanText(s) {
  return String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAdTitle(title) {
  return /(^|\s)(реклама|рекламн|промокод|промо\b|advertis|advert\b|sponsored)/i.test(title);
}

function yearOf(title) {
  const m =
    title.match(/\((19|20)\d{2}\)/) ||
    title.match(/\b(19[4-9]\d|20[0-4]\d)\b/);
  if (!m) return "";
  return (m[0].match(/(19|20)\d{2}/) || [""])[0];
}

function badgesOf(title) {
  const out = [];
  if (/latino|espa[nñ]ol|castellano|spanish/i.test(title)) out.push("Latino");
  if (/sub(?:titulado)?s?\s*(?:en\s*)?espa[nñ]ol|subt[ií]tulad/i.test(title)) out.push("Sub español");
  else if (/\bsub\b|\bsubbed\b/i.test(title)) out.push("Subtitulado");
  if (/1080|full ?hd|4k/i.test(title)) out.push("HD");
  return out.slice(0, 3);
}

function looksSpanish(title) {
  return /latino|espa[nñ]ol|castellano|spanish/i.test(title);
}

function parseDuration(text) {
  if (!text) return 0;
  const parts = String(text).split(":").map(function (p) {
    return parseInt(p, 10);
  });
  if (parts.length < 2 || parts.length > 3) return 0;
  let seconds = 0;
  for (let i = 0; i < parts.length; i++) {
    const n = parts[i];
    if (!isFinite(n) || n < 0) return 0;
    seconds = seconds * 60 + n;
  }
  return seconds;
}

// Las miniaturas de OK.ru son 16:9; pedimos la copia de 720 px de ancho.
function posterUrl(u) {
  const s = normalizeUrl(u);
  if (!s) return "";
  if (/[?&]fn=external_\d+/.test(s)) return s.replace(/([?&]fn=)external_\d+/, "$1external_8");
  return s;
}

function normalizeUrl(u) {
  let s = String(u || "").trim();
  if (!s) return "";
  if (s.indexOf("//") === 0) s = "https:" + s;
  return s;
}

/* ─────────────── sesión de OK.ru (opcional) ─────────────── */

// Cookies de sesión. Las puede escribir Kino al vincular con la ventana web
// (formato "header": name=value; name2=value2 y así) o la persona a mano.
// Acepta también el valor solo de remixsid ("abc123...") o una línea completa
// de cookies. Devuelve "" cuando no hay sesión.
function sessionCookie() {
  // La ventana web usa hasta 3 ajustes (okCookie + okCookie2 + okCookie3):
  // se leen juntos, uno tras otro y sin separador.
  const raw = String(
    (kino.config.get("okCookie") || "") +
    (kino.config.get("okCookie2") || "") +
    (kino.config.get("okCookie3") || "")
  ).trim();
  if (!raw) return "";
  if (/^[A-Za-z0-9%._-]{12,}$/.test(raw)) return "remixsid=" + raw;
  const pairs = raw
    .split(";")
    .map(function (p) { return p.trim(); })
    .filter(function (p) { return p.length > 0 && p.indexOf("=") > 0; });
  if (!pairs.length) return "";
  return pairs.join("; ");
}

function cookieFingerprint(cookie) {
  const s = String(cookie || "");
  return (s.slice(0, 6) + s.slice(-4)).replace(/[^A-Za-z0-9-]/g, "") || "vacia";
}

// Pide una página de OK con la sesión (si existe) y sin jar conflictivo.
async function fetchOk(url, options) {
  const opts = options || {};
  const headers = Object.assign({}, HEADERS, opts.headers || {});
  const cookie = sessionCookie();
  if (cookie) headers.Cookie = cookie;
  return kino.fetch(url, {
    method: opts.method || "GET",
    headers: headers,
    timeoutMs: opts.timeoutMs || T_PAGE_LONG,
  });
}

/* ─────────────── caché de filas de Inicio ───────────────
 * Kino cachea las filas de home() por 6 horas y no cachea una respuesta sin
 * filas válidas: si OK se pone lento la respuesta llega tarde y Home queda
 * vacío. Aquí cada fila se guarda en kino.storage (256 KB, sobra) y, cuando
 * la red falla o sobra tiempo, la fila guardada se sirve igual.
 */

const HOME_CACHE_KEY = "home-rows-v2";
const ROW_TTL_MS = 6 * 60 * 60 * 1000;   // fila fresca: 6 h
const ROW_KEEP_MS = 30 * 24 * 60 * 60 * 1000; // fila vieja sirve como respaldo
const CACHED_ITEMS = 24; // por fila en caché, para caber holgado en 256 KB

function rowCacheKey(planEntry) {
  if (planEntry.subs) return planEntry.id + ":" + cookieFingerprint(sessionCookie());
  if (planEntry.dyn) return planEntry.id + ":" + cookieFingerprint(wweChannelPath() || "sin-canal");
  return planEntry.id;
}

function loadRowCache() {
  try {
    const raw = kino.storage.get(HOME_CACHE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) {
    return {};
  }
}

function saveRowCache(cache) {
  try {
    kino.storage.set(HOME_CACHE_KEY, JSON.stringify(cache), { ttlMs: ROW_KEEP_MS });
  } catch (e) {
    // almacenamiento lleno: se sigue sin caché
  }
}

/* ─────────────── extracción del reproductor ─────────────── */

// Devuelve el objeto JSON que empieza en `start`, respetando cadenas y escapes.
function jsonObjectAt(s, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
      if (depth < 0) return null;
    }
  }
  return null;
}

function metadataFromPage(html) {
  const marker = html.indexOf('"flashvars"');
  if (marker < 0) return null;
  const start = html.indexOf("{", marker);
  if (start < 0) return null;
  const raw = jsonObjectAt(html, start);
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!parsed || !parsed.metadata) return null;
  return parsed.metadata;
}

async function loadMetadata(id) {
  const url = BASE + "/video/" + encodeURIComponent(id);
  let res;
  try {
    res = await fetchOk(url, { timeoutMs: T_PAGE_LONG });
  } catch (e) {
    throw kino.error("network", "OK.ru no respondió: " + (e && e.code));
  }
  if (!res.ok) {
    throw kino.error("unavailable", "OK.ru respondió " + res.status, {
      userMessage: "OK no está respondiendo; intenta de nuevo en un momento.",
    });
  }
  const meta = metadataFromPage(decodeEntities(res.text()));
  if (!meta) {
    throw kino.error("not_found", "sin datos del reproductor", {
      userMessage: "Este video no se puede reproducir desde el plugin.",
    });
  }
  return meta;
}

/* ─────────────── resultados de búsqueda ─────────────── */

function cardsFromSearchPage(html) {
  const items = [];
  const seen = Object.create(null);
  const marker = 'tsid="movie-card"';
  let at = html.indexOf(marker);
  while (at >= 0) {
    const before = html.slice(Math.max(0, at - 260), at);
    const after = html.slice(at, at + 2600);
    const idm = before.match(/data-id="(\d{4,})"[^>]*$/) || before.match(/data-id="(\d{4,})"/);
    at = html.indexOf(marker, at + marker.length);
    if (!idm) continue;
    const id = idm[1];
    if (seen[id]) continue;
    const titleM = after.match(/alt="([^"]+)"/);
    if (!titleM) continue;
    const title = cleanText(decodeEntities(titleM[1]));
    if (!title || isAdTitle(title)) continue;
    const posterM =
      after.match(/(?:data-poster-src|src)="(https:\/\/[^"]+videoPreview[^"]*)"/) ||
      after.match(/(?:data-poster-src|src)="(https:\/\/[^"]+okcdn[^"]*)"/);
    const durM = after.match(/video-card_duration[^>]*>\s*([0-9:]+)\s*</);
    seen[id] = true;
    items.push(
      makeItem(
        id,
        title,
        posterM ? decodeEntities(posterM[1]) : "",
        parseDuration(durM ? durM[1] : "")
      )
    );
  }
  return items;
}

// Tarjetas de canales de la página de suscripciones: enlaces a grupo, canal
// o perfil con su nombre. El video de cada canal se lee al abrirlo
// (episodes), así home() no dispara una petición por canal.
function channelItemsFromPage(html) {
  const out = [];
  const seen = Object.create(null);
  const linkRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]{0,400}?)<\/a>/g;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    let href = decodeEntities(m[1]);
    let path = "";
    if (href.indexOf("/group/") === 0 || href.indexOf("/channel/") === 0 || href.indexOf("/profile/") === 0) {
      path = href;
    } else if (/^https?:\/\/[^/]*ok\.ru\/(group|channel|profile)\//.test(href)) {
      path = href.replace(/^https?:\/\/[^/]*ok\.ru/, "");
    }
    if (!path) continue;
    path = path.split("?")[0].replace(/\/+$/, "");
    if (!/\/(group|channel|profile)\/\d+/.test(path)) continue;
    if (seen[path]) continue;
    let name = "";
    const tm = m[0].match(/\btitle="([^"]+)"/) || m[0].match(/\baria-label="([^"]+)"/);
    if (tm) name = cleanText(decodeEntities(tm[1]));
    if (!name || name.length < 2) name = cleanText(decodeEntities(m[2]));
    if (!name || name.length < 2) continue;
    if (/^(группа|участник|подпис)/i.test(name)) continue;
    seen[path] = true;
    const slug = path.replace(/[^A-Za-z0-9._~-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
    if (!slug) continue;
    const img = m[2].match(/src="(https:\/\/[^"]+(?:okcdn|vkuser)[^"]*|https:\/\/i\.mycdn\.me\/[^"]+)"/);
    const item = {
      id: "okcha-" + slug,
      ref: "ch:" + path,
      title: name.slice(0, 200),
      kind: "series",
    };
    const poster = img ? posterUrl(decodeEntities(img[1])) : "";
    if (poster) {
      item.poster = poster;
      item.backdrop = poster;
    }
    out.push(item);
    if (out.length >= 24) break;
  }
  return out;
}

function makeItem(id, title, poster, seconds) {
  const item = {
    id: "ok" + id,
    ref: id,
    title: title.slice(0, 300),
    kind: "movie",
  };
  if (poster) {
    item.poster = posterUrl(poster);
    item.backdrop = item.poster;
  }
  if (seconds > 0) item.runtimeMinutes = Math.max(1, Math.round(seconds / 60));
  const year = yearOf(title);
  if (year) item.year = year;
  const badges = badgesOf(title);
  if (badges.length) item.badges = badges;
  if (looksSpanish(title)) item.lang = "es";
  return item;
}

// Un pedido de página de búsqueda: timeouts cortos, un reintento corto.
async function searchPage(query, timeoutMs) {
  const t = timeoutMs || T_PAGE;
  const url = BASE + "/video/search/" + encodeURIComponent(query);
  let res = null;
  try {
    res = await fetchOk(url, { timeoutMs: t });
  } catch (e) {
    res = null;
  }
  if (!res || !res.ok) {
    await kino.sleep(400);
    try {
      res = await fetchOk(url, { timeoutMs: Math.min(t, 8000) });
    } catch (e2) {
      return [];
    }
    if (!res || !res.ok) return [];
  }
  return cardsFromSearchPage(unescapeJsonText(decodeEntities(res.text())));
}

function cursorPage(cursor) {
  const n = parseInt(cursor, 10);
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(n, EXPANSIONS.length - 1);
}

async function resultPage(query, page) {
  // Página 0: búsqueda base + variantes en español, unificadas y
  // priorizando títulos que parecen latino/español (p. ej. Freaks →
  // resultados de "la parada de los monstruos" / "español latino").
  // Páginas siguientes: solo la expansión clásica para "Ver más".
  const seen = Object.create(null);
  const merged = [];
  function addBatch(batch) {
    for (let i = 0; i < batch.length; i++) {
      const it = batch[i];
      if (!it || !it.ref || seen[it.ref]) continue;
      seen[it.ref] = true;
      merged.push(it);
    }
  }
  if (page === 0) {
    const variants = [
      query,
      query + " español",
      query + " latino",
      query + " español latino",
      query + " sub español",
    ];
    // Evita duplicar si la query ya termina en español/latino.
    const qLow = query.toLowerCase();
    const uniqueVars = [];
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i].trim();
      if (!v) continue;
      if (uniqueVars.indexOf(v) >= 0) continue;
      // Si el usuario ya escribió "español" o "latino", no dispares 5 veces.
      if (i > 0 && (qLow.indexOf("español") >= 0 || qLow.indexOf("espanol") >= 0 || qLow.indexOf("latino") >= 0)) continue;
      uniqueVars.push(v);
    }
    for (let i = 0; i < uniqueVars.length && merged.length < 80; i++) {
      try {
        addBatch(await searchPage(uniqueVars[i], Math.min(T_PAGE, 7000)));
      } catch (e) {}
    }
    merged.sort(function (a, b) {
      const sa = looksSpanish(a.title || "") ? 0 : 1;
      const sb = looksSpanish(b.title || "") ? 0 : 1;
      return sa - sb;
    });
  } else {
    const variant = EXPANSIONS[page] || "";
    try {
      addBatch(await searchPage(query + variant));
    } catch (e) {}
  }
  const out = { items: merged.slice(0, 100) };
  if (merged.length > 0 && page + 1 < EXPANSIONS.length) out.next = String(page + 1);
  return out;
}

/* ─────────────── filas de Inicio ─────────────── */

async function buildSearchRow(row) {
  const items = await searchPage(row.q, T_PAGE);
  if (!items.length) return null;
  return {
    id: row.id,
    title: row.title,
    genre: row.genre,
    ref: "q:" + row.q,
    items: items.slice(0, 60),
  };
}

// Fila 1 con sesión: los canales (suscripciones) de la cuenta. Cada canal es
// una tarjeta de "serie" cuyos capítulos son los videos del canal.
async function buildChannelsRow() {
  const res = await fetchOk(BASE + "/video/mySubscriptions", { timeoutMs: T_PAGE });
  if (!res.ok) return null;
  const html = unescapeJsonText(decodeEntities(res.text()));
  const channels = channelItemsFromPage(html);
  if (!channels.length) return null;
  return {
    id: "mis-canales",
    title: "Mis canales",
    genre: "entretenimiento",
    items: channels,
  };
}

// Fila 2 con sesión: los videos recientes de esos canales.
async function buildSubsVideosRow() {
  const res = await fetchOk(BASE + "/video/mySubscriptions", { timeoutMs: T_PAGE });
  if (!res.ok) return null;
  const html = unescapeJsonText(decodeEntities(res.text()));
  const items = cardsFromSearchPage(html).slice(0, 60);
  if (!items.length) return null;
  return {
    id: "mis-suscripciones",
    title: "Mis suscripciones",
    genre: "entretenimiento",
    ref: "subs:videos",
    items: items,
  };
}

/* ─────────────── fila "WWE Español" (canal Donluchas) ─────────────── */

// El canal de la fila: el ajuste canalWwe (un enlace o camino de ok.ru) o el
// canal fijo CANAL_WWE_PATH. Acepta /group/ID, /group/slug, /channel/ID,
// /profile/ID o la página de listado /video/cID.
function wweChannelPath() {
  let p = String(kino.config.get("canalWwe") || "").trim();
  if (!p) p = CANAL_WWE_PATH;
  if (!p) return "";
  const m = p.match(/ok\.ru(\/(?:group|channel|profile)\/[^/?#0-9][^/?#]*|\/(?:group|channel|profile)\/\d+|\/video\/c\d+)/i);
  if (m) return m[1].replace(/\/+$/, "");
  if (/^\/(?:group|channel|profile)\/[^/?#]+/.test(p)) return p.split("?")[0].replace(/\/+$/, "");
  if (/^\/video\/c\d+$/.test(p)) return p;
  return "";
}

// Los videos del canal, como tarjetas que se reproducen al tocarlas.
// Si la página del canal no entrega tarjetas (parser / muro de login /
// HTML distinto), se cae a búsquedas curadas de WWE en español para que
// la fila "WWE Español" no desaparezca del Inicio.
async function buildWweRow() {
  const path = wweChannelPath();
  let items = [];
  if (path) {
    const url = /^\/video\/c\d+$/.test(path) ? BASE + path : BASE + path + "/videos";
    try {
      const res = await fetchOk(url, { timeoutMs: T_PAGE });
      if (res && res.ok) {
        const html = unescapeJsonText(decodeEntities(res.text()));
        items = cardsFromSearchPage(html);
      }
    } catch (e) {
      items = [];
    }
  }
  // Respaldo: búsquedas que sí suelen devolver tarjetas con el parser actual.
  if (!items.length) {
    const fallbacks = [
      "wwe español latino",
      "wwe latino",
      "wwe español",
      "donluchas wwe",
      "raw smackdown español latino",
    ];
    const seen = Object.create(null);
    for (let i = 0; i < fallbacks.length && items.length < 40; i++) {
      try {
        const batch = await searchPage(fallbacks[i], Math.min(T_PAGE, 6000));
        for (let j = 0; j < batch.length; j++) {
          const it = batch[j];
          if (!it || !it.ref || seen[it.ref]) continue;
          seen[it.ref] = true;
          items.push(it);
        }
      } catch (e2) {
        // siguiente fallback
      }
    }
  }
  if (!items.length) return null;
  // Prioriza títulos que parecen en español.
  items.sort(function (a, b) {
    const sa = looksSpanish(a.title || "") ? 0 : 1;
    const sb = looksSpanish(b.title || "") ? 0 : 1;
    return sa - sb;
  });
  return {
    id: "wwe-espanol",
    title: "WWE Español",
    genre: "deportes",
    items: items.slice(0, 60),
  };
}

function planForHome(cookie) {
  const plan = [];
  if (cookie) {
    plan.push({ id: "mis-canales", subs: true, build: buildChannelsRow });
    plan.push({ id: "mis-suscripciones", subs: true, build: buildSubsVideosRow });
  }
  plan.push({ id: "wwe-espanol", dyn: true, build: buildWweRow });
  for (let i = 0; i < HOME_ROWS.length; i++) {
    plan.push({ id: HOME_ROWS[i].id, build: buildSearchRow.bind(null, HOME_ROWS[i]) });
  }
  return plan;
}

export async function home() {
  await null; // trampa de rechazo en Kino 0.9.49 y anteriores
  const started = Date.now();
  const cookie = sessionCookie();
  const plan = planForHome(cookie);
  const cache = loadRowCache();

  const freshRows = [];
  const pending = [];

  for (let i = 0; i < plan.length; i++) {
    const entry = plan[i];
    const key = rowCacheKey(entry);
    const cached = cache[key];
    if (cached && cached.row && Date.now() - cached.at < ROW_TTL_MS) {
      freshRows.push(cached.row);
      continue;
    }
    // Sin tiempo para un pedido nuevo: sirve la fila vieja si existe.
    if (Date.now() - started > HOME_SOFT_MS - T_PAGE - 500) {
      if (cached && cached.row) freshRows.push(cached.row);
      continue;
    }
    pending.push({ entry: entry, key: key, stale: cached && cached.row ? cached : null, idx: i });
  }

  const results = Object.create(null);
  let next = 0;
  const stopAt = started + HOME_SOFT_MS;

  async function worker() {
    while (next < pending.length) {
      if (Date.now() > stopAt - T_PAGE) return;
      const job = pending[next++];
      let row = null;
      try {
        row = await job.entry.build();
      } catch (e) {
        row = null;
      }
      if ((!row || !row.items || !row.items.length) && Date.now() < stopAt - T_PAGE - 1000) {
        await kino.sleep(500);
        try {
          row = await job.entry.build();
        } catch (e2) {
          row = null;
        }
      }
      results[job.key] = row;
    }
  }

  // Kino corre hasta 6 de nuestros fetches a la vez: 6 trabajadores = 0 espera.
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);

  const rows = [];
  const toSave = {};
  for (let i = 0; i < pending.length; i++) {
    const job = pending[i];
    const row = results[job.key];
    if (row && row.items && row.items.length) {
      rows.push(row);
      toSave[job.key] = { at: Date.now(), row: row };
    } else if (job.stale && job.stale.row) {
      // OK falló o no dio resultados: la lista anterior se queda en Home.
      rows.push(job.stale.row);
    }
  }

  if (Object.keys(toSave).length) {
    const prev = loadRowCache();
    for (const key in toSave) prev[key] = toSave[key];
    saveRowCache(prev);
  }

  return freshRows.concat(rows);
}

export async function browse(ref, cursor) {
  await null;
  const r = String(ref || "");
  if (r === "subs:videos") {
    // "Ver más" de las suscripciones: la misma página, sin paginación.
    const row = await buildSubsVideosRow();
    return { items: row ? row.items : [] };
  }
  const q = cleanText(r.replace(/^q:/, ""));
  if (!q) return { items: [] };
  return resultPage(q, cursorPage(cursor));
}

/* ─────────────── capítulos de un canal ─────────────── */

export async function episodes(ref) {
  await null;
  const r = String(ref || "");
  if (r.indexOf("ch:") !== 0) {
    throw kino.error("not_found", "canal no soportado: " + r.slice(0, 40));
  }
  const path = r.slice(3);
  if (!/^[A-Za-z0-9._\/-]+$/.test(path)) {
    throw kino.error("not_found", "canal inválido");
  }
  const listUrl = /^\/video\/c\d+$/.test(path) ? BASE + path : BASE + path + "/videos";
  const res = await fetchOk(listUrl, { timeoutMs: T_PAGE_LONG });
  if (!res.ok) {
    throw kino.error("unavailable", "OK.ru respondió " + res.status, {
      userMessage: "No se pudo abrir el canal; intenta de nuevo en un momento.",
    });
  }
  const html = unescapeJsonText(decodeEntities(res.text()));
  const items = cardsFromSearchPage(html).slice(0, 300);
  if (!items.length) {
    throw kino.error("not_found", "sin videos en el canal", {
      userMessage: "Este canal no tiene videos que el plugin pueda leer.",
    });
  }
  return {
    series: {},
    episodes: items.map(function (it, i) {
      const ep = { season: 1, number: i + 1, ref: it.ref, title: it.title };
      if (it.poster) ep.still = it.poster;
      if (it.runtimeMinutes) ep.runtimeMinutes = it.runtimeMinutes;
      return ep;
    }),
  };
}

/* ─────────────── búsqueda y formulario de ajustes ─────────────── */

export async function search(query) {
  await null;
  const q = cleanText((query && query.q) || "");
  if (!q) return [];
  const page = cursorPage(query && query.cursor);
  try {
    return await resultPage(q, page);
  } catch (e) {
    return [];
  }
}

export async function settingsStatus() {
  await null;
  const cookie = sessionCookie();
  // okCookie2 y okCookie3 son internos (la ventana web los llena únicamente
  // si las cookies no caben en el primero): sin contenido, no se dibujan.
  const extra = [];
  if (!String(kino.config.get("okCookie2") || "")) extra.push("okCookie2");
  if (!String(kino.config.get("okCookie3") || "")) extra.push("okCookie3");
  const hide = extra.length ? { hide: extra } : {};
  if (!cookie) {
    return Object.assign(
      { estadoSesion: "Sin sesión: Iniciar sesión con navegador (teléfono/correo, no Google) o pega remixsid abajo" },
      hide
    );
  }
  try {
    const res = await fetchOk(BASE + "/video/mySubscriptions", { timeoutMs: 9000 });
    if (res.ok) {
      const html = unescapeJsonText(decodeEntities(res.text()));
      const canales = channelItemsFromPage(html).length;
      const videos = cardsFromSearchPage(html).length;
      if (canales || videos) {
        return Object.assign(
          { estadoSesion: "Sesión activa · " + canales + " canales · " + videos + " videos recientes" },
          hide
        );
      }
      return Object.assign(
        { estadoSesion: "La cookie se guardó, pero OK no devolvió suscripciones: quizá venció" },
        hide
      );
    }
    if (res.status === 403 || res.status === 401) {
      return Object.assign(
        { estadoSesion: "OK rechazó la cookie: vincula la sesión otra vez o copia remixsid" },
        hide
      );
    }
    return Object.assign(
      { estadoSesion: "OK respondió " + res.status + " al revisar la sesión" },
      hide
    );
  } catch (e) {
    return Object.assign({ estadoSesion: "No se pudo revisar la sesión ahora" }, hide);
  }
}

export async function action(key) {
  await null;
  if (key === "vincularLogin") {
    const vb = kino.visualBrowser;
    if (!vb || !vb.available) {
      return {
        message:
          "Este aparato no puede abrir la ventana web (necesita Kino 0.9.81 o más nuevo). Usa el campo «Cookies de sesión» más abajo: en el móvil abre ok.ru en Firefox o Chrome, inicia sesión con teléfono/correo y contraseña (no Google), y pega el valor de remixsid. Ver el hint del campo para los pasos.",
      };
    }
    let r = null;
    try {
      // Página móvil de entrada. Evitamos el botón "Google" dentro de Kino:
      // OAuth de Google casi nunca completa en el visualBrowser embebido.
      // El usuario debe usar teléfono/correo + contraseña de OK.
      r = await vb.open({
        url: "https://m.ok.ru/dk?st.cmd=anonymMain",
        title: "OK.ru — usa teléfono o correo (no Google)",
        doneWhen: { cookies: ["remixsid"] },
        collect: {
          cookies: ["remixsid", "remixstid", "remixstoky", "JSESSIONID", "remixlang"],
          storeAs: { setting: "okCookie", format: "header" },
        },
        userAgent: "browser",
        timeoutMs: 600000,
      });
    } catch (e) {
      if (e && e.code === "store_failed") {
        return { message: "Las cookies de OK no cupieron en el ajuste. Actualiza Kino e inténtalo otra vez." };
      }
      if (e && e.code === "busy") {
        return { message: "Ya hay una ventana web abierta. Ciérrala e inténtalo otra vez." };
      }
      return {
        message:
          "No se pudo abrir la ventana web. Pega remixsid en «Cookies de sesión». Si tu cuenta solo entra con Google, define una contraseña en ok.ru (Ajustes → Seguridad) y vuelve a intentar con teléfono/correo.",
      };
    }
    if (r && r.status === "done" && r.stored) {
      return { message: "Sesión vinculada: Kino guardó las cookies de OK.ru (y las lleva selladas a tus otros aparatos)." };
    }
    if (r && r.status === "done") {
      return {
        message:
          "La ventana terminó sin sesión. No uses «Entrar con Google» dentro de Kino (casi nunca funciona). Entra con teléfono o correo y la contraseña de OK. Si solo tienes Google, en ok.ru crea una contraseña y vuelve a tocar este botón.",
      };
    }
    if (r && r.status === "timeout") {
      return {
        message:
          "Se acabó el tiempo. Toca de nuevo e inicia sesión con teléfono/correo + contraseña (no Google). Al entrar, la ventana se cierra sola.",
      };
    }
    return {
      message:
        "Ventana cerrada sin sesión. Alternativa: en el móvil abre m.ok.ru, inicia sesión, copia remixsid y pégala abajo (ver el hint del campo de cookies).",
    };
  }
  if (key === "checkSession") {
    const cookie = sessionCookie();
    if (!cookie) {
      return { message: "No hay sesión guardada. Toca Iniciar sesión con navegador, o copia el valor de la cookie remixsid de ok.ru y pégalo abajo." };
    }
    try {
      const res = await fetchOk(BASE + "/video/mySubscriptions", { timeoutMs: 9000 });
      if (res.ok) {
        const html = unescapeJsonText(decodeEntities(res.text()));
        const canales = channelItemsFromPage(html).length;
        const videos = cardsFromSearchPage(html).length;
        if (canales || videos) {
          return { message: "Sesión activa: " + canales + " canales y " + videos + " videos recientes leídos de OK." };
        }
        return { message: "La cookie se aceptó pero no hay suscripciones que leer. Puede haber vencido: vincula la sesión otra vez." };
      }
      if (res.status === 403 || res.status === 401) {
        return { message: "OK rechazó la sesión. Toca Iniciar sesión con navegador o vuelve a copiar el valor de remixsid y guárdalo." };
      }
      return { message: "OK respondió " + res.status + ". Intenta otra vez en unos minutos." };
    } catch (e) {
      return { message: "No hubo respuesta de OK. Revisa tu conexión e inténtalo otra vez." };
    }
  }
  if (key === "cerrarSesion") {
    try { kino.cookies.clear(); } catch (e) { /* nada que olvidar */ }
    const cache = loadRowCache();
    let cambio = false;
    for (const k of Object.keys(cache)) {
      if (k.indexOf("mis-") === 0) { delete cache[k]; cambio = true; }
    }
    if (cambio) saveRowCache(cache);
    return {
      message: "Sesión cerrada",
      clearSettings: ["okCookie", "okCookie2", "okCookie3"],
    };
  }
  return null;
}

export async function validateSettings(values) {
  await null;
  const v = values && values.okCookie;
  if (!v) return null; // es opcional: sin sesión, Home funciona igual
  const clean = String(v).trim();
  if (/^[A-Za-z0-9%._-]{12,}$/.test(clean)) return null;
  if (/remixsid/i.test(clean)) return null;
  return { okCookie: "No parece remixsid. Pega solo el valor de la cookie remixsid, o la línea completa name=valor; … de ok.ru / m.ok.ru." };
}

/* ─────────────── reproducción ─────────────── */

function videoVariants(meta) {
  const list = [];
  const seen = Object.create(null);
  const videos = (meta && meta.videos) || [];
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i] || {};
    if (!v.url || v.disallowed) continue;
    const info = QUALITY[v.name];
    if (!info) continue;
    const height = info[0];
    if (seen[height]) continue;
    seen[height] = true;
    list.push({
      url: normalizeUrl(v.url),
      height: height,
      label: info[1],
      name: v.name,
    });
  }
  list.sort(function (a, b) {
    return b.height - a.height;
  });
  return list;
}

function pickVariant(list, target) {
  if (!list.length) return null;
  let best = list[0];
  for (let i = 0; i < list.length; i++) {
    if (list[i].height <= target) {
      best = list[i];
      break;
    }
  }
  return best;
}

function expiresInSeconds(url) {
  const m = String(url || "").match(/[?&]expires=(\d+)/);
  if (!m) return undefined;
  const ms = Number(m[1]) - Date.now();
  if (!isFinite(ms) || ms <= 0) return undefined;
  return Math.max(30, Math.min(86400, Math.round(ms / 1000)));
}

function subtitleRank(track) {
  const lang = track.lang;
  if (lang === "es" || lang.indexOf("es-") === 0 || lang.indexOf("es_") === 0) return 0;
  if (lang === "en" || lang.indexOf("en-") === 0) return 2;
  return 1;
}

function subtitlesFor(meta) {
  const mode = kino.config.get("subs") || "es";
  if (mode === "off") return [];
  const tracks = (meta && meta.movie && meta.movie.subtitleTracks) || [];
  const out = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i] || {};
    if (!t.url) continue;
    const lang = String(t.language || "und").toLowerCase().slice(0, 20);
    if (mode === "es-en" && !(lang.indexOf("es") === 0 || lang.indexOf("en") === 0)) continue;
    const label = cleanText(t.manifestName || t.title || "") || (lang === "es" ? "Español" : lang);
    out.push({
      lang: lang,
      url: normalizeUrl(t.url),
      format: "vtt",
      label: t.autogenerated ? label + " (auto)" : label,
    });
  }
  out.sort(function (a, b) {
    return subtitleRank(a) - subtitleRank(b);
  });

  // "Español primero": si el video no trae español, no se esconden los demás.
  if (mode === "es" && out.length && subtitleRank(out[0]) !== 0) return out.slice(0, 30);
  if (mode === "es" && out.length) {
    return out
      .filter(function (t) {
        return subtitleRank(t) === 0;
      })
      .slice(0, 30);
  }
  return out.slice(0, 30);
}

export async function resolve(ref) {
  await null;
  const id = String(ref || "").trim();
  if (!/^\d{4,}$/.test(id)) {
    throw kino.error("not_found", "referencia inválida: " + id, {
      userMessage: "Este video no se puede reproducir desde el plugin.",
    });
  }

  const meta = await loadMetadata(id);
  const movie = (meta && meta.movie) || {};

  if (movie.status && movie.status !== "OK") {
    throw kino.error("not_found", "estado del video: " + movie.status, {
      userMessage: "Este video ya no está disponible en OK.",
    });
  }
  if (movie.isLive) {
    throw kino.error("unavailable", "transmisión en vivo", {
      userMessage: "Esta transmisión en vivo no se puede abrir desde el plugin.",
    });
  }

  const variants = videoVariants(meta);
  const hls = normalizeUrl(meta && meta.hlsManifestUrl);
  if (!variants.length && !hls) {
    throw kino.error("not_found", "sin archivos reproducibles", {
      userMessage: "Este video no tiene una copia reproducible.",
    });
  }

  const pref = String(kino.config.get("quality") || "auto");
  const target = pref === "auto" ? 1080 : parseInt(pref, 10);

  let main = null;
  if (pref === "auto" && hls) {
    main = { url: hls, height: 1080, label: "Automática (HLS)" };
  } else {
    main = pickVariant(variants, target);
    if (!main && hls) main = { url: hls, height: 0, label: "Automática (HLS)" };
  }
  if (!main) {
    throw kino.error("not_found", "sin copia para esa calidad", {
      userMessage: "Este video no tiene una copia reproducible.",
    });
  }

  const alternatives = [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (v.url === main.url) continue;
    alternatives.push({ url: v.url, label: "OK.ru Video · " + v.label });
  }
  if (hls && hls !== main.url) {
    alternatives.push({ url: hls, label: "OK.ru Video · Automática (HLS)" });
  }

  const duration = Number(movie.duration);
  const stream = {
    url: main.url,
    label: "OK.ru Video · " + main.label,
    headers: { "User-Agent": UA },
    alternatives: alternatives.slice(0, 8),
  };
  if (isFinite(duration) && duration > 0) stream.durationMs = Math.round(duration * 1000);
  const ttl = expiresInSeconds(main.url);
  if (ttl) stream.expiresInSeconds = ttl;
  const subs = subtitlesFor(meta);
  if (subs.length) stream.subtitles = subs;
  return stream;
}
