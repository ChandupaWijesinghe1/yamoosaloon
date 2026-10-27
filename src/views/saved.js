import { i18n } from "../scripts/i18n.js";
import { bindI18n } from "../scripts/i18n-bind.js";
import { ApiError } from "../scripts/api.js";
import { router } from "../scripts/router.js";
import { salons } from "../scripts/salons.js";

let listGen = 0;
const screen = {
  items: [],
  busyId: "",
  flash: "",
  flashError: false,
};

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

function calmError(error) {
  if (!error) return "";
  if (error instanceof ApiError) return error.userMessage;
  return i18n.t("errors.unknown");
}

function coverImage(src, alt) {
  if (!src) return `<div class="explore-cover explore-cover-fallback" aria-hidden="true"></div>`;
  return `<img class="explore-cover" src="${escapeHtml(src)}" alt="${escapeHtml(alt || "")}" width="640" height="360" loading="lazy" decoding="async">`;
}

function skeletonMarkup() {
  return `
    <section class="page saved-screen" aria-busy="true">
      <header class="saved-head">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </header>
      <article class="explore-card skeleton-card" aria-hidden="true"></article>
      <article class="explore-card skeleton-card" aria-hidden="true"></article>
    </section>
  `;
}

function emptyMarkup() {
  return `
    <div class="saved-empty empty-state">
      <p data-i18n="saved.empty"></p>
      <a class="btn btn-primary" data-link href="/explore" data-i18n="saved.explore"></a>
    </div>
  `;
}

function savedCard(salon) {
  const busy = screen.busyId === salon.id;
  const rating = salon.rating ? salon.rating.toFixed(1) : "—";
  const address = [salon.address, salon.city].filter(Boolean).join(", ") || salon.location || "";
  return `
    <article class="explore-card saved-card" data-saved-card="${escapeHtml(salon.id)}">
      <a class="explore-card-link" data-link href="/salon/${encodeURIComponent(salon.id)}">
        ${coverImage(salon.cover, salon.name)}
        <div class="explore-card-body">
          <h2>${escapeHtml(salon.name)}</h2>
          <p class="explore-rating">
            <span aria-hidden="true">★</span>
            <span data-i18n="salon.rating" data-i18n-vars='${varsAttr({ rating, count: salon.reviewCount || 0 })}'></span>
          </p>
          ${address ? `<p class="explore-meta">${escapeHtml(address)}</p>` : ""}
        </div>
      </a>
      <div class="saved-actions">
        <a class="btn btn-primary" data-link href="/salon/${encodeURIComponent(salon.id)}/book" data-i18n="saved.bookNow"></a>
        <button class="btn btn-ghost" type="button" data-unsave="${escapeHtml(salon.id)}" ${busy ? "disabled" : ""} data-i18n="saved.remove"></button>
      </div>
    </article>
  `;
}

function paint(root) {
  root.innerHTML = `
    <section class="page saved-screen">
      <header class="saved-head">
        <h1 data-i18n="saved.title"></h1>
        <p class="lede" data-i18n="saved.lede"></p>
      </header>
      ${screen.flash ? `<p class="banner ${screen.flashError ? "banner-error" : "banner-success"}" role="alert">${escapeHtml(screen.flash)}</p>` : ""}
      <div class="explore-list saved-list">
        ${screen.items.length ? screen.items.map(savedCard).join("") : emptyMarkup()}
      </div>
    </section>
  `;
  bindI18n(root);
  bindScreen(root);
}

function bindScreen(root) {
  root.querySelectorAll("[data-unsave]").forEach((button) => {
    button.addEventListener("click", () => removeSaved(root, button.getAttribute("data-unsave")));
  });
}

async function removeSaved(root, id) {
  if (!id || screen.busyId) return;
  const previous = screen.items.slice();
  screen.busyId = id;
  screen.items = screen.items.filter((item) => item.id !== id);
  screen.flash = "";
  screen.flashError = false;
  paint(root);
  try {
    await salons.unsave(id);
    screen.flash = i18n.t("saved.removed");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      router.navigate("/account");
      return;
    }
    screen.items = previous;
    screen.flashError = true;
    screen.flash = calmError(error);
  } finally {
    screen.busyId = "";
    paint(root);
  }
}

export function renderSaved() {
  return skeletonMarkup();
}

export async function mountSaved(root) {
  const gen = ++listGen;
  screen.busyId = "";
  screen.flash = "";
  screen.flashError = false;
  try {
    const items = await salons.listSaved({ force: true });
    if (gen !== listGen) return;
    screen.items = items;
    paint(root);
  } catch (error) {
    if (gen !== listGen) return;
    if (error instanceof ApiError && error.status === 401) {
      router.navigate("/account");
      return;
    }
    root.innerHTML = `
      <section class="page saved-screen">
        <article class="card form-stack">
          <h1 data-i18n="saved.title"></h1>
          <p class="banner banner-error" role="alert">${escapeHtml(calmError(error))}</p>
          <a class="btn btn-ghost" data-link href="/explore" data-i18n="saved.explore"></a>
        </article>
      </section>
    `;
    bindI18n(root);
  }
}
