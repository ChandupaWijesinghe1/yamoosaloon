import { bindI18n } from "./i18n-bind.js";

const BANNER_ID = "offline-banner";

export function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function syncOfflineBanner() {
  const banner = document.getElementById(BANNER_ID);
  if (!banner) return;
  const offline = isOffline();
  banner.hidden = !offline;
  document.body.classList.toggle("is-offline", offline);
  if (offline) bindI18n(banner);
}

export function bindOfflineBanner() {
  syncOfflineBanner();
  window.addEventListener("online", syncOfflineBanner);
  window.addEventListener("offline", syncOfflineBanner);
}

export function registerShellWorker() {
  if (!("serviceWorker" in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
