import { api, ApiError, colombo } from "./api.js";
import { storage } from "./storage.js";
import { auth } from "./auth.js";

const GATE_PATH = "/auth/gate";
const listeners = new Set();

const KIND_ALIASES = {
  community: ["community", "community_rules", "community-rules", "communityRules", "rules"],
  privacy: ["privacy", "privacy_policy", "privacy-policy", "privacyPolicy", "policy"],
};

function gateUrl() {
  return new URL(GATE_PATH, window.location.origin).href;
}

function kindFrom(value, fallback = "other") {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  for (const [kind, aliases] of Object.entries(KIND_ALIASES)) {
    if (aliases.some((alias) => alias.toLowerCase() === raw || alias.toLowerCase() === String(value || ""))) {
      return kind;
    }
  }
  if (raw.includes("community") || raw.includes("rule")) return "community";
  if (raw.includes("privacy") || raw.includes("policy")) return "privacy";
  return fallback;
}

function asAgreement(raw, fallbackKind) {
  if (raw == null || typeof raw === "boolean") return null;
  if (typeof raw === "string") {
    return {
      id: fallbackKind || raw,
      kind: kindFrom(fallbackKind || raw),
      title: null,
      version: raw,
      body: null,
      accepted: false,
    };
  }

  const kind = kindFrom(raw.kind || raw.type || raw.id || raw.slug || fallbackKind, fallbackKind || "other");
  const accepted = raw.accepted === true || raw.status === "accepted" || raw.complete === true;
  return {
    id: String(raw.id || raw.slug || kind),
    kind,
    title: raw.title || raw.name || null,
    version: String(raw.version || raw.versionId || raw.rev || "1"),
    body: raw.body || raw.content || raw.text || null,
    accepted,
  };
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function collectAgreements(payload) {
  if (!payload || typeof payload !== "object") return [];

  const fromList = []
    .concat(
      asList(payload.agreements),
      asList(payload.pending),
      asList(payload.pendingAgreements),
      asList(payload.required),
    )
    .map((item) => asAgreement(item))
    .filter(Boolean);

  const named = [
    asAgreement(payload.communityRules || payload.community, "community"),
    asAgreement(payload.privacyPolicy || payload.privacy, "privacy"),
  ].filter(Boolean);

  const merged = [...fromList, ...named];
  const seen = new Set();
  return merged.filter((item) => {
    const key = `${item.kind}:${item.version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isPendingPayload(payload, agreements) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.pending === true || payload.required === true || payload.status === "pending") return true;
  if (payload.pending === false || payload.accepted === true || payload.status === "ok" || payload.status === "accepted" || payload.complete === true) {
    return false;
  }
  return agreements.some((item) => item.accepted !== true);
}

function defaultAgreements(payload) {
  return [
    asAgreement({ id: "community", kind: "community", version: payload?.communityVersion || payload?.version || "2026.10" }, "community"),
    asAgreement({ id: "privacy", kind: "privacy", version: payload?.privacyVersion || payload?.version || "2026.10" }, "privacy"),
  ];
}

function normalize(payload) {
  let agreements = collectAgreements(payload);
  let pending = isPendingPayload(payload, agreements);
  if (pending && agreements.length === 0) agreements = defaultAgreements(payload);
  if (!pending) {
    agreements = agreements.map((item) => ({ ...item, accepted: true }));
  }
  return { pending, agreements, payload };
}

function persistClear(agreements) {
  const flags = { confirmed: true, confirmedAt: colombo.nowIso() };
  for (const item of agreements) {
    flags[`${item.kind}:${item.version}`] = true;
  }
  storage.setGates(flags);
}

function notify() {
  listeners.forEach((fn) => fn(gate.snapshot()));
}

export const gate = {
  status: "idle",
  agreements: [],
  error: null,
  returnTo: "/",

  snapshot() {
    return {
      status: this.status,
      agreements: this.agreements.map((item) => ({ ...item })),
      error: this.error,
      blocking: this.isBlocking(),
    };
  },

  isBlocking() {
    if (!auth.isAuthenticated()) return false;
    return this.status !== "clear";
  },

  reset() {
    this.status = "idle";
    this.agreements = [];
    this.error = null;
    notify();
  },

  async refresh() {
    if (!auth.isAuthenticated()) {
      this.reset();
      return this.snapshot();
    }

    this.status = "loading";
    this.error = null;
    notify();

    try {
      const payload = await api.get(gateUrl(), { force: true });
      if (!payload || typeof payload !== "object") {
        throw new ApiError("errors.unknown");
      }
      const next = normalize(payload);
      this.agreements = next.agreements;
      this.status = next.pending ? "pending" : "clear";
      if (!next.pending) persistClear(next.agreements);
    } catch (error) {
      this.status = "error";
      this.error = error instanceof ApiError ? error : new ApiError("errors.unknown");
    }

    notify();
    return this.snapshot();
  },

  async accept() {
    if (!auth.isAuthenticated()) {
      throw new ApiError("errors.http.401");
    }

    this.error = null;
    this.status = "loading";
    notify();

    try {
      await api.post(
        gateUrl(),
        {
          accepted: true,
          acceptedAt: colombo.nowIso(),
          agreements: this.agreements.map((item) => ({
            id: item.id,
            kind: item.kind,
            version: item.version,
            accepted: true,
          })),
        },
        { force: true },
      );

      await this.refresh();
      if (this.status !== "clear") {
        this.status = "error";
        this.error = new ApiError("errors.refused");
        notify();
        throw this.error;
      }
    } catch (error) {
      const wrapped = error instanceof ApiError ? error : new ApiError("errors.unknown");
      this.status = "error";
      this.error = wrapped;
      notify();
      throw wrapped;
    }

    return this.snapshot();
  },

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
