import { api, ApiError } from "./api.js";
import { auth } from "./auth.js";
import { storage } from "./storage.js";

function originPath(pathname) {
  return new URL(pathname, window.location.origin).href;
}

function asClient(raw) {
  const src = raw?.client || raw?.profile || raw?.user || raw;
  if (!src || typeof src !== "object") return null;
  const id = String(src.id || src.clientId || src.userId || "");
  const fullName = String(src.fullName || src.name || src.displayName || "").trim();
  const email = String(src.email || "").trim().toLowerCase();
  const phone = String(src.phone || src.mobile || src.phoneNumber || "").trim();
  if (!id && !fullName && !email && !phone) return null;
  return {
    id: id || "me",
    fullName,
    email,
    phone,
    locale: String(src.locale || ""),
    updatedAt: src.updatedAt || src.updated_at || null,
  };
}

function remember(client) {
  if (!client) return client;
  const session = auth.getSession() || {};
  storage.setSession({
    ...session,
    id: client.id || session.id,
    email: client.email || session.email,
    name: client.fullName || session.name,
  });
  return client;
}

export const account = {
  async getProfile() {
    const session = auth.getSession();
    const id = session?.id || "me";
    let payload;
    try {
      payload = await api.get(originPath(`/clients/${encodeURIComponent(id)}`), { force: true });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404 || id === "me") throw error;
      payload = await api.get(originPath("/clients/me"), { force: true });
    }
    const client = asClient(payload);
    if (!client) throw new ApiError("errors.unknown");
    return remember(client);
  },

  async updateName(fullName) {
    const payload = await api.put(
      originPath("/clients/update/name"),
      { fullName, name: fullName },
      { force: true },
    );
    return remember(asClient(payload));
  },

  async requestPhoneOtp(phone) {
    return api.post(originPath("/clients/me/phone/otp"), { phone }, { force: true });
  },

  async verifyPhone({ phone, code }) {
    const payload = await api.post(
      originPath("/clients/me/phone/verify"),
      { phone, code, otp: code },
      { force: true },
    );
    return remember(asClient(payload));
  },

  async requestEmailOtp(email) {
    return api.post(originPath("/clients/me/email/otp"), { email }, { force: true });
  },

  async verifyEmail({ email, code }) {
    const payload = await api.post(
      originPath("/clients/me/email/verify"),
      { email, code, otp: code },
      { force: true },
    );
    return remember(asClient(payload));
  },

  async submitSupport({ subject, message, category, locale }) {
    const payload = await api.post(
      originPath("/support/tickets"),
      { subject, message, category, locale },
      { force: true },
    );
    return payload?.ticket || payload;
  },

  async deleteAccount({ confirmPhrase } = {}) {
    return api.post(
      originPath("/account/deletion"),
      { confirm: true, confirmPhrase, permanent: true },
      { force: true },
    );
  },

  errorKey(error) {
    if (error instanceof ApiError && error.key) return error.key;
    return "errors.unknown";
  },
};
