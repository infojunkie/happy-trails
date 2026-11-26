# SQLite search index

The album catalogue and every track row are aggregated from PostgreSQL and
written to a SQLite database at startup (and whenever the change fingerprint
moves). SQLite replaces the previous JavaScript arrays and `Map`s; query logic
now lives in SQL. The API keeps its existing fields and adds a separate
`regions` facet and album field, plus a track-level search mode.

The implementation is in [`src/server/sqlite.ts`](../src/server/sqlite.ts);
normalisation and album keys are in [`src/server/search.ts`](../src/server/search.ts);
country/region detection is in [`src/server/regions.ts`](../src/server/regions.ts).

## Storage

`INDEX_DB_DIR` controls where the database lives:

- A directory path (the default is `$TMPDIR/happy-trails-index`, usually
  `/tmp/happy-trails-index`) builds a file-backed database.
- `:memory:` keeps the database in the Node process heap and skips all file
  handling. Tests and fixtures use this mode by default via the `databasePath`
  argument of `SqliteIndex.build()`.

`Library.indexDatabasePath()` names each build
`happy-trails-index-<pid>-<version>-<uuid>.sqlite` and creates the directory
with mode `0700` if needed. `prepareIndexStorage()` runs once at startup,
logs the storage mode, and removes stale `happy-trails-index-*` files from a
previous process. The directory is treated as dedicated to one live server; do
not point two running instances at the same directory.

In file-backed mode the build runs in a Node worker thread
([`src/server/indexWorker.ts`](../src/server/indexWorker.ts)); the main thread
keeps serving the previous index throughout. The worker has its own PostgreSQL
pool, writes a new SQLite file, closes its connection with `persist()`, and
posts the fingerprint and counts back to `Library`. `Library` then opens the
file with `SqliteIndex.open()` and swaps it in. `:memory:` mode cannot be
handed between threads, so that mode builds in the main thread.

The build writes to a new file while the old index keeps answering requests.
When the build succeeds, `Library` swaps the connection and calls `close()` on
the previous index, which closes and deletes its file. A failed build closes
and deletes the partial file and leaves the previous index in place. Because
the file is disposable, the build uses `journal_mode = MEMORY` and
`synchronous = OFF`; no WAL or journal sidecar files are left behind.

Use a local filesystem. SMB/NFS mounts do not provide the POSIX locking and
file semantics SQLite expects. Mount the containing **directory**, not a
single `.sqlite` file, because every rebuild creates a new file. See the
[Docker and non-Docker storage guidance](../README.md#index-storage) in the
README for volume layout, permissions, and disk sizing.

Measured on a 410k-track library: ~373 MB on disk, ~43–46 s total worker
build, ~560–600 MB peak build RSS, and ~75 MB steady process RSS (the OS page
cache holds the file and is reclaimable). `:memory:` mode peaks around 920 MB
RSS.

Folder prefixes in `IGNORE_FOLDERS` are filtered out in PostgreSQL before the
album aggregate, track rows, fingerprint, album dialog query, and playback-id
queries, so their files never reach SQLite or the API. `TRACKS_FOLDERS`
rows are still indexed; only their albums are flagged `track_only` and hidden
from album-facing surfaces. Ignored rows are removed first, so an ignore entry
wins when both lists match.

## Schema

```sql
CREATE TABLE albums (
  id          INTEGER PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,   -- opaque base64url (album, artist)
  album       TEXT NOT NULL,          -- merged, normalised title
  artist      TEXT NOT NULL,          -- effective album artist, original text
  year        INTEGER,
  track_count INTEGER NOT NULL,
  duration    INTEGER NOT NULL,
  latest      TEXT,                   -- MAX(music.date), ISO-like text
  cover_path  TEXT,                   -- representative file path
  track_only    INTEGER NOT NULL,       -- 1 = every track is in a loose folder
  search_text TEXT NOT NULL,          -- folded album + artist + sources + guests
  search_album TEXT NOT NULL,         -- folded album title + source titles
  search_artist TEXT NOT NULL,        -- folded album, parsed, and track artists
  search_source TEXT NOT NULL,        -- folded raw source titles
  search_composer TEXT NOT NULL,      -- folded composer tags
  album_rank  INTEGER NOT NULL,       -- Intl.Collator rank for album
  artist_rank INTEGER NOT NULL,       -- Intl.Collator rank for artist
  key_rank    INTEGER NOT NULL        -- Intl.Collator rank for key
) STRICT;

CREATE TABLE album_artists (           -- parsed names from artist/album_artist
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  artist   TEXT NOT NULL,
  PRIMARY KEY (album_id, position)
) STRICT;

CREATE TABLE album_sources (           -- raw titles merged into an album
  album_id     INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,       -- natural display order
  source_album TEXT NOT NULL,          -- e.g. "X // Bonus Tracks"
  cover_path   TEXT,
  PRIMARY KEY (album_id, position)
) STRICT;

CREATE TABLE album_comments (          -- distinct track comments, sorted
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  comment  TEXT NOT NULL,
  PRIMARY KEY (album_id, position)
) STRICT;

CREATE TABLE series (
  key         TEXT PRIMARY KEY,        -- folded series/label name
  name        TEXT NOT NULL,           -- canonical first spelling
  name_rank   INTEGER NOT NULL,
  album_count INTEGER NOT NULL,        -- visible albums in this series
  track_count INTEGER NOT NULL         -- tracks of all albums in this series
) STRICT;

CREATE TABLE album_series (
  album_id  INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  serie_key TEXT NOT NULL REFERENCES series(key),
  PRIMARY KEY (album_id, position)
) STRICT;

CREATE TABLE genres (
  key         TEXT PRIMARY KEY,        -- lowercased, whitespace-collapsed
  name        TEXT NOT NULL,           -- canonical first spelling
  name_rank   INTEGER NOT NULL,
  album_count INTEGER NOT NULL,        -- visible albums carrying this genre
  track_count INTEGER NOT NULL         -- tracks whose own tags carry it
) STRICT;

CREATE TABLE album_genres (
  album_id  INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  genre_key TEXT NOT NULL REFERENCES genres(key),
  PRIMARY KEY (album_id, position)
) STRICT;

CREATE TABLE regions (
  key         TEXT PRIMARY KEY,        -- folded country/region name
  name        TEXT NOT NULL,           -- canonical first spelling
  name_rank   INTEGER NOT NULL,
  album_count INTEGER NOT NULL,        -- visible albums carrying this region
  track_count INTEGER NOT NULL         -- tracks whose own tags carry it
) STRICT;

CREATE TABLE album_regions (
  album_id   INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  region_key TEXT NOT NULL REFERENCES regions(key),
  PRIMARY KEY (album_id, position)
) STRICT;

CREATE TABLE tracks (
  id              INTEGER PRIMARY KEY,   -- music.id
  album_id        INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  artist          TEXT,                  -- raw track artist; NULL -> album artist
  source_album    TEXT NOT NULL,         -- raw title, e.g. "X // Bonus Tracks"
  year            INTEGER,
  disc            INTEGER,
  track           INTEGER,
  duration        INTEGER,
  playable        INTEGER NOT NULL,      -- browser-native format? (0/1)
  date            TEXT,                  -- per-track upload date
  genre_names     TEXT NOT NULL,         -- JSON array of this track's genres
  region_names    TEXT NOT NULL,         -- JSON array of this track's regions
  search_title    TEXT NOT NULL,
  search_artist   TEXT NOT NULL,         -- folded track artist + album artist
  search_source   TEXT NOT NULL,
  search_composer TEXT NOT NULL,
  artist_rank     INTEGER NOT NULL,      -- visible artist, for sorting
  album_rank      INTEGER NOT NULL       -- copied from albums
) STRICT;

CREATE INDEX tracks_artist_order
  ON tracks(artist_rank, album_rank, disc, track, id);
CREATE INDEX tracks_artist_desc
  ON tracks(artist_rank DESC, album_rank, disc, track, id);
CREATE INDEX tracks_album_order
  ON tracks(album_rank, disc, track, id);
CREATE INDEX tracks_album_desc
  ON tracks(album_rank DESC, disc, track, id);
CREATE INDEX tracks_date_order
  ON tracks((date IS NULL), date DESC, album_rank, disc, track, id);
CREATE INDEX tracks_date_asc
  ON tracks((date IS NULL), date ASC, album_rank, disc, track, id);
CREATE INDEX tracks_year_order
  ON tracks((year IS NULL), year DESC, album_rank, disc, track, id);
CREATE INDEX tracks_year_asc
  ON tracks((year IS NULL), year ASC, album_rank, disc, track, id);
CREATE INDEX tracks_by_album ON tracks(album_id);

CREATE VIRTUAL TABLE album_search USING fts5(
  search_text,
  search_album,
  search_artist,
  search_source,
  search_composer,
  content = 'albums',
  content_rowid = 'id',
  tokenize = 'trigram'
);

CREATE VIRTUAL TABLE track_search USING fts5(
  search_title,
  search_artist,
  search_source,
  search_composer,
  content = 'tracks',
  content_rowid = 'id',
  tokenize = 'trigram'
);
```

`album_search` and `track_search` are external-content FTS5 tables: the text
is stored once in the `albums`/`tracks` columns, and FTS5 maintains the
inverted index. Triggers are created after the bulk load and each table is
populated with a single `'rebuild'` command, which is substantially faster than
indexing row by row.

The separate folded columns are what make fielded search possible. On the album
side, `album` includes the merged title and all raw source titles; `source`
contains only the raw titles; `artist` combines the effective album artist,
parsed artists, and track-level artists; `composer` contains the distinct
composer tag values from the tracks.

The track table stores only per-track text: `title`; `artist` (track artist
plus album artist); `source` (this track's raw source title); and `composer`.
Album title and series terms resolve through the album index by `album_id`, so
~400k track rows do not repeat album-level title text.

Each track also stores its own genre and region names and lookup keys as JSON
arrays (`genre_names`, `region_names`, `genre_keys`, `region_keys`). The names
drive the result-row pills; the keys make `genre:` and `region:` exact
per-track filters. Series remains an album-level property.

Series are stored in `album_series` rather than a folded text column.
`serie:` (alias `label:`) matches `album_series.serie_key` exactly, so query
totals agree with the series facet counts. Values are assembled at build time:

- every `{...}` group is split on `/` (spaces optional) and each token is a
  distinct series; multiple groups each contribute. No other tokenizing is
  applied, so commas, separator words, and punctuation stay in the name.
- albums with no braced series may match `SERIES_ALLOWLIST`: entries are
  checked in configured order as substrings anywhere in the album title, and
  only the first match is retained.
- `SERIES_DENYLIST` is applied
  last: if any entry is a substring of the album title, the album is removed
  from all series.

Matching for the allowlist and denylist folds case, accents, and apostrophes.
The field name is parsed in
[`src/server/searchQuery.ts`](../src/server/searchQuery.ts); `detectSeries()`
is in [`src/server/search.ts`](../src/server/search.ts).

## Why trigram?

The old search used `entry.search.includes(token)`, i.e. an arbitrary substring
match. FTS5's default `unicode61` tokenizer supports words and prefixes, not
substrings. The `trigram` tokenizer indexes every three-character sequence, so
a quoted phrase is a substring query.

Each query term becomes either an FTS phrase or, for phrases shorter than three
characters, an `instr()` check on the relevant folded column. FTS phrases are
wrapped in materialized CTEs so the trigram index is used once per term rather
than once per album:

```sql
WITH search_term_0 AS MATERIALIZED (
  SELECT rowid FROM album_search WHERE album_search MATCH ?
)
SELECT ...
  FROM albums a
 WHERE a.track_only = 0
   AND EXISTS (
     SELECT 1 FROM search_term_0 WHERE search_term_0.rowid = a.id
   )
```

The match string includes a field column, for example
`search_album : "abbey road"`. Short phrases use
`instr(a.search_album, ?) > 0`. Boolean `AND`/`OR`/parentheses are composed at
the SQL level from these leaves.

Both paths use the same `foldAlnum()` output that was written to the index:
NFKD, combining-mark removal, lowercasing, explicit mappings for Latin letters
that NFKD leaves alone (`ø`, `æ`, `œ`, `ß`, `ł`, …), and removal of every
non-alphanumeric character except whitespace. Thus `-M-` and `M` match
identically, while `The Beatles` and `TheBeatles` do not. An all-punctuation
value falls back to the punctuation-preserving fold so unrelated names stay
distinct. Exact genre/region/series keys still use `foldSearch()`.

## Query layer

The queries below implement the album listing, search, and facet logic.

### Free-text and fielded search

```sql
WITH search_term_0 AS MATERIALIZED (
  SELECT rowid FROM album_search WHERE album_search MATCH ?
)
SELECT a.key, a.album, a.artist, a.year, a.track_count, a.duration, a.latest
  FROM albums a
 WHERE a.track_only = 0
   AND EXISTS (
         SELECT 1 FROM search_term_0 WHERE search_term_0.rowid = a.id
       )
 ORDER BY a.latest DESC, a.album_rank, a.artist_rank
 LIMIT ? OFFSET ?;
```

Every album listing and album-mode Play all query starts with
`a.track_only = 0`; album-key lookups used by the Tracks view deliberately do
not, so a loose track can still open its album dialog.

`search_text` contains the merged album title, the effective album artist, all
parsed artists, every raw source title, every distinct track-level artist,
composer tag, genre tag, region tag, and series value.
Fielded terms target `search_album`, `search_artist`, `search_source`, or
`search_composer` instead. `track:` is resolved against `track_search` and an
`EXISTS` over `tracks.album_id`, so it returns albums containing a matching
track. `genre:`, `region:`, and `serie:` are categorical and match
`album_genres` / `album_regions` / `album_series` exactly, so their totals agree
with the sidebar facet counts. Bare terms target `search_text`. A plain list of
keywords is parsed as one quoted phrase; explicit `AND`/`OR` terms stay
independent.

### Genre, region, and series terms

`genre:`, `region:`, and `serie:` are exact mapping-table lookups, so their
totals match the facet counts. OR/AND combinations are composed as usual:

```sql
WHERE EXISTS (
  SELECT 1
    FROM album_genres ag
   WHERE ag.album_id = a.id
     AND ag.genre_key = ?
)
```

Region terms use `album_regions`/`region_key` and the folded region key; series
terms use `album_series`/`serie_key`. The sidebar facet counts come from the
grouped queries below.

### Track search

`queryTracks()` reuses the same parser, folding, materialized CTEs, and boolean
composition against `tracks`. Per-track terms use `track_search` columns:
`track:` targets `search_title`, `artist:` targets `search_artist` (which
contains both the track artist and the album artist), `source:` targets
`search_source`, and `composer:` targets `search_composer`.

Bare/`all` terms are an OR of the four track columns, the album title (via the
album `search_album` column), the track's own genre/region keys, and
album-level series keys. The tag/series branches use folded `{key, name}` lists
cached once per build, which preserves substring matching without storing
per-track tag text. Album terms are resolved by `t.album_id`:

```sql
-- album title via the album index
t.album_id IN (SELECT rowid FROM album_term_0)

-- per-track genre/region tags
EXISTS (
  SELECT 1 FROM json_each(t.region_keys) tag
   WHERE tag.value = ?
)

-- album-level series
EXISTS (
  SELECT 1 FROM album_series ase
   WHERE ase.album_id = t.album_id AND ase.serie_key = ?
)
```

Fielded `genre:` and `region:` terms use the same `json_each` lookup, so only
tracks carrying that tag match. `serie:` remains album-level because a series
belongs to the album, not an individual track. The sidebar shows the facet's
`trackCount` in Tracks mode and its `albumCount` in Albums mode, so each number
equals the result of selecting that filter. The row pills come from
`tracks.genre_names`/`region_names`.

The row query joins the album for identity and display pills:

```sql
SELECT t.id, t.title, al.key AS album_key, al.album,
       COALESCE(NULLIF(trim(t.artist), ''), al.artist) AS artist,
       al.artist AS album_artist,
       t.source_album, t.year, t.disc, t.track, t.duration,
       t.genre_names, t.region_names
  FROM tracks t
  JOIN albums al ON al.id = t.album_id
 ORDER BY (t.date IS NULL), t.date DESC, t.album_rank, t.disc, t.track, t.id
 LIMIT ? OFFSET ?;
```

The four sort fields reuse the album meanings: `added` is the per-track upload
date, `released` is the track year, `artist` is the visible artist, and `album`
is the album rank then disc/track. Each accepts `order=asc|desc`.

On the 410k-track reference library, selective fielded track queries answer in
roughly 25–45 ms, exact album-level facet filters in 25–50 ms, and a broad bare
term such as `jazz` (about 100k tracks) in roughly 220 ms. The bare-term
branches are materialized as one `UNION` CTE; composing them as correlated
`EXISTS` subqueries made the same query take several seconds.

### Genre, region, and series facets

Both counts are accumulated while the index is built, so the facets are a
single table read:

```sql
SELECT key, name, album_count, track_count
  FROM genres
 ORDER BY album_count DESC, name_rank ASC;
-- regions and series use the same shape.
```

`album_count` increments once per visible album (`track_only = 0`) carrying the
tag. `track_count` increments once per indexed track carrying it: the track's
own `genre_keys`/`region_keys` for genres and regions, and the series of the
track's album for series. Tracks of hidden `track_only` albums therefore still
contribute to `track_count`, matching what the same filter returns in Tracks
mode. Tags that occur only on hidden albums stay in the table with
`album_count = 0`; the client hides them in Albums mode and shows them in Tracks
mode.

## Adding a new field or facet

Searchable fields are either **substring** fields or **exact** fields. Pick the
kind first; it determines every other change.

| Kind | Use for | Matching | Storage |
| --- | --- | --- | --- |
| Substring | Free-form text where partial matches are useful: titles, artist names, composer strings | FTS5 trigram phrase/substring | Folded `search_*` column |
| Exact | Finite, normalized values that are browsed as facets: genres, regions, series | `EXISTS` lookup by key | Values + `album_*` mapping tables |

The split is encoded in
[`src/server/searchQuery.ts`](../src/server/searchQuery.ts): only substring
fields appear in `SEARCH_FIELD_COLUMNS` (a partial map for the album index). In
[`src/server/sqlite.ts`](../src/server/sqlite.ts), `termSql()` in `queryAlbums()`
and `queryTracks()` has an explicit branch for each exact field that performs
the mapping-table lookup; exact fields must never fall through to the FTS path.
Album-level exact fields work in track mode through `t.album_id` without extra
storage. [`src/server/trackSearch.ts`](../src/server/trackSearch.ts) mirrors
the same split for per-track dialog filtering.

A useful test: if the sidebar shows a count for the field, it should be exact,
because the count is computed from the same keys as the query. Substring
matching would make the query total larger than the facet count.

### Substring field

1. **Parser**: add the field to `SEARCH_FIELDS` in
   [`searchQuery.ts`](../src/server/searchQuery.ts), add its aliases to
   `FIELD_ALIASES`, and map it to a SQLite column in `SEARCH_FIELD_COLUMNS` for
   album mode and to a branch in `queryTracks()` for track mode.
2. **Schema and FTS**: in [`sqlite.ts`](../src/server/sqlite.ts), add a folded
   `search_<field> TEXT NOT NULL` column to `albums` and/or `tracks`, add it to
   the matching FTS5 column list, and add it to every trigger column
   list/value in `TRIGGER_SQL`, the bulk `INSERT` statement, and the bound
   values. Bump `schema_version` and `PRAGMA user_version`.
3. **Build**: in the per-album and/or per-track loop, compute
   `const searchField = foldAlnum(values.join(' '))` and insert it. Include
   the raw values in the mode's `all` text if bare terms should match the field
   too.
4. **Track filter**: `TrackFields` is `Record<SearchField, string>`, so
   TypeScript forces a value. Add `field: foldAlnum(...)` in `trackFields()`;
   `matchesNode()` then uses the normal substring path automatically.
5. **Tests/docs**: add parser, search, and API tests in both modes; update the
   search syntax table and the help popup. No mapping table or facet count is
   needed unless the field is also browsed as a facet.

### Exact field and facet

1. **Parser**: add the field to `SEARCH_FIELDS` and `FIELD_ALIASES`, but **do
   not** add it to `SEARCH_FIELD_COLUMNS`.
2. **Storage**: if the field needs its own dimension, add a values table and an
   album mapping table, modeled on `genres`/`album_genres` or
   `series`/`album_series`:

   ```sql
   CREATE TABLE moods (
     key       TEXT PRIMARY KEY,   -- normalized lookup key
     name      TEXT NOT NULL,      -- canonical display name
     name_rank INTEGER NOT NULL
   ) STRICT;

   CREATE TABLE album_moods (
     album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
     position INTEGER NOT NULL,
     mood_key TEXT NOT NULL REFERENCES moods(key),
     PRIMARY KEY (album_id, position)
   ) STRICT;

   CREATE INDEX album_moods_by_mood ON album_moods(mood_key, album_id);
   ```

   During `SqliteIndex.build()`, collect the values per album with the same
   key function the query will use, insert the `moods` rows and the
   `album_moods` mappings, and bump the schema version.
3. **Query**: add a branch to `termSql()` in `sqlite.ts` that normalizes the
   value to the lookup key and returns an exact existence check:

   ```ts
   if (term.field === 'mood') {
     const key = moodKey(term.value);
     if (!key) return '0';
     params.push(key);
     return `EXISTS (
       SELECT 1 FROM album_moods m
        WHERE m.album_id = a.id AND m.mood_key = ?
     )`;
   }
   ```

   `moodKey()` is illustrative: define the normalization once and share it
   between the build, the query, and the track matcher, as `genreKey()` and
   `regionKey()` do. Include the values in `searchText` if bare/`all` terms
   should match them. Because this uses the same keys as the facet count,
   query totals and sidebar counts agree.
4. **Facet count**: add a method beside `genres()`/`regions()`/`series()`
   returning `key`, `name`, and `COUNT(DISTINCT album_id)` ordered by count and
   `name_rank`; expose it through `Library` and `/api/genres`.
5. **Track filter**: TypeScript requires a `TrackFields` entry. Store exact
   keys delimiter-wrapped (as genre/region/serie do), add the field to the
   exact branch in `matchesNode()`, and pass the album's keys to
   `createTrackMatcher()` — see `serieKeysFor()` for the pattern.
6. **Client facet**: add the facet to the sidebar and extend
   [`src/client/facets.ts`](../src/client/facets.ts) (`FacetField`, the parser
   regex, and `buildFacetQuery`) so checkboxes write `<field>:"value"` terms
   and round-trip through the URL.
7. **Tests/docs**: add exactness tests (a partial value returns 0 and the full
   facet name's total equals the facet count), API tests, UI tests, and update
   the search syntax/help docs.

## Country/region detection

`isRegionTag()` classifies a whole genre tag as a location if it matches a
generated or curated name. Names come from:

- `Intl.DisplayNames` for every ISO 3166 alpha-2 code and the UN M49
  macro-region codes, in English, French, German, Spanish, Portuguese, and
  Italian.
- A curated list of subnational regions, islands, constituent countries,
  historical countries, and spelling variants present in this catalogue
  (`Corsica`, `Catalonia`, `Andalusia`, `Sardinia`, `Sicily`, `Byelorussia`,
  `Zaire`, `Grece`, `Columbia`, …).
- Extra names from `REGION_TAGS`.

Matching folds case, accents, ligatures, and apostrophe variants, so `Grèce`
and `Grece` land on the same region key. Only whole tags are classified:
`Jazz/Brazil` remains a genre because it also carries a non-location genre
component.

### Sorting

The old code used `Intl.Collator('en', { sensitivity: 'base', numeric: true })`.
SQLite's built-in collations do not reproduce ICU's accent/case/numeric rules,
so the builder precomputes dense ranks for album titles, artists, and keys.
Artist and album ranks compare `foldAlnum()` values, so punctuation does not
affect name order (`-M-` and `M` share a rank). Values that compare equal share
a rank, allowing the same tie-breaking chain as before:

| Sort field | `ORDER BY` (ascending; `order=desc` flips the value term) |
| --- | --- |
| `added` | `(latest IS NULL), latest, album_rank, artist_rank` |
| `released` | `(year IS NULL), year, album_rank, artist_rank` |
| `artist` | `artist_rank, album_rank, key_rank` |
| `album` | `album_rank, artist_rank, key_rank` |
| `random` | `random_rank(id, seed), id` |

The first four fields support `order=asc` and `order=desc`; missing years and
track dates sort last in both directions. The `(column IS NULL)` expression is
the first term, and matching expression indexes (`(year IS NULL), year DESC, …`
and `(year IS NULL), year ASC, …`, and the same for `latest`/`date`) keep deep
`OFFSET` pagination index-backed. The opposite-direction name indexes
(`artist_rank DESC`, `album_rank DESC`) are created alongside the ascending
ones.

`random` ignores `order`. The connection registers a deterministic
`random_rank(id, seed)` SQL function (a 32-bit integer mix); the same seed
returns the same order for every page, so `OFFSET` pagination and Play all
refills never overlap. It has no index and sorts the full matching set, which
is cheap for albums but measurably slower for a 410k-track Tracks-mode query.

### Album details

```sql
SELECT source_album FROM album_sources
 WHERE album_id = ?
 ORDER BY position;

SELECT cover_path FROM albums WHERE key = ?;

SELECT comment FROM album_comments
 WHERE album_id = ?
 ORDER BY position;
```

`album_comments` holds the distinct, trimmed `comment` values collected from
all rows merged into the album, sorted so the listing is deterministic. The
album listing's correlated subquery returns them as a JSON array. The shared
album-summary columns also join `album_series`/`series`, so both the listing
and the single-album lookup return each album's series names.

## Build and publication

`SqliteIndex.build()` performs the same row parsing as before (merging
` // …` titles, splitting tags, classifying country/region tags, parsing
artists, collecting composer tags, and assembling braced/allowlisted series),
then:

1. `loadLibraryRows()` runs the album aggregate and the per-track query in one
   `REPEATABLE READ` transaction, so both views come from the same snapshot.
   In file-backed mode the builder worker runs this step and the rest of the
   sequence; `:memory:` runs it in the main thread.
2. Creates a fresh database at the configured path (or `:memory:`) and the
   schema.
3. Inserts genres, regions, series, albums, parsed artists, source titles,
   comments, and the tag/series mappings in one transaction, yielding to the
   event loop between chunks. It retains an album-key → id/rank map.
4. Inserts every track row, mapping each raw album title + album artist to its
   merged album, computes the track's own genre/region display names, then
   verifies that the inserted track count equals the sum of the album track
   counts.
5. Calculates ranks (including the track artist ranks) and stores build
   metadata.
6. Creates the FTS triggers and rebuilds `album_search` and `track_search`.
   FTS5 `optimize` plus `VACUUM` was measured at ~15 MB saved for ~2 s of
   build time, so the build does not run them.
7. In file-backed mode the worker calls `persist()` (closing without deleting
   the file) and posts `{fingerprint, albumCount, trackCount, databaseBytes}`.
   `Library` opens the file with `SqliteIndex.open()`, swaps it in, and closes
   the previous index (deleting its file). In `:memory:` mode the returned
   index is used directly.

The old database stays readable throughout the rebuild, so requests are served
without a gap. The HTTP server listens from startup; `/api/status` reports
`ready:false` until the first build finishes, and data endpoints return `503`.
A failed build leaves the previous index in place, deletes any partial file,
and is reported through `/api/status`.

## Current boundaries

- Track `genre:` and `region:` filters use the track's own tags; `serie:`
  remains album-level, since series belong to albums rather than individual
  tracks. Sidebar facet counts are album counts, not track counts.
- The database is rebuilt in full. Incremental updates would need to consume
  the change stream or a tighter fingerprint and apply upserts; the FTS
  triggers are already in place for row-level updates.
- In file-backed mode the build runs in a worker thread; `:memory:` builds in
  the main thread. The worker holds the ~400k track rows while building.
  Measured on a 410k-track library: ~373 MB on disk, ~43–46 s total worker
  build, ~560–600 MB peak build RSS, and ~75 MB steady process RSS;
  `:memory:` mode peaks around 920 MB. A change-triggered rebuild uses two
  files (~750 MB) or two in-memory databases. Streaming and inserting track
  rows in chunks would reduce the build peak; the FTS tables dominate the
  steady database size.
- Track sorting offers the same `added`, `released`, `artist`, and `album`
  fields in both directions; there is no track-title sort and therefore no
  `title_rank`.
- The expression parser supports `AND`, `OR`, implicit AND, parentheses, and
  quoted phrases. `NOT`/negation is not implemented.
- Region detection is exact-tag only. A future pass could split compound tags
  (`Jazz/Brazil`, `Classical+Spain`) and classify the location component, and
  could canonicalize multilingual country spellings into one facet.
