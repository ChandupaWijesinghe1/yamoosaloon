const routes = new Map();
const listeners = new Set();
const guards = [];

function normalize(path) {
  if (!path) return "/";
  const clean = path.split("?")[0].split("#")[0];
  if (clean.length > 1 && clean.endsWith("/")) return clean.slice(0, -1);
  return clean || "/";
}

function compile(pattern) {
  const names = [];
  const source = normalize(pattern)
    .split("/")
    .map((part) => {
      if (part.startsWith(":") && part.length > 1) {
        names.push(part.slice(1));
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${source}$`), names };
}

function parseQuery(search) {
  const raw = String(search || "");
  const trimmed = raw.startsWith("?") ? raw.slice(1) : raw;
  return Object.fromEntries(new URLSearchParams(trimmed));
}

function incomingUrl(path) {
  try {
    return new URL(String(path), window.location.origin);
  } catch {
    return new URL(window.location.origin);
  }
}

export const router = {
  current: "/",
  params: {},
  query: {},

  register(path, render) {
    const key = normalize(path);
    routes.set(key, { render, pattern: key, ...compile(key) });
  },

  beforeEach(guard) {
    guards.push(guard);
    return () => {
      const index = guards.indexOf(guard);
      if (index >= 0) guards.splice(index, 1);
    };
  },

  applyGuards(path) {
    let next = normalize(path);
    for (const guard of guards) {
      const result = guard(next, this.current);
      if (typeof result === "string" && normalize(result) !== next) {
        next = normalize(result);
      }
    }
    return next;
  },

  match(path = this.current) {
    const normalized = normalize(path);
    let fallback = null;
    for (const [key, route] of routes) {
      if (key === "*") {
        fallback = route;
        continue;
      }
      const found = normalized.match(route.regex);
      if (found) {
        const params = Object.fromEntries(
          route.names.map((name, index) => [name, decodeURIComponent(found[index + 1])]),
        );
        return { render: route.render, params, path: normalized };
      }
    }
    return { render: fallback?.render || null, params: {}, path: normalized };
  },

  resolve(path = window.location.pathname) {
    return this.match(path).render;
  },

  navigate(path, { replace = false } = {}) {
    const incoming = incomingUrl(path);
    const guardedPath = this.applyGuards(incoming.pathname);
    const search = guardedPath === normalize(incoming.pathname) ? incoming.search : "";
    const display = guardedPath + search;
    const same = guardedPath === this.current && search === window.location.search;

    this.current = guardedPath;
    this.query = parseQuery(search);
    this.params = this.match(guardedPath).params;

    if (replace || !same) {
      if (replace) window.history.replaceState({ path: display }, "", display);
      else window.history.pushState({ path: display }, "", display);
    }
    this.render();
  },

  render() {
    const match = this.match(this.current);
    listeners.forEach((fn) => fn(this.current, match));
    return match.render?.(match.params) ?? "";
  },

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  start() {
    const initial = this.applyGuards(window.location.pathname);
    this.current = initial;
    this.query = parseQuery(window.location.search);
    this.params = this.match(initial).params;
    const display = initial + (initial === normalize(window.location.pathname) ? window.location.search : "");
    if (display !== window.location.pathname + window.location.search) {
      window.history.replaceState({ path: display }, "", display);
    }
    window.addEventListener("popstate", () => {
      const next = this.applyGuards(window.location.pathname);
      const search = next === normalize(window.location.pathname) ? window.location.search : "";
      if (next + search !== window.location.pathname + window.location.search) {
        window.history.replaceState({ path: next + search }, "", next + search);
      }
      this.current = next;
      this.query = parseQuery(search);
      this.params = this.match(next).params;
      this.render();
    });
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[data-link]");
      if (!link || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      this.navigate(link.getAttribute("href"));
    });
    this.render();
  },
};
