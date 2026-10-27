import { i18n } from "./i18n.js";
import { bindI18n } from "./i18n-bind.js";
import { auth } from "./auth.js";
import { router } from "./router.js";
import { gate } from "./gate.js";
import { ApiError } from "./api.js";
import { bindColomboTimes } from "./explore-view.js";
import { bindExplore, mountExplore, renderExplore } from "../views/explore.js";
import { mountSalonDetail, renderSalonDetail } from "../views/salon-detail.js";
import { mountBooking, renderBooking } from "../views/booking.js";
import { mountEventRequest, renderEventRequest } from "../views/event-request.js";
import { mountBookings, renderBookings } from "../views/appointments.js";
import { mountSaved, renderSaved } from "../views/saved.js";
import { bindNoticeBell, closeNoticePanel, mountNotices, refreshNoticeBadge, renderNotices, syncNoticeChrome } from "../views/notices.js";
import { mountAccount, renderAccount, syncAccountChrome } from "../views/account.js";
import { bindOfflineBanner, registerShellWorker, syncOfflineBanner } from "./offline.js";

const appRoot = document.getElementById("app");
const nav = document.getElementById("site-nav");
const navToggle = document.getElementById("nav-toggle");
const langSwitch = document.getElementById("lang-switch");


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

function renderHome() {
  return `
    <section class="hero" aria-labelledby="home-title">
      <div class="hero-copy">
        <p class="lede i18n-text" data-i18n="home.eyebrow"></p>
        <h1 id="home-title" class="i18n-text" data-i18n="home.title"></h1>
        <p class="i18n-text" data-i18n="home.lede"></p>
        <div class="hero-actions">
          <a class="btn btn-primary" data-link href="/explore" data-i18n="home.cta.explore"></a>
          <a class="btn btn-ghost" data-link href="/account" data-i18n="home.cta.account"></a>
        </div>
      </div>
    </section>
    <section class="feature-grid" data-i18n-aria="home.features">
      <article class="card">
        <h2 class="i18n-text" data-i18n="home.feature.local.title"></h2>
        <p class="i18n-text" data-i18n="home.feature.local.body"></p>
      </article>
      <article class="card">
        <h2 class="i18n-text" data-i18n="home.feature.access.title"></h2>
        <p class="i18n-text" data-i18n="home.feature.access.body"></p>
      </article>
      <article class="card">
        <h2 class="i18n-text" data-i18n="home.feature.private.title"></h2>
        <p class="i18n-text" data-i18n="home.feature.private.body"></p>
      </article>
    </section>
  `;
}

function renderPrivacy() {
  return `
    <section class="page">
      <article class="card">
        <h1 class="i18n-text" data-i18n="privacy.title"></h1>
        <p class="lede i18n-text" data-i18n="privacy.lede"></p>
        <p class="i18n-text" data-i18n="privacy.body"></p>
      </article>
    </section>
  `;
}

function renderAgreement(item) {
  const titleKey = item.kind === "privacy" ? "gate.privacy.title" : "gate.community.title";
  const bodyKey = item.kind === "privacy" ? "gate.privacy.body" : "gate.community.body";
  const confirmKey = item.kind === "privacy" ? "gate.confirm.privacy" : "gate.confirm.community";
  const title = item.title ? escapeHtml(item.title) : "";
  const body = item.body ? `<p class="i18n-text">${escapeHtml(item.body)}</p>` : `<p class="i18n-text" data-i18n="${bodyKey}"></p>`;

  return `
    <article class="gate-doc card">
      <header class="gate-doc-head">
        <h2 class="i18n-text"${item.title ? "" : ` data-i18n="${titleKey}"`}>${title}</h2>
        <p class="gate-version i18n-text" data-i18n="gate.version" data-i18n-vars='${varsAttr({ version: item.version })}'></p>
      </header>
      <div class="gate-doc-body">${body}</div>
      <label class="gate-check">
        <input type="checkbox" data-gate-accept="${escapeHtml(item.id)}" ${item.accepted ? "checked" : ""}>
        <span class="i18n-text" data-i18n="${confirmKey}"></span>
      </label>
    </article>
  `;
}

function renderGate() {
  const errorText = gate.error instanceof ApiError ? gate.error.userMessage : "";
  const docs =
    gate.agreements.length > 0
      ? gate.agreements.map(renderAgreement).join("")
      : `
        ${renderAgreement({ id: "community", kind: "community", version: "—", accepted: false })}
        ${renderAgreement({ id: "privacy", kind: "privacy", version: "—", accepted: false })}
      `;

  return `
    <section class="gate-screen" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div class="gate-panel">
        <h1 id="gate-title" class="i18n-text" data-i18n="gate.title"></h1>
        <p class="lede i18n-text" data-i18n="gate.lede"></p>
        <p class="banner banner-error" id="gate-error" ${errorText ? "" : "hidden"}>${escapeHtml(errorText)}</p>
        ${
          gate.status === "error"
            ? `<button class="btn btn-ghost" type="button" data-action="gate-retry" data-i18n="gate.retry"></button>`
            : ""
        }
        <form id="gate-form" class="form-stack" novalidate>
          ${docs}
          <p class="i18n-text" data-i18n="gate.required"></p>
          <div class="hero-actions">
            <button class="btn btn-primary" id="gate-submit" type="submit" data-i18n="gate.accept" disabled></button>
            <button class="btn btn-ghost" type="button" data-action="sign-out" data-i18n="account.logout"></button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderNotFound() {
  return `
    <section class="page">
      <article class="card">
        <h1 class="i18n-text" data-i18n="notfound.title"></h1>
        <p class="i18n-text" data-i18n="notfound.body"></p>
        <a class="btn btn-accent" data-link href="/" data-i18n="notfound.back"></a>
      </article>
    </section>
  `;
}

function paint() {
  const match = router.match(router.current);
  const html = match.render?.(match.params) ?? renderNotFound();
  appRoot.innerHTML = html;
  bindView();
  bindI18n(document);
  bindColomboTimes(document);
  syncChrome();
  syncHeaderOffset();
  syncOfflineBanner();
  document.body.classList.toggle("gate-locked", gate.isBlocking());
}

function syncGateSubmit() {
  const form = document.getElementById("gate-form");
  const submit = document.getElementById("gate-submit");
  if (!form || !submit) return;
  const boxes = [...form.querySelectorAll("input[data-gate-accept]")];
  submit.disabled = boxes.length === 0 || boxes.some((box) => !box.checked) || gate.status === "loading";
}

function bindView() {
  const gateForm = document.getElementById("gate-form");
  gateForm?.addEventListener("change", syncGateSubmit);
  gateForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.getElementById("gate-submit");
    const errorNode = document.getElementById("gate-error");
    if (submit) submit.disabled = true;
    try {
      await gate.accept();
      const dest = gate.returnTo && gate.returnTo !== "/agree" ? gate.returnTo : "/";
      gate.returnTo = "/";
      router.navigate(dest, { replace: true });
    } catch (error) {
      if (errorNode) {
        errorNode.hidden = false;
        errorNode.textContent = error instanceof ApiError ? error.userMessage : i18n.t("errors.unknown");
      }
      syncGateSubmit();
    }
  });
  syncGateSubmit();

  document.querySelector("[data-action='gate-retry']")?.addEventListener("click", async () => {
    await gate.refresh();
    if (!gate.isBlocking()) {
      router.navigate(gate.returnTo || "/", { replace: true });
    }
  });

  document.body.classList.remove("has-salon-cart");
  if (router.current === "/explore") {
    bindExplore(appRoot);
    mountExplore(appRoot);
  }
  if (/^\/salon\/[^/]+\/event$/.test(router.current)) {
    mountEventRequest(appRoot);
  } else if (/^\/salon\/[^/]+\/book$/.test(router.current)) {
    mountBooking(appRoot);
  } else if (router.current.startsWith("/salon/")) {
    mountSalonDetail(appRoot);
  }
  if (router.current === "/bookings") {
    mountBookings(appRoot);
  }
  if (router.current === "/saved") {
    mountSaved(appRoot);
  }
  if (router.current === "/notices") {
    mountNotices(appRoot);
  } else {
    refreshNoticeBadge();
  }
  if (router.current === "/account") {
    mountAccount(appRoot);
  }
}

function syncChrome() {
  if (langSwitch) {
    langSwitch.value = i18n.locale;
    langSwitch.setAttribute("aria-label", i18n.t("lang.switch"));
  }

  document.querySelectorAll("[data-nav]").forEach((link) => {
    const href = link.getAttribute("href");
    const isCurrent =
      href === router.current ||
      (href === "/explore" && router.current.startsWith("/salon/")) ||
      (href === "/bookings" && router.current === "/bookings") ||
      (href === "/saved" && router.current === "/saved") ||
      (href === "/notices" && router.current === "/notices") ||
      (href === "/account" && router.current === "/account") ||
      (href === "/" && router.current === "/");
    if (isCurrent) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  closeNav();
}

function syncHeaderOffset() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  const height = Math.ceil(header.getBoundingClientRect().height);
  if (height > 0) document.documentElement.style.setProperty("--header-height", `${height}px`);
}

function closeNav() {
  nav?.classList.remove("is-open");
  if (navToggle) {
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("data-i18n-aria", "nav.open");
    navToggle.setAttribute("aria-label", i18n.t("nav.open"));
  }
}

function toggleNav() {
  const open = !nav?.classList.contains("is-open");
  nav?.classList.toggle("is-open", open);
  navToggle?.setAttribute("aria-expanded", String(open));
  const key = open ? "nav.close" : "nav.open";
  navToggle?.setAttribute("data-i18n-aria", key);
  navToggle?.setAttribute("aria-label", i18n.t(key));
}

function bindChrome() {
  navToggle?.addEventListener("click", toggleNav);
  const onLangChange = (event) => {
    const next = event.target.value;
    if (next && next !== i18n.locale) i18n.setLocale(next);
  };
  langSwitch?.addEventListener("change", onLangChange);
  langSwitch?.addEventListener("input", onLangChange);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeNoticePanel();
      closeNav();
      document.querySelector("[data-delete-cancel]")?.click();
    }
  });
  bindNoticeBell();
  bindOfflineBanner();
  registerShellWorker();
  syncHeaderOffset();
  if (typeof ResizeObserver === "function") {
    const header = document.querySelector(".site-header");
    if (header) new ResizeObserver(syncHeaderOffset).observe(header);
  }
  window.addEventListener("resize", syncHeaderOffset);
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-action='sign-out']")) return;
    auth.signOut();
    gate.reset();
    gate.returnTo = "/";
    document.body.classList.remove("gate-locked");
    router.navigate("/account", { replace: true });
  });
}

router.register("/", renderHome);
router.register("/explore", renderExplore);
router.register("/salon/:id/event", renderEventRequest);
router.register("/salon/:id/book", renderBooking);
router.register("/salon/:id", renderSalonDetail);
router.register("/bookings", renderBookings);
router.register("/saved", renderSaved);
router.register("/notices", renderNotices);
router.register("/account", renderAccount);
router.register("/privacy", renderPrivacy);
router.register("/agree", renderGate);
router.register("*", renderNotFound);

router.beforeEach((to) => {
  if (!auth.isAuthenticated()) return to === "/agree" ? "/account" : null;
  if (gate.isBlocking()) return to === "/agree" ? null : "/agree";
  return to === "/agree" ? "/" : null;
});

router.onChange(paint);
i18n.onChange(() => {
  syncChrome();
  bindColomboTimes(document);
  syncNoticeChrome();
  syncAccountChrome();
  syncOfflineBanner();
  syncHeaderOffset();
});
gate.onChange((snapshot) => {
  if (router.current !== "/agree") return;
  if (snapshot.status === "loading" || snapshot.status === "clear") return;
  paint();
});

bindChrome();
i18n
  .init()
  .then(async () => {
    if (auth.isAuthenticated()) {
      gate.returnTo = window.location.pathname || "/";
      await gate.refresh();
    }
  })
  .catch(() => {
    console.error("Failed to load translations");
  })
  .finally(() => router.start());
