const PREFIX = "yamoo:";
const MEMORY = new Map();

export const STORAGE_KEYS = Object.freeze({
  ACCESS_TOKEN: "auth.accessToken",
  REFRESH_TOKEN: "auth.refreshToken",
  SESSION: "auth.session",
  GATES: "gates",
  LOCALE: "locale",
});

const SECRET_KEY = /token|password|secret|authorization|jwt|bearer|otp|pin|phone|mobile/i;

function getStore(kind) {
  try {
    const store = kind === "session" ? window.sessionStorage : window.localStorage;
    const probe = `${PREFIX}__probe`;
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

function namespaced(key) {
  return PREFIX + key;
}

function read(key, fallback, session) {
  const store = getStore(session ? "session" : "local");
  const id = namespaced(key);

  try {
    const raw = store ? store.getItem(id) : MEMORY.get(id);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value, session) {
  const id = namespaced(key);
  const serialized = JSON.stringify(value);
  const store = getStore(session ? "session" : "local");

  if (store) store.setItem(id, serialized);
  else MEMORY.set(id, serialized);
}

function drop(key, session) {
  const id = namespaced(key);
  const store = getStore(session ? "session" : "local");
  if (store) store.removeItem(id);
  MEMORY.delete(id);
}

function dropBoth(key) {
  drop(key, false);
  drop(key, true);
}

export function redactSecrets(value, seen = new WeakSet()) {
  if (typeof value === "string") {
    return SECRET_KEY.test(value) || looksLikeJwt(value) || looksLikePhone(value)
      ? "[redacted]"
      : value.replace(PHONE_RE, "[redacted]").replace(JWT_RE, "[redacted]");
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[cycle]";
    seen.add(value);
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : redactSecrets(nested, seen);
    }
    return out;
  }
  return value;
}

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const PHONE_RE = /(?<!\d)(?:\+?94|0)?7\d[\d\s-]{7,12}(?!\d)/g;

function looksLikeJwt(value) {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function looksLikePhone(value) {
  const digits = value.replace(/\D/g, "");
  return /^(?:94)?7\d{8}$/.test(digits);
}

export const storage = {
  get(key, fallback = null, { session = false } = {}) {
    return read(key, fallback, session);
  },

  set(key, value, { session = false } = {}) {
    write(key, value, session);
  },

  remove(key, { session = false } = {}) {
    drop(key, session);
  },

  clearNamespace() {
    for (const store of [getStore("local"), getStore("session")]) {
      if (!store) continue;
      const keys = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key?.startsWith(PREFIX)) keys.push(key);
      }
      keys.forEach((key) => store.removeItem(key));
    }
    MEMORY.clear();
  },

  getAccessToken() {
    return read(STORAGE_KEYS.ACCESS_TOKEN, null, true) || read(STORAGE_KEYS.ACCESS_TOKEN, null, false);
  },

  setAccessToken(token, { persist = false } = {}) {
    dropBoth(STORAGE_KEYS.ACCESS_TOKEN);
    if (!token) return;
    write(STORAGE_KEYS.ACCESS_TOKEN, String(token), !persist);
  },

  getRefreshToken() {
    return read(STORAGE_KEYS.REFRESH_TOKEN, null, true) || read(STORAGE_KEYS.REFRESH_TOKEN, null, false);
  },

  setRefreshToken(token, { persist = false } = {}) {
    dropBoth(STORAGE_KEYS.REFRESH_TOKEN);
    if (!token) return;
    write(STORAGE_KEYS.REFRESH_TOKEN, String(token), !persist);
  },

  getSession() {
    return read(STORAGE_KEYS.SESSION, null, true) || read("session", null, true);
  },

  setSession(session) {
    write(STORAGE_KEYS.SESSION, session, true);
    drop("session", true);
  },

  clearAuth() {
    dropBoth(STORAGE_KEYS.ACCESS_TOKEN);
    dropBoth(STORAGE_KEYS.REFRESH_TOKEN);
    dropBoth(STORAGE_KEYS.SESSION);
    drop("session", true);
  },

  clearSessionData() {
    this.clearAuth();
    this.setGates({});
    for (const kind of ["local", "session"]) {
      const store = getStore(kind);
      if (!store) continue;
      const keys = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key?.startsWith(PREFIX) && /token|session|auth|gate/i.test(key)) keys.push(key);
      }
      keys.forEach((key) => store.removeItem(key));
    }
  },

  getLocale(fallback = "en") {
    return read(STORAGE_KEYS.LOCALE, fallback, false);
  },

  setLocale(locale) {
    write(STORAGE_KEYS.LOCALE, locale, false);
  },

  getGates() {
    const gates = read(STORAGE_KEYS.GATES, {}, false);
    return gates && typeof gates === "object" ? { ...gates } : {};
  },

  getGate(name, fallback = false) {
    const gates = this.getGates();
    return Object.prototype.hasOwnProperty.call(gates, name) ? gates[name] : fallback;
  },

  setGate(name, value) {
    const gates = this.getGates();
    gates[String(name)] = value;
    write(STORAGE_KEYS.GATES, gates, false);
    return gates;
  },

  setGates(next) {
    write(STORAGE_KEYS.GATES, { ...next }, false);
  },

  hasGates(names = []) {
    const gates = this.getGates();
    return names.every((name) => Boolean(gates[name]));
  },

  snapshot() {
    return redactSecrets({
      locale: this.getLocale(),
      gates: this.getGates(),
      session: this.getSession(),
      hasAccessToken: Boolean(this.getAccessToken()),
      hasRefreshToken: Boolean(this.getRefreshToken()),
    });
  },
};
