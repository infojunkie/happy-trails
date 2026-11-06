# Happy Trails

A small, read-only web app for browsing the music tables of the Synology `mediaserver`
PostgreSQL database. Albums are grouped by album title and album artist, with
multi-CD variants merged at their ` // <disc label>` suffix, sorted by their
most recent upload date, and filterable with separate genre and country/region
facets built from the comma-separated `genre` column.

- **Backend:** Node.js + Express + `pg` + the built-in `node:sqlite` module, written in TypeScript.
- **Frontend:** vanilla TypeScript (no framework), compiled to ES modules.
- No database migrations and no write queries.

## Features

![Screenshot](docs/screenshot.png)

- Album grid sorted by latest upload date (`MAX(date)`).
- Multi-CD albums whose titles differ only by a whitespace-separated
  ` // <disc label>` suffix are merged into one album; the original titles
  (including the labels) remain searchable.
- Genre facet with album counts, facet search, and multi-select.
- Country and region tags in the genre column (Brazil, France, Corsica,
  Catalonia, …) are detected and exposed as a separate **Regions** facet, with
  their own filter. The genre facet contains only non-location tags.
- Each facet has **Match any** / **Match all** modes. Any is the default and
  matches albums carrying at least one selected tag; All requires every
  selected tag. The two facets are combined with AND.
- Free-text album/artist search with case-, accent-, and ligature-insensitive
  matching (`Soren` finds `Søren`, `caetera` finds `cætera`, `Bjork` finds
  `Björk`). Track-level artists are searchable too.
- Album and artist names are search shortcuts in cards and in the album dialog;
  genre tags activate the genre facet and region tags activate the region
  facet everywhere. Name links clear both filters, while tag chips keep the
  current search query.
- Multi-artist values are parsed into individual artists, including
  comma-separated lists; a configurable exception list keeps names such as
  `Earth, Wind & Fire` together. Each detected name is its own search link in
  cards, the dialog header, and track artist lines.
- The server checks for database changes every 60 seconds by default and
  silently rebuilds the snapshot when needed. The header **Refresh** control
  enables when a newer snapshot is available and reloads the current view; it
  never triggers a rebuild itself.
- Additional sort orders: artist A–Z, album A–Z, and release year.
- Album dialog with the full track list, duration, sample rate, and bitrate.
  Merged multi-CD albums group tracks under their original disc labels, since
  disc numbers frequently collide across the source titles.
- Album artwork from Synology AudioStation, proxied and cached by the server.
  Albums without artwork keep the generated gradient/initials cover.
- Sign in with your own Synology account, then **Play** hands an album to
  Audio Station: the server replaces the Audio Station web-player queue with
  the album's tracks and opens Audio Station. No audio player lives in this app.
  Play controls are hidden until the app session is authenticated.
- Shareable URL state (`?genre=Jazz&genreMode=all&region=France&q=...&sort=artist`).
- Light/dark colour schemes, keyboard navigation, `/` focuses search.
- Responsive layout for narrow screens.

## Requirements

- Node.js 24 or newer (the server uses the built-in `node:sqlite` module).
- Read access to a PostgreSQL database containing the `music` table described
  by [`music.sql`](docs/music.sql).
- Optional: read access to the `track` table and a Synology DSM URL for Audio
  Station playback. A DSM service account is optional and used only for album
  covers; users sign in with their own account to play.

## Quick start

```bash
cd happy-trails
npm install
cp .env.example .env   # then edit the connection settings
npm run build
npm start
```

Open <http://127.0.0.1:3000>.

The `.env` in this checkout is already configured for the `mediaserver`
database on `rokanan`; the password is taken from `~/.pgpass` by
`node-postgres`, so no secret is stored in the file.

The server also reads the workspace-level `../.env`, where the existing
Synology settings live as `DSADDR` / `DSUSER` / `DSPASSWD` (or set `DSM_URL` /
`DSM_USER` / `DSM_PASS` in this app's `.env`):

- `DSM_URL` (or `DSADDR`) is required for user sign-in and playback.
- `DSM_USER` / `DSM_PASS` are an optional service account used only for album
  covers. Users sign in with their own DSM account in the app to play.

Without a DSM URL, the app still runs with generated covers and no Play links.

For development, run the TypeScript client watcher and the server with
auto-restart:

```bash
npm run dev
```

`npm run dev` compiles the client into `public/client/` and starts the API with
`tsx watch`. Other useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run build` | Build server (`dist/`) and client (`public/client/`) |
| `npm run typecheck` | Type-check both targets without emitting |
| `npm start` | Run the built server |
| `npm run dev` | Watch client and server |

## Docker

Build the image (the app, server, and compiled client are all included; `.env`
is deliberately **not** baked into it):

```bash
docker build -t happy-trails .
```

If Docker's embedded DNS is unreliable on the build host, build with
`docker build --network=host -t happy-trails .`.

Run it with the environment file mounted read-only:

```bash
docker run --rm -p 3000:3000 \
  --add-host rokanan:192.168.0.2 \
  -v "$PWD/.env:/app/.env:ro" \
  -v "$HOME/.pgpass:/home/node/.pgpass:ro" \
  happy-trails
```

Open <http://localhost:3000>.

Notes:

- The mounted `.env` is read from `/app/.env`. The container forces
  `HOST=0.0.0.0` and defaults `PORT=3000`, overriding those values in `.env`;
  override the port with `-e PORT=8080` and map `-p 8080:8080`.
- `~/.pgpass` is not part of the image. Either mount it as shown above, or put
  `PGPASSWORD` / `DATABASE_URL` in the mounted `.env`.
- `rokanan` is defined in this host's `/etc/hosts`, which Docker containers do
  not inherit. The `--add-host` flag above supplies it (use the NAS IP); using
  `PGHOST` with the IP directly, or `--network host` on Linux, also works.
- The mounted `.env` must be readable by the container's `node` user (UID
  1000); mode `644` is sufficient. The same applies to a mounted `.pgpass` if
  the host user does not have UID 1000.
- The image runs as the unprivileged `node` user and health-checks
  `/api/status`.

## Configuration

All variables are optional; see [`.env.example`](.env.example).

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | — | Full libpq URL. If unset, standard `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` apply. |
| `HOST` | `127.0.0.1` | Interface to bind. Use `0.0.0.0` to expose the app on the LAN. |
| `PORT` | `3000` | HTTP port. |
| `MUSIC_SCHEMA` | `public` | Schema containing the tables. Must be a plain identifier. |
| `MUSIC_TABLE` | `music` | Table to read. Must be a plain identifier. |
| `TRACK_TABLE` | `track` | Table used to map a music path to an AudioStation cover id. |
| `DSM_URL` | — | Synology DSM base URL; required for user sign-in and album covers. Falls back to `DSADDR`. |
| `DSM_FRONTEND_URL` | value of `DSM_URL` | Synology DSM frontend URL; used for playback button redirection. Falls back to value of `DSM_URL` / `DSADDR`. |
| `DSM_USER` / `DSM_PASS` | — | Optional service account used only for album covers. Falls back to `DSUSER` / `DSPASSWD`; playback uses each user's own sign-in. |
| `DSM_TLS_REJECT_UNAUTHORIZED` | `false` | Verify the NAS TLS certificate (the stock certificate is self-signed). |
| `DSM_TIMEOUT_MS` | `10000` | Timeout for Synology requests. |
| `COVER_CACHE_TTL_MS` | `86400000` | Server-side cover cache TTL. |
| `COVER_CACHE_ENTRIES` | `500` | Maximum cached covers (LRU); `0` disables the cache. |
| `LIBRARY_CHECK_MS` | `60000` | How often the `music` table is checked for changes; a detected change triggers a silent rebuild. `LIBRARY_REFRESH_MS` is accepted as a legacy fallback. |
| `PAGE_SIZE` | `48` | Default albums per page. |
| `MAX_PAGE_SIZE` | `200` | Upper bound accepted from clients. |
| `ARTIST_SEPARATOR_WORDS` | `feat., com, part., avec, with, et, e, con, vs., mit` | Additional comma-separated words that separate multiple artists; appended to the defaults. One-letter words match case-sensitively. |
| `ARTIST_EXCEPTIONS` | `Earth, Wind & Fire; Florence + The Machine; Simon & Garfunkel; Crosby, Stills, Nash & Young` | Additional artist names kept intact. Entries are separated by a vertical-bar character because the names contain commas; appended to the defaults. |
| `REGION_TAGS` | — | Additional genre tags to classify as countries/regions, separated by a vertical-bar character. ISO country names, macro-regions, and common subnational regions are detected automatically. |
| `DB_STATEMENT_TIMEOUT_MS` | `30000` | Per-query statement timeout. |

## How it works

The table holds >400k tracks across >30k raw album titles (before merging
multi-CD variants). Parsing the comma-separated `genre` column and grouping by
album in SQL on every request is slow (multi-second queries on the production
dataset), so the server aggregates the library at startup and rebuilds it
silently when its periodic change check detects new data (see below):

```sql
SELECT
  m.album AS album,
  COALESCE(NULLIF(m.album_artist, ''), NULLIF(m.artist, ''), 'Unknown Artist') AS artist,
  MIN(m.year) FILTER (WHERE m.year BETWEEN 1 AND 9999)::int AS year,
  COUNT(*)::int AS track_count,
  COALESCE(SUM(m.duration), 0)::int AS duration,
  to_char(MAX(m.date), 'YYYY-MM-DD"T"HH24:MI:SS') AS latest,
  STRING_AGG(DISTINCT m.genre, ',') AS genres,
  ARRAY_AGG(DISTINCT m.artist)
    FILTER (WHERE m.artist IS NOT NULL AND m.artist <> '') AS track_artists,
  MIN(m.path) AS cover_path
FROM "public"."music" m
WHERE m.fs_online IS NOT FALSE
GROUP BY 1, 2
```

The aggregated rows are parsed and written to an in-memory SQLite database.
The genre string is split on commas, trimmed, deduplicated, and stored in
`genres`/`album_genres` or `regions`/`album_regions`, depending on whether the
tag is a country/region name. Album titles are normalised by stripping a
whitespace-separated ` // ...` suffix; rows that end up with the same title and
artist are merged: track counts and durations are summed, the newest upload
date wins, and tags are unioned. Parsed artists and the original raw titles are
kept in `album_artists` and `album_sources`. The original raw titles and all
track-level artists are folded into the FTS search text, so labels such as
"The Vanilla Tapes" and guest artists still match. See
[`docs/sqlite-index.md`](docs/sqlite-index.md) for the schema and query
equivalents.

Country/region detection uses `Intl.DisplayNames` for ISO 3166 country names in
English, French, German, Spanish, Portuguese, and Italian, plus UN M49
macro-regions and a curated list of subnational regions, historical countries,
and spelling variants (`Corsica`, `Catalonia`, `Andalusia`, `Byelorussia`,
`Zaire`, …). Matching is exact after folding case, accents, and apostrophe
variants; `REGION_TAGS` adds site-specific names. Compound tags such as
`Jazz/Brazil` are still treated as genres because only whole tags are
classified.

Search folding lowercases the text, applies Unicode NFKD, removes combining
marks, and maps Latin letters that NFKD leaves intact (`ø`→`o`, `æ`→`ae`,
`œ`→`oe`, `ß`→`ss`, `ł`→`l`, `đ`→`d`, `ð`→`d`, `þ`→`th`, `ı`→`i`, and a few
others). The folded text is stored in `albums.search_text`, and queries are
folded with the same function, so accented and unaccented searches match in
either direction. `album_search` is an FTS5 table using the `trigram`
tokenizer, which preserves the old substring semantics; tokens shorter than
three characters fall back to an exact `instr()` scan.

Artist parsing applies to the effective album artist and to each track artist.
A punctuation run is a separator only when whitespace surrounds it, so
`Artist A & Artist B`, `Artist A / Artist B`, and `Artist A - Artist B` split,
while `AC/DC`, `Jay-Z`, and `R.E.M.` stay intact. A comma followed by
whitespace is also a separator, so `A, B, C` becomes three names; `A,B`
without the following space is left intact.

Names listed in `ARTIST_EXCEPTIONS` are masked before separator processing and
restored verbatim, so `Earth, Wind & Fire` and `Florence + The Machine` stay
intact. The defaults also include Simon & Garfunkel and Crosby, Stills, Nash &
Young; `ARTIST_EXCEPTIONS` adds more (separated by a vertical-bar character
because the names contain commas).
Matching is case-insensitive and whole-name only, but the original spelling is
preserved.

Words listed in `ARTIST_SEPARATOR_WORDS` are separators when they are
standalone words surrounded by whitespace; the defaults are
`feat., com, part., avec, with, et, e, con, vs., mit`, and
`ARTIST_SEPARATOR_WORDS` adds more. One-letter words are matched
case-sensitively, so `E Street Band` is not
split. Parsed names are exposed as
`artists` in the API and rendered as separate search links (joined by ` · `);
the original string remains in `artist`/`albumArtist`.

### Change detection and refresh

Instead of rebuilding on a fixed interval, the server runs a cheap aggregate
every `LIBRARY_CHECK_MS` (default 60s): row count, `MAX(date)`, `MAX(mdate)`,
`SUM(filesize)`, and `MAX(id)` over `fs_online` rows. If it differs from the
fingerprint stored with the current snapshot, the server rebuilds in the
background, swaps the snapshot atomically, and increments `libraryVersion`.
`/api/status` exposes `libraryVersion`, `lastCheckedAt`, `refreshing`, and
`checkIntervalMs`; `/api/albums` and `/api/genres` include the
`libraryVersion` of the snapshot they served.

The frontend polls `/api/status` every 30s (paused while the tab is hidden).
It compares the server's version with the version of the data it rendered.
When they differ, the header Refresh button lights up with a dot; clicking it
re-fetches genres and albums for the current search/filters (resetting
pagination to the first page), clears the track cache, and updates the loaded
version. It never triggers a rebuild. A failed rebuild keeps serving the old
snapshot, and the button stays disabled until a newer version exists.

The fingerprint catches inserts/deletes (count/id), uploads (`date`), and most
metadata/file changes (`mdate`/size). An update that changes none of those
fields would not be seen; a DB trigger or `pg_stat_user_tables` counters can be
added if that matters. The check is a cheap scan (sub-second); the rebuild
remains the ~6–8s operation.

Genres and regions are matched case-insensitively; region keys also fold
accents and apostrophe variants. Facet counts are the number of merged albums
carrying each tag. Each facet can match **any** or **all** selected tags; a
genre selection and a region selection are combined with AND. Sorting uses
precomputed dense ranks that reproduce the old `Intl.Collator` ordering,
including its case/accent-insensitive ties. Filtering, searching, and
pagination are single SQLite queries; the current dataset answers typical
searches in a few milliseconds.

Track lists are **not** cached: opening an album issues a parameterized,
index-backed query against `music` for every raw title merged into it, and
returns the current rows. The response carries each track's original title, so
the dialog can group merged CDs under their labels (`Main album`,
`The Vanilla Tapes`, `CD02 …`) instead of relying on disc numbers that often
repeat across the sources. The client caches responses for the lifetime of the
page.

Covers are fetched through the server; the optional cover service account is
never exposed to the browser. Each merged album keeps a representative file path (preferring the
main, unsuffixed source). When a cover is requested, the server resolves that
path to `track.id` — `music.id` uses a different sequence — and calls the
AudioStation cover API with `id=music_<track.id>` and `output_default=false`,
so albums without artwork produce a 404 instead of Synology's generic image.
The UI then keeps the generated gradient cover. Cover bytes are cached in a
bounded LRU (`COVER_CACHE_ENTRIES`) and served with a one-day browser cache;
the client requests them lazily as cards become visible.

### Sign-in and playback handoff

Users sign in with their own DSM account from the app's header. The browser
posts the username and password to `POST /api/session/login`; the server
verifies them with `SYNO.API.Auth` and keeps a `DsmClient` for that user in an
in-memory session (8 hour TTL), referenced by an HttpOnly `mw_session` cookie.
Passwords are never written to disk or returned to the browser; the in-memory
client retains them only so it can renew an expired DSM token. Signing out (or
restarting the server) drops the session. Accounts with two-factor
authentication are not supported.

Play links point at `GET /play/:key` in a new tab. The card Play chips and the
dialog Play button are only rendered while the app session is authenticated;
signing out removes them. Without a signed-in app session, the route queues
nothing and redirects to `/?login=1&play=…`; the app opens the sign-in dialog
and continues to playback after a successful sign-in. With a session,
the route resolves the album's source titles to AudioStation song ids by
joining `music` to `track` on `path`, ordered by source title, disc, and track.
It uses that user's DSM client to replace the Audio Station web-player queue
(`web_player.cgi` `method=updateplaylist`) with those `music_<track.id>` songs
and `play=true`. The existing queue length is read first and passed as
`limit`, so the queue is replaced instead of appended. The update call carries
the session token in an `X-SYNO-TOKEN` header (the query-string form is not
accepted), then the route redirects with `303` to
`<DSM>/?launchApp=SYNO.SDS.AudioStation.Application`.

The queued album belongs to the signed-in DSM user, so the browser must also be
signed into DSM (in that browser) as the same user for Audio Station to show
the queue. Browsers normally do not allow Audio Station to start audio without
a user gesture, so press the player's Play button once if playback does not
start by itself.

Notes on the data:

- "Latest upload date" uses `date`. `mdate` is the media server's modification
  time, which changes when files or metadata are touched and would make edited
  albums look newly added, so it is not used for the "Recently added" sort.
  Both columns are wall-clock `timestamp` values without a zone; they are
  displayed as recorded rather than converted between time zones.
- Tracks with `fs_online = false` are excluded.
- Albums with no `album_artist` fall back to the track artist; albums without an
  artist fall back to `Unknown Artist`; a missing/empty album title becomes
  `(Unknown Album)`.
- The multi-CD suffix must be preceded by whitespace. Titles that use `//`
  inline without spaces (there is one such title in the current library) are
  left untouched.
- Some genre values are inconsistent in the source data (for example
  `Bossa Nova`, `Bossa Nova. Jazz`, and `Bossa Nova+Jazz` are three genres).
  The facets mirror the data rather than trying to normalise those labels.
  Country/region detection also works on whole tags only, so `Jazz/Brazil`
  remains a genre even though `Brazil` alone is a region. Detection classifies
  tags individually rather than canonicalising them, so multilingual variants
  such as `Germany`/`Allemagne` can appear as separate region entries.

If the database is unavailable at startup, the HTTP server still starts and
returns an explanatory error; the UI retries automatically and the change
check keeps retrying in the background.

## API

All endpoints return JSON.

### `GET /api/status`

Index state and library totals. `libraryVersion` identifies the current
snapshot; clients compare it with the version of the data they loaded to decide
whether the Refresh control is enabled. `lastCheckedAt` and `refreshing`
describe the change-detection loop. `playbackEnabled` is true when a DSM URL is
configured, i.e. when users can sign in and use the Play links.

```json
{
  "ready": true,
  "albumCount": 33317,
  "trackCount": 409740,
  "libraryVersion": 1,
  "lastRefreshed": "2026-11-02T12:00:00.000Z",
  "lastCheckedAt": "2026-11-02T12:00:30.000Z",
  "refreshing": false,
  "checkIntervalMs": 60000,
  "error": null,
  "playbackEnabled": true
}
```

### `GET /api/genres`

All genres/regions and their album counts, sorted by count then name. `key` is
the normalised value accepted by the matching filter. `libraryVersion`
identifies the snapshot the counts came from.

```json
{
  "totalAlbums": 33317,
  "libraryVersion": 1,
  "genres": [{ "key": "jazz", "name": "Jazz", "albumCount": 8726 }],
  "regions": [{ "key": "ethiopia", "name": "Ethiopia", "albumCount": 42 }]
}
```

### `GET /api/albums`

| Parameter | Description |
| --- | --- |
| `genre` | Repeatable (`?genre=Jazz&genre=Rock`) or comma-separated. Matches albums containing any selected genre. |
| `genreMode` | `any` (default) or `all`; controls whether an album must contain any or all selected genres. |
| `region` | Repeatable or comma-separated. Matches albums containing any selected country/region tag. Combined with `genre` using AND. |
| `regionMode` | `any` (default) or `all`; controls whether an album must contain any or all selected regions. |
| `q` | Album, album-artist, and track-artist search (accent- and ligature-insensitive), up to 200 characters. |
| `sort` | `recent` (default), `artist`, `album`, or `year`. |
| `offset` | Default `0`. |
| `limit` | Default `48`, maximum `200`. |

The response's `libraryVersion` is the version of the snapshot used for the
listing; compare it with `/api/status` before deciding to reload.

```json
{
  "total": 8726,
  "offset": 0,
  "limit": 48,
  "libraryVersion": 1,
  "albums": [
    {
      "key": "WyJEYW5hbWEiLCJBcmF0IEtpbG8iXQ",
      "album": "Danama",
      "artist": "Arat Kilo",
      "artists": ["Arat Kilo"],
      "year": 2025,
      "trackCount": 12,
      "duration": 3046,
      "latest": "2026-10-13T19:25:15",
      "genres": ["Jazz", "Funk"],
      "regions": ["Ethiopia", "France"]
    }
  ]
}
```

`duration` is in seconds. `key` is an opaque base64url value identifying the
`(album, artist)` pair.

### `GET /api/albums/:key/tracks`

Returns the tracks of every raw album title merged into the album, ordered by
disc, track number, and title. `sourceAlbums` lists the raw titles in display
order, and each track's `sourceAlbum` identifies the title it came from. `key`
is the value from the album listing.

```json
{
  "album": "Danama",
  "artist": "Arat Kilo",
  "sourceAlbums": ["Danama"],
  "tracks": [
    {
      "id": 3644554,
      "title": "Nahel",
      "artist": "Arat Kilo",
      "artists": ["Arat Kilo"],
      "albumArtist": "Arat Kilo",
      "sourceAlbum": "Danama",
      "genre": "Jazz, Funk, Ethiopia, France",
      "year": 2025,
      "track": 1,
      "disc": 0,
      "duration": 235,
      "bitrate": 873000,
      "frequency": 44100
    }
  ]
}
```

### `GET /api/albums/:key/cover`

Returns the album artwork as `image/jpeg` or `image/png` with
`Cache-Control: private, max-age=86400` and an ETag. Returns `404` when the
album has no artwork, covers are not configured, or the path cannot be resolved
to an AudioStation song; `400` for an invalid album key. The client falls back
to its generated cover on any failure.

### Session endpoints

`GET /api/session` returns `{ "authenticated": boolean, "account": string | null }`
for the browser's current DSM session.

`POST /api/session/login` accepts JSON `{ "username": "...", "password": "..." }`,
verifies the credentials with Synology, and sets an HttpOnly `mw_session`
cookie. Returns `{ "authenticated": true, "account": "..." }`. Incorrect
credentials return `401` with an `error` message; 2FA accounts are rejected.
Passwords are not written to disk or echoed back.

`POST /api/session/logout` destroys the server-side session and clears the
cookie.

### `GET /play/:key`

The target of the album Play links; it is an HTML/redirect endpoint rather
than JSON. If the browser has no signed-in DSM session, it redirects to
`/?login=1&play=…` so the app can show the sign-in dialog. Otherwise it queues
every track of the album in Audio Station using that user's session (replacing
the web-player queue) and redirects `303` to the Audio Station app. An invalid
key shows an HTML `400` page; a playback failure shows an HTML error page with
a link to Audio Station. This route changes playback state and is meant to be
opened in a browser tab.

Errors use `{ "error": "message" }`. Unknown API routes return `404`;
an album key that cannot be decoded returns `400`; a valid key with no rows
returns `404`.

## Project layout

```
happy-trails/
├── src/
│   ├── server/
│   │   ├── app.ts        Express routes and static files
│   │   ├── artists.ts    Configurable multi-artist parser
│   │   ├── config.ts     Environment configuration
│   │   ├── covers.ts     Bounded cover cache and cover lookup
│   │   ├── db.ts         Pool and SQL queries
│   │   ├── dsm.ts        Synology login, covers, and web-player client
│   │   ├── index.ts      Startup and shutdown
│   │   ├── library.ts    Index lifecycle, rebuilds, and change detection
│   │   ├── playback.ts   Album-to-Audio-Station handoff
│   │   ├── regions.ts    Country/region tag detection
│   │   ├── search.ts     Folding, album keys, and title normalisation
│   │   ├── sqliteIndex.ts  SQLite schema, bulk load, and query layer
│   │   └── userSessions.ts  Per-browser DSM sign-in sessions
│   ├── client/
│   │   ├── api.ts        API client
│   │   ├── dom.ts        Safe createElement helper
│   │   ├── format.ts     Duration/date/bitrate formatting
│   │   └── main.ts       State, rendering, and events
│   └── shared/
│       ├── text.ts       Folding and region keys shared with the browser
│       └── types.ts      Shared API types and sort keys
├── public/
│   ├── index.html
│   └── styles.css        Compiled client files are written to public/client/
├── scripts/dev.mjs       Runs the client and server watchers
└── .env.example
```

## Operational notes

- The app only issues `SELECT` queries.
- The in-memory SQLite index for the current dataset takes roughly 6–8 seconds
  to build and settles around 300 MB of RSS (about 47 MB is the SQLite
  database; the rest includes the build's transient parsing structures and the
  cover cache). The change check runs every `LIBRARY_CHECK_MS` (default 60s)
  but only performs the full rebuild when the fingerprint changes.
- Open pages poll `/api/status` every 30s and reuse the old snapshot until the
  user clicks the enabled Refresh control. A rebuild failure leaves the old
  snapshot in place and is reported through `error`.
- Static files are served with ETags. JSON API responses use `Cache-Control:
  no-store`; cover images use a one-day private browser cache.
- Covers require the `track` table and, if configured, the optional DSM
  service account. Playback requires the `track` table, a `DSM_URL`, and each
  user's own DSM sign-in. If the NAS is unreachable, cover requests fail (the
  UI keeps its generated placeholders) and Play shows an HTML error page; the
  rest of the app is unaffected.
- Sign-in sessions live in server memory with an 8-hour TTL; restarting the
  server signs everyone out. Passwords are kept in memory (inside the user's
  DSM client) so expired tokens can be renewed, but are never written to disk,
  logged, or returned to the browser. Two-factor-authenticated DSM accounts
  are not supported.
- The sign-in form sends credentials to this Node server. It binds to
  `127.0.0.1` by default; if you expose it on a LAN, put it behind HTTPS (for
  example a reverse proxy) and do not send DSM passwords over plain HTTP.
- Playback replaces Audio Station's web-player queue under the signed-in user
  and supports up to 8192 songs. The browser opening Audio Station must also be
  signed into DSM as that same user to see the queue. Browsers may require one
  press of Audio Station's Play button because they block autoplay.
- `GET /play/:key` changes playback state. Do not expose it to untrusted users
  without adding authentication.
- TLS certificate verification for the NAS is disabled by default because DSM
  ships a self-signed certificate. Enable it with
  `DSM_TLS_REJECT_UNAUTHORIZED=true` if your NAS has a trusted certificate.
- The server binds to `127.0.0.1` by default because the catalogue may expose
  personal library metadata. Set `HOST=0.0.0.0` deliberately if LAN access is
  wanted.
