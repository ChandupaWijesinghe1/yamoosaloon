import { i18n } from "../scripts/i18n.js";
import { bindI18n } from "../scripts/i18n-bind.js";
import { ApiError, colombo } from "../scripts/api.js";
import { router } from "../scripts/router.js";
import { salons } from "../scripts/salons.js";

const SEARCH_DEBOUNCE_MS = 300;
const FILTER_CHIPS = [
  { id: "haircut", key: "explore.chip.haircut" },
  { id: "skin-care", key: "explore.chip.skincare" },
  { id: "bridal", key: "explore.chip.bridal" },
  { id: "nails", key: "explore.chip.nails" },
  { id: "massage", key: "explore.chip.massage" },
  { id: "top-rated", key: "explore.chip.toprated" },
];

let exploreGen = 0;
let searchTimer = 0;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function varsAttr(vars) {
  return JSON.stringify(vars).replaceAll("&", "&amp;").replaceAll("'", "&#39;");
}

function currentQuery() {
  return String(router.query.q || router.query.query || "").trim();
}

function currentTag() {
  return String(router.query.tag || "").trim();
}

function exploreHref({ query = currentQuery(), tag = currentTag() } = {}) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (tag) params.set("tag", tag);
  const search = params.toString();
  return search ? `/explore?${search}` : "/explore";
}

function bindColomboTimes(root = document) {
  const locale = i18n.locale === "si" ? "si-LK" : "en-LK";
  root.querySelectorAll("[data-colombo-time]").forEach((node) => {
    const value = node.getAttribute("data-colombo-time");
    if (!value) return;
    node.textContent = colombo.format(value, { locale });
    node.setAttribute("datetime", colombo.parse(value) || value);
  });
}

function heartButton(id, saved) {
  const key = saved ? "discover.saved" : "discover.save";
  const icon = saved ? "/public/assets/icons/heart-on.svg" : "/public/assets/icons/heart.svg";
  return `
    <button class="explore-heart" type="button" data-save-salon="${escapeHtml(id)}" aria-pressed="${saved ? "true" : "false"}" data-i18n-aria="${key}">
      <img src="${icon}" alt="" width="22" height="22">
    </button>
  `;
}

function coverImage(src, alt, { eager = false } = {}) {
  if (!src) return `<div class="explore-cover explore-cover-fallback" aria-hidden="true"></div>`;
  const loading = eager ? "eager" : "lazy";
  const priority = eager ? ` fetchpriority="high"` : "";
  return `<img class="explore-cover" src="${escapeHtml(src)}" alt="${escapeHtml(alt || "")}" width="640" height="360" loading="${loading}" decoding="async"${priority}>`;
}

function ratingLine(salon) {
  const rating = salon.rating ? salon.rating.toFixed(1) : "—";
  return `
    <p class="explore-rating">
      <span aria-hidden="true">★</span>
      <span data-i18n="salon.rating" data-i18n-vars='${varsAttr({ rating, count: salon.reviewCount || 0 })}'></span>
    </p>
  `;
}

function confirmBadge(salon) {
  const key = salon.confirmation === "manual" ? "explore.confirm.manual" : "explore.confirm.auto";
  const kind = salon.confirmation === "manual" ? "is-manual" : "is-auto";
  return `<span class="explore-badge ${kind}" data-i18n="${key}"></span>`;
}

function metaLine(salon) {
  const address = [salon.address, salon.city].filter(Boolean).join(", ") || salon.location;
  const bits = [escapeHtml(address)];
  if (salon.distanceKm != null && !Number.isNaN(salon.distanceKm)) {
    bits.push(escapeHtml(i18n.t("explore.distance", { km: salon.distanceKm })));
  }
  return `<p class="explore-meta">${bits.join(" · ")}</p>`;
}

function openLine(salon) {
  const today = salons.todayHours(salon.hours);
  if (today.openNow) {
    return `<p class="explore-hours"><span data-i18n="salon.openNow"></span> · <span data-i18n="salon.hours.range" data-i18n-vars='${varsAttr({ open: today.open, close: today.close })}'></span></p>`;
  }
  if (today.closed) return `<p class="explore-hours" data-i18n="salon.closedNow"></p>`;
  return `<p class="explore-hours" data-i18n="explore.openUntil" data-i18n-vars='${varsAttr({ time: today.open })}'></p>`;
}

function renderStoreCard(salon, { featured = false, eager = false } = {}) {
  const href = `/salon/${encodeURIComponent(salon.id)}`;
  const saved = salon.saved || salons.isSaved(salon.id);
  return `
    <article class="explore-card${featured ? " is-featured" : ""}">
      <a class="explore-card-link" data-link href="${href}">
        ${coverImage(salon.cover, salon.name, { eager })}
        <div class="explore-card-body">
          ${featured && salon.promo ? `<p class="explore-promo">${escapeHtml(salon.promo)}</p>` : ""}
          <h3>${escapeHtml(salon.name)}</h3>
          ${ratingLine(salon)}
          ${metaLine(salon)}
          ${confirmBadge(salon)}
          ${openLine(salon)}
        </div>
      </a>
      ${heartButton(salon.id, saved)}
    </article>
  `;
}

function skeletonFeatured() {
  return Array.from({ length: 3 }, () => `<article class="explore-card is-featured skeleton-card" aria-hidden="true"><div class="explore-cover skeleton"></div><div class="explore-card-body"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div></article>`).join("");
}

function skeletonList() {
  return Array.from({ length: 6 }, () => `<article class="explore-card skeleton-card" aria-hidden="true"><div class="explore-cover skeleton"></div><div class="explore-card-body"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div><div class="skeleton skeleton-line"></div></div></article>`).join("");
}

function emptyState(key) {
  return `<p class="empty-state i18n-text" data-i18n="${key}"></p>`;
}

function errorBanner(error) {
  const message = error instanceof ApiError ? error.userMessage : i18n.t("errors.unknown");
  return `<p class="banner banner-error">${escapeHtml(message)}</p><button class="btn btn-ghost" type="button" data-action="explore-retry" data-i18n="discover.retry"></button>`;
}

function chipButtons(active) {
  return FILTER_CHIPS.map((chip) => {
    const pressed = chip.id === active;
    return `<button class="explore-chip" type="button" data-explore-tag="${chip.id}" aria-pressed="${pressed ? "true" : "false"}" data-i18n="${chip.key}"></button>`;
  }).join("");
}

function featuredFrom(feed, featured, owners) {
  if (featured?.length) return featured;
  const fromFeed = (feed || []).map((post) => post.salon).filter(Boolean);
  if (fromFeed.length) return fromFeed;
  return (owners || []).filter((item) => item.featured);
}

export function renderExplore() {
  const query = currentQuery();
  const tag = currentTag();
  const cachedOwners = salons.cachedOwners(query, tag);
  const cachedFeed = salons.cachedExplore(query, tag);
  const cachedFeatured = salons.cachedFeatured(query, tag);
  const ready = Boolean(cachedOwners);
  const featured = ready ? featuredFrom(cachedFeed, cachedFeatured, cachedOwners) : null;

  return `
    <section class="explore-screen">
      <div class="explore-sticky">
        <form id="explore-search" class="explore-search" role="search">
          <label class="visually-hidden" for="explore-q" data-i18n="discover.search.label"></label>
          <input class="field explore-search-input" id="explore-q" name="q" type="search" value="${escapeHtml(query)}" autocomplete="off" data-i18n-placeholder="discover.search.placeholder" data-i18n-aria="discover.search.label">
        </form>
        <div class="explore-chips" role="toolbar" data-i18n-aria="explore.filters">${chipButtons(tag)}</div>
      </div>
      <p class="visually-hidden" id="explore-status" aria-live="polite"></p>
      <div id="explore-error-slot"></div>
      <section class="explore-section" aria-labelledby="explore-featured-title">
        <h2 id="explore-featured-title" class="i18n-text" data-i18n="explore.featured"></h2>
        <div id="explore-featured" class="explore-banners" aria-busy="${ready ? "false" : "true"}">${
          featured ? (featured.length ? featured.map((item, index) => renderStoreCard(item, { featured: true, eager: index === 0 })).join("") : emptyState("explore.featured.empty")) : skeletonFeatured()
        }</div>
      </section>
      <section class="explore-section" aria-labelledby="explore-list-title">
        <h2 id="explore-list-title" class="i18n-text" data-i18n="explore.nearby"></h2>
        <div id="explore-list" class="explore-list" aria-busy="${ready ? "false" : "true"}">${
          cachedOwners ? (cachedOwners.length ? cachedOwners.map((item) => renderStoreCard(item)).join("") : emptyState("discover.empty")) : skeletonList()
        }</div>
      </section>
    </section>
  `;
}

function fillExplore(root, { owners, feed, featured, error, query, tag }) {
  const banners = root.querySelector("#explore-featured");
  const list = root.querySelector("#explore-list");
  const errorSlot = root.querySelector("#explore-error-slot");
  const status = root.querySelector("#explore-status");
  const promoted = featuredFrom(feed, featured, owners);

  if (banners) {
    banners.innerHTML = promoted.length
      ? promoted.map((item, index) => renderStoreCard(item, { featured: true, eager: index === 0 })).join("")
      : emptyState("explore.featured.empty");
    banners.setAttribute("aria-busy", "false");
  }
  if (list) {
    list.innerHTML = owners.length ? owners.map((item) => renderStoreCard(item)).join("") : emptyState("discover.empty");
    list.setAttribute("aria-busy", "false");
  }
  if (errorSlot) errorSlot.innerHTML = error ? errorBanner(error) : "";
  if (status) status.textContent = i18n.t("discover.results", { count: owners.length });
  bindI18n(root);
  bindColomboTimes(root);
  bindSaves(root);
  root.querySelector("[data-action='explore-retry']")?.addEventListener("click", () => mountExplore(root, { force: true }));
  syncChipState(root, tag);
}

async function runExploreQuery(root, query, tag, { force = false } = {}) {
  const gen = ++exploreGen;
  const banners = root.querySelector("#explore-featured");
  const list = root.querySelector("#explore-list");
  const cachedOwners = !force && salons.cachedOwners(query, tag);
  const cachedFeed = !force && salons.cachedExplore(query, tag);
  const cachedFeatured = !force && salons.cachedFeatured(query, tag);

  if (!cachedOwners && list) {
    list.innerHTML = skeletonList();
    list.setAttribute("aria-busy", "true");
  }
  if (!cachedOwners && !cachedFeatured && banners) {
    banners.innerHTML = skeletonFeatured();
    banners.setAttribute("aria-busy", "true");
  }
  if (cachedOwners && cachedFeed) {
    fillExplore(root, { owners: cachedOwners, feed: cachedFeed, featured: cachedFeatured, error: null, query, tag });
    return;
  }

  try {
    const result = await salons.loadDiscover(query, tag);
    if (gen !== exploreGen) return;
    fillExplore(root, { ...result, query, tag });
  } catch (error) {
    if (gen !== exploreGen) return;
    fillExplore(root, {
      owners: salons.filterOwners(query, tag),
      feed: salons.cachedExplore(query, tag) || [],
      featured: salons.cachedFeatured(query, tag) || [],
      error,
      query,
      tag,
    });
  }
}

function replaceExploreUrl(query, tag) {
  const next = exploreHref({ query, tag });
  if (`${window.location.pathname}${window.location.search}` === next) return;
  window.history.replaceState({ path: next }, "", next);
  router.query = Object.fromEntries(new URLSearchParams(next.split("?")[1] || ""));
}

function scheduleSearch(root, query, tag) {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    replaceExploreUrl(query, tag);
    runExploreQuery(root, query, tag);
  }, SEARCH_DEBOUNCE_MS);
}

function syncChipState(root, tag) {
  root.querySelectorAll("[data-explore-tag]").forEach((chip) => {
    chip.setAttribute("aria-pressed", chip.getAttribute("data-explore-tag") === tag ? "true" : "false");
  });
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
        document.querySelectorAll(`[data-save-salon="${CSS.escape(id)}"]`).forEach((node) => {
          node.setAttribute("aria-pressed", saved ? "true" : "false");
          const key = saved ? "discover.saved" : "discover.save";
          node.setAttribute("data-i18n-aria", key);
          node.setAttribute("aria-label", i18n.t(key));
          const icon = node.querySelector("img");
          if (icon) icon.src = saved ? "/public/assets/icons/heart-on.svg" : "/public/assets/icons/heart.svg";
        });
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

export function bindExplore(root) {
  const form = root.querySelector("#explore-search");
  const input = root.querySelector("#explore-q");

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(searchTimer);
    router.navigate(exploreHref({ query: String(input?.value || "").trim(), tag: currentTag() }), { replace: true });
  });

  input?.addEventListener("input", () => {
    const query = input.value;
    const tag = currentTag();
    const local = salons.filterOwners(query, tag);
    const list = root.querySelector("#explore-list");
    if (list && local.length) {
      list.innerHTML = local.map((item) => renderStoreCard(item)).join("");
      bindI18n(list);
      bindSaves(list);
    }
    scheduleSearch(root, query, tag);
  });

  root.querySelectorAll("[data-explore-tag]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const nextTag = chip.getAttribute("aria-pressed") === "true" ? "" : chip.getAttribute("data-explore-tag");
      router.navigate(exploreHref({ query: String(input?.value || "").trim(), tag: nextTag }), { replace: true });
    });
  });
}

export function mountExplore(root, { force = false } = {}) {
  const query = currentQuery();
  const tag = currentTag();
  const input = root.querySelector("#explore-q");
  if (input && input.value !== query) input.value = query;
  bindSaves(root);
  bindColomboTimes(root);
  return runExploreQuery(root, query, tag, { force });
}
