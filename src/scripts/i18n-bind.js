import { i18n } from "./i18n.js";

function readVars(element) {
  const raw = element.getAttribute("data-i18n-vars");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function applyText(element, key) {
  element.textContent = i18n.t(key, readVars(element));
}

export function bindI18n(root = document) {
  const scope = root instanceof Element || root === document ? root : document;

  scope.querySelectorAll("[data-i18n]").forEach((element) => {
    applyText(element, element.getAttribute("data-i18n"));
  });

  scope.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    element.setAttribute("aria-label", i18n.t(element.getAttribute("data-i18n-aria"), readVars(element)));
  });

  scope.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.setAttribute("title", i18n.t(element.getAttribute("data-i18n-title"), readVars(element)));
  });

  scope.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute(
      "placeholder",
      i18n.t(element.getAttribute("data-i18n-placeholder"), readVars(element)),
    );
  });

  scope.querySelectorAll("[data-i18n-attr]").forEach((element) => {
    const spec = element.getAttribute("data-i18n-attr") || "";
    const [attr, keyFromSpec] = spec.split(":").map((part) => part.trim());
    const key = keyFromSpec || element.getAttribute("data-i18n-attr-key");
    if (!attr || !key) return;
    element.setAttribute(attr, i18n.t(key, readVars(element)));
  });

  return scope;
}

export function setI18nVars(element, vars) {
  element.setAttribute("data-i18n-vars", JSON.stringify(vars));
  const key =
    element.getAttribute("data-i18n") ||
    element.getAttribute("data-i18n-aria") ||
    element.getAttribute("data-i18n-placeholder");
  if (key && element.hasAttribute("data-i18n")) {
    applyText(element, key);
  } else if (element.hasAttribute("data-i18n-aria")) {
    element.setAttribute("aria-label", i18n.t(element.getAttribute("data-i18n-aria"), vars));
  }
}
