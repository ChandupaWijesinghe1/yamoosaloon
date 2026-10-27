import { i18n } from "./i18n.js";
import { bindI18n } from "./i18n-bind.js";
import { colombo, ApiError } from "./api.js";
import { router } from "./router.js";
import { salons } from "./salons.js";

let discoverGen = 0;
let salonGen = 0;
let searchTimer = 0;

const lazyObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            promoteImage(entry.target);
            lazyObserver.unobserve(entry.target);
          }
        },
        { rootMargin: "240px 0px" },
      )
    : null;

function varsAttr(vars) {
  return JSON.stringify(vars).replaceAll("&", "&amp;").replaceAll("'", "&#39;");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function promoteImage(img) {
  const src = img.getAttribute("data-src");
  if (!src) return;
  img.src = src;
  img.removeAttribute("data-src");
  img.addEventListener(
    "load",
    () => {
      img.classList.add("is-loaded");
      img.closest(".media-frame")?.classList.add("is-ready");
    },
    { once: true },
  );
  if (img.complete && img.naturalWidth) {
    img.classList.add("is-loaded");
    img.closest(".media-frame")?.classList.add("is-ready");
  }
}

export function hydrateLazyImages(root, { eager = 0 } = {}) {
  const images = [...(root?.querySelectorAll("img[data-src]") || [])];
  images.forEach((img, index) => {
    if (index < eager || !lazyObserver) {
      if (index < eager) img.setAttribute("fetchpriority", "high");
      promoteImage(img);
      return;
    }
    lazyObserver.observe(img);
  });
}

export function bindColomboTimes(root = document) {
  const locale = i18n.locale === "si" ? "si-LK" : "en-LK";
  root.querySelectorAll("[data-colombo-time]").forEach((node) => {
    const value = node.getAttribute("data-colombo-time");
    if (!value) return;
    node.textContent = colombo.format(value, { locale });
    node.setAttribute("datetime", colombo.parse(value) || value);
  });
}

function skeletonCards(count, kind) {
  return Array.from({ length: count }, (_, index) => {
    if (kind === "feed") {
      return `<article class="feed-card skeleton-card" aria-hidden="true"><div class="media-frame skeleton"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></article>`;
    }
    return `<article class="salon-card skeleton-card" aria-hidden="true"><div class="media-frame skeleton"></div><div class="salon-card-body"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div><div class="skeleton skeleton-line"></div></div></article>`;
  }).join("");
}

function saveButton(id, saved) {
  const key = saved ? "discover.saved" : "discover.save";
  const icon = saved ? "/public/assets/icons/heart-on.svg" : "/public/assets/icons/heart.svg";
  return `
    <button class="icon-button salon-save" type="button" data-save-salon="${escapeHtml(id)}" aria-pressed="${saved ? "true" : "false"}" data-i18n-aria="${key}">
      <img src="${icon}" alt="" width="22" height="22">
    </button>
  `;
}

function ratingLine(salon) {
  const rating = salon.rating ? salon.rating.toFixed(1) : "—";
  return `
    <p class="salon-rating">
      <span aria-hidden="true">★</span>
      <span class="i18n-text" data-i18n="salon.rating" data-i18n-vars='${varsAttr({ rating, count: salon.reviewCount || 0 })}'></span>
    </p>
  `;
}

function coverFrame(src, alt, { eager = false } = {}) {
  if (!src) {
    return `<div class="media-frame media-fallback" aria-hidden="true"></div>`;
  }
  const safeAlt = escapeHtml(alt || "");
  const loading = eager ? "eager" : "lazy";
  const fetchPriority = eager ? ` fetchpriority="high"` : "";
  return `
    <div class="media-frame">
      <div class="skeleton media-placeholder" aria-hidden="true"></div>
      <img alt="${safeAlt}" width="640" height="360" loading="${loading}" decoding="async"${fetchPriority} data-src="${escapeHtml(src)}">
    </div>
  `;
}

function renderSalonCard(salon, index) {
  const href = `/salon/${encodeURIComponent(salon.id)}`;
  const address = [salon.address, salon.city].filter(Boolean).join(", ") || salon.location;
  return `
    <article class="salon-card">
      <a class="salon-card-main" data-link href="${href}">
        ${coverFrame(salon.cover, salon.name, { eager: index < 2 })}
        <div class="salon-card-body">
          <h3>${escapeHtml(salon.name)}</h3>
          ${ratingLine(salon)}
          <p class="salon-address">${escapeHtml(address)}</p>
        </div>
      </a>
      ${saveButton(salon.id, salon.saved || salons.isSaved(salon.id))}
    </article>
  `;
}

function renderFeedCard(post) {
  const href = post.salonId ? `/salon/${encodeURIComponent(post.salonId)}` : "/explore";
  return `
    <article class="feed-card">
      <a class="feed-card-link" data-link href="${href}">
        ${coverFrame(post.image, post.salonName || post.caption)}
        <div class="feed-card-body">
          <p class="feed-kicker">${escapeHtml(post.salonName)}</p>
          <p class="feed-caption">${escapeHtml(post.caption)}</p>
          ${
            post.createdAt
              ? `<time data-colombo-time="${escapeHtml(post.createdAt)}"></time>`
              : ""
          }
        </div>
      </a>
    </article>
  `;
}

function emptyState(key) {
  return `<p class="empty-state i18n-text" data-i18n="${key}"></p>`;
}

function errorBanner(error) {
  const message = error instanceof ApiError ? error.userMessage : i18n.t("errors.unknown");
  return `<p class="banner banner-error" id="discover-error">${escapeHtml(message)}</p>`;
}

export function renderDiscover() {
  const query = String(router.query.q || router.query.query || "");
  const cachedOwners = salons.cachedOwners(query.trim());
  const cachedFeed = salons.cachedExplore(query.trim());
  const ownersHtml = cachedOwners
    ? cachedOwners.length
      ? cachedOwners.map(renderSalonCard).join("")
      : emptyState("discover.empty")
    : skeletonCards(6, "salon");
  const feedHtml = cachedFeed
    ? cachedFeed.length
      ? cachedFeed.map(renderFeedCard).join("")
      : emptyState("discover.feed.empty")
    : skeletonCards(3, "feed");

  return `
    <section class="page page-wide discover">
      <header class="discover-head">
        <p class="lede i18n-text" data-i18n="discover.eyebrow"></p>
        <h1 class="i18n-text" data-i18n="discover.title"></h1>
        <p class="i18n-text" data-i18n="discover.lede"></p>
        <form id="discover-search" class="search-bar" role="search">
          <label class="visually-hidden" for="discover-q" data-i18n="discover.search.label"></label>
          <input class="field" id="discover-q" name="q" type="search" value="${escapeHtml(query)}" autocomplete="off" data-i18n-placeholder="discover.search.placeholder" data-i18n-aria="discover.search.label">
          <button class="btn btn-primary" type="submit" data-i18n="discover.search.submit"></button>
        </form>
      </header>
      <div id="discover-error-slot"></div>
      <p class="visually-hidden" id="discover-status" aria-live="polite"></p>
      <section class="discover-section" aria-labelledby="salon-list-title">
        <h2 id="salon-list-title" class="i18n-text" data-i18n="discover.salons"></h2>
        <div id="salon-list" class="salon-grid" aria-busy="${cachedOwners ? "false" : "true"}">${ownersHtml}</div>
      </section>
      <section class="discover-section" aria-labelledby="explore-feed-title">
        <h2 id="explore-feed-title" class="i18n-text" data-i18n="discover.feed"></h2>
        <div id="explore-feed" class="feed-list" aria-busy="${cachedFeed ? "false" : "true"}">${feedHtml}</div>
      </section>
    </section>
  `;
}

function fillDiscover(root, { owners, feed, error, query }) {
  const list = root.querySelector("#salon-list");
  const feedNode = root.querySelector("#explore-feed");
  const errorSlot = root.querySelector("#discover-error-slot");
  const status = root.querySelector("#discover-status");
  if (list) {
    list.innerHTML = owners.length ? owners.map(renderSalonCard).join("") : emptyState("discover.empty");
    list.setAttribute("aria-busy", "false");
  }
  if (feedNode) {
    const visible = feed.filter((post) => !query || salons.matchesQuery(post.salon || { name: post.salonName, address: "", services: [] }, query));
    feedNode.innerHTML = visible.length ? visible.map(renderFeedCard).join("") : emptyState("discover.feed.empty");
    feedNode.setAttribute("aria-busy", "false");
  }
  if (errorSlot) errorSlot.innerHTML = error ? `${errorBanner(error)}<button class="btn btn-ghost" type="button" data-action="discover-retry" data-i18n="discover.retry"></button>` : "";
  if (status) status.textContent = i18n.t("discover.results", { count: owners.length });
  bindI18n(root);
  bindColomboTimes(root);
  hydrateLazyImages(root, { eager: 2 });
  bindSaves(root);
  root.querySelector("[data-action='discover-retry']")?.addEventListener("click", () => mountDiscover(root, { force: true }));
}

async function runDiscoverQuery(root, query, { force = false } = {}) {
  const gen = ++discoverGen;
  const q = String(query || "").trim();
  const list = root.querySelector("#salon-list");
  const feedNode = root.querySelector("#explore-feed");
  const cachedOwners = !force && salons.cachedOwners(q);
  const cachedFeed = !force && salons.cachedExplore(q);
  if (!cachedOwners && list) {
    list.innerHTML = skeletonCards(6, "salon");
    list.setAttribute("aria-busy", "true");
  }
  if (!cachedFeed && feedNode) {
    feedNode.innerHTML = skeletonCards(3, "feed");
    feedNode.setAttribute("aria-busy", "true");
  }
  if (cachedOwners && cachedFeed) {
    fillDiscover(root, { owners: cachedOwners, feed: cachedFeed, error: null, query: q });
    return;
  }
  try {
    const result = await salons.loadDiscover(q);
    if (gen !== discoverGen) return;
    fillDiscover(root, { ...result, query: q });
  } catch (error) {
    if (gen !== discoverGen) return;
    fillDiscover(root, { owners: salons.filterOwners(q), feed: salons.cachedExplore(q) || [], error, query: q });
  }
}

function scheduleSearch(root, query) {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    const next = `/explore${query ? `?q=${encodeURIComponent(query)}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState({ path: next }, "", next);
      router.query = query ? { q: query } : {};
    }
    runDiscoverQuery(root, query);
  }, 280);
}

export function bindDiscover(root) {
  const form = root.querySelector("#discover-search");
  const input = root.querySelector("#discover-q");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(searchTimer);
    const query = String(input?.value || "").trim();
    const next = `/explore${query ? `?q=${encodeURIComponent(query)}` : ""}`;
    router.navigate(next, { replace: true });
  });
  input?.addEventListener("input", () => {
    const local = salons.filterOwners(input.value);
    const list = root.querySelector("#salon-list");
    if (list && local.length) {
      list.innerHTML = local.map(renderSalonCard).join("");
      bindI18n(list);
      hydrateLazyImages(list, { eager: 2 });
      bindSaves(list);
    }
    scheduleSearch(root, input.value);
  });
}

export function mountDiscover(root, { force = false } = {}) {
  const query = String(router.query.q || router.query.query || "");
  const input = root.querySelector("#discover-q");
  if (input && input.value !== query) input.value = query;
  bindSaves(root);
  hydrateLazyImages(root, { eager: 2 });
  bindColomboTimes(root);
  return runDiscoverQuery(root, query, { force });
}

function hoursList(hours) {
  const today = colombo.weekdayKey();
  return salons
    .weekHours(hours)
    .map((item) => {
      const range = item.closed
        ? `<span class="i18n-text" data-i18n="salon.hours.closedDay"></span>`
        : `<span class="i18n-text" data-i18n="salon.hours.range" data-i18n-vars='${varsAttr({ open: item.open, close: item.close })}'></span>`;
      return `
        <li class="hours-row${item.day === today ? " is-today" : ""}">
          <span class="i18n-text" data-i18n="weekday.${item.day}"></span>
          ${range}
        </li>
      `;
    })
    .join("");
}

function serviceRow(service) {
  const meta = [];
  if (service.durationMin) meta.push(i18n.t("salon.duration", { minutes: service.durationMin }));
  if (service.priceLkr != null && !Number.isNaN(service.priceLkr)) {
    meta.push(
      new Intl.NumberFormat(i18n.locale === "si" ? "si-LK" : "en-LK", {
        style: "currency",
        currency: "LKR",
        maximumFractionDigits: 0,
      }).format(service.priceLkr),
    );
  }
  return `
    <li class="service-row">
      <span>${escapeHtml(service.name)}</span>
      <span class="service-meta">${escapeHtml(meta.join(" · "))}</span>
    </li>
  `;
}

export function renderSalon() {
  return `
    <section class="page page-wide salon-feed" id="salon-feed-root">
      <p><a class="btn btn-ghost" data-link href="/explore" data-i18n="salon.back"></a></p>
      <div class="salon-hero skeleton-card" aria-busy="true">
        <div class="media-frame skeleton"></div>
        <div class="salon-hero-copy">
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line short"></div>
        </div>
      </div>
      <div class="salon-columns">
        <section>
          <h2 class="i18n-text" data-i18n="salon.services"></h2>
          <ul class="service-list" id="salon-services">${skeletonCards(4, "feed")}</ul>
        </section>
        <section>
          <h2 class="i18n-text" data-i18n="salon.hours"></h2>
          <p class="hours-zone i18n-text" data-i18n="salon.hours.zone"></p>
          <ul class="hours-list" id="salon-hours">${skeletonCards(3, "feed")}</ul>
        </section>
      </div>
      <section>
        <h2 class="i18n-text" data-i18n="salon.feed"></h2>
        <div id="salon-posts" class="feed-list">${skeletonCards(2, "feed")}</div>
      </section>
    </section>
  `;
}

function renderSalonReady(root, { salon, posts, services, error }) {
  if (!salon) {
    root.innerHTML = `
      <section class="page">
        <article class="card">
          <h1 class="i18n-text" data-i18n="salon.missing.title"></h1>
          <p class="i18n-text" data-i18n="salon.missing.body"></p>
          ${error ? errorBanner(error) : ""}
          <a class="btn btn-accent" data-link href="/explore" data-i18n="salon.back"></a>
        </article>
      </section>
    `;
    bindI18n(root);
    return;
  }

  const today = salons.todayHours(salon.hours);
  const statusKey = today.openNow ? "salon.openNow" : "salon.closedNow";
  const todayLine = today.closed
    ? i18n.t("salon.hours.closedDay")
    : i18n.t("salon.hours.range", { open: today.open, close: today.close });
  const address = [salon.address, salon.city].filter(Boolean).join(", ") || salon.location;

  root.innerHTML = `
    <section class="page page-wide salon-feed">
      <p><a class="btn btn-ghost" data-link href="/explore" data-i18n="salon.back"></a></p>
      ${error ? errorBanner(error) : ""}
      <header class="salon-hero">
        ${coverFrame(salon.cover, salon.name, { eager: true })}
        <div class="salon-hero-copy">
          <div class="salon-hero-top">
            <h1>${escapeHtml(salon.name)}</h1>
            ${saveButton(salon.id, salon.saved || salons.isSaved(salon.id))}
          </div>
          ${ratingLine(salon)}
          <p class="salon-address">${escapeHtml(address)}</p>
          <p class="salon-status">
            <span class="status-pill ${today.openNow ? "is-open" : "is-closed"} i18n-text" data-i18n="${statusKey}"></span>
            <span>${escapeHtml(todayLine)}</span>
            <span class="hours-zone i18n-text" data-i18n="salon.hours.zone"></span>
          </p>
        </div>
      </header>
      <div class="salon-columns">
        <section>
          <h2 class="i18n-text" data-i18n="salon.services"></h2>
          <ul class="service-list">${services.length ? services.map(serviceRow).join("") : emptyState("salon.services.empty")}</ul>
        </section>
        <section>
          <h2 class="i18n-text" data-i18n="salon.hours"></h2>
          <p class="hours-zone i18n-text" data-i18n="salon.hours.zone"></p>
          <ul class="hours-list">${hoursList(salon.hours)}</ul>
        </section>
      </div>
      <section>
        <h2 class="i18n-text" data-i18n="salon.feed"></h2>
        <div class="feed-list">${posts.length ? posts.map(renderFeedCard).join("") : emptyState("salon.feed.empty")}</div>
      </section>
    </section>
  `;
  bindI18n(root);
  bindColomboTimes(root);
  hydrateLazyImages(root, { eager: 1 });
  bindSaves(root);
}

export async function mountSalon(root) {
  const gen = ++salonGen;
  const id = router.params.id;
  try {
    const feed = await salons.salonFeed(id);
    const ownerId = feed.salon?.ownerId || id;
    const services = await salons.ownerServices(ownerId).catch(() => []);
    if (gen !== salonGen) return;
    renderSalonReady(root, { salon: feed.salon, posts: feed.posts, services, error: null });
  } catch (error) {
    if (gen !== salonGen) return;
    renderSalonReady(root, { salon: null, posts: [], services: [], error });
  }
}

function bindSaves(root) {
  root.querySelectorAll("[data-save-salon]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = button.getAttribute("data-save-salon");
      button.disabled = true;
      try {
        const saved = await salons.toggleSaved(id);
        syncSaveButtons(id, saved);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          router.navigate("/account");
          return;
        }
        button.setAttribute("aria-label", error instanceof ApiError ? error.userMessage : i18n.t("errors.unknown"));
      } finally {
        button.disabled = false;
      }
    });
  });
}

function syncSaveButtons(id, saved) {
  document.querySelectorAll(`[data-save-salon="${CSS.escape(id)}"]`).forEach((button) => {
    button.setAttribute("aria-pressed", saved ? "true" : "false");
    const key = saved ? "discover.saved" : "discover.save";
    button.setAttribute("data-i18n-aria", key);
    button.setAttribute("aria-label", i18n.t(key));
    const icon = button.querySelector("img");
    if (icon) icon.src = saved ? "/public/assets/icons/heart-on.svg" : "/public/assets/icons/heart.svg";
  });
}

export function refreshDiscoverLocale(root) {
  bindI18n(root);
  bindColomboTimes(root);
}
