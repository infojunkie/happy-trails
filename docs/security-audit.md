# Happy Trails — Security Audit

**Date:** 2026-11-09
**Commit:** `624a30b` (v2.8.0)
**Scope:** the HTTP API and server-side code in `src/server/`, the client's DOM
handling in `src/client/`, static file serving, and the Docker/runtime
configuration. Database and Synology access were replaced with the project's
existing test fixtures; no production NAS or PostgreSQL instance was touched.

**Method:** manual review of every route and service, followed by dynamic
tests against the real Express app (`createApp`) and the real
`PlaybackService`/`UserSessionStore` where their behaviour matters. The
reproduction suite is `tests/security/security.test.ts` and runs with
`npm run test:security`.

---

## Executive summary

> **Remediation status:** F1 and F2 have been fixed in the working tree. F1
> uses an exact allow list of app origins (`DSM_FRONTEND_ALLOWED_ORIGINS`) plus
> a port-only `DSM_FRONTEND_URL`; `Origin` and `Referer` are no longer read.
> F2 adds per-IP and per-account login rate limiting with `429`/`Retry-After`.
> Their tests now assert the secure behaviour and guard against regression.
> The findings below record the original issues and the fixes.

| ID | Finding | Severity |
|----|---------|----------|
| F1 | Open redirect via attacker-controlled `Origin`/`Referer`/`Host` on `/play/*` (origin-based `DSM_FRONTEND_URL` deployments) — **fixed** | **Medium** |
| F2 | Login has no rate limiting or lockout; each attempt creates a fresh DSM client, so the built-in backoff never applies across attempts — **fixed** | **Medium** |
| F3 | State-changing `GET /play/:key` and `GET /play/track/:id` have no CSRF token or Origin/Referer check; `SameSite=Lax` still sends the cookie on cross-site top-level navigation | **Low** |
| F4 | `/api/status` and 503 responses disclose raw internal error text (DB host/user/schema details) to unauthenticated clients | **Low** |
| F5 | No `X-Frame-Options` / `Content-Security-Policy`; the app (including its DSM sign-in dialog) can be framed | **Low** |
| F6 | Cover proxy relays any upstream `image/*` content type, including `image/svg+xml`; direct navigation executes SVG script in the app origin | **Low** |
| F7 | Session cookie is not `Secure` behind a TLS-terminating reverse proxy because `trust proxy` is not configured; no HSTS | **Low** |
| F8 | Malformed JSON bodies produce `500 Internal Server Error` instead of `400` and log a full stack trace | Informational |

No high or critical issues were found. The core controls are sound:
all SQL is parameterized, table identifiers are validated, the client builds
the DOM with `textContent`, server-rendered HTML is escaped, path traversal is
blocked, and authenticated fetch endpoints are not reachable cross-origin.
`npm audit --omit=dev` reports 0 advisories across 80 production dependencies.

---

## Threat model and assumptions

- The app is a read-only library browser. Album/artist/track metadata is
  intentionally public to anyone who can reach the HTTP port.
- Sign-in exists only to let a user hand albums to **their own** Synology
  Audio Station queue. A signed-in attacker gains nothing beyond what they can
  already do in DSM; the interesting attacker is therefore an unauthenticated
  network client or a malicious web page visited by a signed-in user.
- Synology service-account credentials (`DSM_USER`/`DSM_PASS`) are trusted
  configuration. Users' DSM passwords are held in process memory for the
  session lifetime so the DSM token can be renewed (documented in
  `src/server/userSessions.ts`).
- The database is read-only to the app: there is no insert/update/delete
  statement anywhere in `src/server/db.ts` or `src/server/sqlite.ts`.

---

## API inventory

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/status` | public | readiness, counts, version, `error`, `playbackEnabled` |
| GET | `/api/session` | cookie (optional) | `{ authenticated, account }` |
| POST | `/api/session/login` | public | JSON `{username,password}`; sets `mw_session` |
| POST | `/api/session/logout` | cookie | destroys the in-memory session |
| GET | `/api/genres` | public | genre + region facets |
| GET | `/api/albums` | public | `q`, `genre`/`region` (+ modes), `sort`, `offset`, `limit` |
| GET | `/api/albums/:key/cover` | public | proxied AudioStation cover (service account) |
| HEAD | `/api/albums/:key/artwork` | public | probes `Artwork.pdf` via FileStation |
| GET | `/api/albums/:key/artwork` | public | streams `Artwork.pdf`; forwards `Range` |
| GET | `/api/albums/:key/tracks` | public | PostgreSQL track query; `q` filters per track |
| GET | `/play/track/:id` | cookie → login redirect | queues one track in Audio Station |
| GET | `/play/:key` | cookie → login redirect | replaces the Audio Station queue |
| GET | `/*` | public | `express.static(public/)`; unknown `/api/*` → JSON 404 |

Album keys are `base64url(JSON [album, artist])` and are **not** secrets; they
can be built from the public `/api/albums` response. Nothing in the app treats
them as authorisation.

---

## Findings

### F1 — Open redirect in playback redirects (Medium) — **fixed**

**Where:** `src/server/app.ts:94-102` (`requestOrigin`), used at
`src/server/app.ts:532-533` and `609-610`; the resulting origin is formatted
into the redirect target by `src/server/playback.ts:45-55` and
`src/server/config.ts:169-195`, then sent at `src/server/app.ts:590` and `676`.

**What (original issue):** when `DSM_FRONTEND_URL` was configured in the
origin-relative form (`/`, `/audio`, `:5001`, `/audio:5001`), the playback
redirect was built from the request's `Origin`, then `Referer`, then `Host`
header. All three are attacker-controlled in at least one realistic path:

- A link on `https://evil.example` to
  `https://nas.example/play/<key>` is a top-level GET navigation. Browsers send
  `Referer: https://evil.example/`, so the 303 went to
  `https://evil.example/?launchApp=SYNO.SDS.AudioStation.Application`.
- A direct client can set `Host: evil.example`; behind a proxy that forwards
  arbitrary `Host`, that also changed the redirect.
- `Origin` was likewise honoured when present.

`requestOrigin` only required the value to parse as an `http(s)` URL; it did
not require it to match the app's own origin.

**Impact:** an attacker could make the trusted library URL redirect a signed-in
user to an attacker-controlled origin (phishing, malware, credential
harvesting). Because the same request also queues an album, the redirect was
not the only effect.

**Original proof:** `open redirect: /play/:key trusts Origin, Referer, and Host
for its redirect` asserted a 303 to `https://evil.example/...` for all three
headers using the real `PlaybackService.audioStationUrlFor`.

**Fix (implemented):** `DSM_FRONTEND_URL` now supports only a fixed absolute
URL or `:port` (path rewriting is gone), and `requestOrigin` no longer reads
`Origin` or `Referer`. It takes the request `Host` (falling back to
`X-Forwarded-Host` for proxies that rewrite it), normalizes it, and requires an
exact match against `DSM_FRONTEND_ALLOWED_ORIGINS`; the matched configured
origin supplies the scheme, and the `:port` value rewrites the port. An
unlisted host yields no target and the request fails closed (503). The allow
list is validated at startup, and a `:port` configuration without one refuses
to start.

**Regression test:** `F1 fix: /play/:key redirects only to allow-listed app
origins` proves both allowed hosts redirect to their own frontend despite an
evil `Origin`/`Referer`, an `X-Forwarded-Host` fallback still resolves through
the same list, and an unlisted `Host` yields 503 without queueing playback.

---

### F2 — No login throttling; per-attempt DSM client defeats backoff (Medium) — **fixed**

**Where:** `src/server/app.ts:257-295`,
`src/server/userSessions.ts:53-76`, `src/server/dsm.ts:249-274`.

**What (original issue):** `POST /api/session/login` performed no rate
limiting, account lockout, CAPTCHA, or delay. Each call to
`UserSessionStore.login` constructs a **new** `DsmClient`, and the 30-second
login backoff in `DsmClient.ensureSession` is per-instance state — so it never
applied to subsequent login attempts. The endpoint also distinguishes
"incorrect username or password" from disabled / not-allowed / 2FA-required
accounts (`src/server/app.ts:159-189`), which assists account probing. Because
every attempt is proxied to the NAS, an attacker could also deliberately
trigger Synology's auto-block and lock out the legitimate owner.

**Impact:** password spraying / credential stuffing against DSM accounts, and
an amplification vector against the NAS. Severity depends on exposure; a
LAN-only deployment is lower risk.

**Original proof:** `brute force: /api/session/login accepts unlimited
attempts` sent 30 failed logins and asserted every one reached the login
handler and returned 401 with no 429.

**Fix (implemented):** `src/server/loginRateLimit.ts` adds an in-memory
fixed-window limiter. Failures are counted per client IP and per account
(case-insensitively); an attempt is rejected with `429` and `Retry-After` as
soon as either bucket reaches its limit, before any DSM request is made. A
successful sign-in clears that account's failures; DSM transport errors are
not counted, so a NAS outage cannot lock users out. Limits default to 20
failures per IP and 5 per account in a 15-minute window and are configurable
with `LOGIN_RATE_LIMIT_MAX`, `LOGIN_ACCOUNT_LIMIT_MAX`, and
`LOGIN_RATE_LIMIT_WINDOW_MS`. The new `TRUST_PROXY` setting configures Express
`trust proxy` so `req.ip` sees the real client behind a reverse proxy (and
fixes `req.secure` for F7 as a side effect). The limiter state is in memory and
bounded to 10,000 keys.

**Regression tests:** `POST /api/session/login rate limits per account and per
IP` and `TRUST_PROXY uses X-Forwarded-For for per-IP limits` in
`tests/api/login-rate-limit.test.ts` (plus unit tests for expiry, per-account
reset, and case folding), and `F2 fix: /api/session/login rate limits repeated
failures` in the security suite.

---

### F3 — CSRF on state-changing playback GETs (Low)

**Where:** `src/server/app.ts:530-691`; cookie policy
`src/server/userSessions.ts:96-113`.

**What:** `GET /play/:key` and `GET /play/track/:id` change server-side state
(replace the Audio Station web-player queue). They accept any request bearing
the session cookie and check neither an anti-CSRF token nor `Origin`/`Referer`.
The cookie is `SameSite=Lax`, which is not sufficient here: Lax cookies **are**
sent on cross-site top-level GET navigations. Any web page can therefore link
a signed-in user to `/play/<key>`; the album key is public (derivable from
`/api/albums`).

**Impact:** an attacker can change the music queued on the victim's Audio
Station, including over a shared/office NAS. Playback state is not sensitive
and no library data is modified, hence Low.

**Proof:** `CSRF: a cross-site top-level GET queues an album without a token`
performs the request with only a cookie and `Referer:
https://attacker.example/page`, and asserts that `playAlbum` and
`playTrack` were invoked.

**Fix:** make playback `POST` with a CSRF token, or at minimum reject requests
whose `Sec-Fetch-Site` is `cross-site` and whose `Origin`/`Referer` does not
match the request host. `SameSite=Strict` on the session cookie would also
mitigate, at the cost of breaking the deep-link login flow.

---

### F4 — Internal error disclosure on unauthenticated endpoints (Low)

**Where:** `src/server/library.ts:46-60` and `109-111`/`131-135` (raw
`describeError(error)` stored in `lastError`);
`src/server/app.ts:140-145`, `244-246`.

**What:** `GET /api/status` returns `library.status()` verbatim, including
`error`. When the database is unreachable or a query fails, `lastError` is the
raw driver message, e.g. `connect ECONNREFUSED 10.1.2.3:5432`,
`password authentication failed for user "postgres"`, or
`relation "public.music" does not exist`. `/api/genres` and `/api/albums`
repeat the same string in their 503 body. No authentication is required.

**Impact:** leaks internal hostnames/IPs, database usernames, and schema
details to any network client; useful reconnaissance.

**Proof:** `info leak: /api/status exposes raw library errors unauthenticated`
simulates a PostgreSQL connection error through the fixture and asserts it is
returned by both `/api/status` and the 503 body of `/api/albums`.

**Fix:** log the detailed error server-side and expose only a stable,
generic message plus a "not ready" flag to clients.

---

### F5 — No clickjacking or content-security protection (Low)

**Where:** `src/server/app.ts:231-235` sets only
`X-Content-Type-Options` and `Referrer-Policy`. No `X-Frame-Options` or
`Content-Security-Policy` is emitted anywhere (`grep` finds no `helmet`,
`frame-ancestors`, or CSP header).

**What:** the application — including the modal that asks for DSM credentials
(`public/index.html`, `#login-dialog`) — can be embedded in a cross-origin
iframe. There is also no CSP as a second line of defence for the one HTML
injection path that exists today (F6).

**Impact:** UI-redressing attacks against sign-in/playback controls; missing
CSP increases the impact of any future XSS.

**Proof:** `headers: HTML pages have no clickjacking or CSP protection`
asserts that `/` and `/index.html` lack `x-frame-options`,
`content-security-policy`, and `strict-transport-security`.

**Fix:** set `Content-Security-Policy: frame-ancestors 'none'` (and/or
`X-Frame-Options: DENY`), and add a restrictive CSP
(`default-src 'self'` plus whatever the inline error pages need).

---

### F6 — Upstream `image/*` content-type passthrough, including SVG (Low)

**Where:** `src/server/dsm.ts:342-356` accepts any `image/*` response from
AudioStation and keeps its content type; `src/server/app.ts:390-392` passes it
to `res.type()`.

**What:** the cover proxy does not allow-list image formats. If the DSM cover
API returns `image/svg+xml` (or an attacker can plant such a cover in the
media library), the app serves it from its own origin. An SVG opened by direct
navigation executes embedded script in the application origin, where it can
call the JSON API with the user's cookie (the cookie is `HttpOnly`, so it can
issue requests but not read the cookie). No CSP is present to stop it.

**Impact:** stored XSS in the app origin, conditional on the NAS returning an
SVG content type.

**Proof:** `stored XSS: cover endpoint relays an upstream image/svg+xml body`
asserts that an SVG with an `onload` handler is returned byte-for-byte with
`Content-Type: image/svg+xml`.

**Fix:** allow-list `image/jpeg`, `image/png`, `image/gif`, and `image/webp`,
falling back to `application/octet-stream`; add the CSP from F5.

---

### F7 — Session cookie not `Secure` behind TLS termination; no HSTS (Low)

**Where:** `src/server/userSessions.ts:96-104` (`secure: req.secure`).
`TRUST_PROXY` now exists and is passed to `app.set('trust proxy', ...)`
(`src/server/app.ts`), but it defaults to off.

**What:** Express computes `req.secure` from the socket unless `trust proxy`
is enabled. In the documented Docker deployment the app listens on plain HTTP
and is commonly placed behind a TLS-terminating reverse proxy; with the default
configuration `req.secure` is `false` even for HTTPS clients, so `mw_session`
is issued without the `Secure` attribute and the browser will also send it
over plain HTTP if such an endpoint exists. No `Strict-Transport-Security`
header is set.

**Impact:** session-cookie exposure on any plaintext path to the app.

**Mitigation:** set `TRUST_PROXY` to the proxy's address/CIDR (or `loopback`),
which also gives login rate limiting the real client IP. The test below still
documents the default (unconfigured) behaviour.

**Proof:** `cookie: no Secure flag behind a TLS-terminating proxy` sends
`X-Forwarded-Proto: https` and asserts the `Set-Cookie` header lacks `Secure`;
it also verifies the store does consult `req.secure`. The companion test
`cookie: session cookie is HttpOnly and SameSite=Lax` records the flags that
are correct.

**Fix:** set `TRUST_PROXY` to the exact proxy address/CIDR (do not set it to
`true` on an internet-reachable port), then keep `secure: req.secure`. Add
HSTS at the proxy or app. Consider the `__Host-` cookie prefix.

---

### F8 — Malformed JSON becomes HTTP 500 (Informational)

**Where:** `src/server/app.ts:705-709`.

**What:** `body-parser` throws a `SyntaxError` with `status = 400` and
`type = 'entity.parse.failed'`, but the error handler ignores both and returns
500 with a generic message while logging the full stack.

**Impact:** no data exposure in the response, but incorrect status codes break
clients and turn ordinary bad input into error-level log noise (alert fatigue).

**Proof:** `error handling: malformed JSON returns 500 instead of 400`.

**Fix:** in the error handler, use `error.status`/`error.statusCode` when it is
a 4xx and avoid logging the stack for client errors.

---

## Hardening observations (not individually tested)

- **DSM TLS verification is off by default** (`DSM_TLS_REJECT_UNAUTHORIZED`
  defaults to `false`, `src/server/config.ts:207-210`; `.env.example` also
  sets `false`). The DSM login sends the user's password as a query parameter
  (`src/server/dsm.ts:276-284`), so credentials can be intercepted by anyone
  who can MITM the NAS connection. Prefer trusting the NAS certificate; if
  that is impossible, scope the exception to the NAS host/IP.
- **No rate limits on expensive unauthenticated endpoints.**
  `/api/albums/:key/tracks` issues a PostgreSQL query and
  `/api/albums/:key/cover` issues a DB lookup plus a DSM request for every
  uncached album. A client can cycle through the public album list to load the
  NAS and database. Add request throttling and/or a small negative cache keyed
  by cover path (the current cache is bounded at 500 entries by default).
- **Cover cache memory bound.** `COVER_CACHE_ENTRIES` (500) × the 20 MB
  response cap (`src/server/dsm.ts:5`) is a theoretical worst case of 10 GB
  for crafted/large covers. Consider a smaller per-cover byte cap.
- **Playback error pages echo `error.message`** to the authenticated user
  (`src/server/app.ts:592-603`, `678-689`). It is correctly HTML-escaped, but
  it can include PostgreSQL error text; return a generic message.
- **In-memory session store**: sessions vanish on restart and are not shared
  across replicas. This is a availability/operational note, not a
  confidentiality issue.
- **No CORS headers** are emitted, which is correct for this same-origin app;
  keep it that way rather than adding a permissive `Access-Control-Allow-Origin`.
- **No `Cache-Control` on static assets** beyond `maxAge: 0`; no sensitive
  content is cached by shared proxies because `/api` is `no-store` and
  `/play` is `no-store`.

---

## Verified controls (positive findings)

These were checked because they are the most common failure modes for this
kind of app, and the test suite includes regression checks for the first
three:

- **SQL injection:** PostgreSQL queries use bind parameters
  (`src/server/db.ts:58-151`); SQLite queries bind every value
  (`src/server/sqlite.ts:660-813`); the only interpolated identifiers come
  from a static field map or are validated as plain identifiers at startup
  (`src/server/config.ts:33-39`). FTS5 phrases are quoted and bound
  (`src/server/sqlite.ts:283-286`). Test: `SQL injection payloads in q, genre,
  region, and album key are inert`.
- **Path traversal:** the only files served from disk are under `public/`,
  via `express.static`; album keys are decoded and used only as lookup keys,
  never as paths. Test: `path traversal: the static handler does not serve
  files outside public/`.
- **Server-side XSS:** `playErrorPage` escapes title, message, and the URL with
  `escapeHtml` (`src/server/app.ts:147-222`). Test: `XSS: playback error pages
  HTML-escape the DSM error message`.
- **Client-side XSS:** the client never uses `innerHTML`/`outerHTML`/
  `insertAdjacentHTML`/`eval`; `el()` assigns text through `textContent` and
  attributes through `setAttribute` (`src/client/dom.ts:15-33`); links are
  built with `encodeURIComponent`.
- **Authorisation:** playback endpoints require a live server-side session;
  session IDs are 256-bit random (`src/server/userSessions.ts:69`) and looked
  up in a `Map`. There is no session fixation path.
- **CSRF for JSON endpoints:** login/logout require/are protected by
  `SameSite=Lax` + `application/json` (a cross-site HTML form cannot send
  JSON, so a preflighted request is required and no CORS permission exists).
- **SSRF:** no user input reaches an outbound URL. DSM/FileStation targets come
  from configuration; cover and artwork paths come from the trusted index.
- **Resource limits:** JSON bodies 16 KB (`src/server/app.ts:237`), search text
  200 chars, page size 1–200, offset ≤ 1,000,000, ≤ 50 facet values, FTS
  fragments shorter than 3 chars fall back to a bound `instr` scan.
- **HTTP response headers:** `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Powered-By` disabled
  (`src/server/app.ts:229-235`), `Cache-Control: no-store` on `/api`.
- **Packaging:** the Docker image runs as the unprivileged `node` user and does
  not bake in `.env`; `.env` is gitignored and was never committed.
- **Dependencies:** `npm audit --omit=dev` → 0 vulnerabilities (80 production
  packages).

---

## Running the proof-of-vulnerability tests

```bash
npm run test:security
```

The suite sets `DSM_URL`, `DSM_FRONTEND_URL=:443`,
`DSM_FRONTEND_ALLOWED_ORIGINS`, `DSM_USER`, and `DSM_PASS` before importing the
server modules, starts the real Express app with the fixture services, and
uses raw `node:http` requests where header control (`Host`, `Referer`,
`X-Forwarded-Host`) or dot-segment paths are required.

The F1 and F2 tests now assert the fixed behaviour and guard those designs.
The remaining tests intentionally assert the current insecure behaviour; each
test names its finding in `docs/security-audit.md`. They are not part of
`npm test`; when another finding is remediated, invert its assertion and move
the test into the regular suite so the fix is protected.

---

## Limitations

- No live Synology DSM or PostgreSQL instance was available; DSM responses and
  database rows are fixture-controlled. F6 in particular depends on what a
  real AudioStation cover endpoint returns.
- Browser-level behaviour (SameSite cookie sending, SVG script execution,
  clickjacking) is asserted from the HTTP contract, not driven through a real
  browser. The Playwright harness could be extended for that.
- `npm audit` reflects the advisory database at audit time and only production
  dependencies.
