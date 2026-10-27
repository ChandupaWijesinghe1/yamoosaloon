import express from "express";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || "0.0.0.0";
const PRODUCTION = process.env.NODE_ENV === "production";

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const BLOCKED = new Set([".env", ".git", "node_modules"]);
const SPA_ROUTES = new Set(["/", "/account", "/privacy", "/agree", "/explore", "/bookings", "/saved", "/notices"]);

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

function isBlocked(relativePath) {
  const parts = relativePath.split(path.sep);
  return parts.some((part) => BLOCKED.has(part) || part.startsWith(".env"));
}

function send(response, status, headers, body) {
  response.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  response.end(body);
}

async function sendFile(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const body = await readFile(filePath);
  const cache =
    ext === ".html" || ext === ".js" || ext === ".css" || ext === ".json"
      ? "no-cache"
      : "public, max-age=31536000, immutable";

  send(response, 200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": cache }, body);
}

function wantsHttpsRedirect(request) {
  if (!PRODUCTION) return false;
  const proto = String(request.headers["x-forwarded-proto"] || request.protocol || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return proto === "http";
}

const GATE_VERSIONS = {
  community: "2026.10",
  privacy: "2026.10",
};
const acceptedGates = new Map();

function gateToken(request) {
  const header = String(request.headers.authorization || "");
  const bearer = header.match(/^Bearer\s+(.+)$/i);
  return bearer ? bearer[1] : "local-session";
}

function pendingAgreements() {
  return [
    {
      id: "community",
      kind: "community",
      title: "Community rules",
      version: GATE_VERSIONS.community,
      body: "Be kind, honest, and fair. No scams, harassment, or fake listings. Yamoo is a calm marketplace for real honey.",
    },
    {
      id: "privacy",
      kind: "privacy",
      title: "Privacy policy",
      version: GATE_VERSIONS.privacy,
      body: "We keep sign-in on this device until a backend is connected. We do not run analytics or third-party trackers. This policy version is shown above.",
    },
  ];
}

function gateSnapshot(token) {
  const accepted = acceptedGates.get(token) || new Set();
  const pending = pendingAgreements().filter((item) => !accepted.has(`${item.id}:${item.version}`));
  if (pending.length === 0) {
    return { pending: false, status: "ok", agreements: pendingAgreements().map((item) => ({ ...item, accepted: true })) };
  }
  return { pending: true, status: "pending", agreements: pending.map((item) => ({ ...item, accepted: false })) };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

async function handleGate(request, response, url) {
  if (url.pathname !== "/auth/gate" && url.pathname !== "/api/auth/gate") return false;
  const token = gateToken(request);
  if (request.method === "GET" || request.method === "HEAD") {
    send(response, 200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, JSON.stringify(gateSnapshot(token)));
    return true;
  }
  if (request.method === "POST") {
    const body = await readJsonBody(request);
    const accepted = acceptedGates.get(token) || new Set();
    const items = Array.isArray(body?.agreements) ? body.agreements : [];
    for (const item of items) {
      if (item?.accepted && item.id && item.version) accepted.add(`${item.id}:${item.version}`);
    }
    const required = pendingAgreements();
    const complete = required.every((item) => accepted.has(`${item.id}:${item.version}`));
    if (!complete) {
      send(response, 422, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, JSON.stringify({ pending: true, status: "pending", code: "agreements-incomplete" }));
      return true;
    }
    acceptedGates.set(token, accepted);
    send(response, 200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, JSON.stringify(gateSnapshot(token)));
    return true;
  }
  send(response, 405, { Allow: "GET, HEAD, POST" }, "Method Not Allowed");
  return true;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const savedSalons = new Map();
const noticeStore = new Map();
const clientStore = new Map();
const contactChallenges = new Map();
const supportTickets = [];
const filedReports = [];
const bookedAppointments = [];
const eventRequests = [];
const filedReviews = [];
const MOCK_OTP = "123456";

function weekHours(open, close, closed = ["sunday"]) {
  const hours = {};
  for (const day of WEEKDAYS) {
    hours[day] = closed.includes(day) ? null : { open, close };
  }
  return hours;
}

function salonCatalog() {
  return [
    {
      id: "honeycomb-colombo",
      ownerId: "honeycomb-colombo",
      name: "Honeycomb Studio",
      rating: 4.8,
      reviewCount: 186,
      address: "42 Galle Road",
      city: "Colombo 03",
      location: "Colombo",
      cover: "/public/assets/salons/honeycomb-colombo.svg",
      tags: ["haircut", "skin-care"],
      featured: true,
      confirmation: "auto",
      distanceKm: 0.8,
      promo: "Honey glow facial this week",
      services: [
        { id: "cut", name: "Haircut", category: "hair-treatments", durationMin: 45, priceLkr: 3500, description: "Wash, shape, and a calm finish." },
        { id: "blow", name: "Blow dry", category: "hair-treatments", durationMin: 30, priceLkr: 2500, description: "Smooth set with honey serum." },
        { id: "color", name: "Honey gloss colour", category: "hair-treatments", durationMin: 90, priceLkr: 8500, description: "Warm gloss colour and shine." },
        { id: "facial", name: "Honey glow facial", category: "facial-glow", durationMin: 60, priceLkr: 5500, description: "Cleanse, steam, and a honey mask." },
        { id: "mask", name: "Honey mask", category: "facial-glow", durationMin: 30, priceLkr: 3200, description: "A short glow treatment, no steam." },
      ],
      hours: weekHours("09:00", "19:00", ["sunday"]),
    },
    {
      id: "kandy-hive",
      ownerId: "kandy-hive",
      name: "Kandy Hive",
      rating: 4.6,
      reviewCount: 124,
      address: "12 Peradeniya Road",
      city: "Kandy",
      location: "Kandy",
      cover: "/public/assets/salons/kandy-hive.svg",
      tags: ["haircut", "bridal"],
      featured: true,
      confirmation: "manual",
      distanceKm: 2.4,
      promo: "Kandyan bridal trials",
      services: [
        { id: "cut", name: "Haircut", category: "hair-treatments", durationMin: 40, priceLkr: 2500, description: "Hill-country cut with a wash." },
        { id: "beard", name: "Beard trim", category: "hair-treatments", durationMin: 25, priceLkr: 1200, description: "Line-up and tidy, 25 minutes." },
        { id: "bridal", name: "Kandyan bridal", category: "bridal", durationMin: 180, priceLkr: 25000, description: "Hair, makeup, and jewellery set." },
        { id: "trial", name: "Bridal trial", category: "bridal", durationMin: 90, priceLkr: 8500, description: "Look test before the wedding day." },
      ],
      hours: weekHours("10:00", "18:00", ["monday"]),
    },
    {
      id: "galle-amber",
      ownerId: "galle-amber",
      name: "Galle Amber Cuts",
      rating: 4.9,
      reviewCount: 98,
      address: "8 Church Street",
      city: "Galle Fort",
      location: "Galle",
      cover: "/public/assets/salons/galle-amber.svg",
      tags: ["haircut", "nails"],
      featured: true,
      confirmation: "auto",
      distanceKm: 3.1,
      promo: "Fort nail care walk-ins",
      services: [
        { id: "cut", name: "Haircut", category: "hair-treatments", durationMin: 50, priceLkr: 4000, description: "Fort cut with sea-air finish." },
        { id: "blow", name: "Sea-air blow dry", category: "hair-treatments", durationMin: 35, priceLkr: 2800, description: "Soft waves that hold in humidity." },
        { id: "nails", name: "Nail care", category: "nail-care", durationMin: 40, priceLkr: 2200, description: "Shape, care, and a calm polish." },
        { id: "gel", name: "Gel polish", category: "nail-care", durationMin: 50, priceLkr: 3200, description: "Long-wear colour, removed gently." },
      ],
      hours: weekHours("09:30", "18:30", ["sunday"]),
    },
    {
      id: "negombo-comb",
      ownerId: "negombo-comb",
      name: "Negombo Comb & Co",
      rating: 4.4,
      reviewCount: 76,
      address: "21 Lewis Place",
      city: "Negombo",
      location: "Negombo",
      cover: "/public/assets/salons/negombo-comb.svg",
      tags: ["haircut", "massage"],
      featured: false,
      confirmation: "auto",
      distanceKm: 5.6,
      promo: "",
      services: [
        { id: "cut", name: "Haircut", category: "hair-treatments", durationMin: 35, priceLkr: 2000, description: "Quick cut, walk-ins welcome." },
        { id: "kids", name: "Kids cut", category: "hair-treatments", durationMin: 25, priceLkr: 1500, description: "Gentle cut for children." },
        { id: "massage", name: "Head massage", category: "massage", durationMin: 20, priceLkr: 1800, description: "Scalp and temple release." },
        { id: "shoulder", name: "Shoulder massage", category: "massage", durationMin: 30, priceLkr: 2800, description: "Upper-back ease after a long day." },
      ],
      hours: weekHours("08:30", "20:00", []),
    },
    {
      id: "jaffna-gold",
      ownerId: "jaffna-gold",
      name: "Jaffna Gold Scissors",
      rating: 4.7,
      reviewCount: 61,
      address: "5 Power House Road",
      city: "Jaffna",
      location: "Jaffna",
      cover: "/public/assets/salons/jaffna-gold.svg",
      tags: ["haircut"],
      featured: false,
      confirmation: "manual",
      distanceKm: 8.2,
      promo: "",
      services: [
        { id: "cut", name: "Haircut", category: "hair-treatments", durationMin: 40, priceLkr: 1800, description: "Classic cut with a hot towel." },
        { id: "keratin", name: "Keratin smooth", category: "hair-treatments", durationMin: 120, priceLkr: 12000, description: "Frizz control for humid weeks." },
        { id: "color", name: "Colour", category: "hair-treatments", durationMin: 90, priceLkr: 6500, description: "Even colour from root to tip." },
      ],
      hours: weekHours("09:00", "18:00", ["sunday"]),
    },
    {
      id: "matara-meadow",
      ownerId: "matara-meadow",
      name: "Matara Meadow Salon",
      rating: 4.5,
      reviewCount: 54,
      address: "18 Beach Road",
      city: "Matara",
      location: "Matara",
      cover: "/public/assets/salons/matara-meadow.svg",
      tags: ["haircut", "skin-care", "bridal"],
      featured: false,
      confirmation: "auto",
      distanceKm: 4.2,
      promo: "",
      services: [
        { id: "cut", name: "Haircut", category: "hair-treatments", durationMin: 40, priceLkr: 2200, description: "Beach-road cut and tidy." },
        { id: "facial", name: "Honey glow facial", category: "facial-glow", durationMin: 50, priceLkr: 4000, description: "Local honey cleanse and glow." },
        { id: "mask", name: "Sea-salt scrub", category: "facial-glow", durationMin: 35, priceLkr: 2800, description: "Gentle polish for sun-tired skin." },
        { id: "bridal", name: "Southern bridal", category: "bridal", durationMin: 150, priceLkr: 18000, description: "Hair and makeup for the poruwa." },
      ],
      hours: weekHours("10:00", "19:00", ["sunday"]),
    },
  ];
}

function salonReviews() {
  return [
    { id: "r1", salonId: "honeycomb-colombo", author: "Nimali P.", rating: 5, body: "Calm room, honest time slots, and the honey facial was gentle.", createdAt: "2026-10-20T15:10:00+05:30" },
    { id: "r2", salonId: "honeycomb-colombo", author: "Kasun J.", rating: 4, body: "Haircut landed exactly as asked. Waited a few minutes at noon.", createdAt: "2026-10-18T11:40:00+05:30" },
    { id: "r3", salonId: "kandy-hive", author: "Tharushi M.", rating: 5, body: "Bridal trial felt unhurried. They wrote the look down for the wedding day.", createdAt: "2026-10-19T16:05:00+05:30" },
    { id: "r4", salonId: "kandy-hive", author: "Ruwan S.", rating: 4, body: "Beard trim was neat. Closed Monday, which the hours list made clear.", createdAt: "2026-10-14T10:20:00+05:30" },
    { id: "r5", salonId: "galle-amber", author: "Fathima R.", rating: 5, body: "Nail care in the Fort, no rush, and they confirmed the slot by themselves.", createdAt: "2026-10-21T09:30:00+05:30" },
    { id: "r6", salonId: "negombo-comb", author: "Ishara D.", rating: 4, body: "Head massage after the cut. Open late, which helped after work.", createdAt: "2026-10-17T19:15:00+05:30" },
    { id: "r7", salonId: "jaffna-gold", author: "Abarna K.", rating: 5, body: "Keratin week was booked properly. Staff asked before anything extra.", createdAt: "2026-10-12T13:00:00+05:30" },
    { id: "r8", salonId: "matara-meadow", author: "Sajith L.", rating: 4, body: "Facial used local honey. Quiet room facing the road, still calm.", createdAt: "2026-10-16T14:45:00+05:30" },
  ];
}

function salonPosts() {
  return [
    { id: "p1", salonId: "honeycomb-colombo", caption: "Honey gloss colour, Galle Road light.", createdAt: "2026-10-26T11:15:00+05:30" },
    { id: "p2", salonId: "kandy-hive", caption: "Kandyan bridal trial for Saturday.", createdAt: "2026-10-25T16:40:00+05:30" },
    { id: "p3", salonId: "galle-amber", caption: "Fort breeze blow-dries this morning.", createdAt: "2026-10-26T09:05:00+05:30" },
    { id: "p4", salonId: "negombo-comb", caption: "Walk-ins welcome until 20:00 Sri Lanka time.", createdAt: "2026-10-24T18:20:00+05:30" },
    { id: "p5", salonId: "jaffna-gold", caption: "Keratin week — book a morning slot.", createdAt: "2026-10-23T10:00:00+05:30" },
    { id: "p6", salonId: "matara-meadow", caption: "Beach-road facial with local honey.", createdAt: "2026-10-22T14:45:00+05:30" },
  ];
}

function withCover(post) {
  const salon = salonCatalog().find((item) => item.id === post.salonId);
  return {
    ...post,
    salonName: salon?.name || "",
    image: salon?.cover || "",
    salon: salon ? { ...salon } : null,
  };
}

function searchBlob(salon) {
  return [salon.name, salon.address, salon.city, salon.location, ...(salon.tags || []), ...(salon.services || []).map((item) => item.name)]
    .join(" ")
    .toLowerCase();
}

function matchesSalonQuery(salon, url) {
  const q = String(url.searchParams.get("q") || url.searchParams.get("query") || url.searchParams.get("search") || "").trim().toLowerCase();
  const name = String(url.searchParams.get("name") || "").trim().toLowerCase();
  const service = String(url.searchParams.get("service") || "").trim().toLowerCase();
  const location = String(url.searchParams.get("location") || "").trim().toLowerCase();
  const tag = String(url.searchParams.get("tag") || "").trim().toLowerCase();
  const blob = searchBlob(salon);
  if (q && !q.split(/\s+/).every((part) => blob.includes(part))) return false;
  if (name && !salon.name.toLowerCase().includes(name)) return false;
  if (service && !(salon.services || []).some((item) => item.name.toLowerCase().includes(service))) return false;
  if (location && !`${salon.location} ${salon.city} ${salon.address}`.toLowerCase().includes(location)) return false;
  if (tag === "top-rated" || tag === "toprated") return Number(salon.rating) >= 4.7;
  if (tag) {
    const tags = (salon.tags || []).map((item) => String(item).toLowerCase());
    const hit =
      tags.includes(tag) ||
      tags.some((item) => item.includes(tag) || tag.includes(item)) ||
      (salon.services || []).some((item) => String(item.name || "").toLowerCase().includes(tag.replace("-", " ")));
    if (!hit) return false;
  }
  return true;
}

function json(response, status, body) {
  send(response, status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, JSON.stringify(body));
}

function stripPath(pathname) {
  return pathname.replace(/^\/api(?=\/)/, "") || "/";
}

function savedSet(token) {
  if (!savedSalons.has(token)) {
    savedSalons.set(token, new Set(["honeycomb-colombo", "galle-amber", "kandy-hive"]));
  }
  return savedSalons.get(token);
}

async function handleSalonApi(request, response, url) {
  const pathname = stripPath(url.pathname);
  const token = gateToken(request);
  const jsonHeadersOk =
    request.method === "GET" ||
    request.method === "HEAD" ||
    request.method === "POST" ||
    request.method === "PUT" ||
    request.method === "DELETE";
  if (!jsonHeadersOk) return false;

  if (pathname === "/saloon-owners") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, { Allow: "GET, HEAD" }, "Method Not Allowed");
      return true;
    }
    const saved = savedSet(token);
    const owners = salonCatalog()
      .filter((salon) => matchesSalonQuery(salon, url))
      .map((salon) => ({ ...salon, saved: saved.has(salon.id) }));
    json(response, 200, { owners });
    return true;
  }

  if (pathname === "/feed/explore") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, { Allow: "GET, HEAD" }, "Method Not Allowed");
      return true;
    }
    const posts = salonPosts()
      .map(withCover)
      .filter((post) => !post.salon || matchesSalonQuery(post.salon, url));
    const featured = salonCatalog()
      .filter((salon) => salon.featured && matchesSalonQuery(salon, url))
      .map((salon) => ({ ...salon, saved: savedSet(token).has(salon.id) }));
    json(response, 200, { feed: posts, featured });
    return true;
  }

  const salonFeed = pathname.match(/^\/feed\/salon\/([^/]+)\/?$/);
  if (salonFeed) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, { Allow: "GET, HEAD" }, "Method Not Allowed");
      return true;
    }
    const id = decodeURIComponent(salonFeed[1]);
    const salon = salonCatalog().find((item) => item.id === id);
    if (!salon) {
      json(response, 404, { code: "not-found" });
      return true;
    }
    const saved = savedSet(token);
    json(response, 200, {
      salon: { ...salon, saved: saved.has(salon.id) },
      posts: salonPosts().filter((post) => post.salonId === id).map(withCover),
    });
    return true;
  }

  const services = pathname.match(/^\/services\/owner\/([^/]+)(?:\/.*)?$/);
  if (services) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, { Allow: "GET, HEAD" }, "Method Not Allowed");
      return true;
    }
    const id = decodeURIComponent(services[1]);
    const salon = salonCatalog().find((item) => item.id === id || item.ownerId === id);
    if (!salon) {
      json(response, 404, { code: "not-found" });
      return true;
    }
    json(response, 200, { services: salon.services || [] });
    return true;
  }

  const reviewsPath = pathname.match(/^\/reviews\/salon\/([^/]+)\/?$/);
  const serviceReviewPath = pathname.match(/^\/reviews\/service\/([^/]+)\/?$/);
  if (reviewsPath || serviceReviewPath) {
    if (request.method === "GET" || request.method === "HEAD") {
      if (!reviewsPath) {
        send(response, 405, { Allow: "PUT" }, "Method Not Allowed");
        return true;
      }
      const id = decodeURIComponent(reviewsPath[1]);
      const salon = salonCatalog().find((item) => item.id === id);
      if (!salon) {
        json(response, 404, { code: "not-found" });
        return true;
      }
      const extra = filedReviews.filter((item) => item.salonId === id);
      json(response, 200, { reviews: [...salonReviews().filter((item) => item.salonId === id), ...extra] });
      return true;
    }
    if (request.method !== "PUT") {
      send(response, 405, { Allow: reviewsPath ? "GET, HEAD, PUT" : "PUT" }, "Method Not Allowed");
      return true;
    }
    let body = {};
    try {
      body = await readJsonBody(request);
    } catch {
      json(response, 400, { code: "invalid-json" });
      return true;
    }
    const rating = Number(body.rating || body.stars || 0);
    if (rating < 1 || rating > 5) {
      json(response, 422, { code: "rating-required" });
      return true;
    }
    const appointmentId = String(body.appointmentId || body.bookingId || "");
    const found = appointmentId ? findBooking(appointmentId) : null;
    if (found) {
      const current = presentAppointment(found.item);
      if (current.status !== "completed") {
        json(response, 422, { code: "not-completed" });
        return true;
      }
      if (found.item.reviewed && serviceReviewPath) {
        json(response, 200, { ok: true, review: { appointmentId, already: true } });
        return true;
      }
      if (found.item.reviewed) {
        json(response, 409, { code: "already-reviewed" });
        return true;
      }
      found.item.reviewed = true;
    }
    const salonId = String(body.salonId || (reviewsPath ? decodeURIComponent(reviewsPath[1]) : found?.item.salonId || ""));
    const serviceId = String(body.serviceId || (serviceReviewPath ? decodeURIComponent(serviceReviewPath[1]) : ""));
    const entry = {
      id: `rev-${filedReviews.length + 1}`,
      salonId,
      serviceId,
      appointmentId,
      author: "You",
      rating,
      body: String(body.body || body.text || body.comment || ""),
      createdAt: colomboNowIso(),
    };
    filedReviews.push(entry);
    json(response, 200, { ok: true, review: entry });
    return true;
  }

  const postReport = pathname.match(/^\/feed\/posts\/([^/]+)\/report\/?$/);
  const reportTarget = pathname.match(/^\/reports\/(salon|review|post)\/([^/]+)\/?$/);
  if (pathname === "/reports" || postReport || reportTarget) {
    if (request.method !== "POST") {
      send(response, 405, { Allow: "POST" }, "Method Not Allowed");
      return true;
    }
    let body = {};
    try {
      body = await readJsonBody(request);
    } catch {
      json(response, 400, { code: "invalid-json" });
      return true;
    }
    const type = String(body.type || reportTarget?.[1] || (postReport ? "post" : "salon"));
    const targetId = String(body.targetId || body.id || postReport?.[1] || reportTarget?.[2] || "");
    if (!targetId) {
      json(response, 422, { code: "target-required" });
      return true;
    }
    const entry = {
      id: `rep-${filedReports.length + 1}`,
      type,
      targetId,
      reason: String(body.reason || "other"),
      createdAt: new Date().toISOString(),
    };
    filedReports.push(entry);
    json(response, 200, { ok: true, report: entry });
    return true;
  }

  const savedOne = pathname.match(/^\/saved-salons\/([^/]+)\/?$/);
  if (pathname === "/saved-salons" || savedOne) {
    const saved = savedSet(token);
    if (request.method === "GET" || request.method === "HEAD") {
      const catalog = salonCatalog();
      const items = [...saved].map((id) => {
        const salon = catalog.find((item) => item.id === id);
        return salon ? { ...salon, salonId: id, saved: true } : { id, salonId: id, saved: true };
      });
      json(response, 200, { items, saved: items });
      return true;
    }
    if (request.method === "POST") {
      let body = {};
      try {
        body = await readJsonBody(request);
      } catch {
        json(response, 400, { code: "invalid-json" });
        return true;
      }
      const salonId = String(body?.salonId || body?.id || savedOne?.[1] || "");
      const shouldSave = body?.saved !== false && body?.unsave !== true;
      if (!salonId) {
        json(response, 422, { code: "salon-required" });
        return true;
      }
      if (shouldSave) saved.add(salonId);
      else saved.delete(salonId);
      json(response, 200, { salonId, saved: saved.has(salonId), items: [...saved].map((id) => ({ salonId: id, id })) });
      return true;
    }
    if (request.method === "DELETE") {
      const salonId = String(savedOne?.[1] || "");
      if (salonId) saved.delete(salonId);
      json(response, 200, { salonId, saved: false, items: [...saved].map((id) => ({ salonId: id, id })) });
      return true;
    }
    send(response, 405, { Allow: "GET, HEAD, POST, DELETE" }, "Method Not Allowed");
    return true;
  }

  return false;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function colomboNowParts() {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function colomboNowIso() {
  const parts = colomboNowParts();
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}+05:30`;
}

function minutesAgoIso(minutes) {
  const date = new Date(Date.now() - Number(minutes || 0) * 60 * 1000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Colombo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+05:30`;
}

function seedNotices() {
  return [
    {
      id: "ntc-proposed",
      kind: "appointment",
      titleKey: "notices.item.proposed.title",
      bodyKey: "notices.item.proposed.body",
      title: "Reschedule proposed",
      body: "Galle Amber Cuts suggested Saturday 16:00 instead of Friday 14:00.",
      createdAt: minutesAgoIso(12),
      read: false,
      href: "/bookings",
    },
    {
      id: "ntc-confirmed",
      kind: "appointment",
      titleKey: "notices.item.confirmed.title",
      bodyKey: "notices.item.confirmed.body",
      title: "Booking confirmed",
      body: "Honeycomb Studio confirmed your haircut for Thursday 10:00.",
      createdAt: minutesAgoIso(80),
      read: false,
      href: "/bookings",
    },
    {
      id: "ntc-reminder",
      kind: "reminder",
      titleKey: "notices.item.reminder.title",
      bodyKey: "notices.item.reminder.body",
      title: "Visit tomorrow",
      body: "Reminder: Kandy Hive bridal trial is tomorrow at 11:00 Sri Lanka time.",
      createdAt: minutesAgoIso(18 * 60),
      read: false,
      href: "/bookings",
    },
    {
      id: "ntc-system",
      kind: "system",
      titleKey: "notices.item.system.title",
      bodyKey: "notices.item.system.body",
      title: "Community rules updated",
      body: "Please review the latest community rules when you have a moment.",
      createdAt: minutesAgoIso(36 * 60),
      read: true,
      href: "/privacy",
    },
  ];
}

function noticesFor(token) {
  if (!noticeStore.has(token)) noticeStore.set(token, seedNotices());
  return noticeStore.get(token);
}

function unreadCountFor(token) {
  return noticesFor(token).filter((item) => item.read !== true).length;
}

function isDocumentNavigation(request) {
  const accept = String(request.headers.accept || "");
  return /text\/html/.test(accept) && !/application\/json/.test(accept);
}

async function handleNoticesApi(request, response, url) {
  const pathname = stripPath(url.pathname);
  if (!pathname.startsWith("/notices")) return false;
  if (pathname === "/notices" && (request.method === "GET" || request.method === "HEAD") && isDocumentNavigation(request)) {
    return false;
  }
  const token = gateToken(request);
  const items = noticesFor(token);

  if (pathname === "/notices/unread-count") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, { Allow: "GET, HEAD" }, "Method Not Allowed");
      return true;
    }
    json(response, 200, { unreadCount: unreadCountFor(token) });
    return true;
  }

  if (pathname === "/notices/read-all") {
    if (request.method !== "POST" && request.method !== "PUT") {
      send(response, 405, { Allow: "POST, PUT" }, "Method Not Allowed");
      return true;
    }
    items.forEach((item) => {
      item.read = true;
    });
    json(response, 200, { ok: true, unreadCount: 0, items });
    return true;
  }

  const readOne = pathname.match(/^\/notices\/([^/]+)\/read\/?$/);
  if (readOne) {
    if (request.method !== "POST" && request.method !== "PUT") {
      send(response, 405, { Allow: "POST, PUT" }, "Method Not Allowed");
      return true;
    }
    const found = items.find((item) => item.id === decodeURIComponent(readOne[1]));
    if (found) found.read = true;
    json(response, 200, { ok: true, unreadCount: unreadCountFor(token), notice: found || null });
    return true;
  }

  if (pathname === "/notices") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, { Allow: "GET, HEAD" }, "Method Not Allowed");
      return true;
    }
    const sorted = [...items].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    json(response, 200, { items: sorted, notices: sorted, unreadCount: unreadCountFor(token) });
    return true;
  }

  json(response, 404, { code: "not-found" });
  return true;
}

function seedClient(token) {
  const slug = String(token || "local")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 12) || "local";
  return {
    id: token === "local-session" ? "cli-local" : `cli-${slug}`,
    fullName: "Amaya Perera",
    email: "amaya@yamoo.lk",
    phone: "+94771234567",
    locale: "en",
    createdAt: colomboNowIso(),
    updatedAt: colomboNowIso(),
  };
}

function clientFor(token) {
  if (!clientStore.has(token)) clientStore.set(token, seedClient(token));
  return clientStore.get(token);
}

function publicClient(client) {
  return {
    id: client.id,
    fullName: client.fullName,
    name: client.fullName,
    email: client.email,
    phone: client.phone,
    locale: client.locale,
    updatedAt: client.updatedAt,
  };
}

function isLankaPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^(?:94)?7\d{8}$/.test(digits);
}

function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^07\d{8}$/.test(digits)) return `+94${digits.slice(1)}`;
  if (/^947\d{8}$/.test(digits)) return `+${digits}`;
  return String(value || "").trim();
}

function setChallenge(token, kind, value) {
  contactChallenges.set(`${token}:${kind}`, {
    value,
    otp: MOCK_OTP,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
}

function readChallenge(token, kind) {
  const entry = contactChallenges.get(`${token}:${kind}`);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    contactChallenges.delete(`${token}:${kind}`);
    return { expired: true };
  }
  return entry;
}

function wipeAccount(token) {
  clientStore.delete(token);
  contactChallenges.delete(`${token}:phone`);
  contactChallenges.delete(`${token}:email`);
  savedSalons.delete(token);
  noticeStore.delete(token);
  acceptedGates.delete(token);
}

async function handleAccountApi(request, response, url) {
  const pathname = stripPath(url.pathname);
  const isClients = pathname.startsWith("/clients");
  const isSupport = pathname.startsWith("/support");
  const isDeletion = pathname === "/account/deletion" || pathname === "/account/delete";
  if (!isClients && !isSupport && !isDeletion) return false;

  const token = gateToken(request);

  if (isDeletion) {
    if (request.method !== "POST" && request.method !== "DELETE") {
      send(response, 405, { Allow: "POST, DELETE" }, "Method Not Allowed");
      return true;
    }
    let body = {};
    try {
      body = request.method === "DELETE" ? {} : await readJsonBody(request);
    } catch {
      json(response, 400, { code: "invalid-json" });
      return true;
    }
    const phrase = String(body.confirmPhrase || body.confirmation || body.phrase || "").trim().toUpperCase();
    const confirmed = body.confirm === true || body.permanent === true || phrase === "DELETE";
    if (!confirmed) {
      json(response, 422, { code: "deletion-confirm" });
      return true;
    }
    wipeAccount(token);
    json(response, 200, { ok: true, deleted: true });
    return true;
  }

  if (isSupport) {
    if (request.method !== "POST") {
      send(response, 405, { Allow: "POST" }, "Method Not Allowed");
      return true;
    }
    let body = {};
    try {
      body = await readJsonBody(request);
    } catch {
      json(response, 400, { code: "invalid-json" });
      return true;
    }
    const subject = String(body.subject || body.title || "").trim();
    const message = String(body.message || body.body || body.text || "").trim();
    if (subject.length < 3 || message.length < 10) {
      json(response, 422, { code: "support-required" });
      return true;
    }
    const ticket = {
      id: `sup-${supportTickets.length + 1}`,
      category: String(body.category || "other"),
      subject,
      message,
      locale: String(body.locale || "en"),
      status: "open",
      createdAt: colomboNowIso(),
    };
    supportTickets.push(ticket);
    json(response, 200, { ok: true, ticket });
    return true;
  }

  const phonePath = pathname.match(/^\/clients\/me\/phone\/([^/]+)\/?$/);
  if (phonePath) {
    if (request.method !== "POST" && request.method !== "PUT") {
      send(response, 405, { Allow: "POST, PUT" }, "Method Not Allowed");
      return true;
    }
    let body = {};
    try {
      body = await readJsonBody(request);
    } catch {
      json(response, 400, { code: "invalid-json" });
      return true;
    }
    const action = phonePath[1];
    const client = clientFor(token);
    if (action === "otp" || action === "request" || action === "send" || action === "start") {
      const phone = normalizePhone(body.phone || body.mobile || body.phoneNumber);
      if (!isLankaPhone(phone)) {
        json(response, 422, { code: "phone-required" });
        return true;
      }
      setChallenge(token, "phone", phone);
      json(response, 200, { ok: true, sent: true, channel: "phone" });
      return true;
    }
    if (action === "verify" || action === "confirm") {
      const challenge = readChallenge(token, "phone");
      if (!challenge) {
        json(response, 422, { code: "otp-required" });
        return true;
      }
      if (challenge.expired) {
        json(response, 422, { code: "otp-expired" });
        return true;
      }
      const code = String(body.code || body.otp || body.token || "").trim();
      if (code !== challenge.otp) {
        json(response, 422, { code: "otp-invalid" });
        return true;
      }
      client.phone = challenge.value;
      client.updatedAt = colomboNowIso();
      contactChallenges.delete(`${token}:phone`);
      json(response, 200, { ok: true, client: publicClient(client) });
      return true;
    }
    json(response, 404, { code: "not-found" });
    return true;
  }

  const emailPath = pathname.match(/^\/clients\/me\/email\/([^/]+)\/?$/);
  if (emailPath) {
    if (request.method !== "POST" && request.method !== "PUT") {
      send(response, 405, { Allow: "POST, PUT" }, "Method Not Allowed");
      return true;
    }
    let body = {};
    try {
      body = await readJsonBody(request);
    } catch {
      json(response, 400, { code: "invalid-json" });
      return true;
    }
    const action = emailPath[1];
    const client = clientFor(token);
    if (action === "otp" || action === "request" || action === "send" || action === "start") {
      const email = String(body.email || body.address || "").trim().toLowerCase();
      if (!isEmailAddress(email)) {
        json(response, 422, { code: "email-required" });
        return true;
      }
      setChallenge(token, "email", email);
      json(response, 200, { ok: true, sent: true, channel: "email" });
      return true;
    }
    if (action === "verify" || action === "confirm") {
      const challenge = readChallenge(token, "email");
      if (!challenge) {
        json(response, 422, { code: "otp-required" });
        return true;
      }
      if (challenge.expired) {
        json(response, 422, { code: "otp-expired" });
        return true;
      }
      const code = String(body.code || body.otp || body.token || "").trim();
      if (code !== challenge.otp) {
        json(response, 422, { code: "otp-invalid" });
        return true;
      }
      client.email = challenge.value;
      client.updatedAt = colomboNowIso();
      contactChallenges.delete(`${token}:email`);
      json(response, 200, { ok: true, client: publicClient(client) });
      return true;
    }
    json(response, 404, { code: "not-found" });
    return true;
  }

  if (pathname === "/clients/update" || pathname.startsWith("/clients/update/")) {
    if (request.method !== "PUT" && request.method !== "POST" && request.method !== "PATCH") {
      send(response, 405, { Allow: "PUT, POST, PATCH" }, "Method Not Allowed");
      return true;
    }
    let body = {};
    try {
      body = await readJsonBody(request);
    } catch {
      json(response, 400, { code: "invalid-json" });
      return true;
    }
    const client = clientFor(token);
    const field = pathname.split("/")[3] || "";
    const fullName = String(body.fullName || body.name || body.displayName || "").trim();
    const updatingName = field === "name" || field === "profile" || body.fullName != null || body.name != null;
    if (updatingName) {
      if (fullName.length < 2) {
        json(response, 422, { code: "name-required" });
        return true;
      }
      client.fullName = fullName;
    }
    if (body.locale) client.locale = String(body.locale);
    client.updatedAt = colomboNowIso();
    json(response, 200, { ok: true, client: publicClient(client) });
    return true;
  }

  const clientOne = pathname.match(/^\/clients\/([^/]+)\/?$/);
  if (clientOne && (request.method === "GET" || request.method === "HEAD")) {
    const client = clientFor(token);
    const id = decodeURIComponent(clientOne[1]);
    if (id !== "me" && id !== client.id) {
      json(response, 404, { code: "not-found" });
      return true;
    }
    json(response, 200, { client: publicClient(client), ...publicClient(client) });
    return true;
  }

  if (clientOne && (request.method === "PUT" || request.method === "PATCH")) {
    let body = {};
    try {
      body = await readJsonBody(request);
    } catch {
      json(response, 400, { code: "invalid-json" });
      return true;
    }
    const client = clientFor(token);
    const id = decodeURIComponent(clientOne[1]);
    if (id !== "me" && id !== client.id) {
      json(response, 404, { code: "not-found" });
      return true;
    }
    const fullName = String(body.fullName || body.name || "").trim();
    if (fullName && fullName.length < 2) {
      json(response, 422, { code: "name-required" });
      return true;
    }
    if (fullName) client.fullName = fullName;
    client.updatedAt = colomboNowIso();
    json(response, 200, { ok: true, client: publicClient(client) });
    return true;
  }

  json(response, 404, { code: "not-found" });
  return true;
}

function colomboDateParts(offsetDays = 0) {
  const now = colomboNowParts();
  const utc = Date.UTC(now.year, now.month - 1, now.day + offsetDays, 6, 30, 0);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(utc)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function colomboStamp(offsetDays, clock) {
  return `${colomboDateParts(offsetDays)}T${clock}:00+05:30`;
}

function findBooking(id) {
  const appointmentId = String(id || "");
  const apt = bookedAppointments.find((item) => item.id === appointmentId);
  if (apt) return { item: apt, list: bookedAppointments };
  const evt = eventRequests.find((item) => item.id === appointmentId);
  if (evt) return { item: evt, list: eventRequests };
  return null;
}

function presentAppointment(item) {
  if (!item) return null;
  const nowIso = colomboNowIso();
  let status = String(item.status || "pending");
  if (item.proposal?.startsAt) status = "proposed";
  else if (status === "confirmed" && item.startsAt && item.startsAt < nowIso) status = "completed";
  return { ...item, status, kind: item.kind || (item.eventType ? "event" : "booking") };
}

function weekdayFromDate(dateStr) {
  const match = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 6, 30, 0);
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Colombo", weekday: "long" }).format(new Date(utc)).toLowerCase();
}

function clockToMin(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minToClock(minutes) {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function colomboWallClock(value) {
  const minutes = clockToMin(value);
  return minutes == null ? "" : minToClock(minutes);
}

function specialist(id, name, title, photo) {
  return { id, name, title, photo: `/public/assets/staff/${photo}` };
}

function anySpecialist() {
  return {
    id: "any",
    name: "Any available",
    title: "First free specialist",
    photo: "/public/assets/staff/any.svg",
    any: true,
  };
}

function salonSpecialists(salonId) {
  const map = {
    "honeycomb-colombo": [
      specialist("amaya", "Amaya Perera", "Senior stylist", "amaya.svg"),
      specialist("nuwan", "Nuwan Silva", "Colour specialist", "nuwan.svg"),
      specialist("fathima-h", "Fathima Rahman", "Facial therapist", "fathima.svg"),
    ],
    "kandy-hive": [
      specialist("tharushi", "Tharushi Mendis", "Bridal artist", "tharushi.svg"),
      specialist("ruwan", "Ruwan Silva", "Barber", "ruwan.svg"),
    ],
    "galle-amber": [
      specialist("fathima-g", "Fathima Rahman", "Nail artist", "fathima.svg"),
      specialist("amaya-g", "Amaya Perera", "Stylist", "amaya.svg"),
    ],
    "negombo-comb": [
      specialist("nuwan-n", "Nuwan Silva", "Barber", "nuwan.svg"),
      specialist("ruwan-n", "Ruwan Silva", "Massage therapist", "ruwan.svg"),
    ],
    "jaffna-gold": [
      specialist("amaya-j", "Amaya Perera", "Stylist", "amaya.svg"),
      specialist("nuwan-j", "Nuwan Silva", "Keratin specialist", "nuwan.svg"),
    ],
    "matara-meadow": [
      specialist("tharushi-m", "Tharushi Mendis", "Bridal artist", "tharushi.svg"),
      specialist("fathima-m", "Fathima Rahman", "Facial therapist", "fathima.svg"),
    ],
  };
  return map[salonId] || [specialist("amaya", "Amaya Perera", "Stylist", "amaya.svg")];
}

function appointmentKey(salonId, staffId, startsAt) {
  return `${salonId}::${staffId}::${startsAt}`;
}

function isSlotBooked(salonId, staffId, startsAt) {
  return bookedAppointments.some((item) => {
    if (item.salonId !== salonId || item.startsAt !== startsAt) return false;
    if (staffId === "any" || item.staffId === "any") return true;
    return item.staffId === staffId;
  });
}

function isDemoHeld(staffId, startsAt) {
  if (staffId === "any") return String(startsAt).includes("T13:00");
  return String(startsAt).includes("T12:00") && /amaya|tharushi|fathima-g/.test(staffId);
}

function generateSlots(salon, dateStr, staffId, durationMin) {
  const weekday = weekdayFromDate(dateStr);
  const hours = salon.hours?.[weekday];
  if (!hours?.open || !hours?.close) return { closed: true, slots: [] };
  const open = clockToMin(hours.open);
  const close = clockToMin(hours.close);
  if (open == null || close == null) return { closed: true, slots: [] };
  const now = colomboNowParts();
  const today = `${now.year}-${pad2(now.month)}-${pad2(now.day)}`;
  const nowMin = now.hour * 60 + now.minute + 15;
  const dur = Math.max(30, Number(durationMin) || 30);
  const confirmation = salon.confirmation === "manual" ? "manual" : "auto";
  const slots = [];
  for (let time = open; time + dur <= close; time += 30) {
    if (dateStr === today && time < nowMin) continue;
    const start = minToClock(time);
    const startsAt = `${dateStr}T${start}:00+05:30`;
    const available = !isSlotBooked(salon.id, staffId, startsAt) && !isDemoHeld(staffId, startsAt);
    slots.push({ id: startsAt, start, startsAt, confirmation, available, staffId });
  }
  return { closed: false, slots };
}

function unionSlots(salon, dateStr, durationMin) {
  const team = salonSpecialists(salon.id);
  if (!team.length) return generateSlots(salon, dateStr, "any", durationMin);
  const byStart = new Map();
  let closed = true;
  for (const member of team) {
    const result = generateSlots(salon, dateStr, member.id, durationMin);
    if (!result.closed) closed = false;
    for (const slot of result.slots) {
      const prev = byStart.get(slot.start);
      if (!prev) byStart.set(slot.start, { ...slot, staffId: "any" });
      else if (slot.available) prev.available = true;
    }
  }
  return { closed, slots: [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start)) };
}

function seedDemoBookings() {
  if (bookedAppointments.length || eventRequests.length) return;
  bookedAppointments.push(
    {
      id: "apt-demo-confirmed",
      kind: "booking",
      salonId: "honeycomb-colombo",
      salonName: "Honeycomb Studio",
      staffId: "amaya",
      staffName: "Amaya Perera",
      startsAt: colomboStamp(2, "10:00"),
      confirmation: "auto",
      status: "confirmed",
      services: [{ id: "cut", name: "Haircut", qty: 1, priceLkr: 3500 }],
      zone: "Asia/Colombo",
      createdAt: colomboStamp(-1, "09:12"),
    },
    {
      id: "apt-demo-pending",
      kind: "booking",
      salonId: "kandy-hive",
      salonName: "Kandy Hive",
      staffId: "tharushi",
      staffName: "Tharushi Mendis",
      startsAt: colomboStamp(5, "11:00"),
      confirmation: "manual",
      status: "pending",
      services: [{ id: "trial", name: "Bridal trial", qty: 1, priceLkr: 8500 }],
      zone: "Asia/Colombo",
      createdAt: colomboStamp(-1, "16:40"),
    },
    {
      id: "apt-demo-proposed",
      kind: "booking",
      salonId: "galle-amber",
      salonName: "Galle Amber Cuts",
      staffId: "fathima-g",
      staffName: "Fathima Rahman",
      startsAt: colomboStamp(3, "14:00"),
      confirmation: "auto",
      status: "confirmed",
      proposal: {
        startsAt: colomboStamp(4, "16:00"),
        note: "A bridal party overran. 16:00 is free the next afternoon.",
        staffName: "Fathima Rahman",
      },
      services: [{ id: "nails", name: "Nail care", qty: 1, priceLkr: 2200 }],
      zone: "Asia/Colombo",
      createdAt: colomboStamp(-2, "11:20"),
    },
    {
      id: "apt-demo-done",
      kind: "booking",
      salonId: "honeycomb-colombo",
      salonName: "Honeycomb Studio",
      staffId: "fathima-h",
      staffName: "Fathima Rahman",
      startsAt: colomboStamp(-5, "15:00"),
      confirmation: "auto",
      status: "completed",
      reviewed: false,
      services: [{ id: "facial", name: "Honey glow facial", qty: 1, priceLkr: 5500 }],
      zone: "Asia/Colombo",
      createdAt: colomboStamp(-8, "10:05"),
    },
    {
      id: "apt-demo-reviewed",
      kind: "booking",
      salonId: "matara-meadow",
      salonName: "Matara Meadow Salon",
      staffId: "tharushi-m",
      staffName: "Tharushi Mendis",
      startsAt: colomboStamp(-12, "11:00"),
      confirmation: "auto",
      status: "completed",
      reviewed: true,
      services: [{ id: "cut", name: "Haircut", qty: 1, priceLkr: 2200 }],
      zone: "Asia/Colombo",
      createdAt: colomboStamp(-14, "18:00"),
    },
    {
      id: "apt-demo-cancelled",
      kind: "booking",
      salonId: "negombo-comb",
      salonName: "Negombo Comb & Co",
      staffId: "any",
      staffName: "Any available",
      startsAt: colomboStamp(-2, "09:00"),
      confirmation: "auto",
      status: "cancelled",
      cancelledAt: colomboStamp(-3, "19:30"),
      services: [{ id: "cut", name: "Haircut", qty: 1, priceLkr: 2000 }],
      zone: "Asia/Colombo",
      createdAt: colomboStamp(-4, "12:00"),
    },
  );
  eventRequests.push({
    id: "evt-demo-pending",
    kind: "event",
    salonId: "jaffna-gold",
    salonName: "Jaffna Gold Scissors",
    eventType: "bridal",
    startsAt: colomboStamp(10, "08:30"),
    durationMin: 180,
    persons: 6,
    locationType: "salon",
    address: "5 Power House Road",
    notes: "Poruwa morning, jewellery already packed.",
    status: "pending",
    zone: "Asia/Colombo",
    createdAt: colomboStamp(-1, "08:00"),
  });
}

async function handleAppointmentApi(request, response, url) {
  const pathname = stripPath(url.pathname);
  if (!pathname.startsWith("/appointments")) return false;

  if (pathname === "/appointments/availability") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, { Allow: "GET, HEAD" }, "Method Not Allowed");
      return true;
    }
    const salonId = String(url.searchParams.get("salonId") || url.searchParams.get("salon") || "");
    const salon = salonCatalog().find((item) => item.id === salonId || item.ownerId === salonId);
    if (!salon) {
      json(response, 404, { code: "not-found" });
      return true;
    }
    const staffId = String(url.searchParams.get("staffId") || url.searchParams.get("staff") || "any") || "any";
    const date = String(url.searchParams.get("date") || "");
    const durationMin = Number(url.searchParams.get("durationMin") || url.searchParams.get("duration") || 30);
    const team = [anySpecialist(), ...salonSpecialists(salon.id)];
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      json(response, 422, { code: "invalid-date" });
      return true;
    }
    const named = salonSpecialists(salon.id);
    if (staffId !== "any" && !named.some((item) => item.id === staffId)) {
      json(response, 422, { code: "staff-required" });
      return true;
    }
    const window = date
      ? staffId === "any"
        ? unionSlots(salon, date, durationMin)
        : generateSlots(salon, date, staffId, durationMin)
      : { closed: false, slots: [] };
    json(response, 200, {
      date,
      zone: "Asia/Colombo",
      confirmation: salon.confirmation === "manual" ? "manual" : "auto",
      closed: window.closed,
      staff: team,
      slots: window.slots,
    });
    return true;
  }

  if (pathname === "/appointments" || pathname === "/appointments/mine") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, { Allow: "GET, HEAD" }, "Method Not Allowed");
      return true;
    }
    const items = [
      ...bookedAppointments.map((item) => presentAppointment({ ...item, kind: item.kind || "booking" })),
      ...eventRequests.map((item) => presentAppointment({ ...item, kind: "event" })),
    ].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    json(response, 200, { items, appointments: items, zone: "Asia/Colombo" });
    return true;
  }

  const cancelPath = pathname.match(/^\/appointments\/cancel\/([^/]+)\/?$/) || pathname.match(/^\/appointments\/([^/]+)\/cancel\/?$/);
  const acceptPath = pathname.match(/^\/appointments\/([^/]+)\/proposal\/accept\/?$/);
  const declinePath = pathname.match(/^\/appointments\/([^/]+)\/proposal\/decline\/?$/);
  if (cancelPath || acceptPath || declinePath) {
    if (request.method !== "PUT") {
      send(response, 405, { Allow: "PUT" }, "Method Not Allowed");
      return true;
    }
    let body = {};
    try {
      body = await readJsonBody(request);
    } catch {
      json(response, 400, { code: "invalid-json" });
      return true;
    }
    const id = decodeURIComponent(cancelPath?.[1] || acceptPath?.[1] || declinePath?.[1] || "");
    const found = findBooking(id);
    if (!found) {
      json(response, 404, { code: "not-found" });
      return true;
    }
    const current = presentAppointment(found.item);
    if (cancelPath) {
      if (current.status === "completed" || current.status === "cancelled") {
        json(response, 422, { code: "cannot-cancel" });
        return true;
      }
      found.item.status = "cancelled";
      found.item.cancelledAt = colomboNowIso();
      found.item.proposal = null;
      json(response, 200, { ok: true, appointment: presentAppointment(found.item) });
      return true;
    }
    if (!found.item.proposal?.startsAt) {
      json(response, 422, { code: "no-proposal" });
      return true;
    }
    if (acceptPath) {
      found.item.startsAt = found.item.proposal.startsAt;
      if (found.item.proposal.staffName) found.item.staffName = found.item.proposal.staffName;
      found.item.status = "confirmed";
      found.item.proposal = null;
      json(response, 200, { ok: true, appointment: presentAppointment(found.item) });
      return true;
    }
    found.item.proposal = null;
    if (found.item.status === "proposed") found.item.status = "confirmed";
    json(response, 200, { ok: true, appointment: presentAppointment(found.item) });
    return true;
  }

  if (pathname === "/appointments/event-request") {
    if (request.method !== "POST") {
      send(response, 405, { Allow: "POST" }, "Method Not Allowed");
      return true;
    }
    let body = {};
    try {
      body = await readJsonBody(request);
    } catch {
      json(response, 400, { code: "invalid-json" });
      return true;
    }
    const salonId = String(body.salonId || body.salon || "");
    const salon = salonCatalog().find((item) => item.id === salonId || item.ownerId === salonId);
    if (!salon) {
      json(response, 404, { code: "not-found" });
      return true;
    }
    const eventType = String(body.eventType || body.type || "").toLowerCase();
    if (!["bridal", "groom", "party", "shoot", "other"].includes(eventType)) {
      json(response, 422, { code: "event-type-required" });
      return true;
    }
    const date = String(body.date || body.preferredDate || "");
    const startTime = colomboWallClock(body.startTime || body.time || body.start);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !startTime) {
      json(response, 422, { code: "invalid-date" });
      return true;
    }
    const durationMin = Number(body.durationMin || body.duration || body.estimatedDuration || 0);
    if (!durationMin || durationMin < 30) {
      json(response, 422, { code: "duration-required" });
      return true;
    }
    const persons = Number(body.persons || body.guests || body.partySize || 0);
    if (!persons || persons < 1) {
      json(response, 422, { code: "persons-required" });
      return true;
    }
    const locationType = /offsite|away|my[- ]?location|client/.test(String(body.locationType || body.location || "salon"))
      ? "offsite"
      : "salon";
    const address = String(body.address || body.locationAddress || "").trim();
    if (locationType === "offsite" && address.length < 4) {
      json(response, 422, { code: "address-required" });
      return true;
    }
    const startsAt = `${date}T${startTime}:00+05:30`;
    const requestItem = {
      id: `evt-${eventRequests.length + 1}`,
      kind: "event",
      salonId: salon.id,
      salonName: salon.name,
      eventType,
      date,
      startTime,
      startsAt,
      durationMin,
      persons,
      locationType,
      address: locationType === "offsite" ? address : salon.address,
      notes: String(body.notes || body.request || "").trim(),
      status: "pending",
      zone: "Asia/Colombo",
      createdAt: colomboNowIso(),
    };
    eventRequests.push(requestItem);
    json(response, 200, { request: requestItem, appointment: requestItem });
    return true;
  }

  if (pathname !== "/appointments/book") return false;

  if (request.method !== "POST") {
    send(response, 405, { Allow: "POST" }, "Method Not Allowed");
    return true;
  }

  let body = {};
  try {
    body = await readJsonBody(request);
  } catch {
    json(response, 400, { code: "invalid-json" });
    return true;
  }

  const salonId = String(body.salonId || body.salon || "");
  const salon = salonCatalog().find((item) => item.id === salonId || item.ownerId === salonId);
  if (!salon) {
    json(response, 404, { code: "not-found" });
    return true;
  }
  const staffId = String(body.staffId || body.staff || "any") || "any";
  const named = salonSpecialists(salon.id);
  if (staffId !== "any" && !named.some((item) => item.id === staffId)) {
    json(response, 422, { code: "staff-required" });
    return true;
  }
  const startsAt = String(body.startsAt || body.startAt || body.datetime || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startsAt)) {
    json(response, 422, { code: "slot-required" });
    return true;
  }
  if (body.termsAccepted !== true && body.agreed !== true) {
    json(response, 422, { code: "terms-required" });
    return true;
  }
  const services = Array.isArray(body.services) ? body.services : [];
  if (!services.length) {
    json(response, 422, { code: "services-required" });
    return true;
  }
  if (isSlotBooked(salon.id, staffId, startsAt) || isDemoHeld(staffId, startsAt)) {
    json(response, 409, { code: "slot-taken" });
    return true;
  }

  const specialist =
    staffId === "any" ? anySpecialist() : named.find((item) => item.id === staffId) || anySpecialist();
  const confirmation = salon.confirmation === "manual" ? "manual" : "auto";
  const appointment = {
    id: `apt-${bookedAppointments.length + 1}`,
    salonId: salon.id,
    salonName: salon.name,
    staffId: specialist.id,
    staffName: specialist.name,
    startsAt,
    confirmation,
    status: confirmation === "manual" ? "pending" : "confirmed",
    services,
    zone: "Asia/Colombo",
    createdAt: colomboNowIso(),
  };
  bookedAppointments.push(appointment);
  json(response, 200, { appointment });
  return true;
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((request, response, next) => {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(key, value);
  }
  next();
});

app.use((request, response, next) => {
  if (!wantsHttpsRedirect(request)) {
    next();
    return;
  }
  const host = request.headers.host || "localhost";
  response.writeHead(301, { Location: `https://${host}${request.originalUrl || request.url || "/"}` });
  response.end();
});

app.get("/health", (_request, response) => {
  send(response, 200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, JSON.stringify({ ok: true }));
});

app.use(async (request, response, next) => {
  try {
    const url = new URL(request.originalUrl || request.url || "/", `https://${request.headers.host || "localhost"}`);
    if (await handleGate(request, response, url)) return;
    if (await handleNoticesApi(request, response, url)) return;
    if (await handleAccountApi(request, response, url)) return;
    if (await handleSalonApi(request, response, url)) return;
    if (await handleAppointmentApi(request, response, url)) return;
    next();
  } catch (error) {
    next(error);
  }
});

app.use(async (request, response, next) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, { Allow: "GET, HEAD" }, "Method Not Allowed");
      return;
    }

    const decoded = decodeURIComponent(request.path || "/");
    const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
    const candidate = path.normalize(path.join(ROOT, relative));

    if (!candidate.startsWith(ROOT) || isBlocked(path.relative(ROOT, candidate))) {
      send(response, 403, { "Content-Type": "text/plain; charset=utf-8" }, "Forbidden");
      return;
    }

    if (existsSync(candidate) && statSync(candidate).isFile()) {
      await sendFile(response, candidate);
      return;
    }

    if (SPA_ROUTES.has(request.path) || !path.extname(request.path || "")) {
      await sendFile(response, path.join(ROOT, "index.html"));
      return;
    }

    send(response, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not Found");
  } catch (error) {
    next(error);
  }
});

app.use((_error, _request, response, _next) => {
  send(response, 500, { "Content-Type": "text/plain; charset=utf-8" }, "Internal Server Error");
});

seedDemoBookings();

app.listen(PORT, HOST, () => {
  console.log(`Yamoo client listening on http://${HOST}:${PORT}`);
});
