import { api, ApiError, colombo } from "./api.js";

function originPath(pathname, query) {
  const url = new URL(pathname, window.location.origin);
  if (query && typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  return url.href;
}

function asList(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function asStaff(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || raw.staffId || raw.slug || index);
  if (!id) return null;
  return {
    id,
    name: String(raw.name || raw.displayName || raw.title || "Specialist"),
    title: String(raw.title || raw.role || raw.jobTitle || ""),
    photo: String(raw.photo || raw.image || raw.avatar || raw.cover || ""),
    any: raw.any === true || id === "any" || raw.kind === "any",
  };
}

function asSlot(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const start = colombo.formatWallClock(raw) || raw;
    return {
      id: raw,
      start,
      startsAt: /T/.test(raw) ? colombo.parse(raw) || raw : null,
      confirmation: "auto",
      available: true,
    };
  }
  if (typeof raw !== "object") return null;
  const startsAt = raw.startsAt || raw.startAt || raw.startTime || raw.datetime || raw.timeIso || null;
  const start = colombo.formatWallClock(raw.start || raw.time || raw.clock || startsAt) || "";
  const available = raw.available !== false && raw.taken !== true && raw.booked !== true;
  const confirmation = /manual/.test(String(raw.confirmation || raw.bookingMode || raw.approval || "")) ? "manual" : "auto";
  return {
    id: String(raw.id || startsAt || start),
    start,
    startsAt: startsAt ? colombo.parse(startsAt) || String(startsAt) : null,
    confirmation,
    available,
  };
}

function bookingErrorKey(error) {
  if (!(error instanceof ApiError)) return "errors.unknown";
  const code = String(error.code || "");
  if (code === "slot-taken" || code === "slot_taken" || code === "taken") return "errors.code.slot-taken";
  if (code === "terms-required" || code === "terms_required") return "errors.code.terms-required";
  if (code === "event-type-required") return "errors.code.event-type-required";
  if (code === "address-required") return "errors.code.address-required";
  if (code === "persons-required") return "errors.code.persons-required";
  if (code === "duration-required") return "errors.code.duration-required";
  if (code === "cannot-cancel") return "errors.code.cannot-cancel";
  if (code === "no-proposal") return "errors.code.no-proposal";
  if (code === "rating-required") return "errors.code.rating-required";
  if (code === "already-reviewed") return "errors.code.already-reviewed";
  if (code === "not-completed") return "errors.code.not-completed";
  if (error.key && error.key.startsWith("errors.code.")) return error.key;
  if (error.status === 409) return "errors.code.slot-taken";
  if (error.status === 422) return "errors.http.422";
  return error.key || "errors.unknown";
}

export const appointments = {
  asStaff,
  asSlot,
  asAppointment,
  errorKey: bookingErrorKey,

  async availability({ salonId, staffId, date, durationMin, force = true } = {}) {
    const payload = await api.get(
      originPath("/appointments/availability", {
        salonId,
        staffId,
        date,
        durationMin,
      }),
      { force },
    );
    const staff = asList(payload, ["staff", "specialists", "stylists", "team"]).map(asStaff).filter(Boolean);
    const slots = asList(payload, ["slots", "times", "availability", "windows"]).map(asSlot).filter(Boolean);
    const confirmation = /manual/.test(String(payload?.confirmation || payload?.bookingMode || "")) ? "manual" : "auto";
    return {
      date: String(payload?.date || date || ""),
      zone: String(payload?.zone || colombo.zone),
      closed: payload?.closed === true,
      confirmation,
      staff,
      slots,
    };
  },

  async book(body) {
    return api.post(originPath("/appointments/book"), body, { force: true });
  },

  async requestEvent(body) {
    return api.post(originPath("/appointments/event-request"), body, { force: true });
  },

  async list({ force = true } = {}) {
    const paths = ["/appointments/mine", "/appointments"];
    let lastError = null;
    for (const path of paths) {
      try {
        const payload = await api.get(originPath(path), { force });
        return asList(payload, ["items", "appointments", "requests", "data"]).map(asAppointment).filter(Boolean);
      } catch (error) {
        lastError = error;
        if (error instanceof ApiError && error.status && error.status !== 404) break;
      }
    }
    throw lastError instanceof ApiError ? lastError : new ApiError("errors.unknown");
  },

  async cancel(id, body = {}) {
    const appointmentId = String(id || "");
    const payload = { ...body, cancelledAt: colombo.nowIso() };
    const paths = [
      `/appointments/cancel/${encodeURIComponent(appointmentId)}`,
      `/appointments/${encodeURIComponent(appointmentId)}/cancel`,
    ];
    let lastError = null;
    for (const path of paths) {
      try {
        return await api.put(originPath(path), payload, { force: true });
      } catch (error) {
        lastError = error;
        if (error instanceof ApiError && error.status && error.status !== 404) break;
      }
    }
    throw lastError instanceof ApiError ? lastError : new ApiError("errors.unknown");
  },

  async acceptProposal(id) {
    return api.put(originPath(`/appointments/${encodeURIComponent(id)}/proposal/accept`), { acceptedAt: colombo.nowIso() }, { force: true });
  },

  async declineProposal(id) {
    return api.put(originPath(`/appointments/${encodeURIComponent(id)}/proposal/decline`), { declinedAt: colombo.nowIso() }, { force: true });
  },

  async review({ salonId, serviceId, appointmentId, rating, body } = {}) {
    const payload = {
      appointmentId,
      salonId,
      serviceId,
      rating: Number(rating) || 0,
      body: String(body || ""),
      reviewedAt: colombo.nowIso(),
    };
    if (payload.rating < 1 || payload.rating > 5) {
      throw new ApiError("errors.code.rating-required", { status: 422, code: "rating-required" });
    }
    const salonPath = originPath(`/reviews/salon/${encodeURIComponent(salonId || "")}`);
    const salonReview = await api.put(salonPath, payload, { force: true });
    if (serviceId) {
      try {
        await api.put(originPath(`/reviews/service/${encodeURIComponent(serviceId)}`), payload, { force: true });
      } catch (error) {
        if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 405)) throw error;
      }
    }
    return salonReview;
  },
};

function asProposal(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    const startsAt = colombo.parse(raw) || raw;
    return { startsAt, note: "", staffName: "" };
  }
  if (typeof raw !== "object") return null;
  const startsAt = raw.startsAt || raw.startAt || raw.datetime || raw.proposedStartsAt || null;
  if (!startsAt) return null;
  return {
    startsAt: colombo.parse(startsAt) || String(startsAt),
    note: String(raw.note || raw.message || raw.reason || ""),
    staffName: String(raw.staffName || raw.staff || ""),
  };
}

function normalizeStatus(raw, proposal) {
  const status = String(raw?.status || raw?.state || "").toLowerCase().replace(/_/g, "-");
  if (proposal) return "proposed";
  if (/propos|reschedule/.test(status)) return "proposed";
  if (status === "pending" || status === "awaiting" || status === "awaiting-approval") return "pending";
  if (status === "confirmed" || status === "booked") return "confirmed";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "completed" || status === "done" || status === "fulfilled") return "completed";
  if (status === "declined" || status === "rejected") return "declined";
  return status || "pending";
}

function asAppointment(raw) {
  if (!raw || typeof raw !== "object") return null;
  const startsAt = raw.startsAt || raw.startAt || raw.datetime || null;
  const proposal = asProposal(raw.proposal || raw.reschedule || raw.proposedSlot || raw.proposedStartsAt);
  const services = asList(raw, ["services", "items"]);
  return {
    id: String(raw.id || raw.requestId || ""),
    kind: raw.kind === "event" || raw.eventType ? "event" : "booking",
    salonId: String(raw.salonId || raw.salon || ""),
    salonName: String(raw.salonName || raw.salon?.name || ""),
    eventType: String(raw.eventType || raw.type || ""),
    staffId: String(raw.staffId || raw.staff?.id || ""),
    staffName: String(raw.staffName || raw.staff?.name || ""),
    startsAt: startsAt ? colombo.parse(startsAt) || String(startsAt) : null,
    durationMin: Number(raw.durationMin || raw.duration || 0) || null,
    persons: Number(raw.persons || raw.guests || 0) || null,
    locationType: /offsite|away/.test(String(raw.locationType || "")) ? "offsite" : "salon",
    address: String(raw.address || ""),
    notes: String(raw.notes || ""),
    status: normalizeStatus(raw, proposal),
    confirmation: /manual/.test(String(raw.confirmation || "")) ? "manual" : "auto",
    services,
    serviceId: String(raw.serviceId || services[0]?.id || services[0]?.serviceId || ""),
    proposal,
    reviewed: raw.reviewed === true || raw.hasReview === true,
    cancelledAt: raw.cancelledAt || raw.canceledAt || null,
    zone: String(raw.zone || colombo.zone),
    createdAt: raw.createdAt || raw.requestedAt || null,
  };
}
