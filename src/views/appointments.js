import { i18n } from "../scripts/i18n.js";
import { bindI18n } from "../scripts/i18n-bind.js";
import { ApiError, colombo } from "../scripts/api.js";
import { router } from "../scripts/router.js";
import { appointments } from "../scripts/appointments.js";

const PAST_STATUSES = new Set(["completed", "cancelled", "declined"]);

let listGen = 0;
const screen = {
  tab: "upcoming",
  items: [],
  flash: "",
  flashError: false,
  dialog: null,
  busyId: "",
  rating: 0,
  reviewBody: "",
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

function localeTag() {
  return i18n.locale === "si" ? "si-LK" : "en-LK";
}

function bindColomboTimes(root = document) {
  const locale = localeTag();
  root.querySelectorAll("[data-colombo-time]").forEach((node) => {
    const value = node.getAttribute("data-colombo-time");
    if (!value) return;
    node.textContent = colombo.format(value, { locale, dateStyle: "full", timeStyle: "short" });
    node.setAttribute("datetime", colombo.parse(value) || value);
  });
}

function formatWhen(startsAt) {
  if (!startsAt) return "";
  return colombo.format(startsAt, { locale: localeTag(), dateStyle: "full", timeStyle: "short" });
}

function calmError(error) {
  if (!error) return "";
  if (typeof error === "string") return i18n.t(error);
  return i18n.t(appointments.errorKey(error));
}

function isUpcoming(item) {
  if (item.status === "proposed") return true;
  if (item.status === "pending") return true;
  if (PAST_STATUSES.has(item.status)) return false;
  if (item.status === "confirmed" && item.startsAt) return item.startsAt >= colombo.nowIso();
  return Boolean(item.startsAt && item.startsAt >= colombo.nowIso());
}

function currentTab() {
  return screen.tab === "past" ? "past" : "upcoming";
}

function setTab(tab) {
  screen.tab = tab === "past" ? "past" : "upcoming";
  const next = screen.tab === "past" ? "/bookings?tab=past" : "/bookings";
  if (`${window.location.pathname}${window.location.search}` !== next) {
    window.history.replaceState({ path: next }, "", next);
  }
  router.query = screen.tab === "past" ? { tab: "past" } : {};
}

function statusMeta(item) {
  if (item.status === "proposed") return { key: "bookings.status.proposed", cls: "is-proposed" };
  if (item.status === "pending") return { key: "bookings.status.pending", cls: "is-pending" };
  if (item.status === "confirmed") return { key: "bookings.status.confirmed", cls: "is-confirmed" };
  if (item.status === "cancelled") return { key: "bookings.status.cancelled", cls: "is-cancelled" };
  if (item.status === "completed") return { key: "bookings.status.completed", cls: "is-completed" };
  if (item.status === "declined") return { key: "bookings.status.declined", cls: "is-cancelled" };
  return { key: "bookings.status.pending", cls: "is-pending" };
}

function serviceLine(item) {
  return (item.services || [])
    .map((service) => (typeof service === "string" ? service : service.name || service.title))
    .filter(Boolean)
    .join(" · ");
}

function skeletonMarkup() {
  return `
    <section class="page appt-screen" aria-busy="true">
      <header class="appt-head">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </header>
      <div class="appt-tabs" aria-hidden="true">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line"></div>
      </div>
      <article class="appt-card skeleton-card" aria-hidden="true"></article>
      <article class="appt-card skeleton-card" aria-hidden="true"></article>
    </section>
  `;
}

function emptyMarkup(tab) {
  const key = tab === "past" ? "bookings.empty.past" : "bookings.empty.upcoming";
  return `
    <div class="appt-empty empty-state">
      <p data-i18n="${key}"></p>
      <a class="btn btn-primary" data-link href="/explore" data-i18n="bookings.explore"></a>
    </div>
  `;
}

function proposalBlock(item) {
  if (!item.proposal?.startsAt) return "";
  const busy = screen.busyId === item.id;
  return `
    <div class="appt-proposal">
      <p class="appt-proposal-label" data-i18n="bookings.proposal.lede"></p>
      <p class="appt-proposal-time">
        <time data-colombo-time="${escapeHtml(item.proposal.startsAt)}">${escapeHtml(formatWhen(item.proposal.startsAt))}</time>
      </p>
      <p class="book-zone" data-i18n="book.time.zone"></p>
      ${item.proposal.note ? `<p class="appt-proposal-note">${escapeHtml(item.proposal.note)}</p>` : ""}
      ${item.proposal.staffName ? `<p>${escapeHtml(item.proposal.staffName)}</p>` : ""}
      <div class="appt-actions">
        <button class="btn btn-primary" type="button" data-accept="${escapeHtml(item.id)}" ${busy ? "disabled" : ""} data-i18n="bookings.proposal.accept"></button>
        <button class="btn btn-ghost" type="button" data-decline="${escapeHtml(item.id)}" ${busy ? "disabled" : ""} data-i18n="bookings.proposal.decline"></button>
      </div>
    </div>
  `;
}

function bookingCard(item) {
  const status = statusMeta(item);
  const kindKey = item.kind === "event" ? "bookings.kind.event" : "bookings.kind.visit";
  const services = serviceLine(item);
  const busy = screen.busyId === item.id;
  const upcoming = isUpcoming(item);
  const canCancel = upcoming && item.status !== "cancelled";
  const canReview = item.status === "completed" && !item.reviewed;
  return `
    <article class="appt-card${item.status === "proposed" ? " is-proposal" : ""}" data-appt="${escapeHtml(item.id)}">
      <header class="appt-card-head">
        <div>
          <p class="appt-kind" data-i18n="${kindKey}"></p>
          <h2>${escapeHtml(item.salonName || i18n.t("book.summary.salon"))}</h2>
        </div>
        <span class="appt-badge ${status.cls}" data-i18n="${status.key}"></span>
      </header>
      ${services ? `<p class="appt-services">${escapeHtml(services)}</p>` : ""}
      ${item.staffName && item.kind !== "event" ? `<p class="appt-meta">${escapeHtml(item.staffName)}</p>` : ""}
      ${
        item.startsAt
          ? `<p class="appt-when"><span data-i18n="${item.status === "proposed" ? "bookings.when.original" : "bookings.when"}"></span>
              <time data-colombo-time="${escapeHtml(item.startsAt)}">${escapeHtml(formatWhen(item.startsAt))}</time></p>`
          : ""
      }
      <p class="book-zone" data-i18n="book.time.zone"></p>
      ${proposalBlock(item)}
      ${item.reviewed ? `<p class="appt-reviewed" data-i18n="bookings.review.done"></p>` : ""}
      <div class="appt-actions">
        ${canCancel ? `<button class="btn btn-ghost" type="button" data-cancel="${escapeHtml(item.id)}" ${busy ? "disabled" : ""} data-i18n="bookings.cancel"></button>` : ""}
        ${canReview ? `<button class="btn btn-accent" type="button" data-review="${escapeHtml(item.id)}" ${busy ? "disabled" : ""} data-i18n="bookings.review"></button>` : ""}
        ${item.salonId ? `<a class="btn btn-ghost" data-link href="/salon/${encodeURIComponent(item.salonId)}" data-i18n="bookings.open"></a>` : ""}
      </div>
    </article>
  `;
}

function cancelDialog(item) {
  return `
    <div id="appt-dialog" class="appt-sheet" role="dialog" aria-modal="true" aria-labelledby="appt-dialog-title">
      <div class="appt-sheet-panel">
        <h2 id="appt-dialog-title" data-i18n="bookings.cancel.title"></h2>
        <p data-i18n="bookings.cancel.body"></p>
        <p class="appt-when">${escapeHtml(item.salonName || "")}</p>
        ${item.startsAt ? `<time data-colombo-time="${escapeHtml(item.startsAt)}">${escapeHtml(formatWhen(item.startsAt))}</time>` : ""}
        <div class="appt-actions">
          <button class="btn btn-ghost" type="button" data-dialog-close ${screen.busyId ? "disabled" : ""} data-i18n="bookings.cancel.keep"></button>
          <button class="btn btn-primary" type="button" data-confirm-cancel="${escapeHtml(item.id)}" ${screen.busyId ? "disabled" : ""} data-i18n="bookings.cancel.confirm"></button>
        </div>
      </div>
    </div>
  `;
}

function reviewDialog(item) {
  const stars = [1, 2, 3, 4, 5]
    .map(
      (value) => `
        <button class="appt-star${screen.rating >= value ? " is-on" : ""}" type="button" data-star="${value}" aria-pressed="${screen.rating >= value ? "true" : "false"}" data-i18n-aria="bookings.review.stars" data-i18n-vars='${varsAttr({ rating: value })}'>★</button>
      `,
    )
    .join("");
  return `
    <div id="appt-dialog" class="appt-sheet" role="dialog" aria-modal="true" aria-labelledby="appt-dialog-title">
      <form class="appt-sheet-panel" id="appt-review-form">
        <h2 id="appt-dialog-title" data-i18n="bookings.review.title"></h2>
        <p data-i18n="bookings.review.body"></p>
        <p class="appt-when">${escapeHtml(item.salonName || "")} · ${escapeHtml(serviceLine(item))}</p>
        <div class="appt-stars" role="radiogroup" data-i18n-aria="bookings.review.rating">${stars}</div>
        <label class="field-group">
          <span data-i18n="bookings.review.comment"></span>
          <textarea class="field" id="appt-review-body" rows="4" maxlength="600">${escapeHtml(screen.reviewBody)}</textarea>
        </label>
        <div class="appt-actions">
          <button class="btn btn-ghost" type="button" data-dialog-close ${screen.busyId ? "disabled" : ""} data-i18n="bookings.review.cancel"></button>
          <button class="btn btn-primary" type="submit" id="appt-review-submit" ${screen.busyId ? "disabled" : ""} data-i18n="bookings.review.submit"></button>
        </div>
      </form>
    </div>
  `;
}

function dialogMarkup() {
  if (!screen.dialog) return "";
  const item = screen.items.find((entry) => entry.id === screen.dialog.id);
  if (!item) return "";
  return screen.dialog.type === "review" ? reviewDialog(item) : cancelDialog(item);
}

function tabbedList() {
  const tab = currentTab();
  const upcoming = screen.items.filter(isUpcoming).sort((a, b) => {
    if (a.status === "proposed" && b.status !== "proposed") return -1;
    if (b.status === "proposed" && a.status !== "proposed") return 1;
    return String(a.startsAt || "").localeCompare(String(b.startsAt || ""));
  });
  const past = screen.items.filter((item) => !isUpcoming(item)).sort((a, b) => String(b.startsAt || "").localeCompare(String(a.startsAt || "")));
  const visible = tab === "past" ? past : upcoming;
  return `
    <div class="appt-tabs" role="tablist" data-i18n-aria="bookings.tabs">
      <button class="appt-tab" type="button" role="tab" data-tab="upcoming" aria-selected="${tab === "upcoming" ? "true" : "false"}" data-i18n="bookings.tab.upcoming"></button>
      <button class="appt-tab" type="button" role="tab" data-tab="past" aria-selected="${tab === "past" ? "true" : "false"}" data-i18n="bookings.tab.past"></button>
    </div>
    <div class="appt-list" role="tabpanel">
      ${visible.length ? visible.map(bookingCard).join("") : emptyMarkup(tab)}
    </div>
  `;
}

function paint(root) {
  root.innerHTML = `
    <section class="page appt-screen">
      <header class="appt-head">
        <h1 data-i18n="bookings.title"></h1>
        <p class="lede" data-i18n="bookings.lede"></p>
      </header>
      ${screen.flash ? `<p class="banner ${screen.flashError ? "banner-error" : "banner-success"}" role="alert">${escapeHtml(screen.flash)}</p>` : ""}
      ${tabbedList()}
      ${dialogMarkup()}
    </section>
  `;
  bindI18n(root);
  bindColomboTimes(root);
  bindScreen(root);
}

function bindScreen(root) {
  root.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setTab(button.getAttribute("data-tab"));
      screen.flash = "";
      paint(root);
    });
  });

  root.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      screen.dialog = { type: "cancel", id: button.getAttribute("data-cancel") };
      paint(root);
    });
  });

  root.querySelectorAll("[data-review]").forEach((button) => {
    button.addEventListener("click", () => {
      screen.dialog = { type: "review", id: button.getAttribute("data-review") };
      screen.rating = 0;
      screen.reviewBody = "";
      paint(root);
    });
  });

  root.querySelector("[data-dialog-close]")?.addEventListener("click", () => {
    screen.dialog = null;
    paint(root);
  });

  root.querySelector("[data-confirm-cancel]")?.addEventListener("click", (event) => {
    runAction(root, event.currentTarget.getAttribute("data-confirm-cancel"), "cancel");
  });

  root.querySelectorAll("[data-accept]").forEach((button) => {
    button.addEventListener("click", () => runAction(root, button.getAttribute("data-accept"), "accept"));
  });
  root.querySelectorAll("[data-decline]").forEach((button) => {
    button.addEventListener("click", () => runAction(root, button.getAttribute("data-decline"), "decline"));
  });

  root.querySelectorAll("[data-star]").forEach((button) => {
    button.addEventListener("click", () => {
      screen.rating = Number(button.getAttribute("data-star")) || 0;
      screen.reviewBody = root.querySelector("#appt-review-body")?.value || "";
      paint(root);
    });
  });

  root.querySelector("#appt-review-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    screen.reviewBody = root.querySelector("#appt-review-body")?.value || "";
    runAction(root, screen.dialog?.id, "review");
  });
}

async function runAction(root, id, action) {
  if (!id || screen.busyId) return;
  const item = screen.items.find((entry) => entry.id === id);
  if (!item) return;
  screen.busyId = id;
  screen.flash = "";
  screen.flashError = false;
  paint(root);

  try {
    if (action === "cancel") {
      const payload = await appointments.cancel(id);
      replaceItem(id, payload?.appointment);
      screen.dialog = null;
      screen.flash = i18n.t("bookings.cancel.done");
    } else if (action === "accept") {
      const payload = await appointments.acceptProposal(id);
      replaceItem(id, payload?.appointment);
      screen.flash = i18n.t("bookings.proposal.accepted");
    } else if (action === "decline") {
      const payload = await appointments.declineProposal(id);
      replaceItem(id, payload?.appointment);
      screen.flash = i18n.t("bookings.proposal.declined");
    } else if (action === "review") {
      if (screen.rating < 1) throw new ApiError("errors.code.rating-required", { status: 422, code: "rating-required" });
      await appointments.review({
        salonId: item.salonId,
        serviceId: item.serviceId,
        appointmentId: item.id,
        rating: screen.rating,
        body: screen.reviewBody,
      });
      item.reviewed = true;
      screen.dialog = null;
      screen.flash = i18n.t("bookings.review.thanks");
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      router.navigate("/account");
      return;
    }
    screen.flashError = true;
    screen.flash = calmError(error);
  } finally {
    screen.busyId = "";
    paint(root);
  }
}

function replaceItem(id, raw) {
  const mapped = raw ? appointments.asAppointment(raw) : null;
  if (!mapped) {
    const current = screen.items.find((item) => item.id === id);
    if (current) current.status = "cancelled";
    return;
  }
  const index = screen.items.findIndex((item) => item.id === id);
  if (index >= 0) screen.items[index] = mapped;
  else screen.items.unshift(mapped);
}

export function renderBookings() {
  return skeletonMarkup();
}

export async function mountBookings(root) {
  const gen = ++listGen;
  screen.tab = String(router.query.tab || "upcoming") === "past" ? "past" : "upcoming";
  screen.dialog = null;
  screen.busyId = "";
  screen.flash = "";
  screen.flashError = false;
  try {
    const items = await appointments.list();
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
      <section class="page appt-screen">
        <article class="card form-stack">
          <h1 data-i18n="bookings.title"></h1>
          <p class="banner banner-error" role="alert">${escapeHtml(calmError(error))}</p>
          <a class="btn btn-ghost" data-link href="/explore" data-i18n="bookings.explore"></a>
        </article>
      </section>
    `;
    bindI18n(root);
  }
}
