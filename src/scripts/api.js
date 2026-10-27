import { storage, redactSecrets } from "./storage.js";
import { i18n } from "./i18n.js";

const COLOMBO_TZ = "Asia/Colombo";
const COLOMBO_OFFSET = "+05:30";
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_DEBOUNCE_MS = 280;
const DATE_KEY = /(^|_|-|\.)(at|on|date|time|timestamp|expires|expiry|created|updated|signedin)s?$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const inflight = new Map();
const lastStarted = new Map();
const lastSuccess = new Map();

const runtime = {
  apiBase: "",
  timeoutMs: DEFAULT_TIMEOUT_MS,
  debounceMs: DEFAULT_DEBOUNCE_MS,
  loaded: false,
};

const STATUS_KEYS = {
  400: "errors.http.400",
  401: "errors.http.401",
  403: "errors.http.403",
  404: "errors.http.404",
  408: "errors.timeout",
  409: "errors.http.409",
  422: "errors.http.422",
  429: "errors.http.429",
  500: "errors.http.500",
  502: "errors.http.502",
  503: "errors.http.503",
};

const ENGLISH_FALLBACK = {
  "errors.network": "We could not reach the server. Check your connection and try again.",
  "errors.timeout": "That took too long. Please try again.",
  "errors.offline": "You appear to be offline. Reconnect and try again.",
  "errors.https": "This app only talks to HTTPS services.",
  "errors.canceled": "The request was cancelled.",
  "errors.unknown": "Something went wrong. Please try again in a moment.",
  "errors.refused": "The server declined that request.",
  "errors.http.400": "Some details look incomplete. Please review and try again.",
  "errors.http.401": "Please sign in to continue.",
  "errors.http.403": "You do not have permission to do that.",
  "errors.http.404": "We could not find what you asked for.",
  "errors.http.409": "That clashes with existing data. Please try again.",
  "errors.http.422": "Those details could not be accepted.",
  "errors.http.429": "Too many tries. Pause for a moment, then retry.",
  "errors.http.500": "The service hit a temporary problem.",
  "errors.http.502": "The service did not respond.",
  "errors.http.503": "The service is unavailable right now.",
  "errors.code.slot-taken": "That time was just taken. Please pick another slot.",
  "errors.code.terms-required": "Please confirm you are 16 or older and agree to the community rules and privacy policy.",
  "errors.code.staff-required": "Please choose a specialist, or Any available.",
  "errors.code.slot-required": "Please choose a time that is still free.",
  "errors.code.services-required": "Add a service from the menu before booking.",
  "errors.code.invalid-date": "That date could not be used. Please pick another day.",
  "errors.code.event-type-required": "Please choose an event type.",
  "errors.code.address-required": "Please add the address for a visit to your location.",
  "errors.code.persons-required": "Please tell us how many people to plan for.",
  "errors.code.duration-required": "Please estimate how long the event should run.",
  "errors.code.cannot-cancel": "That booking can no longer be cancelled.",
  "errors.code.no-proposal": "There is no new time waiting on that booking.",
  "errors.code.rating-required": "Please choose a star rating from 1 to 5.",
  "errors.code.already-reviewed": "You already left a review for that visit.",
  "errors.code.not-completed": "Reviews open after the visit is complete.",
  "errors.code.name-required": "Please enter your full name.",
  "errors.code.phone-required": "Please enter a Sri Lankan mobile number.",
  "errors.code.email-required": "Please enter a valid email address.",
  "errors.code.otp-required": "Please request a one-time code first.",
  "errors.code.otp-invalid": "That code did not match. Request a new one if it expired.",
  "errors.code.otp-expired": "That code expired. Send a new one.",
  "errors.code.support-required": "Please add a subject and a short message.",
  "errors.code.deletion-confirm": "Type DELETE to permanently close this account.",
};

export class ApiError extends Error {
  constructor(key, { status = 0, code = null, payload = null } = {}) {
    const message = localize(key);
    super(message);
    this.name = "ApiError";
    this.key = key;
    this.status = status;
    this.code = code;
    this.payload = payload;
    this.userMessage = message;
  }
}

function localize(key) {
  try {
    const translated = i18n.t(key);
    if (translated && translated !== key) return translated;
  } catch {
    /* dictionaries may not be ready during early boot */
  }
  return ENGLISH_FALLBACK[key] || ENGLISH_FALLBACK["errors.unknown"];
}

function metaContent(name) {
  return document.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim() || "";
}

function readInlineConfig() {
  const fromWindow = window.YAMOO_CONFIG || {};
  const apiBase = fromWindow.apiBase || window.YAMOO_API_BASE || metaContent("yamoo-api-base");
  const timeoutMs = Number(fromWindow.timeoutMs || metaContent("yamoo-timeout")) || runtime.timeoutMs;
  const debounceMs = Number(fromWindow.debounceMs || metaContent("yamoo-debounce")) || runtime.debounceMs;
  return { apiBase, timeoutMs, debounceMs };
}

export function configureApi(partial = {}) {
  Object.assign(runtime, partial);
  runtime.loaded = true;
  return getConfig();
}

export function getConfig() {
  const inline = readInlineConfig();
  return {
    apiBase: runtime.apiBase || inline.apiBase || "",
    timeoutMs: runtime.timeoutMs || inline.timeoutMs || DEFAULT_TIMEOUT_MS,
    debounceMs: runtime.debounceMs || inline.debounceMs || DEFAULT_DEBOUNCE_MS,
  };
}

export async function loadRuntimeConfig() {
  if (runtime.loaded) return getConfig();
  try {
    const response = await fetch("/src/config.json", {
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      const file = await response.json();
      if (file && typeof file === "object") Object.assign(runtime, file);
    }
  } catch {
    /* keep inline/defaults — never log the body */
  }
  runtime.loaded = true;
  return getConfig();
}

function defaultBase() {
  const { apiBase } = getConfig();
  if (apiBase) return apiBase;
  return `${window.location.origin}/api`;
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function assertSafeUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError("errors.unknown");
  }

  const local = isLocalHost(parsed.hostname);
  if (parsed.protocol === "http:" && local) return parsed.toString();
  if (parsed.protocol !== "https:") throw new ApiError("errors.https");
  if (window.location.protocol === "https:" && parsed.protocol === "http:") {
    throw new ApiError("errors.https");
  }
  return parsed.toString();
}

function resolveUrl(path) {
  if (/^https:\/\//i.test(path) || /^http:\/\//i.test(path)) return assertSafeUrl(path);
  const base = defaultBase();
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return assertSafeUrl(new URL(String(path).replace(/^\//, ""), normalizedBase).toString());
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function colomboParts(date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: COLOMBO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function formatColomboIso(parts) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}${COLOMBO_OFFSET}`;
}

function parseNaiveAsColombo(value) {
  const match = String(value)
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?$/,
    );
  if (!match) return null;
  return formatColomboIso({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] || 0),
    minute: Number(match[5] || 0),
    second: Number(match[6] || 0),
  });
}

function parseClockMinutes(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2})(?::|\.)(\d{2})(?:\s*([AaPp][Mm]))?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59) return null;
  const meridem = match[3]?.toLowerCase();
  if (meridem === "pm" && hour < 12) hour += 12;
  if (meridem === "am" && hour === 12) hour = 0;
  if (hour > 23) return null;
  return hour * 60 + minute;
}

export const colombo = {
  zone: COLOMBO_TZ,
  offset: COLOMBO_OFFSET,

  parts(date = new Date()) {
    return colomboParts(date);
  },

  weekdayKey(date = new Date()) {
    return new Intl.DateTimeFormat("en-US", { timeZone: COLOMBO_TZ, weekday: "long" }).format(date).toLowerCase();
  },

  minutesSinceMidnight(date = new Date()) {
    const parts = colomboParts(date);
    return parts.hour * 60 + parts.minute;
  },

  formatWallClock(value) {
    const minutes = parseClockMinutes(value);
    if (minutes == null) return "";
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  },

  parseClockMinutes,

  nowIso() {
    return formatColomboIso(colomboParts(new Date()));
  },

  parse(value) {
    if (value == null || value === "") return null;
    if (value instanceof Date) return formatColomboIso(colomboParts(value));
    const text = String(value).trim();
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
      const date = new Date(text);
      if (Number.isNaN(date.getTime())) return null;
      return formatColomboIso(colomboParts(date));
    }
    return parseNaiveAsColombo(text);
  },

  format(value, options = {}) {
    const iso = this.parse(value) || this.nowIso();
    const date = new Date(iso);
    return new Intl.DateTimeFormat(options.locale || document.documentElement.lang || "en-LK", {
      timeZone: COLOMBO_TZ,
      dateStyle: options.dateStyle || "medium",
      timeStyle: options.timeStyle || "short",
      ...options,
    }).format(date);
  },

  revive(value, key = "") {
    if (value instanceof Date) return this.parse(value);
    if (Array.isArray(value)) return value.map((item) => this.revive(item));
    if (value && typeof value === "object") {
      const out = {};
      for (const [childKey, child] of Object.entries(value)) {
        out[childKey] = this.revive(child, childKey);
      }
      return out;
    }
    if (typeof value === "string" && DATE_KEY.test(key)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)) return value;
      return this.parse(value) || value;
    }
    if (typeof value === "string" && /T\d{2}:\d{2}/.test(value) && ISO_DATE.test(value)) {
      return this.parse(value) || value;
    }
    return value;
  },
};

function canon(value) {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canon(value[key])}`)
    .join(",")}}`;
}

function requestKey(method, url, body) {
  return `${method.toUpperCase()} ${url} ${body === undefined ? "" : canon(body)}`;
}

const LOG_SECRET = /token|password|secret|bearer|jwt|otp|phone|mobile|authorization|email/i;

function warnSafe(status, code, key) {
  const safeCode =
    typeof code === "string" && code.length < 40 && !LOG_SECRET.test(code) ? code : null;
  console.warn("Yamoo API error", { status, key, ...(safeCode ? { code: safeCode } : {}) });
}

function messageFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const code = payload.code || payload.error || payload.reason;
  if (typeof code === "string") {
    const key = `errors.code.${code}`;
    const translated = localize(key);
    if (translated !== key && translated !== ENGLISH_FALLBACK["errors.unknown"]) return { key, code };
    return { key: "errors.refused", code };
  }
  return null;
}

function statusKey(status) {
  if (STATUS_KEYS[status]) return STATUS_KEYS[status];
  if (status >= 500) return "errors.http.500";
  if (status >= 400) return "errors.http.400";
  return "errors.unknown";
}

async function parseBody(response) {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  const text = await response.text();
  return text || null;
}

function attachAuth(headers, auth) {
  if (auth === false) return headers;
  const token = storage.getAccessToken();
  if (!token) return headers;
  headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function request(path, options = {}) {
  await loadRuntimeConfig();
  const config = getConfig();
  const method = (options.method || "GET").toUpperCase();
  const url = resolveUrl(path);
  const debounceMs = options.debounceMs ?? config.debounceMs;
  const timeout = options.timeout ?? config.timeoutMs;
  const key = options.key || requestKey(method, url, options.body);
  const now = Date.now();

  const existing = inflight.get(key);
  if (existing) return existing.promise;

  const startedAt = lastStarted.get(key) || 0;
  if (!options.force && debounceMs > 0 && now - startedAt < debounceMs && lastSuccess.has(key)) {
    return lastSuccess.get(key);
  }

  lastStarted.set(key, now);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);

  const headers = attachAuth(
    {
      Accept: "application/json",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    options.auth,
  );

  const promise = (async () => {
    try {
      if (!navigator.onLine) throw new ApiError("errors.offline");

      const response = await fetch(url, {
        method,
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        signal: options.signal || controller.signal,
        headers,
        body: options.body !== undefined ? JSON.stringify(colombo.revive(options.body)) : undefined,
      });

      const payload = colombo.revive(await parseBody(response));

      if (!response.ok) {
        if (response.status === 401) storage.clearAuth();
        const refused = messageFromPayload(payload);
        const keyName = refused?.key || statusKey(response.status);
        warnSafe(response.status, refused?.code || payload?.code || null, keyName);
        throw new ApiError(keyName, {
          status: response.status,
          code: refused?.code || payload?.code || null,
          payload: redactSecrets(payload),
        });
      }

      lastSuccess.set(key, Promise.resolve(payload));
      return payload;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.name === "AbortError") throw new ApiError("errors.timeout", { code: "aborted" });
      if (error instanceof TypeError) throw new ApiError("errors.network");
      warnSafe(0, error.name || "error", "errors.unknown");
      throw new ApiError("errors.unknown");
    } finally {
      window.clearTimeout(timer);
      inflight.delete(key);
    }
  })();

  inflight.set(key, { controller, promise });
  return promise;
}

export function abortInflight(key) {
  if (key) {
    inflight.get(key)?.controller.abort();
    inflight.delete(key);
    return;
  }
  for (const [id, entry] of inflight) {
    entry.controller.abort();
    inflight.delete(id);
  }
}

export const api = {
  get: (path, options) => request(path, { ...options, method: "GET" }),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  put: (path, body, options) => request(path, { ...options, method: "PUT", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  del: (path, options) => request(path, { ...options, method: "DELETE" }),
  abort: abortInflight,
  configure: configureApi,
  config: getConfig,
  loadConfig: loadRuntimeConfig,
};
