import { i18n, LOCALES } from "../scripts/i18n.js";
import { bindI18n } from "../scripts/i18n-bind.js";
import { ApiError } from "../scripts/api.js";
import { auth } from "../scripts/auth.js";
import { gate } from "../scripts/gate.js";
import { router } from "../scripts/router.js";
import { storage } from "../scripts/storage.js";
import { account } from "../scripts/account.js";

let listGen = 0;
const screen = {
  profile: null,
  nameDraft: "",
  phoneDraft: "",
  phoneOtp: "",
  phonePending: false,
  emailDraft: "",
  emailOtp: "",
  emailPending: false,
  supportCategory: "account",
  supportSubject: "",
  supportMessage: "",
  flashKey: "",
  flashText: "",
  flashError: false,
  busy: "",
  deleteStep: 0,
  deletePhrase: "",
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
  if (typeof error === "string") return i18n.t(error);
  return i18n.t(account.errorKey(error));
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^(?:94|0)?7\d{8}$/.test(digits);
}

function isOtp(value) {
  return /^\d{6}$/.test(String(value || "").trim());
}

function greetingName() {
  return screen.profile?.fullName || auth.getSession()?.name || auth.getSession()?.email || "";
}

function resetDrafts(profile) {
  screen.profile = profile;
  screen.nameDraft = profile?.fullName || "";
  screen.phoneDraft = profile?.phone || "";
  screen.emailDraft = profile?.email || "";
  screen.phoneOtp = "";
  screen.emailOtp = "";
  screen.phonePending = false;
  screen.emailPending = false;
}

function loginMarkup() {
  return `
    <section class="page">
      <form class="card form-stack" id="sign-in-form" novalidate>
        <h1 class="i18n-text" data-i18n="account.title"></h1>
        <p class="lede i18n-text" data-i18n="account.lede"></p>
        <p class="banner banner-error i18n-text" id="sign-in-error" hidden data-i18n="account.error"></p>
        <div class="field-group">
          <label class="i18n-text" for="email" data-i18n="account.email"></label>
          <input class="field" id="email" name="email" type="email" autocomplete="username" required>
        </div>
        <div class="field-group">
          <label class="i18n-text" for="password" data-i18n="account.password"></label>
          <input class="field" id="password" name="password" type="password" autocomplete="current-password" minlength="8" required>
        </div>
        <button class="btn btn-primary" type="submit" data-i18n="auth.login"></button>
      </form>
    </section>
  `;
}

function skeletonMarkup() {
  return `
    <section class="page account-screen" aria-busy="true">
      <header class="account-head">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </header>
      <article class="card skeleton-card" aria-hidden="true"></article>
      <article class="card skeleton-card" aria-hidden="true"></article>
    </section>
  `;
}

function flashMarkup() {
  if (screen.flashKey) {
    return `<p class="banner ${screen.flashError ? "banner-error" : "banner-success"}" role="alert" data-i18n="${escapeHtml(screen.flashKey)}"></p>`;
  }
  if (screen.flashText) {
    return `<p class="banner ${screen.flashError ? "banner-error" : "banner-success"}" role="alert">${escapeHtml(screen.flashText)}</p>`;
  }
  return "";
}

function languageButtons() {
  return LOCALES.map(
    (locale) => `
      <button
        class="account-lang"
        type="button"
        role="radio"
        data-account-locale="${locale}"
        aria-checked="${i18n.locale === locale ? "true" : "false"}"
        data-i18n="lang.${locale}"
      ></button>
    `,
  ).join("");
}

function otpBlock({ id, pending, code, sendKey, codeKey, verifyKey, sendBusy, verifyBusy }) {
  return `
    <div class="account-actions">
      <button class="btn btn-ghost" type="button" data-otp-send="${id}" ${sendBusy || verifyBusy ? "disabled" : ""} data-i18n="${sendKey}"></button>
    </div>
    ${
      pending
        ? `
      <div class="account-otp">
        <div class="field-group">
          <label for="account-${id}-otp" data-i18n="${codeKey}"></label>
          <input class="field" id="account-${id}-otp" name="${id}Otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" value="${escapeHtml(code)}">
        </div>
        <p class="account-hint" data-i18n="account.otp.hint"></p>
        <button class="btn btn-primary" type="button" data-otp-verify="${id}" ${verifyBusy ? "disabled" : ""} data-i18n="${verifyKey}"></button>
      </div>
    `
        : ""
    }
  `;
}

function deleteDialog() {
  if (!screen.deleteStep) return "";
  const step = screen.deleteStep;
  return `
    <div id="account-delete-sheet" class="account-sheet" role="dialog" aria-modal="true" aria-labelledby="account-delete-title">
      <form class="account-sheet-panel" id="account-delete-form">
        <h2 id="account-delete-title" data-i18n="${step === 1 ? "account.delete.step1.title" : "account.delete.step2.title"}"></h2>
        <p class="lede" data-i18n="${step === 1 ? "account.delete.step1.body" : "account.delete.step2.body"}"></p>
        ${
          step === 2
            ? `
          <div class="field-group">
            <label for="account-delete-phrase" data-i18n="account.delete.phrase"></label>
            <input class="field" id="account-delete-phrase" name="confirmPhrase" autocomplete="off" value="${escapeHtml(screen.deletePhrase)}">
          </div>
        `
            : ""
        }
        ${screen.flashText && screen.flashError && step === 2 ? `<p class="banner banner-error" role="alert">${escapeHtml(screen.flashText)}</p>` : ""}
        <div class="account-actions">
          <button class="btn btn-ghost" type="button" data-delete-cancel ${screen.busy === "delete" ? "disabled" : ""} data-i18n="account.delete.cancel"></button>
          ${
            step === 1
              ? `<button class="btn btn-danger" type="button" data-delete-next data-i18n="account.delete.continue"></button>`
              : `<button class="btn btn-danger" type="submit" ${screen.busy === "delete" ? "disabled" : ""} data-i18n="account.delete.confirm"></button>`
          }
        </div>
      </form>
    </div>
  `;
}

function settingsMarkup() {
  const name = greetingName();
  const busy = screen.busy;
  return `
    <section class="page account-screen">
      <header class="account-head">
        <h1 data-i18n="account.settings"></h1>
        <p class="lede" data-i18n="account.greeting" data-i18n-vars='${varsAttr({ name })}'></p>
      </header>
      ${flashMarkup()}

      <article class="card account-card form-stack">
        <h2 data-i18n="account.profile"></h2>
        <p class="lede" data-i18n="account.profile.lede"></p>
        <form id="account-name-form" class="form-stack" novalidate>
          <div class="field-group">
            <label for="account-name" data-i18n="account.name"></label>
            <input class="field" id="account-name" name="fullName" type="text" autocomplete="name" maxlength="80" value="${escapeHtml(screen.nameDraft)}" required>
          </div>
          <button class="btn btn-primary" type="submit" ${busy === "name" ? "disabled" : ""} data-i18n="account.name.save"></button>
        </form>
      </article>

      <article class="card account-card form-stack">
        <h2 data-i18n="account.phone"></h2>
        <p class="lede" data-i18n="account.phone.lede"></p>
        <form id="account-phone-form" class="form-stack" novalidate>
          <div class="field-group">
            <label for="account-phone" data-i18n="account.phone"></label>
            <input class="field" id="account-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" value="${escapeHtml(screen.phoneDraft)}" required>
          </div>
          ${otpBlock({
            id: "phone",
            pending: screen.phonePending,
            code: screen.phoneOtp,
            sendKey: "account.phone.send",
            codeKey: "account.phone.code",
            verifyKey: "account.phone.verify",
            sendBusy: busy === "phone-send",
            verifyBusy: busy === "phone-verify",
          })}
        </form>
      </article>

      <article class="card account-card form-stack">
        <h2 data-i18n="account.email"></h2>
        <p class="lede" data-i18n="account.email.lede"></p>
        <form id="account-email-form" class="form-stack" novalidate>
          <div class="field-group">
            <label for="account-email" data-i18n="account.email"></label>
            <input class="field" id="account-email" name="email" type="email" autocomplete="email" value="${escapeHtml(screen.emailDraft)}" required>
          </div>
          ${otpBlock({
            id: "email",
            pending: screen.emailPending,
            code: screen.emailOtp,
            sendKey: "account.email.send",
            codeKey: "account.email.code",
            verifyKey: "account.email.verify",
            sendBusy: busy === "email-send",
            verifyBusy: busy === "email-verify",
          })}
        </form>
      </article>

      <article class="card account-card form-stack">
        <h2 data-i18n="account.language"></h2>
        <p class="lede" data-i18n="account.language.lede"></p>
        <div class="account-langs" role="radiogroup" data-i18n-aria="account.language">
          ${languageButtons()}
        </div>
      </article>

      <article class="card account-card form-stack">
        <h2 data-i18n="account.support"></h2>
        <p class="lede" data-i18n="account.support.lede"></p>
        <form id="account-support-form" class="form-stack" novalidate>
          <div class="field-group">
            <label for="account-support-category" data-i18n="account.support.category"></label>
            <select class="field" id="account-support-category" name="category">
              <option value="account" ${screen.supportCategory === "account" ? "selected" : ""} data-i18n="account.support.category.account"></option>
              <option value="booking" ${screen.supportCategory === "booking" ? "selected" : ""} data-i18n="account.support.category.booking"></option>
              <option value="billing" ${screen.supportCategory === "billing" ? "selected" : ""} data-i18n="account.support.category.billing"></option>
              <option value="other" ${screen.supportCategory === "other" ? "selected" : ""} data-i18n="account.support.category.other"></option>
            </select>
          </div>
          <div class="field-group">
            <label for="account-support-subject" data-i18n="account.support.subject"></label>
            <input class="field" id="account-support-subject" name="subject" maxlength="120" value="${escapeHtml(screen.supportSubject)}" required>
          </div>
          <div class="field-group">
            <label for="account-support-message" data-i18n="account.support.message"></label>
            <textarea class="field" id="account-support-message" name="message" maxlength="2000" required>${escapeHtml(screen.supportMessage)}</textarea>
          </div>
          <button class="btn btn-primary" type="submit" ${busy === "support" ? "disabled" : ""} data-i18n="account.support.submit"></button>
        </form>
      </article>

      <article class="card account-card account-danger form-stack">
        <h2 data-i18n="account.delete"></h2>
        <p class="lede" data-i18n="account.delete.lede"></p>
        <div class="account-actions">
          <button class="btn btn-danger" type="button" data-delete-open data-i18n="account.delete.open"></button>
          <button class="btn btn-ghost" type="button" data-action="sign-out" data-i18n="account.logout"></button>
        </div>
      </article>
      ${deleteDialog()}
    </section>
  `;
}

function readDrafts(root) {
  screen.nameDraft = root.querySelector("#account-name")?.value ?? screen.nameDraft;
  screen.phoneDraft = root.querySelector("#account-phone")?.value ?? screen.phoneDraft;
  screen.phoneOtp = root.querySelector("#account-phone-otp")?.value ?? screen.phoneOtp;
  screen.emailDraft = root.querySelector("#account-email")?.value ?? screen.emailDraft;
  screen.emailOtp = root.querySelector("#account-email-otp")?.value ?? screen.emailOtp;
  screen.supportCategory = root.querySelector("#account-support-category")?.value ?? screen.supportCategory;
  screen.supportSubject = root.querySelector("#account-support-subject")?.value ?? screen.supportSubject;
  screen.supportMessage = root.querySelector("#account-support-message")?.value ?? screen.supportMessage;
  screen.deletePhrase = root.querySelector("#account-delete-phrase")?.value ?? screen.deletePhrase;
}

function paint(root) {
  root.innerHTML = settingsMarkup();
  bindI18n(root);
  bindSettings(root);
}

function setFlash(root, { key = "", text = "", error = false } = {}) {
  screen.flashKey = key;
  screen.flashText = text;
  screen.flashError = error;
  paint(root);
}

function fail(root, error) {
  screen.busy = "";
  setFlash(root, { text: calmError(error), error: true });
}

async function run(root, busy, work) {
  if (screen.busy) return false;
  readDrafts(root);
  screen.busy = busy;
  screen.flashKey = "";
  screen.flashText = "";
  screen.flashError = false;
  paint(root);
  try {
    await work();
    screen.busy = "";
    paint(root);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      router.navigate("/account", { replace: true });
      return false;
    }
    fail(root, error);
    return false;
  }
}

function bindLogin(root) {
  const form = root.querySelector("#sign-in-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const errorNode = root.querySelector("#sign-in-error");
    try {
      await auth.signIn({
        email: data.get("email"),
        password: data.get("password"),
      });
      gate.returnTo = "/account";
      await gate.refresh();
      router.navigate(gate.isBlocking() ? "/agree" : "/account", { replace: true });
    } catch {
      if (errorNode) errorNode.hidden = false;
    }
  });
}

function bindSettings(root) {
  root.querySelector("#account-name-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveName(root);
  });
  root.querySelector("#account-phone-form")?.addEventListener("submit", (event) => event.preventDefault());
  root.querySelector("#account-email-form")?.addEventListener("submit", (event) => event.preventDefault());
  root.querySelector("#account-support-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    sendSupport(root);
  });
  root.querySelector("[data-otp-send='phone']")?.addEventListener("click", () => sendOtp(root, "phone"));
  root.querySelector("[data-otp-verify='phone']")?.addEventListener("click", () => verifyOtp(root, "phone"));
  root.querySelector("[data-otp-send='email']")?.addEventListener("click", () => sendOtp(root, "email"));
  root.querySelector("[data-otp-verify='email']")?.addEventListener("click", () => verifyOtp(root, "email"));
  root.querySelectorAll("[data-account-locale]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.getAttribute("data-account-locale");
      if (next && next !== i18n.locale) i18n.setLocale(next);
      syncAccountChrome(root);
    });
  });
  root.querySelector("[data-delete-open]")?.addEventListener("click", () => {
    readDrafts(root);
    screen.deleteStep = 1;
    screen.deletePhrase = "";
    screen.flashKey = "";
    screen.flashText = "";
    screen.flashError = false;
    paint(root);
    root.querySelector("[data-delete-next]")?.focus();
  });
  root.querySelector("[data-delete-cancel]")?.addEventListener("click", () => {
    screen.deleteStep = 0;
    screen.deletePhrase = "";
    paint(root);
  });
  root.querySelector("[data-delete-next]")?.addEventListener("click", () => {
    screen.deleteStep = 2;
    paint(root);
    root.querySelector("#account-delete-phrase")?.focus();
  });
  root.querySelector("#account-delete-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    confirmDelete(root);
  });
}

async function saveName(root) {
  readDrafts(root);
  const fullName = screen.nameDraft.trim();
  if (fullName.length < 2) {
    setFlash(root, { key: "account.name.invalid", error: true });
    return;
  }
  await run(root, "name", async () => {
    const profile = await account.updateName(fullName);
    resetDrafts(profile);
    screen.flashKey = "account.name.saved";
    screen.flashError = false;
  });
}

async function sendOtp(root, kind) {
  readDrafts(root);
  if (kind === "phone") {
    if (!isPhone(screen.phoneDraft)) {
      setFlash(root, { key: "account.phone.invalid", error: true });
      return;
    }
    const sent = await run(root, "phone-send", async () => {
      await account.requestPhoneOtp(screen.phoneDraft);
      screen.phonePending = true;
      screen.phoneOtp = "";
      screen.flashKey = "account.phone.sent";
      screen.flashError = false;
    });
    if (sent) root.querySelector("#account-phone-otp")?.focus();
    return;
  }
  if (!isEmail(screen.emailDraft)) {
    setFlash(root, { key: "account.email.invalid", error: true });
    return;
  }
  const sent = await run(root, "email-send", async () => {
    await account.requestEmailOtp(screen.emailDraft);
    screen.emailPending = true;
    screen.emailOtp = "";
    screen.flashKey = "account.email.sent";
    screen.flashError = false;
  });
  if (sent) root.querySelector("#account-email-otp")?.focus();
}

async function verifyOtp(root, kind) {
  readDrafts(root);
  const code = kind === "phone" ? screen.phoneOtp.trim() : screen.emailOtp.trim();
  if (!isOtp(code)) {
    setFlash(root, { key: "account.otp.invalid", error: true });
    return;
  }
  if (kind === "phone") {
    await run(root, "phone-verify", async () => {
      const profile = await account.verifyPhone({ phone: screen.phoneDraft, code });
      resetDrafts(profile);
      screen.flashKey = "account.phone.saved";
      screen.flashError = false;
    });
    return;
  }
  await run(root, "email-verify", async () => {
    const profile = await account.verifyEmail({ email: screen.emailDraft, code });
    resetDrafts(profile);
    screen.flashKey = "account.email.saved";
    screen.flashError = false;
  });
}

async function sendSupport(root) {
  readDrafts(root);
  const subject = screen.supportSubject.trim();
  const message = screen.supportMessage.trim();
  if (subject.length < 3 || message.length < 10) {
    setFlash(root, { key: "account.support.invalid", error: true });
    return;
  }
  await run(root, "support", async () => {
    await account.submitSupport({
      subject,
      message,
      category: screen.supportCategory,
      locale: i18n.locale,
    });
    screen.supportSubject = "";
    screen.supportMessage = "";
    screen.flashKey = "account.support.sent";
    screen.flashError = false;
  });
}

async function confirmDelete(root) {
  readDrafts(root);
  if (screen.deletePhrase.trim().toUpperCase() !== "DELETE") {
    screen.flashKey = "";
    screen.flashText = i18n.t("account.delete.error");
    screen.flashError = true;
    paint(root);
    root.querySelector("#account-delete-phrase")?.focus();
    return;
  }
  if (screen.busy) return;
  screen.busy = "delete";
  paint(root);
  try {
    await account.deleteAccount({ confirmPhrase: "DELETE" });
  } catch (error) {
    screen.busy = "";
    screen.deleteStep = 2;
    setFlash(root, { text: calmError(error), error: true });
    return;
  }
  storage.clearSessionData();
  auth.signOut();
  gate.reset();
  document.body.classList.remove("gate-locked");
  router.navigate("/account", { replace: true });
}

export function syncAccountChrome(root = document) {
  root.querySelectorAll("[data-account-locale]").forEach((button) => {
    button.setAttribute("aria-checked", button.getAttribute("data-account-locale") === i18n.locale ? "true" : "false");
  });
}

export function renderAccount() {
  return auth.isAuthenticated() ? skeletonMarkup() : loginMarkup();
}

export async function mountAccount(root) {
  const gen = ++listGen;
  if (!auth.isAuthenticated()) {
    bindLogin(root);
    return;
  }
  screen.busy = "";
  screen.deleteStep = 0;
  screen.flashKey = "";
  screen.flashText = "";
  screen.flashError = false;
  try {
    const profile = await account.getProfile();
    if (gen !== listGen) return;
    resetDrafts(profile);
    paint(root);
  } catch (error) {
    if (gen !== listGen) return;
    if (error instanceof ApiError && error.status === 401) {
      root.innerHTML = loginMarkup();
      bindI18n(root);
      bindLogin(root);
      return;
    }
    root.innerHTML = `
      <section class="page account-screen">
        <article class="card form-stack">
          <h1 data-i18n="account.settings"></h1>
          <p class="banner banner-error" role="alert">${escapeHtml(calmError(error))}</p>
        </article>
      </section>
    `;
    bindI18n(root);
  }
}
