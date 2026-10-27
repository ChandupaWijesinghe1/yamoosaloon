import { api, ApiError } from "./api.js";

function originPath(pathname) {
  return new URL(pathname, window.location.origin).href;
}

function asList(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function asNotice(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || raw.noticeId || "");
  if (!id) return null;
  const kind = /remind/.test(String(raw.kind || raw.type || ""))
    ? "reminder"
    : /appoint|booking|status/.test(String(raw.kind || raw.type || ""))
      ? "appointment"
      : "system";
  return {
    id,
    kind,
    title: String(raw.title || raw.headline || ""),
    body: String(raw.body || raw.message || raw.text || ""),
    titleKey: String(raw.titleKey || ""),
    bodyKey: String(raw.bodyKey || ""),
    createdAt: raw.createdAt || raw.at || raw.sentAt || null,
    read: raw.read === true || raw.seen === true,
    href: String(raw.href || raw.url || raw.link || "/notices"),
  };
}

const state = {
  items: [],
  unreadCount: 0,
  loaded: false,
};

export const notices = {
  snapshot() {
    return { items: state.items.map((item) => ({ ...item })), unreadCount: state.unreadCount };
  },

  async list({ force = true } = {}) {
    const payload = await api.get(originPath("/notices"), { force });
    state.items = asList(payload, ["items", "notices", "data"]).map(asNotice).filter(Boolean);
    state.unreadCount = Number(payload?.unreadCount);
    if (Number.isNaN(state.unreadCount)) {
      state.unreadCount = state.items.filter((item) => !item.read).length;
    }
    state.loaded = true;
    return state.items;
  },

  async unreadCount({ force = true } = {}) {
    try {
      const payload = await api.get(originPath("/notices/unread-count"), { force });
      state.unreadCount = Number(payload?.unreadCount ?? payload?.count ?? 0) || 0;
      return state.unreadCount;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return state.unreadCount;
      throw error;
    }
  },

  async readAll() {
    const previous = state.items.map((item) => ({ ...item }));
    const previousCount = state.unreadCount;
    state.items = state.items.map((item) => ({ ...item, read: true }));
    state.unreadCount = 0;
    try {
      const payload = await api.post(originPath("/notices/read-all"), { read: true, readAt: new Date().toISOString() }, { force: true });
      if (payload?.items) state.items = asList(payload, ["items", "notices"]).map(asNotice).filter(Boolean);
      state.unreadCount = Number(payload?.unreadCount ?? 0) || 0;
    } catch (error) {
      state.items = previous;
      state.unreadCount = previousCount;
      throw error instanceof ApiError ? error : new ApiError("errors.unknown");
    }
    return state.unreadCount;
  },

  async readOne(id) {
    const noticeId = String(id || "");
    const item = state.items.find((entry) => entry.id === noticeId);
    if (item && !item.read) {
      item.read = true;
      state.unreadCount = Math.max(0, state.unreadCount - 1);
    }
    try {
      await api.post(originPath(`/notices/${encodeURIComponent(noticeId)}/read`), { read: true }, { force: true });
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 405)) throw error;
    }
    return state.unreadCount;
  },
};
