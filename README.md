# Yamoo client

Vanilla HTML/CSS/JS client. The browser bundle has no CDN scripts. A small Express process in `server.js` serves the files, applies security headers, and (locally / on Railway) hosts same-origin mock Yaamo APIs.

## Run locally

```bash
npm install && npm start
```

Open [http://localhost:4173](http://localhost:4173). Node 20+ is required. Railway uses the same `start` script and `$PORT`; HTTPS is terminated at the proxy. In production the server redirects `http` (`X-Forwarded-Proto`) to `https` and sends HSTS.

## Yaamo API endpoints consumed

Same-origin `fetch` with optional `Authorization: Bearer`. Paths below are also accepted under `/api/…`.

| Method | Path | Used for |
| --- | --- | --- |
| GET, POST | `/auth/gate` | Community + privacy agreement gate |
| GET | `/clients/{id}` | Account profile (`{id}` or `me`) |
| GET | `/clients/me` | Profile fallback |
| PUT | `/clients/update/name` | Save display name |
| POST | `/clients/me/phone/otp` | Send phone OTP |
| POST | `/clients/me/phone/verify` | Confirm phone OTP |
| POST | `/clients/me/email/otp` | Send email OTP |
| POST | `/clients/me/email/verify` | Confirm email OTP |
| POST | `/support/tickets` | Support ticket |
| POST | `/account/deletion` | Close / delete account |
| GET | `/saloon-owners` | Explore / discovery list (`q`, `tag`) |
| GET | `/feed/explore` | Featured banners + feed |
| GET | `/feed/salon/{id}` | Salon detail + posts |
| GET | `/services/owner/{id}` | Menu / services (also `/services`, `/list` suffixes) |
| GET | `/reviews/salon/{id}` | Salon reviews |
| PUT | `/reviews/salon/{id}` | Submit salon review |
| PUT | `/reviews/service/{id}` | Submit service review |
| POST | `/feed/posts/{id}/report` | Report a post |
| POST | `/reports` | Report salon / review (`/reports/{type}/{id}` fallback) |
| GET | `/saved-salons` | Saved salons |
| POST | `/saved-salons` | Save a salon |
| DELETE | `/saved-salons/{id}` | Unsave a salon |
| GET | `/notices` | Notification inbox |
| GET | `/notices/unread-count` | Unread badge |
| POST | `/notices/read-all` | Mark all read |
| POST | `/notices/{id}/read` | Mark one read |
| GET | `/appointments/availability` | Staff + Colombo slots |
| POST | `/appointments/book` | Confirm booking |
| POST | `/appointments/event-request` | Custom event request |
| GET | `/appointments/mine` | My bookings (`GET /appointments` fallback) |
| PUT | `/appointments/cancel/{id}` | Cancel (`PUT /appointments/{id}/cancel` fallback) |
| PUT | `/appointments/{id}/proposal/accept` | Accept time proposal |
| PUT | `/appointments/{id}/proposal/decline` | Decline time proposal |

`GET /health` is a Railway health check, not a Yaamo API.

## Third-party inventory (100% compliant)

**Browser:** no npm packages, no Google Fonts, no Font Awesome, no CDNs. Scripts, styles, icons, and fonts are same-origin. CSP: `script-src 'self'` (no `'unsafe-inline'` / `'unsafe-eval'`).

**Fonts (SIL Open Font License 1.1 — bundling permitted):**

| Font | License file |
| --- | --- |
| DM Sans | `public/assets/fonts/OFL-DMSans.txt` |
| Manrope | `public/assets/fonts/OFL-Manrope.txt` |
| Noto Sans Sinhala | `public/assets/fonts/OFL-NotoSansSinhala.txt` |

**Node host (runtime only):** `express@4.22.3` (MIT). Transitive tree is 67 packages: 64 MIT, 2 ISC (`inherits`, `setprototypeof`), 1 BSD-3-Clause (`qs`). All OSI-approved permissive licenses. No GPL/AGPL. `npm audit` reports 0 vulnerabilities at install.

| Direct dependency | License | Role |
| --- | --- | --- |
| express | MIT | Static + mock API server |

The client UI itself remains free of third-party JavaScript.
