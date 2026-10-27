import { storage } from "./storage.js";
import { bindI18n } from "./i18n-bind.js";

export const LOCALES = Object.freeze(["en", "si", "singlish"]);
export const FALLBACK_LOCALE = "en";

const DICT_BASE = "/src/i18n";
const cache = new Map();
const pending = new Map();
const listeners = new Set();

const HTML_LANG = {
  en: "en",
  si: "si",
  singlish: "en",
};

export function normalizeLocale(value) {
  const raw = String(value || "")
    .toLowerCase()
    .trim();
  if (raw === "singlish" || raw === "si-latn" || raw === "en-lk-latn") return "singlish";
  if (raw === "si" || raw === "sin" || raw.startsWith("si-")) return "si";
  if (raw === "en" || raw.startsWith("en-")) return "en";
  return FALLBACK_LOCALE;
}

function interpolate(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, name) =>
    vars[name] == null ? "" : String(vars[name]),
  );
}

async function fetchDictionary(locale) {
  const response = await fetch(`${DICT_BASE}/${locale}.json`, {
    cache: "no-store",
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to load locale "${locale}" (${response.status})`);
  }
  return response.json();
}

export const i18n = {
  locale: FALLBACK_LOCALE,
  ready: Promise.resolve(),

  t(key, vars = {}) {
    const table = cache.get(this.locale) || {};
    const fallback = cache.get(FALLBACK_LOCALE) || {};
    const template = table[key] ?? fallback[key];
    if (template == null) return key;
    return interpolate(template, vars);
  },

  has(key) {
    const table = cache.get(this.locale) || {};
    const fallback = cache.get(FALLBACK_LOCALE) || {};
    return key in table || key in fallback;
  },

  applyToDocument() {
    const html = document.documentElement;
    html.lang = HTML_LANG[this.locale] || "en";
    html.dataset.locale = this.locale;
    document.title = this.t("meta.title");
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", this.t("meta.description"));
  },

  async load(locale) {
    const id = normalizeLocale(locale);
    if (cache.has(id)) return cache.get(id);
    if (pending.has(id)) return pending.get(id);
    const request = fetchDictionary(id)
      .then((dict) => {
        cache.set(id, dict);
        pending.delete(id);
        return dict;
      })
      .catch((error) => {
        pending.delete(id);
        throw error;
      });
    pending.set(id, request);
    return request;
  },

  async setLocale(locale, { persist = true, bind = true } = {}) {
    const next = normalizeLocale(locale);
    if (next !== FALLBACK_LOCALE) {
      await this.load(FALLBACK_LOCALE).catch(() => {});
    }
    await this.load(next);
    this.locale = next;
    if (persist) storage.setLocale(next);
    this.applyToDocument();
    if (bind) bindI18n(document);
    listeners.forEach((fn) => fn(next));
    return next;
  },

  async init() {
    const stored = storage.getLocale(null) || document.documentElement.dataset.locale || FALLBACK_LOCALE;
    this.ready = this.setLocale(stored);
    await this.ready;
    return this.locale;
  },

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
