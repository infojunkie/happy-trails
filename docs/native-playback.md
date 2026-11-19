# Native playback

Status: **Stages 1–3.5 implemented** (stream proxy, footer player, album/queue
playback, and Play all result sources). Stage 4 (polish and hardening) remains.

## Goals

- Play music inside happy-trails without redirecting to the Synology Audio
  Station web app.
- Provide a fixed footer player with play/pause, restart, seeking, track
  metadata, and a replaceable play queue with reorder/delete.
- Keep playback running while the user searches, filters, opens album dialogs,
  or otherwise interacts with the backend.
- Keep the existing Audio Station handoff as an optional fallback for
  unsupported formats and as an escape hatch.

## Decisions (2026-11-15)

| Topic | Decision |
| --- | --- |
| Track Play | Queue the album **from the clicked track onward**. Album Play queues the whole album from track 1. If the album context cannot be loaded, queue just the clicked track. |
| Deleting the playing item | Advance to the next queue item; stop if the queue becomes empty. |
| Persistence | Restore the queue/current item/position after a reload, paused. |
| Crossfade | Not implemented. Use an instant switch between two preloaded `<audio>` elements. |
| Audio Station fallback | Retained, gated by `AUDIO_STATION_FALLBACK_ENABLED` and the existing frontend target. |
| Unsupported formats | WMA is ignored for native playback. No transcoding or special-case detection; the generic error state can offer the Audio Station fallback. |

## Prototype findings (verified against the NAS on 2026-11-15)

### Endpoint

```
GET /webapi/AudioStation/stream.cgi
    ?api=SYNO.AudioStation.Stream
    &version=2
    &method=stream
    &id=music_<track.id>
    &library=shared
```

`music.id` and `track.id` are separate sequences. The client uses `music.id`;
the server maps it to `track.id` with the existing
`loadPlaybackTrackIdForMusicId()` query and sends `music_<track.id>` upstream.

### Authentication

- Login with `SYNO.API.Auth` v7.
- The stream request needs the `id`/`did` cookies **and** a `SynoToken`
  (query parameter or `X-SYNO-TOKEN` header).
- `_sid` also works as an authentication fallback.
- A token without the cookies returns DSM error 105.
- The browser must never see these credentials. happy-trails proxies the
  stream and only exposes a same-origin URL.

### Range and metadata

- `Range` requests return `206` with `Content-Range` and `Accept-Ranges: bytes`.
- Open-ended (`bytes=N-`) and suffix (`bytes=-N`) ranges work.
- `HEAD` returns `Content-Type`, `Content-Length`, and `Accept-Ranges`.
- Seeking in the browser works through the proxy without custom buffering.

### Codecs

| Format | Upstream type | Browser |
| --- | --- | --- |
| FLAC | `audio/x-flac` | Plays in Chromium and Firefox; normalize to `audio/flac` for broader compatibility. |
| MP3 | `audio/mpeg` | Plays. |
| WAV | `audio/wav` | Plays. |
| WMA | `audio/x-ms-wma` | Not supported natively; use the Audio Station fallback. |

Library composition at the time of the spike: 372,408 FLAC (90.8%), 37,525 MP3
(9.1%), 311 WMA (0.08%), 1 WAV.

### Track transitions

Two `<audio>` elements with the next track preloaded on `preload="auto"`
produced an `ended` → `playing` gap of **0–1 ms** in Chromium and Firefox.
Preload starts after the current track is playing so the initial buffering is
not split between two streams.

## Architecture

```
Browser <audio>
   │ GET /api/stream/<musicId> (Range)
   ▼
happy-trails
   │ session cookie → UserSession → DsmClient
   │ musicId → track.id
   │ GET AudioStation/stream.cgi?id=music_<track.id>
   ▼
Synology Audio Station
   │ 200/206 + audio
   ▼
happy-trails pipes the response back (and aborts upstream on disconnect)
```

- Streaming requires the signed-in user's happy-trails session. The stream
  endpoint returns `401` without one, and the UI hides the play controls and
  footer while signed out. A restored queue stays in `localStorage` but is not
  shown until the user signs in.
- The queue and playback state live entirely in the browser. The backend has
  no queue to be invalidated by user interactions.
- The footer and audio elements live outside the re-rendered content, so SPA
  navigation, search, and dialogs cannot stop playback.
- The stream URL is stable and same-origin; the browser sends the `mw_session`
  cookie automatically. A DSM token expiry is repaired by `DsmClient` with an
  in-memory re-login; a happy-trails session expiry is handled in Stage 4.
- A full page reload or server restart stops audio. The queue is restored
  paused after a reload in Stage 4.

## HTTP API

### `GET|HEAD /api/stream/:musicId`

Requires a signed-in happy-trails session.

| Status | Meaning |
| --- | --- |
| `200`/`206` | Audio stream; upstream metadata is forwarded. |
| `400` | The music id is not a positive integer. |
| `401` | Not signed in. |
| `404` | No playable file for this track. |
| `416` | The requested range is beyond the end. |
| `502` | DSM could not open the stream. |
| `503` | Native playback is disabled. |

Forwarded headers: `Content-Type` (with FLAC/WAV aliases normalized),
`Content-Length`, `Content-Range`, `Accept-Ranges`, `Last-Modified`, `ETag`.
Responses use `Cache-Control: private, max-age=3600` and
`X-Accel-Buffering: no`. `Range` and `If-Range` are forwarded upstream.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `NATIVE_PLAYBACK_ENABLED` | `true` | Enables the native player and `/api/stream`. Requires `DSM_URL`. |
| `AUDIO_STATION_FALLBACK_ENABLED` | `true` | Keeps the Audio Station handoff available as a fallback. Also requires a resolved frontend target (`DSM_FRONTEND_URL` or `DSM_URL`). |

The existing `DSM_FRONTEND_URL` / `DSM_FRONTEND_ALLOWED_ORIGINS` rules still
apply to the fallback redirect.

## Stages

### Stage 1 — Server-side stream proxy (done)

- `DsmClient.openAudioStream()` with cookie/token auth, `_sid` fallback,
  Range/HEAD forwarding, MIME normalization, and one re-auth retry.
- `PlaybackService.openStream()` mapping `music.id` → `track.id`.
- `GET|HEAD /api/stream/:musicId` with session auth, status mapping, streaming,
  abort-on-disconnect, and cache/proxy headers.
- Tests: signed-out, invalid id, Range, HEAD, 416, missing track, disabled
  native playback, DSM failure, MIME normalization.
- Verified through the real app against the NAS: `206`, 1024 bytes,
  `audio/flac`, `Content-Range: bytes 0-1023/9193`.

### Stage 2 — Player footer and single-track playback (done)

- Static footer outside the dynamic content: cover/title/artist/album,
  play/pause, restart, previous/next, seek bar, elapsed/remaining time, queue
  toggle.
- Two persistent `<audio>` elements with preload/swap; verified real FLAC
  playback through the proxy in Chromium.
- Existing play links are intercepted; signed-out clicks route through the
  login dialog first, then resume the pending action.
- Modifier-click / middle-click still opens the Audio Station handoff.
- Login copy updated (streaming, not queueing in Audio Station).

### Stage 3 — Album playback and queue (done)

- Album Play queues all tracks; a track Play queues the album from that track
  onward (or the single track if album context cannot be loaded).
- Album-dialog Play respects the active track filter; the dialog closes when a
  native Play action starts so the footer is reachable.
- Queue panel: current/next highlight, click-to-play, remove, clear, move
  up/down buttons, and drag-and-drop reordering.
- Stable queue item ids so editing does not lose the playing item.
- Auto-advance with a preloaded next track; queue edits refresh the preload.
- Deleting the playing item advances; deleting the last playing item selects
  the previous item paused.
- Queue and position persist in `localStorage` and restore paused after a
  reload.

### Stage 3.5 — Play all search results (done)

- A **Play all** button sits beside the result summary. In Albums mode it
  queues every track of every matching album (album order, then disc/track);
  in Tracks mode it queues the matching tracks.
- `GET /api/playback/tracks?mode=albums|tracks&q=&sort=&offset=&limit=` returns
  flat, track-level pages for both modes. Albums mode flattens the album query
  on the server instead of fetching each album separately.
- The player keeps a 48-item visible window (the Load-more page size) and
  refills when fewer than 12 tracks remain after the current one. It fetches
  exactly enough to restore 48, trims items before the current track only after
  a page commits, and persists the source cursor with the queue.
- The source remembers the original `q`, `sort`, and `mode`; changing the
  visible search does not change refills. Pressing Play all again, playing a
  track/album, clearing the queue, or signing out replaces/clears it.
- Refill failures leave the queue and cursor intact and retry on a later
  trigger. Library version changes are handled best-effort.

### Stage 4 — Robustness and polish (partially done)

Already included:

- Queue/current item/position persistence in `localStorage`, restored paused.
- Unsupported-format error state with the Audio Station fallback and automatic
  skip inside a queue. Tracks that the browser cannot decode are marked with a
  warning icon (`playable: false`) in track lists and the queue; the internal
  file format is not exposed to the client.
- Volume slider and mute button, persisted separately from the queue.
- Player keyboard shortcuts (play/pause, seek, previous/next, volume, mute,
  restart) and a complete shortcut reference in the `?` help dialog.
- Focused accessibility pass: live track announcements, labels and
  `aria-keyshortcuts`, accessible queue controls, warning badge semantics.
- Media Session metadata, artwork, media-key handlers, and
  `setPositionState()` timeline sync for lock screens, notifications, and
  hardware/car media controls.
- Responsive footer and queue panel; drag plus accessible move buttons.
- README, `.env.example`, and this design document.

Remaining:

- Sliding session expiry and re-authentication on stream `401`; resume after
  sign-in.
- Real Safari/iOS verification: the Playwright WebKit project now covers
  desktop WebKit, but it is not Apple Safari. Check autoplay after the async
  album fetch, two-element preload, and the iOS volume-slider behavior on real
  devices; harden only if those checks fail.
- Release notes and version bump.

## Corner cases

- Removing/reordering items before, at, or after the playing item.
- A preload racing a queue replacement or deletion (use a generation token).
- Track removed or renamed in the library (stream 404 → skip).
- Album with no playable tracks.
- Session expiry, server restart, sign-out (stop and clear).
- Safari/iOS autoplay: unlock both audio elements on the first user gesture.
- Library index rebuilds block the Node event loop and can briefly stall audio;
  move the build to a worker if this becomes noticeable.
- Reverse proxies must not buffer the audio response.
- Never forward DSM credentials or cookies to the browser.
