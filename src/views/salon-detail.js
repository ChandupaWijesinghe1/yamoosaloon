import { i18n } from "../scripts/i18n.js";
import { bindI18n } from "../scripts/i18n-bind.js";
import { ApiError, colombo } from "../scripts/api.js";
import { router } from "../scripts/router.js";
import { salons } from "../scripts/salons.js";
import { storage } from "../scripts/storage.js";

const CART_KEY = "cart";
const CATEGORY_KEYS = {
  "hair-treatments": "salon.cat.hair",
  "facial-glow": "salon.cat.facial",
  "nail-care": "salon.cat.nails",
  bridal: "salon.cat.bridal",
  massage: "salon.cat.massage",
  colour: "salon.cat.colour",
  other: "salon.cat.other",
};

let detailGen = 0;
let reportTarget = null;

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

function formatLkr(amount) {
  return new Intl.NumberFormat(i18n.locale === "si" ? "si-LK" : "en-LK", {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

function formatAmount(amount) {
  return new Intl.NumberFormat(i18n.locale === "si" ? "si-LK" : "en-LK", {
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);
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

function cartKey(salonId) {
  return `${CART_KEY}.${salonId}`;
}

function getCart(salonId) {
  const items = storage.get(cartKey(salonId), [], { session: true });
  return Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
}

function setCart(salonId, items) {
  storage.set(cartKey(salonId), items, { session: true });
}

function cartQty(salonId, serviceId) {
  return getCart(salonId).find((item) => item.id === serviceId)?.qty || 0;
}

function cartTotals(salonId) {
  const items = getCart(salonId);
  const count = items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const total = items.reduce((sum, item) => sum + Number(item.priceLkr || 0) * Number(item.qty || 0), 0);
  return { items, count, total };
}

function addToCart(salonId, service, delta = 1) {
  const items = getCart(salonId);
  const found = items.find((item) => item.id === service.id);
  if (found) found.qty = Math.max(0, Number(found.qty || 0) + delta);
  else if (delta > 0) {
    items.push({
      id: service.id,
      name: service.name,
      priceLkr: service.priceLkr,
      durationMin: service.durationMin,
      qty: delta,
    });
  }
  setCart(
    salonId,
    items.filter((item) => item.qty > 0),
  );
  return cartTotals(salonId);
}

function categoryLabel(service) {
  if (service.categoryLabel) return service.categoryLabel;
  const key = CATEGORY_KEYS[service.category] || CATEGORY_KEYS.other;
  return i18n.t(key);
}

function groupServices(services) {
  const groups = [];
  const index = new Map();
  for (const service of services) {
    const id = service.category || "other";
    if (!index.has(id)) {
      const group = { id, label: categoryLabel(service), items: [] };
      index.set(id, group);
      groups.push(group);
    }
    index.get(id).items.push(service);
  }
  return groups;
}

function heartButton(id, saved) {
  const key = saved ? "discover.saved" : "discover.save";
  const icon = saved ? "/public/assets/icons/heart-on.svg" : "/public/assets/icons/heart.svg";
  return `
    <button class="salon-icon-btn" type="button" data-save-salon="${escapeHtml(id)}" aria-pressed="${saved ? "true" : "false"}" data-i18n-aria="${key}">
      <img src="${icon}" alt="" width="22" height="22">
    </button>
  `;
}

function addControl(salonId, service) {
  const qty = cartQty(salonId, service.id);
  if (qty > 0) {
    return `
      <div class="salon-stepper" data-stepper="${escapeHtml(service.id)}">
        <button class="salon-stepper-btn" type="button" data-qty="-1" data-add-service="${escapeHtml(service.id)}" data-i18n-aria="menu.remove">−</button>
        <span class="salon-qty">${qty}</span>
        <button class="salon-stepper-btn" type="button" data-qty="1" data-add-service="${escapeHtml(service.id)}" data-i18n-aria="menu.add">+</button>
      </div>
    `;
  }
  return `<button class="btn btn-accent salon-add" type="button" data-qty="1" data-add-service="${escapeHtml(service.id)}" data-i18n="menu.add"></button>`;
}

function serviceCard(salonId, service) {
  const duration = service.durationMin ? i18n.t("salon.duration", { minutes: service.durationMin }) : "";
  const price = service.priceLkr == null ? "" : formatLkr(service.priceLkr);
  return `
    <article class="menu-card" data-service-id="${escapeHtml(service.id)}">
      <div class="menu-card-copy">
        <h3>${escapeHtml(service.name)}</h3>
        ${service.description ? `<p class="menu-desc">${escapeHtml(service.description)}</p>` : ""}
        <p class="menu-meta">${escapeHtml([duration, price].filter(Boolean).join(" · "))}</p>
      </div>
      ${addControl(salonId, service)}
    </article>
  `;
}

function reviewCard(review) {
  const stars = "★".repeat(Math.max(0, Math.min(5, Math.round(review.rating)))) + "☆".repeat(Math.max(0, 5 - Math.round(review.rating)));
  return `
    <article class="review-card" data-review-id="${escapeHtml(review.id)}">
      <header class="review-head">
        <p class="review-author">${escapeHtml(review.author)}</p>
        <p class="review-stars" aria-label="${escapeHtml(i18n.t("reviews.stars", { rating: review.rating }))}">${stars}</p>
        ${review.createdAt ? `<time data-colombo-time="${escapeHtml(review.createdAt)}"></time>` : ""}
      </header>
      <p class="review-body">${escapeHtml(review.body)}</p>
      <button class="btn btn-ghost review-report" type="button" data-report="review" data-report-id="${escapeHtml(review.id)}" data-i18n="report.review"></button>
    </article>
  `;
}

function reportSheet() {
  return `
    <div id="report-sheet" class="report-sheet" hidden>
      <div class="report-panel" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <h2 id="report-title" data-i18n="report.title"></h2>
        <p class="lede" data-i18n="report.lede"></p>
        <form id="report-form" class="form-stack">
          <label class="report-option"><input type="radio" name="reason" value="spam" checked> <span data-i18n="report.reason.spam"></span></label>
          <label class="report-option"><input type="radio" name="reason" value="harassment"> <span data-i18n="report.reason.harassment"></span></label>
          <label class="report-option"><input type="radio" name="reason" value="fake"> <span data-i18n="report.reason.fake"></span></label>
          <label class="report-option"><input type="radio" name="reason" value="other"> <span data-i18n="report.reason.other"></span></label>
          <div class="hero-actions">
            <button class="btn btn-primary" type="submit" data-i18n="report.submit"></button>
            <button class="btn btn-ghost" type="button" data-action="report-cancel" data-i18n="report.cancel"></button>
          </div>
        </form>
      </div>
    </div>
  `;
}

export function renderSalonDetail() {
  return `
    <article class="salon-detail" id="salon-detail" aria-busy="true">
      <div class="salon-banner skeleton" aria-hidden="true"></div>
      <div class="salon-detail-body">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
        <div class="menu-card skeleton-card" aria-hidden="true"></div>
        <div class="menu-card skeleton-card" aria-hidden="true"></div>
      </div>
    </article>
  `;
}

function missingMarkup(error) {
  const message = error instanceof ApiError ? error.userMessage : "";
  return `
    <section class="page">
      <article class="card">
        <h1 class="i18n-text" data-i18n="salon.missing.title"></h1>
        <p class="i18n-text" data-i18n="salon.missing.body"></p>
        ${message ? `<p class="banner banner-error">${escapeHtml(message)}</p>` : ""}
        <a class="btn btn-accent" data-link href="/explore" data-i18n="salon.back"></a>
      </article>
    </section>
  `;
}

function cartBar(salonId) {
  const { count, total } = cartTotals(salonId);
  const hidden = count === 0 ? "hidden" : "";
  return `
    <div id="salon-cart-bar" class="salon-cart-bar" ${hidden}>
      <p id="salon-cart-summary" aria-live="polite" data-i18n="menu.cart.summary" data-i18n-vars='${varsAttr({ count, total: formatAmount(total) })}'></p>
      <a class="btn btn-primary" data-link href="/salon/${encodeURIComponent(salonId)}/book" data-i18n="menu.cart.book"></a>
    </div>
  `;
}

function renderReady(root, { salon, services, reviews, posts, error }) {
  if (!salon) {
    root.innerHTML = missingMarkup(error);
    bindI18n(root);
    document.body.classList.remove("has-salon-cart");
    return;
  }

  const groups = groupServices(services);
  const today = salons.todayHours(salon.hours);
  const statusKey = today.openNow ? "salon.openNow" : "salon.closedNow";
  const address = [salon.address, salon.city].filter(Boolean).join(", ") || salon.location;
  const saved = salon.saved || salons.isSaved(salon.id);
  const menu = groups.length
    ? groups
        .map(
          (group) => `
        <section class="menu-section" id="menu-${escapeHtml(group.id)}">
          <h2>${escapeHtml(group.label)}</h2>
          ${group.items.map((item) => serviceCard(salon.id, item)).join("")}
        </section>
      `,
        )
        .join("")
    : `<p class="empty-state i18n-text" data-i18n="salon.services.empty"></p>`;

  root.innerHTML = `
    <article class="salon-detail" data-salon-id="${escapeHtml(salon.id)}">
      <header class="salon-banner-wrap">
        <img class="salon-banner" src="${escapeHtml(salon.cover)}" alt="${escapeHtml(salon.name)}" width="960" height="420" fetchpriority="high">
        <a class="salon-icon-btn salon-back" data-link href="/explore" data-i18n-aria="salon.back">←</a>
        <div class="salon-banner-actions">
          ${heartButton(salon.id, saved)}
          <button class="btn btn-ghost salon-report" type="button" data-report="salon" data-report-id="${escapeHtml(salon.id)}" data-i18n="report.salon"></button>
        </div>
      </header>
      <div class="salon-detail-body">
        ${error ? `<p class="banner banner-error">${escapeHtml(error instanceof ApiError ? error.userMessage : i18n.t("errors.unknown"))}</p>` : ""}
        <p id="salon-flash" class="banner banner-success" hidden></p>
        <h1>${escapeHtml(salon.name)}</h1>
        <p class="explore-rating">
          <span aria-hidden="true">★</span>
          <span data-i18n="salon.rating" data-i18n-vars='${varsAttr({ rating: salon.rating.toFixed(1), count: salon.reviewCount || reviews.length })}'></span>
        </p>
        <p class="salon-address">${escapeHtml(address)}</p>
        <p class="salon-status">
          <span class="status-pill ${today.openNow ? "is-open" : "is-closed"}" data-i18n="${statusKey}"></span>
          ${
            today.closed
              ? ""
              : `<span data-i18n="salon.hours.range" data-i18n-vars='${varsAttr({ open: today.open, close: today.close })}'></span>`
          }
          <span class="hours-zone" data-i18n="salon.hours.zone"></span>
        </p>
        <p>
          <a class="btn btn-ghost" data-link href="/salon/${encodeURIComponent(salon.id)}/event" data-i18n="event.cta"></a>
        </p>
        ${
          groups.length
            ? `<nav class="salon-cats" aria-label="${escapeHtml(i18n.t("menu.categories"))}">${groups
                .map((group, index) => `<a class="explore-chip" href="#menu-${escapeHtml(group.id)}" data-cat="${escapeHtml(group.id)}"${index === 0 ? ' aria-current="true"' : ""}>${escapeHtml(group.label)}</a>`)
                .join("")}</nav>`
            : ""
        }
        ${menu}
        <section class="salon-reviews" aria-labelledby="reviews-title">
          <h2 id="reviews-title" data-i18n="reviews.title"></h2>
          ${reviews.length ? reviews.map(reviewCard).join("") : `<p class="empty-state" data-i18n="reviews.empty"></p>`}
        </section>
        ${
          posts.length
            ? `<section class="salon-posts" aria-labelledby="posts-title">
                <h2 id="posts-title" data-i18n="salon.feed"></h2>
                ${posts
                  .map(
                    (post) => `
                  <article class="review-card">
                    <p>${escapeHtml(post.caption)}</p>
                    ${post.createdAt ? `<time data-colombo-time="${escapeHtml(post.createdAt)}"></time>` : ""}
                    <button class="btn btn-ghost review-report" type="button" data-report="post" data-report-id="${escapeHtml(post.id)}" data-i18n="report.post"></button>
                  </article>
                `,
                  )
                  .join("")}
              </section>`
            : ""
        }
      </div>
      ${cartBar(salon.id)}
      ${reportSheet()}
    </article>
  `;

  bindI18n(root);
  bindColomboTimes(root);
  bindDetail(root, salon, services);
  syncCartBar(root, salon.id);
}

function syncCartBar(root, salonId) {
  const { count, total } = cartTotals(salonId);
  const bar = root.querySelector("#salon-cart-bar");
  const summary = root.querySelector("#salon-cart-summary");
  if (summary) {
    summary.setAttribute("data-i18n-vars", JSON.stringify({ count, total: formatAmount(total) }));
    summary.textContent = i18n.t("menu.cart.summary", { count, total: formatAmount(total) });
  }
  if (bar) bar.hidden = count === 0;
  document.body.classList.toggle("has-salon-cart", count > 0);
}

function bindDetail(root, salon, services) {
  root.querySelector("[data-save-salon]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const saved = await salons.toggleSaved(salon.id);
      button.setAttribute("aria-pressed", saved ? "true" : "false");
      const key = saved ? "discover.saved" : "discover.save";
      button.setAttribute("data-i18n-aria", key);
      button.setAttribute("aria-label", i18n.t(key));
      const icon = button.querySelector("img");
      if (icon) icon.src = saved ? "/public/assets/icons/heart-on.svg" : "/public/assets/icons/heart.svg";
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) router.navigate("/account");
    } finally {
      button.disabled = false;
    }
  });

  root.addEventListener("click", (event) => {
    const add = event.target.closest("[data-add-service]");
    if (!add) return;
    const id = add.getAttribute("data-add-service");
    const service = services.find((item) => item.id === id);
    if (!service) return;
    const delta = Number(add.getAttribute("data-qty") || 1);
    addToCart(salon.id, service, delta);
    const card = root.querySelector(`[data-service-id="${CSS.escape(id)}"]`);
    const controlHost = card?.querySelector(".salon-add, .salon-stepper");
    if (card && controlHost) {
      controlHost.outerHTML = addControl(salon.id, service);
      bindI18n(card);
    }
    syncCartBar(root, salon.id);
  });

  root.querySelectorAll("[data-cat]").forEach((chip) => {
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      const id = chip.getAttribute("data-cat");
      const target = root.querySelector(`#menu-${CSS.escape(id)}`);
      root.querySelectorAll("[data-cat]").forEach((node) => {
        if (node.getAttribute("data-cat") === id) node.setAttribute("aria-current", "true");
        else node.removeAttribute("aria-current");
      });
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  const sections = [...root.querySelectorAll(".menu-section")];
  if (sections.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const id = visible.target.id.replace(/^menu-/, "");
        root.querySelectorAll("[data-cat]").forEach((chip) => {
          if (chip.getAttribute("data-cat") === id) chip.setAttribute("aria-current", "true");
          else chip.removeAttribute("aria-current");
        });
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: [0.2, 0.6] },
    );
    sections.forEach((section) => observer.observe(section));
  }

  root.querySelectorAll("[data-report]").forEach((button) => {
    button.addEventListener("click", () => openReport(root, button.getAttribute("data-report"), button.getAttribute("data-report-id")));
  });
  bindReportSheet(root);
}

function openReport(root, type, id) {
  reportTarget = { type, id };
  const sheet = root.querySelector("#report-sheet");
  if (sheet) sheet.hidden = false;
}

function closeReport(root) {
  reportTarget = null;
  const sheet = root.querySelector("#report-sheet");
  if (sheet) sheet.hidden = true;
}

function bindReportSheet(root) {
  const form = root.querySelector("#report-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!reportTarget) return;
    const reason = new FormData(form).get("reason") || "other";
    try {
      await salons.report({ type: reportTarget.type, targetId: reportTarget.id, reason });
      const flash = root.querySelector("#salon-flash");
      if (flash) {
        flash.hidden = false;
        flash.textContent = i18n.t("report.thanks");
      }
      closeReport(root);
    } catch (error) {
      const flash = root.querySelector("#salon-flash");
      if (flash) {
        flash.hidden = false;
        flash.classList.remove("banner-success");
        flash.classList.add("banner-error");
        flash.textContent = error instanceof ApiError ? error.userMessage : i18n.t("errors.unknown");
      }
    }
  });
  root.querySelector("[data-action='report-cancel']")?.addEventListener("click", () => closeReport(root));
}

export async function mountSalonDetail(root) {
  const gen = ++detailGen;
  const id = router.params.id;
  try {
    const feed = await salons.salonFeed(id);
    const ownerId = feed.salon?.ownerId || id;
    const [services, reviews] = await Promise.all([
      salons.ownerServices(ownerId).catch(() => []),
      salons.listReviews(id).catch(() => []),
    ]);
    if (gen !== detailGen) return;
    renderReady(root, { salon: feed.salon, services, reviews, posts: feed.posts || [], error: null });
  } catch (error) {
    if (gen !== detailGen) return;
    renderReady(root, { salon: null, services: [], reviews: [], posts: [], error });
  }
}

