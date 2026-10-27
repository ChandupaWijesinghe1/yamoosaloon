import { storage } from "./storage.js";
import { colombo } from "./api.js";

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export const auth = {
  getSession() {
    return storage.getSession();
  },

  isAuthenticated() {
    return Boolean(this.getSession()?.email || storage.getAccessToken());
  },

  async signIn({ email, password, tokens } = {}) {
    const trimmed = String(email || "").trim().toLowerCase();
    if (!isEmail(trimmed) || String(password || "").length < 8) {
      const error = new Error("invalid-credentials");
      error.code = "invalid-credentials";
      throw error;
    }

    if (tokens?.accessToken) storage.setAccessToken(tokens.accessToken);
    if (tokens?.refreshToken) storage.setRefreshToken(tokens.refreshToken);

    const session = {
      email: trimmed,
      signedInAt: colombo.nowIso(),
    };

    storage.setSession(session);
    return session;
  },

  acceptTokens({ accessToken, refreshToken, persist = false } = {}) {
    if (accessToken) storage.setAccessToken(accessToken, { persist });
    if (refreshToken) storage.setRefreshToken(refreshToken, { persist });
  },

  signOut() {
    storage.clearAuth();
  },
};
