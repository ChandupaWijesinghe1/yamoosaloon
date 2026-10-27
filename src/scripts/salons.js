import { api, ApiError, colombo } from "./api.js";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const TTL_MS = 45_000;
const listeners = new Set();

function originPath(pathname, query) {
  const url = new URL(pathname, window.location.origin);
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  return url.href;
}

function asList(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function textBlob(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function asTags(raw, services = []) {
  const fromRaw = asList(raw, ["tags", "categories", "labels"])
    .concat(Array.isArray(raw) ? raw : [])
    .map((item) => textBlob(typeof item === "object" ? item.id || item.slug || item.name : item))
    .filter(Boolean);
  const fromServices = services.map((item) => textBlob(item.name || item));
  return [...new Set([...fromRaw, ...fromServices])];
}

function matchesQuery(salon, query) {
  const needle = textBlob(query);
  if (!needle) return true;
  const haystack = [
    salon.name,
    salon.address,
    salon.city,
    salon.location,
    salon.area,
    ...(salon.tags || []),
    ...(salon.services || []).map((item) => item.name || item),
  ]
    .map(textBlob)
    .join(" ");
  return needle.split(" ").every((part) => haystack.includes(part));
}

function matchesTag(salon, tag) {
  const needle = textBlob(tag);
  if (!needle) return true;
  if (needle === "top-rated" || needle === "toprated") return Number(salon.rating) >= 4.7;
  const tags = (salon.tags || []).map(textBlob);
  if (tags.includes(needle) || tags.some((item) => item.includes(needle) || needle.includes(item))) return true;
  return (salon.services || []).some((item) => textBlob(item.name || item).includes(needle.replace("-", " ")));
}

function cacheKey(query = "", tag = "") {
  return `${String(query || "").trim()}::${String(tag || "").trim()}`;
}

function asService(raw, index = 0) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    return { id: `${index}-${raw}`, name: raw, durationMin: null, priceLkr: null };
  }
  if (typeof raw !== "object") return null;
  const price = raw.priceLkr ?? raw.price ?? raw.amount ?? null;
  return {
    id: String(raw.id || raw.slug || raw.name || index),
    name: String(raw.name || raw.title || raw.service || "Service"),
    description: String(raw.description || raw.details || raw.summary || ""),
    category: String(raw.category || raw.group || raw.section || "other"),
    categoryLabel: String(raw.categoryLabel || raw.categoryName || raw.groupName || ""),
    durationMin: Number(raw.durationMin || raw.duration || raw.minutes) || null,
    priceLkr: price == null || price === "" ? null : Number(price),
  };
}

function asReview(raw, salonId) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: String(raw.id || raw.reviewId || `${salonId}-${raw.createdAt || Math.random()}`),
    salonId: String(raw.salonId || salonId || ""),
    author: String(raw.author || raw.name || raw.userName || "Guest"),
    rating: Number(raw.rating || raw.stars) || 0,
    body: String(raw.body || raw.text || raw.comment || ""),
    createdAt: raw.createdAt || raw.postedAt || raw.created_at || null,
  };
}

function asHoursMap(raw) {
  const map = {};
  if (!raw) return map;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const day = textBlob(item?.day || item?.weekday || item?.name).replace(/s$/, "");
      if (!day) continue;
      map[day] = item.closed === true || item.open === false ? null : { open: item.open, close: item.close };
    }
    return map;
  }
  if (typeof raw !== "object") return map;
  for (const [key, value] of Object.entries(raw)) {
    const day = textBlob(key);
    if (value == null || value === false || value === "closed") {
      map[day] = null;
      continue;
    }
    if (typeof value === "string") {
      const [open, close] = value.split(/\s*[-–]\s*/);
      map[day] = open && close ? { open, close } : null;
      continue;
    }
    if (typeof value === "object") {
      map[day] = value.closed === true ? null : { open: value.open, close: value.close };
    }
  }
  return map;
}

function asSalon(raw) {
  if (!raw || typeof raw !== "object") return null;
  const services = asList(raw, ["services", "serviceList"]).map(asService).filter(Boolean);
  const hours = asHoursMap(raw.hours || raw.workingHours || raw.openingHours);
  const id = String(raw.id || raw.slug || raw.ownerId || raw.saloonId || "");
  if (!id) return null;
  return {
    id,
    ownerId: String(raw.ownerId || raw.saloonOwnerId || id),
    name: String(raw.name || raw.title || raw.salonName || raw.businessName || "Salon"),
    rating: Number(raw.rating || raw.averageRating || raw.stars) || 0,
    reviewCount: Number(raw.reviewCount || raw.reviews || raw.ratingCount) || 0,
    address: String(raw.address || raw.streetAddress || ""),
    city: String(raw.city || raw.town || ""),
    location: String(raw.location || raw.area || raw.city || raw.town || raw.address || ""),
    cover: String(raw.cover || raw.coverPhoto || raw.coverUrl || raw.image || raw.photo || ""),
    services,
    tags: asTags(raw.tags || raw.categories, services),
    featured: raw.featured === true || raw.promoted === true || raw.isFeatured === true,
    confirmation: /manual/.test(textBlob(raw.confirmation || raw.bookingMode || raw.approval)) ? "manual" : "auto",
    distanceKm: raw.distanceKm == null && raw.distance == null ? null : Number(raw.distanceKm ?? raw.distance),
    promo: String(raw.promo || raw.banner || raw.caption || ""),
    hours,
    saved: raw.saved === true || raw.bookmarked === true || raw.isSaved === true,
  };
}

function asPost(raw, fallbackSalon) {
  if (!raw || typeof raw !== "object") return null;
  const salon = asSalon(raw.salon || raw.owner || raw.saloon) || fallbackSalon || null;
  return {
    id: String(raw.id || raw.postId || `${salon?.id || "post"}-${raw.createdAt || Math.random()}`),
    salonId: String(raw.salonId || raw.ownerId || salon?.id || ""),
    salonName: String(raw.salonName || salon?.name || ""),
    caption: String(raw.caption || raw.body || raw.text || raw.title || ""),
    image: String(raw.image || raw.photo || raw.cover || salon?.cover || ""),
    createdAt: raw.createdAt || raw.postedAt || raw.created_at || null,
    salon,
  };
}

function hoursForDay(hours, dayKey) {
  if (!hours) return null;
  return hours[dayKey] || hours[dayKey.slice(0, 3)] || null;
}

function isOpenNow(hours, date = new Date()) {
  const day = colombo.weekdayKey(date);
  const slot = hoursForDay(hours, day);
  if (!slot?.open || !slot?.close) return false;
  const now = colombo.minutesSinceMidnight(date);
  const open = colombo.parseClockMinutes(slot.open);
  const close = colombo.parseClockMinutes(slot.close);
  if (open == null || close == null) return false;
  if (close < open) return now >= open || now < close;
  return now >= open && now < close;
}

function weekHours(hours) {
  return WEEKDAYS.map((day) => {
    const slot = hoursForDay(hours, day);
    if (!slot?.open || !slot?.close) return { day, closed: true, open: "", close: "" };
    return {
      day,
      closed: false,
      open: colombo.formatWallClock(slot.open),
      close: colombo.formatWallClock(slot.close),
    };
  });
}

function cacheFresh(entry, query, tag = "") {
  return Boolean(entry && entry.query === cacheKey(query, tag) && Date.now() - entry.at < TTL_MS);
}

function applySaved(salon) {
  return { ...salon, saved: state.saved.has(salon.id) || salon.saved };
}

const state = {
  owners: { query: null, items: [], at: 0, status: "idle", error: null },
  explore: { query: null, items: [], featured: [], at: 0, status: "idle", error: null },
  feeds: new Map(),
  services: new Map(),
  reviews: new Map(),
  saved: new Set(),
  savedLoaded: false,
};

function notify() {
  listeners.forEach((fn) => fn(salons.snapshot()));
}

async function loadSaved(force = false) {
  if (state.savedLoaded && !force) return [...state.saved];
  try {
    const payload = await api.get(originPath("/saved-salons"), { force: true });
    const ids = asList(payload, ["items", "saved", "salons", "ids"])
      .map((item) => (typeof item === "object" ? item.id || item.salonId : item))
      .filter(Boolean)
      .map(String);
    state.saved = new Set(ids);
    state.savedLoaded = true;
  } catch {
    state.savedLoaded = true;
  }
  return [...state.saved];
}

export const salons = {
  snapshot() {
    return {
      owners: state.owners.items.map(applySaved),
      feed: state.explore.items,
      saved: [...state.saved],
      ownersStatus: state.owners.status,
      feedStatus: state.explore.status,
      error: state.owners.error || state.explore.error,
    };
  },

  matchesQuery,
  matchesTag,
  isOpenNow,
  weekHours,
  hoursForDay,

  todayHours(hours, date = new Date()) {
    const day = colombo.weekdayKey(date);
    const slot = hoursForDay(hours, day);
    if (!slot?.open || !slot?.close) return { day, closed: true, open: "", close: "", openNow: false };
    return {
      day,
      closed: false,
      open: colombo.formatWallClock(slot.open),
      close: colombo.formatWallClock(slot.close),
      openNow: isOpenNow(hours, date),
    };
  },

  isSaved(id) {
    return state.saved.has(String(id));
  },

  cachedOwners(query = "", tag = "") {
    return cacheFresh(state.owners, query, tag) ? state.owners.items.map(applySaved) : null;
  },

  cachedExplore(query = "", tag = "") {
    return cacheFresh(state.explore, query, tag) ? state.explore.items : null;
  },

  cachedFeatured(query = "", tag = "") {
    return cacheFresh(state.explore, query, tag) ? state.explore.featured || [] : null;
  },

  filterOwners(query, tag = "") {
    return state.owners.items
      .map(applySaved)
      .filter((item) => matchesQuery(item, query) && matchesTag(item, tag));
  },

  async listOwners(query = "", { force = false, tag = "" } = {}) {
    const q = String(query || "").trim();
    const chip = String(tag || "").trim();
    if (!force && cacheFresh(state.owners, q, chip)) {
      return state.owners.items.map(applySaved);
    }
    state.owners.status = "loading";
    state.owners.error = null;
    notify();
    try {
      const payload = await api.get(originPath("/saloon-owners", { q, query: q, search: q, tag: chip }), { force: true });
      const items = asList(payload, ["owners", "salons", "items", "data", "results"]).map(asSalon).filter(Boolean);
      state.owners = { query: cacheKey(q, chip), items, at: Date.now(), status: "ready", error: null };
    } catch (error) {
      state.owners.status = "error";
      state.owners.error = error instanceof ApiError ? error : new ApiError("errors.unknown");
      notify();
      throw state.owners.error;
    }
    notify();
    return state.owners.items.map(applySaved);
  },

  async listExplore(query = "", { force = false, tag = "" } = {}) {
    const q = String(query || "").trim();
    const chip = String(tag || "").trim();
    if (!force && cacheFresh(state.explore, q, chip)) return state.explore.items;
    state.explore.status = "loading";
    state.explore.error = null;
    notify();
    try {
      const payload = await api.get(originPath("/feed/explore", { q, query: q, search: q, tag: chip }), { force: true });
      const items = asList(payload, ["feed", "posts", "items", "data", "results"]).map((item) => asPost(item)).filter(Boolean);
      const featured = asList(payload, ["featured", "promoted", "banners"])
        .map(asSalon)
        .filter(Boolean)
        .map(applySaved);
      state.explore = { query: cacheKey(q, chip), items, featured, at: Date.now(), status: "ready", error: null };
    } catch (error) {
      state.explore.status = "error";
      state.explore.error = error instanceof ApiError ? error : new ApiError("errors.unknown");
      notify();
      throw state.explore.error;
    }
    notify();
    return state.explore.items;
  },

  async loadDiscover(query = "", tag = "") {
    const q = String(query || "").trim();
    const chip = String(tag || "").trim();
    await loadSaved();
    const ownersTask = this.listOwners(q, { tag: chip });
    const feedTask = this.listExplore(q, { tag: chip });
    const [owners, feed] = await Promise.allSettled([ownersTask, feedTask]);
    const featured =
      state.explore.featured?.length
        ? state.explore.featured
        : (owners.status === "fulfilled" ? owners.value : this.filterOwners(q, chip)).filter((item) => item.featured);
    return {
      owners: owners.status === "fulfilled" ? owners.value : this.filterOwners(q, chip),
      feed: feed.status === "fulfilled" ? feed.value : state.explore.items,
      featured,
      error: (owners.status === "rejected" && owners.reason) || (feed.status === "rejected" && feed.reason) || null,
    };
  },

  async salonFeed(id, { force = false } = {}) {
    const salonId = String(id || "");
    const cached = state.feeds.get(salonId);
    if (!force && cached && Date.now() - cached.at < TTL_MS) return cached;
    const payload = await api.get(originPath(`/feed/salon/${encodeURIComponent(salonId)}`), { force: true });
    const salon = asSalon(payload?.salon || payload?.owner || payload?.saloon) || asSalon(payload) || null;
    const posts = asList(payload, ["posts", "feed", "items", "data"]).map((item) => asPost(item, salon)).filter(Boolean);
    const next = { salon: salon ? applySaved(salon) : null, posts, at: Date.now() };
    state.feeds.set(salonId, next);
    return next;
  },

  async ownerServices(ownerId, { force = false } = {}) {
    const id = String(ownerId || "");
    const cached = state.services.get(id);
    if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.items;
    const paths = [`/services/owner/${encodeURIComponent(id)}`, `/services/owner/${encodeURIComponent(id)}/services`, `/services/owner/${encodeURIComponent(id)}/list`];
    let lastError = null;
    for (const path of paths) {
      try {
        const payload = await api.get(originPath(path), { force: true });
        const items = asList(payload, ["services", "items", "data", "results"]).map(asService).filter(Boolean);
        state.services.set(id, { items, at: Date.now() });
        return items;
      } catch (error) {
        lastError = error;
        if (error instanceof ApiError && error.status && error.status !== 404) break;
      }
    }
    if (lastError && lastError.status && lastError.status !== 404) throw lastError;
    state.services.set(id, { items: [], at: Date.now() });
    return [];
  },

  async listReviews(salonId, { force = false } = {}) {
    const id = String(salonId || "");
    const cached = state.reviews.get(id);
    if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.items;
    try {
      const payload = await api.get(originPath(`/reviews/salon/${encodeURIComponent(id)}`), { force: true });
      const items = asList(payload, ["reviews", "items", "data", "results"]).map((item) => asReview(item, id)).filter(Boolean);
      state.reviews.set(id, { items, at: Date.now() });
      return items;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        state.reviews.set(id, { items: [], at: Date.now() });
        return [];
      }
      throw error;
    }
  },

  async report({ type, targetId, reason } = {}) {
    const kind = String(type || "salon");
    const id = String(targetId || "");
    const body = { type: kind, targetId: id, reason: String(reason || "other"), reportedAt: colombo.nowIso() };
    if (kind === "post") {
      try {
        return await api.post(originPath(`/feed/posts/${encodeURIComponent(id)}/report`), body, { force: true });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
    }
    const paths = [`/reports/${kind}/${encodeURIComponent(id)}`, "/reports"];
    let lastError = null;
    for (const path of paths) {
      try {
        return await api.post(originPath(path), body, { force: true });
      } catch (error) {
        lastError = error;
        if (error instanceof ApiError && error.status && error.status !== 404) break;
      }
    }
    throw lastError instanceof ApiError ? lastError : new ApiError("errors.unknown");
  },

  async listSaved({ force = true } = {}) {
    const payload = await api.get(originPath("/saved-salons"), { force });
    const raw = asList(payload, ["items", "saved", "salons", "ids"]);
    const hydrated = [];
    const ids = [];
    for (const entry of raw) {
      if (entry && typeof entry === "object" && (entry.name || entry.cover || entry.address)) {
        const salon = applySaved({ ...asSalon(entry), saved: true });
        if (!salon?.id) continue;
        hydrated.push(salon);
        ids.push(salon.id);
      } else {
        const id = String(entry?.id || entry?.salonId || entry || "");
        if (id) ids.push(id);
      }
    }
    state.saved = new Set(ids);
    state.savedLoaded = true;
    if (hydrated.length) return hydrated;
    const owners = await this.listOwners("", { force: false });
    return ids
      .map((id) => owners.find((item) => item.id === id))
      .filter(Boolean)
      .map((item) => applySaved({ ...item, saved: true }));
  },

  async unsave(id) {
    const salonId = String(id || "");
    if (!salonId) return false;
    const had = state.saved.has(salonId);
    state.saved.delete(salonId);
    notify();
    try {
      await api.del(originPath(`/saved-salons/${encodeURIComponent(salonId)}`), { force: true });
      return false;
    } catch (error) {
      if (had) state.saved.add(salonId);
      notify();
      throw error instanceof ApiError ? error : new ApiError("errors.unknown");
    }
  },

  async toggleSaved(id) {
    const salonId = String(id || "");
    const next = !state.saved.has(salonId);
    if (next) state.saved.add(salonId);
    else state.saved.delete(salonId);
    notify();
    try {
      if (next) {
        await api.post(originPath("/saved-salons"), { salonId, saved: true }, { force: true });
      } else {
        await api.del(originPath(`/saved-salons/${encodeURIComponent(salonId)}`), { force: true });
      }
    } catch (error) {
      if (next) state.saved.delete(salonId);
      else state.saved.add(salonId);
      notify();
      throw error instanceof ApiError ? error : new ApiError("errors.unknown");
    }
    return next;
  },

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
