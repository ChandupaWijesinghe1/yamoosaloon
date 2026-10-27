import { i18n } from "../scripts/i18n.js";
import { bindI18n } from "../scripts/i18n-bind.js";
import { ApiError } from "../scripts/api.js";
import { router } from "../scripts/router.js";
import { notices } from "../scripts/notices.js";

let listGen = 0;
let panelOpen = false;
const screen = {
  items: [],
  flash: "",
  flashError: false,
  busy: false,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function noticeTitle(item) {
  if (item.titleKey && i18n.has(item.titleKey)) return i18n.t(item.titleKey);
  return item.title || i18n.t("notices.item.fallback");
}

function noticeBody(item) {
  if (item.bodyKey && i18n.has(item.bodyKey)) return i18n.t(item.bodyKey);
  return item.body || "";
}

function kindKey(kind) {
  if (kind === "appointment") return "notices.kind.appointment";
  if (kind === "reminder") return "notices.kind.reminder";
  return "notices.kind.system";
}

export function formatRelative(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return i18n.t("time.justNow");
  if (abs < 3600) return i18n.t("time.minutesAgo", { count: Math.max(1, Math.round(abs / 60)) });
  if (abs < 22 * 3600) return i18n.t("time.hoursAgo", { count: Math.max(1, Math.round(abs / 3600)) });
  if (abs < 36 * 3600) return i18n.t("time.yesterday");
  return i18n.t("time.daysAgo", { count: Math.max(2, Math.round(abs / 86400)) });
}

function bindRelativeTimes(root = document) {
  root.querySelectorAll("[data-relative-time]").forEach((node) => {
    const value = node.getAttribute("data-relative-time");
    if (!value) return;
    node.textContent = formatRelative(value);
  });
}

function calmError(error) {
  if (error instanceof ApiError) return error.userMessage;
  return i18n.t("errors.unknown");
}

function paintBadge(count) {
  const badge = document.getElementById("notice-badge");
  const bell = document.getElementById("notice-bell");
  if (!badge) return;
  const unread = Number(count) || 0;
  if (unread < 1) {
    badge.hidden = true;
    badge.textContent = "";
    bell?.removeAttribute("data-unread");
    return;
  }
  badge.hidden = false;
  badge.textContent = unread > 9 ? "9+" : String(unread);
  bell?.setAttribute("data-unread", String(unread));
}

function noticeItemMarkup(item) {
  const titleAttr = item.titleKey && i18n.has(item.titleKey) ? ` data-i18n="${escapeHtml(item.titleKey)}"` : "";
  const bodyAttr = item.bodyKey && i18n.has(item.bodyKey) ? ` data-i18n="${escapeHtml(item.bodyKey)}"` : "";
  const body = noticeBody(item);
  return `
    <article class="notice-item${item.read ? "" : " is-unread"}" data-notice="${escapeHtml(item.id)}">
      <a class="notice-item-link" data-link href="${escapeHtml(item.href || "/notices")}">
        <p class="notice-kind" data-i18n="${kindKey(item.kind)}"></p>
        <h3${titleAttr}>${escapeHtml(noticeTitle(item))}</h3>
        ${body ? `<p class="notice-body"${bodyAttr}>${escapeHtml(body)}</p>` : ""}
        <time data-relative-time="${escapeHtml(item.createdAt || "")}">${escapeHtml(formatRelative(item.createdAt))}</time>
      </a>
    </article>
  `;
}

function listMarkup(items, { compact = false } = {}) {
  if (!items.length) {
    return `<p class="empty-state" data-i18n="notices.empty"></p>`;
  }
  const visible = compact ? items.slice(0, 5) : items;
  return `
    <div class="notice-list">
      ${visible.map(noticeItemMarkup).join("")}
    </div>
    ${compact ? `<a class="btn btn-ghost notice-all" data-link href="/notices" data-i18n="notices.seeAll"></a>` : ""}
  `;
}

function panelInner(items) {
  const unread = items.filter((item) => !item.read).length;
  return `
    <div class="notice-panel-head">
      <h2 id="notice-panel-title" data-i18n="notices.title"></h2>
      <button class="btn btn-ghost" type="button" data-notice-close data-i18n="notices.close"></button>
    </div>
    ${screen.flash ? `<p class="banner ${screen.flashError ? "banner-error" : "banner-success"}" role="alert">${escapeHtml(screen.flash)}</p>` : ""}
    <div class="notice-panel-actions">
      <button class="btn btn-ghost" type="button" data-read-all ${unread && !screen.busy ? "" : "disabled"} data-i18n="notices.readAll"></button>
    </div>
    ${listMarkup(items, { compact: true })}
  `;
}

function pageMarkup(items) {
  const unread = items.filter((item) => !item.read).length;
  return `
    <section class="page notice-screen">
      <header class="notice-head">
        <h1 data-i18n="notices.title"></h1>
        <p class="lede" data-i18n="notices.lede"></p>
      </header>
      ${screen.flash ? `<p class="banner ${screen.flashError ? "banner-error" : "banner-success"}" role="alert">${escapeHtml(screen.flash)}</p>` : ""}
      <div class="notice-toolbar">
        <button class="btn btn-ghost" type="button" data-read-all ${unread && !screen.busy ? "" : "disabled"} data-i18n="notices.readAll"></button>
      </div>
      ${listMarkup(items)}
    </section>
  `;
}

function bindList(root) {
  root.querySelectorAll("[data-read-all]").forEach((button) => {
    button.addEventListener("click", () => markAllRead(root));
  });
  root.querySelectorAll("[data-notice-close]").forEach((button) => {
    button.addEventListener("click", closeNoticePanel);
  });
  root.querySelectorAll("[data-notice]").forEach((node) => {
    node.querySelector("a")?.addEventListener("click", () => {
      const id = node.getAttribute("data-notice");
      if (!id) return;
      notices.readOne(id).then((count) => paintBadge(count)).catch(() => {});
    });
  });
}

async function markAllRead(root) {
  if (screen.busy) return;
  screen.busy = true;
  screen.flash = "";
  screen.flashError = false;
  try {
    await notices.readAll();
    screen.items = notices.snapshot().items;
    screen.flash = i18n.t("notices.readAll.done");
    paintBadge(0);
  } catch (error) {
    screen.flashError = true;
    screen.flash = calmError(error);
  } finally {
    screen.busy = false;
    if (root?.id === "app") paintPage(root);
    else paintPanel();
  }
}

function paintPanel() {
  const panel = document.getElementById("notice-panel");
  if (!panel) return;
  panel.innerHTML = panelInner(screen.items);
  bindI18n(panel);
  bindRelativeTimes(panel);
  bindList(panel);
}

function paintPage(root) {
  root.innerHTML = pageMarkup(screen.items);
  bindI18n(root);
  bindRelativeTimes(root);
  bindList(root);
}

export function closeNoticePanel() {
  panelOpen = false;
  const panel = document.getElementById("notice-panel");
  const bell = document.getElementById("notice-bell");
  if (panel) panel.hidden = true;
  if (bell) bell.setAttribute("aria-expanded", "false");
  document.body.classList.remove("notice-open");
}

export async function refreshNoticeBadge() {
  try {
    const count = await notices.unreadCount({ force: true });
    paintBadge(count);
  } catch {
    paintBadge(notices.snapshot().unreadCount);
  }
}

async function openNoticePanel() {
  const panel = document.getElementById("notice-panel");
  const bell = document.getElementById("notice-bell");
  if (!panel || !bell) return;
  panelOpen = true;
  panel.hidden = false;
  bell.setAttribute("aria-expanded", "true");
  document.body.classList.add("notice-open");
  panel.innerHTML = `<p class="lede" data-i18n="notices.loading"></p>`;
  bindI18n(panel);
  try {
    screen.items = await notices.list({ force: true });
    paintBadge(notices.snapshot().unreadCount);
    paintPanel();
  } catch (error) {
    panel.innerHTML = `<p class="banner banner-error" role="alert">${escapeHtml(calmError(error))}</p>`;
  }
}

export function toggleNoticePanel() {
  if (panelOpen) closeNoticePanel();
  else openNoticePanel();
}

export function syncNoticeChrome() {
  bindRelativeTimes(document);
  const bell = document.getElementById("notice-bell");
  if (bell) bell.setAttribute("aria-label", i18n.t("notices.bell"));
}

export function bindNoticeBell() {
  const bell = document.getElementById("notice-bell");
  if (!bell || bell.dataset.bound === "true") return;
  bell.dataset.bound = "true";
  bell.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleNoticePanel();
  });
  document.addEventListener("click", (event) => {
    if (!panelOpen) return;
    const wrap = event.target.closest?.(".notice-wrap");
    if (!wrap) closeNoticePanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panelOpen) closeNoticePanel();
  });
  refreshNoticeBadge();
}

export function renderNotices() {
  return `
    <section class="page notice-screen" aria-busy="true">
      <header class="notice-head">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </header>
      <article class="notice-item skeleton-card" aria-hidden="true"></article>
      <article class="notice-item skeleton-card" aria-hidden="true"></article>
    </section>
  `;
}

export async function mountNotices(root) {
  const gen = ++listGen;
  closeNoticePanel();
  screen.flash = "";
  screen.flashError = false;
  try {
    const items = await notices.list({ force: true });
    if (gen !== listGen) return;
    screen.items = items;
    paintBadge(notices.snapshot().unreadCount);
    paintPage(root);
  } catch (error) {
    if (gen !== listGen) return;
    root.innerHTML = `
      <section class="page notice-screen">
        <h1 data-i18n="notices.title"></h1>
        <p class="banner banner-error" role="alert">${escapeHtml(calmError(error))}</p>
      </section>
    `;
    bindI18n(root);
  }
}
