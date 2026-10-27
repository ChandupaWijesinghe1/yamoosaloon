import { i18n } from "../scripts/i18n.js";
import { bindI18n } from "../scripts/i18n-bind.js";
import { ApiError, colombo } from "../scripts/api.js";
import { router } from "../scripts/router.js";
import { salons } from "../scripts/salons.js";
import { appointments } from "../scripts/appointments.js";

const EVENT_TYPES = [
  { id: "bridal", key: "event.type.bridal" },
  { id: "groom", key: "event.type.groom" },
  { id: "party", key: "event.type.party" },
  { id: "shoot", key: "event.type.shoot" },
  { id: "other", key: "event.type.other" },
];

const DURATIONS = [
  { min: 60, key: "event.duration.1h" },
  { min: 90, key: "event.duration.90m" },
  { min: 120, key: "event.duration.2h" },
  { min: 180, key: "event.duration.3h" },
  { min: 240, key: "event.duration.4h" },
  { min: 360, key: "event.duration.6h" },
  { min: 480, key: "event.duration.8h" },
];

let eventGen = 0;
let submitting = false;

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

function pad(value) {
  return String(value).padStart(2, "0");
}

function colomboTodayKey() {
  const parts = colombo.parts();
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function colomboClock() {
  const parts = colombo.parts();
  const rounded = Math.ceil((parts.hour * 60 + parts.minute + 30) / 15) * 15;
  const minutes = Math.min(rounded, 23 * 60 + 45);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function calmError(error) {
  if (!error) return "";
  if (typeof error === "string") return i18n.t(error);
  return i18n.t(appointments.errorKey(error));
}

function typeOptions(selected = "bridal") {
  const current = EVENT_TYPES.some((item) => item.id === selected) ? selected : "bridal";
  return EVENT_TYPES.map(
    (item) => `
      <label class="event-type">
        <input type="radio" name="eventType" value="${item.id}" ${item.id === current ? "checked" : ""}>
        <span data-i18n="${item.key}"></span>
      </label>
    `,
  ).join("");
}

function durationOptions(selected = 120) {
  const current = DURATIONS.some((item) => item.min === Number(selected)) ? Number(selected) : 120;
  return DURATIONS.map(
    (item) =>
      `<option value="${item.min}" ${item.min === current ? "selected" : ""} data-i18n="${item.key}"></option>`,
  ).join("");
}

export function renderEventRequest() {
  return `
    <section class="page event-screen" aria-busy="true">
      <article class="card form-stack">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
        <div class="skeleton skeleton-line"></div>
      </article>
    </section>
  `;
}

function missingMarkup() {
  return `
    <section class="page event-screen">
      <article class="card form-stack">
        <h1 data-i18n="salon.missing.title"></h1>
        <p data-i18n="salon.missing.body"></p>
        <a class="btn btn-primary" data-link href="/explore" data-i18n="salon.back"></a>
      </article>
    </section>
  `;
}

function formMarkup(salon, error = "", values = {}) {
  const today = colomboTodayKey();
  const date = values.date || today;
  const time = values.startTime || colomboClock();
  const offsite = values.locationType === "offsite";
  return `
    <section class="page event-screen">
      <article class="card form-stack">
        <p><a class="btn btn-ghost" data-link href="/salon/${encodeURIComponent(salon.id)}" data-i18n="event.back"></a></p>
        <h1 data-i18n="event.title"></h1>
        <p class="lede" data-i18n="event.lede" data-i18n-vars='${varsAttr({ salon: salon.name })}'></p>
        <p class="book-zone" data-i18n="event.zone"></p>
        <p id="event-error" class="banner banner-error" role="alert" tabindex="-1" ${error ? "" : "hidden"}>${escapeHtml(error)}</p>
        <form id="event-form" class="form-stack" novalidate>
          <fieldset class="event-fieldset">
            <legend data-i18n="event.type"></legend>
            <div class="event-types">${typeOptions(values.eventType)}</div>
          </fieldset>
          <div class="event-when">
            <div class="field-group">
              <label for="event-date" data-i18n="event.date"></label>
              <input class="field" id="event-date" name="date" type="date" required min="${today}" value="${escapeHtml(date)}">
            </div>
            <div class="field-group">
              <label for="event-time" data-i18n="event.time"></label>
              <input class="field" id="event-time" name="startTime" type="time" required step="900" value="${escapeHtml(time)}">
            </div>
          </div>
          <div class="field-group">
            <label for="event-duration" data-i18n="event.duration"></label>
            <select class="field" id="event-duration" name="durationMin" required>
              ${durationOptions(values.durationMin)}
            </select>
          </div>
          <div class="field-group">
            <label for="event-persons" data-i18n="event.persons"></label>
            <input class="field" id="event-persons" name="persons" type="number" inputmode="numeric" min="1" max="80" step="1" value="${escapeHtml(values.persons || 2)}" required>
          </div>
          <fieldset class="event-fieldset">
            <legend data-i18n="event.location"></legend>
            <label class="event-place">
              <input type="radio" name="locationType" value="salon" ${offsite ? "" : "checked"}>
              <span data-i18n="event.location.salon"></span>
            </label>
            <label class="event-place">
              <input type="radio" name="locationType" value="offsite" ${offsite ? "checked" : ""}>
              <span data-i18n="event.location.offsite"></span>
            </label>
          </fieldset>
          <div class="field-group" id="event-address-group" ${offsite ? "" : "hidden"}>
            <label for="event-address" data-i18n="event.address"></label>
            <input class="field" id="event-address" name="address" type="text" autocomplete="street-address" maxlength="200" value="${escapeHtml(values.address || "")}">
          </div>
          <div class="field-group">
            <label for="event-notes" data-i18n="event.notes"></label>
            <textarea class="field" id="event-notes" name="notes" rows="4" maxlength="800" data-i18n-placeholder="event.notes.placeholder">${escapeHtml(values.notes || "")}</textarea>
          </div>
          <button class="btn btn-primary event-submit" id="event-submit" type="submit" data-i18n="event.submit"></button>
        </form>
      </article>
    </section>
  `;
}

function paintForm(root, salon, error = "", values = {}) {
  root.innerHTML = salon ? formMarkup(salon, error, values) : missingMarkup();
  bindI18n(root);
  if (salon) bindForm(root, salon);
}

function syncAddress(root) {
  const offsite = root.querySelector('input[name="locationType"]:checked')?.value === "offsite";
  const group = root.querySelector("#event-address-group");
  const input = root.querySelector("#event-address");
  if (group) group.hidden = !offsite;
  if (input) {
    input.required = offsite;
    input.setAttribute("aria-required", offsite ? "true" : "false");
  }
}

function bindForm(root, salon) {
  const form = root.querySelector("#event-form");
  form?.querySelectorAll('input[name="locationType"]').forEach((input) => {
    input.addEventListener("change", () => syncAddress(root));
  });
  syncAddress(root);

  const dateInput = root.querySelector("#event-date");
  const timeInput = root.querySelector("#event-time");
  const syncMinTime = () => {
    if (!timeInput) return;
    timeInput.min = dateInput?.value === colomboTodayKey() ? colomboClock() : "";
  };
  dateInput?.addEventListener("change", syncMinTime);
  syncMinTime();

  form?.addEventListener("submit", (event) => submitEvent(event, root, salon));
}

function normalizeDate(value) {
  const match = String(value || "").trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : String(value || "").trim();
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  const clock = text.match(/^(\d{1,2}:\d{2})/);
  return colombo.formatWallClock(clock ? clock[1] : text);
}

function readForm(form) {
  const data = new FormData(form);
  return {
    eventType: String(data.get("eventType") || ""),
    date: normalizeDate(data.get("date")),
    startTime: normalizeTime(data.get("startTime")),
    durationMin: Number(data.get("durationMin") || 0),
    persons: Number(data.get("persons") || 0),
    locationType: String(data.get("locationType") || "salon"),
    address: String(data.get("address") || "").trim(),
    notes: String(data.get("notes") || "").trim(),
  };
}

function localValidate(values) {
  if (!EVENT_TYPES.some((item) => item.id === values.eventType)) return "errors.code.event-type-required";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !values.startTime) return "errors.code.invalid-date";
  if (!values.durationMin || values.durationMin < 30) return "errors.code.duration-required";
  if (!values.persons || values.persons < 1) return "errors.code.persons-required";
  if (values.locationType === "offsite" && values.address.length < 4) return "errors.code.address-required";
  return "";
}

function lockSubmit(root) {
  const form = root.querySelector("#event-form");
  const submit = root.querySelector("#event-submit");
  form?.setAttribute("aria-busy", "true");
  if (!submit) return;
  submit.disabled = true;
  submit.setAttribute("aria-busy", "true");
  submit.textContent = i18n.t("event.submitting");
}

function unlockSubmit(root) {
  submitting = false;
  const form = root.querySelector("#event-form");
  const submit = root.querySelector("#event-submit");
  form?.removeAttribute("aria-busy");
  if (!submit) return;
  submit.disabled = false;
  submit.removeAttribute("aria-busy");
  submit.textContent = i18n.t("event.submit");
}

function showCalmError(root, salon, message, values) {
  const banner = root.querySelector("#event-error");
  if (!banner) {
    submitting = false;
    paintForm(root, salon, message, values);
    return;
  }
  banner.hidden = !message;
  banner.textContent = message;
  unlockSubmit(root);
  banner.focus();
}

async function submitEvent(event, root, salon) {
  event.preventDefault();
  if (submitting) return;
  submitting = true;
  lockSubmit(root);

  const values = readForm(event.currentTarget);
  const invalid = localValidate(values);
  if (invalid) {
    showCalmError(root, salon, i18n.t(invalid), values);
    return;
  }

  try {
    await appointments.requestEvent({
      salonId: salon.id,
      eventType: values.eventType,
      date: values.date,
      startTime: colombo.formatWallClock(values.startTime),
      durationMin: values.durationMin,
      persons: values.persons,
      locationType: values.locationType,
      address: values.address,
      notes: values.notes,
      zone: colombo.zone,
      requestedAt: colombo.nowIso(),
    });
    router.navigate("/bookings", { replace: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      submitting = false;
      router.navigate("/account");
      return;
    }
    showCalmError(root, salon, calmError(error), values);
  }
}

export async function mountEventRequest(root) {
  const gen = ++eventGen;
  submitting = false;
  const salonId = router.params.id;
  try {
    const feed = await salons.salonFeed(salonId);
    if (gen !== eventGen) return;
    paintForm(root, feed.salon);
  } catch (error) {
    if (gen !== eventGen) return;
    if (error instanceof ApiError && error.status === 404) {
      paintForm(root, null);
      return;
    }
    root.innerHTML = formMarkup({ id: salonId, name: "" }, calmError(error));
    bindI18n(root);
  }
}
