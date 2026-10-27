import { i18n } from "../scripts/i18n.js";
import { bindI18n } from "../scripts/i18n-bind.js";
import { ApiError, colombo } from "../scripts/api.js";
import { router } from "../scripts/router.js";
import { salons } from "../scripts/salons.js";
import { storage } from "../scripts/storage.js";
import { appointments } from "../scripts/appointments.js";

const CART_KEY = "cart";
const DATE_COUNT = 14;
const ANY_STAFF = "any";

let bookGen = 0;
let slotsGen = 0;
let submitting = false;
const draft = {
  step: 1,
  staffId: ANY_STAFF,
  date: "",
  slot: null,
  staff: [],
  slots: [],
  closed: false,
  confirmation: "auto",
  salon: null,
  appointment: null,
  error: "",
  loadingSlots: false,
};

function resetDraft() {
  draft.step = 1;
  draft.staffId = ANY_STAFF;
  draft.date = "";
  draft.slot = null;
  draft.staff = [];
  draft.slots = [];
  draft.closed = false;
  draft.confirmation = "auto";
  draft.salon = null;
  draft.appointment = null;
  draft.error = "";
  draft.loadingSlots = false;
}

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

function localeTag() {
  return i18n.locale === "si" ? "si-LK" : "en-LK";
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function colomboTodayKey() {
  const parts = colombo.parts();
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function upcomingDates(count = DATE_COUNT) {
  const start = colombo.parts();
  const dates = [];
  for (let offset = 0; offset < count; offset += 1) {
    const noonUtc = Date.UTC(start.year, start.month - 1, start.day + offset, 6, 30, 0);
    const parts = colombo.parts(new Date(noonUtc));
    dates.push(`${parts.year}-${pad(parts.month)}-${pad(parts.day)}`);
  }
  return dates;
}

function dateChip(dateStr) {
  const iso = colombo.parse(`${dateStr}T12:00:00`) || `${dateStr}T12:00:00+05:30`;
  const date = new Date(iso);
  const locale = localeTag();
  return {
    key: dateStr,
    weekday: new Intl.DateTimeFormat(locale, { timeZone: colombo.zone, weekday: "short" }).format(date),
    day: new Intl.DateTimeFormat(locale, { timeZone: colombo.zone, day: "numeric" }).format(date),
    month: new Intl.DateTimeFormat(locale, { timeZone: colombo.zone, month: "short" }).format(date),
    today: dateStr === colomboTodayKey(),
  };
}

function formatWhen(startsAt) {
  if (!startsAt) return "";
  return colombo.format(startsAt, {
    locale: localeTag(),
    dateStyle: "full",
    timeStyle: "short",
  });
}

function getCart(salonId) {
  const items = storage.get(`${CART_KEY}.${salonId}`, [], { session: true });
  return Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
}

function clearCart(salonId) {
  storage.set(`${CART_KEY}.${salonId}`, [], { session: true });
}

function cartTotals(salonId) {
  const items = getCart(salonId);
  const count = items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const total = items.reduce((sum, item) => sum + Number(item.priceLkr || 0) * Number(item.qty || 0), 0);
  const durationMin = items.reduce((sum, item) => sum + (Number(item.durationMin) || 30) * Number(item.qty || 0), 0);
  return { items, count, total, durationMin };
}

function selectedStaff() {
  return draft.staff.find((item) => item.id === draft.staffId) || draft.staff.find((item) => item.any) || null;
}

function staffLabel(person) {
  if (!person) return i18n.t("book.staff.any");
  if (person.any || person.id === ANY_STAFF) return i18n.t("book.staff.any");
  return person.name;
}

function staffTitle(person) {
  if (!person) return i18n.t("book.staff.any.meta");
  if (person.any || person.id === ANY_STAFF) return i18n.t("book.staff.any.meta");
  return person.title;
}

function showError(error) {
  if (!error) {
    draft.error = "";
    return;
  }
  if (typeof error === "string") {
    draft.error = i18n.t(error) === error && !error.startsWith("errors.") ? error : i18n.t(error);
    return;
  }
  draft.error = i18n.t(appointments.errorKey(error));
}

function emptyMarkup(salonId) {
  return `
    <section class="page book-screen">
      <article class="card form-stack">
        <h1 data-i18n="book.empty.title"></h1>
        <p data-i18n="book.empty.body"></p>
        <a class="btn btn-primary" data-link href="/salon/${encodeURIComponent(salonId || "")}" data-i18n="book.back"></a>
      </article>
    </section>
  `;
}

function stepsNav() {
  const items = [
    { step: 1, key: "book.step.staff" },
    { step: 2, key: "book.step.time" },
    { step: 3, key: "book.step.summary" },
  ];
  return `
    <ol class="book-progress" data-i18n-aria="book.steps">
      ${items
        .map(
          (item) => `
        <li class="book-progress-item${draft.step === item.step ? " is-current" : ""}${draft.step > item.step ? " is-done" : ""}">
          <span class="book-progress-index">${item.step}</span>
          <span data-i18n="${item.key}"></span>
        </li>
      `,
        )
        .join("")}
    </ol>
  `;
}

function errorBanner() {
  if (!draft.error) return `<p id="book-error" class="banner banner-error" hidden></p>`;
  return `<p id="book-error" class="banner banner-error" role="alert">${escapeHtml(draft.error)}</p>`;
}

function staffCard(person) {
  const selected = person.id === draft.staffId;
  const name = staffLabel(person);
  const title = staffTitle(person);
  const photo = person.photo || "/public/assets/staff/any.svg";
  return `
    <button class="book-staff-card${person.any ? " is-any" : ""}${selected ? " is-selected" : ""}" type="button" data-staff="${escapeHtml(person.id)}" aria-pressed="${selected ? "true" : "false"}">
      <img src="${escapeHtml(photo)}" alt="" width="56" height="56" loading="${person.any ? "eager" : "lazy"}">
      <span class="book-staff-copy">
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(title)}</span>
      </span>
    </button>
  `;
}

function dateButton(chip) {
  const selected = chip.key === draft.date;
  return `
    <button class="book-date${selected ? " is-selected" : ""}" type="button" data-date="${escapeHtml(chip.key)}" aria-pressed="${selected ? "true" : "false"}">
      <span class="book-date-week">${escapeHtml(chip.today ? i18n.t("book.date.today") : chip.weekday)}</span>
      <span class="book-date-day">${escapeHtml(chip.day)}</span>
      <span class="book-date-month">${escapeHtml(chip.month)}</span>
    </button>
  `;
}

function slotButton(slot) {
  const selected = draft.slot?.id === slot.id;
  const confirmKey = slot.confirmation === "manual" ? "book.time.manual" : "book.time.auto";
  const badge = slot.confirmation === "manual" ? "is-manual" : "is-auto";
  if (!slot.available) {
    return `
      <button class="book-slot is-taken" type="button" disabled data-i18n-aria="book.time.taken">
        <span class="book-slot-time">${escapeHtml(slot.start)}</span>
        <span data-i18n="book.time.taken"></span>
      </button>
    `;
  }
  return `
    <button class="book-slot${selected ? " is-selected" : ""}" type="button" data-slot="${escapeHtml(slot.id)}" aria-pressed="${selected ? "true" : "false"}">
      <span class="book-slot-time">${escapeHtml(slot.start)}</span>
      <span class="explore-badge ${badge}" data-i18n="${confirmKey}"></span>
    </button>
  `;
}

function serviceList(items) {
  return `
    <ul class="book-list">
      ${items
        .map(
          (item) =>
            `<li class="service-row"><span>${escapeHtml(item.name)} × ${item.qty}</span><span>${escapeHtml(formatLkr((item.priceLkr || 0) * item.qty))}</span></li>`,
        )
        .join("")}
    </ul>
  `;
}

function stepStaff(salonId, cart) {
  return `
    <section class="book-panel">
      <header class="book-head">
        <a class="btn btn-ghost" data-link href="/salon/${encodeURIComponent(salonId)}" data-i18n="book.back"></a>
        <h1 data-i18n="book.staff.title"></h1>
        <p class="lede" data-i18n="book.staff.lede"></p>
      </header>
      ${errorBanner()}
      <div class="book-staff-list" role="group" data-i18n-aria="book.staff.title">
        ${draft.staff.map(staffCard).join("")}
      </div>
      ${serviceList(cart.items)}
      <p class="menu-meta">${escapeHtml(i18n.t("menu.cart.summary", { count: cart.count, total: formatAmount(cart.total) }))}</p>
      <button class="btn btn-primary book-next" type="button" data-action="next" data-i18n="book.staff.continue"></button>
    </section>
  `;
}

function stepTime(salonId) {
  const chips = upcomingDates().map(dateChip);
  const confirm = draft.confirmation === "manual" ? "manual" : "auto";
  const slots = draft.loadingSlots
    ? `<div class="book-slots" aria-busy="true">${Array.from({ length: 6 }, () => `<div class="book-slot skeleton" aria-hidden="true"></div>`).join("")}</div>`
    : draft.closed
      ? `<p class="empty-state" data-i18n="book.time.closed"></p>`
      : draft.slots.length
        ? `<div class="book-slots" role="group" data-i18n-aria="book.time.title">${draft.slots.map(slotButton).join("")}</div>`
        : `<p class="empty-state" data-i18n="book.time.empty"></p>`;

  return `
    <section class="book-panel">
      <header class="book-head">
        <button class="btn btn-ghost" type="button" data-action="back" data-i18n="book.step.back"></button>
        <h1 data-i18n="book.time.title"></h1>
        <p class="lede" data-i18n="book.time.lede"></p>
        <p class="book-zone" data-i18n="book.time.zone"></p>
      </header>
      ${errorBanner()}
      <div class="book-dates" role="group" data-i18n-aria="book.time.dates">
        ${chips.map(dateButton).join("")}
      </div>
      <p class="book-legend">
        <span class="explore-badge ${confirm === "manual" ? "is-manual" : "is-auto"}" data-i18n="${confirm === "manual" ? "book.time.manual" : "book.time.auto"}"></span>
        <span data-i18n="${confirm === "manual" ? "book.time.manual.hint" : "book.time.auto.hint"}"></span>
      </p>
      ${slots}
      <button class="btn btn-primary book-next" type="button" data-action="next" ${draft.slot ? "" : "disabled"} data-i18n="book.time.continue"></button>
    </section>
  `;
}

function stepSummary(salonId, cart) {
  const person = selectedStaff();
  const when = formatWhen(draft.slot?.startsAt);
  const confirmKey = (draft.slot?.confirmation || draft.confirmation) === "manual" ? "book.time.manual" : "book.time.auto";
  const hintKey = confirmKey === "book.time.manual" ? "book.time.manual.hint" : "book.time.auto.hint";
  return `
    <section class="book-panel">
      <header class="book-head">
        <button class="btn btn-ghost" type="button" data-action="back" data-i18n="book.step.back"></button>
        <h1 data-i18n="book.summary.title"></h1>
        <p class="lede" data-i18n="book.summary.lede"></p>
      </header>
      ${errorBanner()}
      <dl class="book-summary">
        <div>
          <dt data-i18n="book.summary.salon"></dt>
          <dd>${escapeHtml(draft.salon?.name || "")}</dd>
        </div>
        <div>
          <dt data-i18n="book.summary.staff"></dt>
          <dd>${escapeHtml(staffLabel(person))}${person?.any ? "" : ` · ${escapeHtml(staffTitle(person))}`}</dd>
        </div>
        <div>
          <dt data-i18n="book.summary.when"></dt>
          <dd>
            <time data-colombo-time="${escapeHtml(draft.slot?.startsAt || "")}">${escapeHtml(when)}</time>
            <span class="book-zone" data-i18n="book.time.zone"></span>
          </dd>
        </div>
        <div>
          <dt data-i18n="book.summary.confirm"></dt>
          <dd><span class="explore-badge ${confirmKey === "book.time.manual" ? "is-manual" : "is-auto"}" data-i18n="${confirmKey}"></span> <span data-i18n="${hintKey}"></span></dd>
        </div>
        <div>
          <dt data-i18n="book.summary.services"></dt>
          <dd>${serviceList(cart.items)}</dd>
        </div>
      </dl>
      <p class="menu-meta">${escapeHtml(i18n.t("menu.cart.summary", { count: cart.count, total: formatAmount(cart.total) }))}</p>
      <form id="book-form" class="form-stack">
        <label class="gate-check">
          <input id="book-terms" type="checkbox" name="terms" required>
          <span>
            <span data-i18n="book.terms.lead"></span>
            <a data-link href="/privacy" data-i18n="gate.community.title"></a>
            <span data-i18n="book.terms.and"></span>
            <a data-link href="/privacy" data-i18n="gate.privacy.title"></a>
          </span>
        </label>
        <button class="btn btn-primary book-next" id="book-submit" type="submit" data-i18n="book.confirm"></button>
      </form>
    </section>
  `;
}

function stepDone() {
  const apt = draft.appointment || {};
  const successKey = apt.confirmation === "manual" || apt.status === "pending" ? "book.success.manual" : "book.success.auto";
  return `
    <section class="book-panel">
      <header class="book-head">
        <h1 data-i18n="book.success.title"></h1>
        <p class="lede" data-i18n="${successKey}"></p>
      </header>
      <p class="banner banner-success" data-i18n="book.success.ref" data-i18n-vars='${varsAttr({ id: apt.id || "" })}'></p>
      <dl class="book-summary">
        <div>
          <dt data-i18n="book.summary.salon"></dt>
          <dd>${escapeHtml(apt.salonName || draft.salon?.name || "")}</dd>
        </div>
        <div>
          <dt data-i18n="book.summary.when"></dt>
          <dd>
            <time data-colombo-time="${escapeHtml(apt.startsAt || "")}">${escapeHtml(formatWhen(apt.startsAt))}</time>
            <span class="book-zone" data-i18n="book.time.zone"></span>
          </dd>
        </div>
      </dl>
      <a class="btn btn-primary" data-link href="/explore" data-i18n="book.success.done"></a>
    </section>
  `;
}

function paint(root) {
  const salonId = router.params.id;
  const cart = cartTotals(salonId);
  if (!cart.count && draft.step !== 4) {
    root.innerHTML = emptyMarkup(salonId);
    bindI18n(root);
    return;
  }
  if (!draft.staff.length) draft.staff = withAnyFirst([]);

  const body =
    draft.step === 4
      ? stepDone()
      : draft.step === 3
        ? stepSummary(salonId, cart)
        : draft.step === 2
          ? stepTime(salonId)
          : stepStaff(salonId, cart);

  root.innerHTML = `
    <article class="book-screen" data-salon-id="${escapeHtml(salonId)}">
      ${draft.step === 4 ? "" : stepsNav()}
      ${body}
    </article>
  `;
  bindI18n(root);
  bindColomboTimes(root);
  bindBooking(root, salonId, cart);
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

function bindBooking(root, salonId, cart) {
  root.querySelector("[data-action='back']")?.addEventListener("click", () => {
    draft.step = Math.max(1, draft.step - 1);
    draft.error = "";
    paint(root);
  });

  root.querySelector("[data-action='next']")?.addEventListener("click", async () => {
    if (draft.step === 1) {
      draft.step = 2;
      draft.error = "";
      if (!draft.date) draft.date = colomboTodayKey();
      paint(root);
      await loadSlots(root, salonId, cart);
      return;
    }
    if (draft.step === 2 && draft.slot) {
      draft.step = 3;
      draft.error = "";
      paint(root);
    }
  });

  root.querySelectorAll("[data-staff]").forEach((button) => {
    button.addEventListener("click", async () => {
      draft.staffId = button.getAttribute("data-staff") || ANY_STAFF;
      draft.slot = null;
      draft.error = "";
      paint(root);
    });
  });

  root.querySelectorAll("[data-date]").forEach((button) => {
    button.addEventListener("click", async () => {
      draft.date = button.getAttribute("data-date") || colomboTodayKey();
      draft.slot = null;
      draft.error = "";
      paint(root);
      await loadSlots(root, salonId, cart);
    });
  });

  root.querySelectorAll("[data-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-slot");
      draft.slot = draft.slots.find((item) => item.id === id) || null;
      draft.error = "";
      paint(root);
    });
  });

  const form = root.querySelector("#book-form");
  form?.addEventListener("submit", (event) => submitBooking(event, root, salonId, cart));
}

async function loadSlots(root, salonId, cart) {
  const gen = ++slotsGen;
  draft.loadingSlots = true;
  paint(root);
  try {
    const result = await appointments.availability({
      salonId,
      staffId: draft.staffId || ANY_STAFF,
      date: draft.date || colomboTodayKey(),
      durationMin: cart.durationMin,
      force: true,
    });
    if (gen !== slotsGen) return;
    if (result.staff.length) draft.staff = withAnyFirst(result.staff);
    draft.slots = result.slots;
    draft.closed = result.closed;
    draft.confirmation = result.confirmation;
    draft.loadingSlots = false;
    if (draft.slot && !draft.slots.some((item) => item.id === draft.slot.id && item.available)) {
      draft.slot = null;
    }
    paint(root);
  } catch (error) {
    if (gen !== slotsGen) return;
    draft.loadingSlots = false;
    showError(error);
    draft.slots = [];
    paint(root);
  }
}

function withAnyFirst(staff) {
  const seen = new Set();
  const list = [];
  const any = staff.find((item) => item.any || item.id === ANY_STAFF) || {
    id: ANY_STAFF,
    name: i18n.t("book.staff.any"),
    title: i18n.t("book.staff.any.meta"),
    photo: "/public/assets/staff/any.svg",
    any: true,
  };
  any.any = true;
  any.id = ANY_STAFF;
  list.push(any);
  seen.add(ANY_STAFF);
  for (const person of staff) {
    if (seen.has(person.id) || person.any || person.id === ANY_STAFF) continue;
    seen.add(person.id);
    list.push(person);
  }
  return list;
}

async function submitBooking(event, root, salonId, cart) {
  event.preventDefault();
  const submit = root.querySelector("#book-submit");
  if (submitting) return;
  submitting = true;
  if (submit) {
    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    submit.textContent = i18n.t("book.confirming");
  }

  const terms = root.querySelector("#book-terms");
  if (!terms?.checked) {
    submitting = false;
    showError("errors.code.terms-required");
    if (submit) {
      submit.disabled = false;
      submit.removeAttribute("aria-busy");
      submit.textContent = i18n.t("book.confirm");
    }
    paint(root);
    return;
  }

  try {
    const payload = await appointments.book({
      salonId,
      staffId: draft.staffId || ANY_STAFF,
      startsAt: draft.slot?.startsAt,
      services: cart.items.map((item) => ({ id: item.id, name: item.name, qty: item.qty, priceLkr: item.priceLkr })),
      termsAccepted: true,
      durationMin: cart.durationMin,
    });
    draft.appointment = payload?.appointment || payload || {};
    draft.step = 4;
    draft.error = "";
    clearCart(salonId);
    submitting = false;
    paint(root);
  } catch (error) {
    submitting = false;
    showError(error);
    const key = appointments.errorKey(error);
    if (key === "errors.code.slot-taken") {
      draft.step = 2;
      draft.slot = null;
      paint(root);
      await loadSlots(root, salonId, cart);
      return;
    }
    if (error instanceof ApiError && error.status === 401) {
      router.navigate("/account");
      return;
    }
    paint(root);
  }
}

export function renderBooking() {
  const salonId = router.params.id;
  if (!cartTotals(salonId).count) return emptyMarkup(salonId);
  return `
    <article class="book-screen" aria-busy="true">
      <div class="book-panel">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
        <div class="book-staff-card skeleton-card" aria-hidden="true"></div>
        <div class="book-staff-card skeleton-card" aria-hidden="true"></div>
      </div>
    </article>
  `;
}

export async function mountBooking(root) {
  const gen = ++bookGen;
  const salonId = router.params.id;
  resetDraft();
  submitting = false;
  document.body.classList.remove("has-salon-cart");
  const cart = cartTotals(salonId);
  if (!cart.count) {
    bindI18n(root);
    return;
  }
  draft.date = colomboTodayKey();
  try {
    const [feed, availability] = await Promise.all([
      salons.salonFeed(salonId),
      appointments.availability({ salonId, staffId: ANY_STAFF, date: draft.date, durationMin: cart.durationMin }),
    ]);
    if (gen !== bookGen) return;
    draft.salon = feed.salon;
    draft.staff = withAnyFirst(availability.staff);
    draft.staffId = ANY_STAFF;
    draft.slots = availability.slots;
    draft.closed = availability.closed;
    draft.confirmation = availability.confirmation || feed.salon?.confirmation || "auto";
    paint(root);
  } catch (error) {
    if (gen !== bookGen) return;
    showError(error);
    paint(root);
  }
}
