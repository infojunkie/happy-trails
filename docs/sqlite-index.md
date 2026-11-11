# In-memory SQLite search index

The album catalogue is aggregated from PostgreSQL and written to an in-memory
SQLite database at startup (and whenever the change fingerprint moves). SQLite
replaces the previous JavaScript arrays and `Map`s; query logic now lives in
SQL. The API keeps its existing fields and adds a separate `regions` facet and
album field.

The implementation is in [`src/server/sqlite.ts`](../src/server/sqlite.ts);
normalisation and album keys are in [`src/server/search.ts`](../src/server/search.ts);
country/region detection is in [`src/server/regions.ts`](../src/server/regions.ts).

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
  search_text TEXT NOT NULL,          -- folded album + artist + sources + guests
  search_album TEXT NOT NULL,         -- folded album title + source titles
  search_artist TEXT NOT NULL,        -- folded album, parsed, and track artists
  search_source TEXT NOT NULL,        -- folded raw source titles
  search_track_artist TEXT NOT NULL,  -- folded track-level artists
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
  key       TEXT PRIMARY KEY,          -- folded series/label name
  name      TEXT NOT NULL,             -- canonical first spelling
  name_rank INTEGER NOT NULL
) STRICT;

CREATE TABLE album_series (
  album_id  INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  serie_key TEXT NOT NULL REFERENCES series(key),
  PRIMARY KEY (album_id, position)
) STRICT;

CREATE TABLE genres (
  key       TEXT PRIMARY KEY,          -- lowercased, whitespace-collapsed
  name      TEXT NOT NULL,             -- canonical first spelling
  name_rank INTEGER NOT NULL
) STRICT;

CREATE TABLE album_genres (
  album_id  INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  genre_key TEXT NOT NULL REFERENCES genres(key),
  PRIMARY KEY (album_id, position)
) STRICT;

CREATE TABLE regions (
  key       TEXT PRIMARY KEY,          -- folded country/region name
  name      TEXT NOT NULL,             -- canonical first spelling
  name_rank INTEGER NOT NULL
) STRICT;

CREATE TABLE album_regions (
  album_id   INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  region_key TEXT NOT NULL REFERENCES regions(key),
  PRIMARY KEY (album_id, position)
) STRICT;

CREATE VIRTUAL TABLE album_search USING fts5(
  search_text,
  search_album,
  search_artist,
  search_source,
  search_track_artist,
  search_composer,
  content = 'albums',
  content_rowid = 'id',
  tokenize = 'trigram'
);
```

`album_search` is an external-content FTS5 table: the text is stored once in
the `albums` columns, and FTS5 maintains the inverted index. Triggers are
created after the bulk load and `album_search` is populated with a single
`'rebuild'` command, which is substantially faster than indexing row by row.

The separate folded columns are what make fielded search possible. `album`
includes the merged title and all raw source titles; `source` contains only the
raw titles; `artist` combines the effective album artist, parsed artists, and
track-level artists; `trackartist` contains only the track-level names;
`composer` contains the distinct composer tag values from the tracks.

Series are stored in `album_series` rather than a folded text column.
`serie:` (alias `label:`) matches `album_series.serie_key` exactly, so query
totals agree with the series facet counts. Values are parsed from the album
title: the contents of `{...}`, the label between a leading year and "Edition"
in `[...]` (so `[2016 Rock Candy Edition]` yields `Rock Candy`), plus series
detected from recurring normalized titles: repeated titles such as
`Sem Limite`, a prefix completed by the artist (`A Arte de <artist>`), a prefix
completed by a volume number (`The Wire Tapper 42`), or a label prefix followed
by ` - ` / `:` (`Putumayo`, `Jazz Is Dead`). Numeric volume suffixes on embedded
labels are folded into their stem when the stem recurs with different numbers
(`{Network Medien / World Network 38}` → `Network Medien / World Network`); a
lone numeric suffix such as `{Club Top 13}` or `{2 em 1}` is kept. Names in
`SERIES_EXCEPTIONS` (defaults: `Legacy`, `Collector's`) are dropped. The field
names are parsed in
[`src/server/searchQuery.ts`](../src/server/searchQuery.ts).

Plain-title detection is library-wide. Before the bulk load the builder
normalizes each album title: it strips `[...]`, `{...}`, and `(...)` text, the
` // …` suffix, and any text after a standalone ` - ` or a `:`. It records 2–6
word prefixes (plus a one-word prefix when a dash/colon suffix was removed, to
catch labels such as `Putumayo`) and qualifies one when it appears in at least
five albums and is either an exact repeated title, a prefix completed by the
album artist, or a prefix completed by a 1–3 digit volume number. Albums whose
title is also a track title, one-track extracts, and generic titles (`Greatest
Hits`, `Live`, `Vol. 2`, …) are excluded, as are names in
`SERIES_EXCEPTIONS`. Albums that already carry an explicit `{...}` or `[...]`
series are excluded from plain-title detection entirely, so a title such as
`Cuba : Les danses des dieux {Ocora}` yields only `Ocora`. The shortest
qualifying prefix is stored, so variable artist/volume text does not enter the
series values.

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
 WHERE EXISTS (
   SELECT 1 FROM search_term_0 WHERE search_term_0.rowid = a.id
 )
```

The match string includes a field column, for example
`search_album : "abbey road"`. Short phrases use
`instr(a.search_album, ?) > 0`. Boolean `AND`/`OR`/parentheses are composed at
the SQL level from these leaves.

Both paths use the same `foldSearch()` output that was written to the index:
NFKD, combining-mark removal, lowercasing, and explicit mappings for Latin
letters that NFKD leaves alone (`ø`, `æ`, `œ`, `ß`, `ł`, …).

## Query layer

The queries below implement the album listing, search, and facet logic.

### Free-text and fielded search

```sql
WITH search_term_0 AS MATERIALIZED (
  SELECT rowid FROM album_search WHERE album_search MATCH ?
)
SELECT a.key, a.album, a.artist, a.year, a.track_count, a.duration, a.latest
  FROM albums a
 WHERE EXISTS (
         SELECT 1 FROM search_term_0 WHERE search_term_0.rowid = a.id
       )
 ORDER BY a.latest DESC, a.album_rank, a.artist_rank
 LIMIT ? OFFSET ?;
```

`search_text` contains the merged album title, the effective album artist, all
parsed artists, every raw source title, every distinct track-level artist,
composer tag, genre tag, region tag, and series value.
Fielded terms target `search_album`, `search_artist`, `search_source`,
`search_track_artist`, or `search_composer` instead. `genre:`, `region:`, and
`serie:` are categorical and match `album_genres` / `album_regions` /
`album_series` exactly, so their totals agree with the sidebar facet counts.
Bare terms target `search_text`. A plain list of keywords is parsed as one
quoted phrase; explicit `AND`/`OR` terms stay independent.

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

### Genre, region, and series facets

```sql
SELECT g.key, g.name, COUNT(DISTINCT ag.album_id) AS album_count
  FROM genres g
  JOIN album_genres ag ON ag.genre_key = g.key
 GROUP BY g.key, g.name, g.name_rank
 ORDER BY album_count DESC, g.name_rank ASC;

SELECT r.key, r.name, COUNT(DISTINCT ar.album_id) AS album_count
  FROM regions r
  JOIN album_regions ar ON ar.region_key = r.key
 GROUP BY r.key, r.name, r.name_rank
 ORDER BY album_count DESC, r.name_rank ASC;

SELECT s.key, s.name, COUNT(DISTINCT ase.album_id) AS album_count
  FROM series s
  JOIN album_series ase ON ase.serie_key = s.key
 GROUP BY s.key, s.name, s.name_rank
 ORDER BY album_count DESC, s.name_rank ASC;
```

## Adding a new field or facet

Searchable fields are either **substring** fields or **exact** fields. Pick the
kind first; it determines every other change.

| Kind | Use for | Matching | Storage |
| --- | --- | --- | --- |
| Substring | Free-form text where partial matches are useful: titles, artist names, composer strings | FTS5 trigram phrase/substring | Folded `search_*` column |
| Exact | Finite, normalized values that are browsed as facets: genres, regions, series | `EXISTS` lookup by key | Values + `album_*` mapping tables |

The split is encoded in
[`src/server/searchQuery.ts`](../src/server/searchQuery.ts): only substring
fields appear in `SEARCH_FIELD_COLUMNS` (a partial map). In
[`src/server/sqlite.ts`](../src/server/sqlite.ts), `termSql()` has an explicit
branch for each exact field that performs the mapping-table lookup; exact
fields must never fall through to the FTS path.
[`src/server/trackSearch.ts`](../src/server/trackSearch.ts) mirrors the same
split for per-track filtering.

A useful test: if the sidebar shows a count for the field, it should be exact,
because the count is computed from the same keys as the query. Substring
matching would make the query total larger than the facet count.

### Substring field

1. **Parser**: add the field to `SEARCH_FIELDS` in
   [`searchQuery.ts`](../src/server/searchQuery.ts), add its aliases to
   `FIELD_ALIASES`, and map it to a SQLite column in `SEARCH_FIELD_COLUMNS`.
2. **Schema and FTS**: in [`sqlite.ts`](../src/server/sqlite.ts), add a folded
   `search_<field> TEXT NOT NULL` column to `albums`, add it to the
   `album_search` FTS5 column list, and add it to every trigger column
   list/value in `TRIGGER_SQL`, the bulk `INSERT INTO albums(...)` statement,
   and the bound values. Bump `schema_version` and `PRAGMA user_version`.
3. **Build**: in the per-album loop, compute
   `const searchField = foldSearch(values.join(' '))` and insert it. Include
   the raw values in `searchText` if bare terms should match the field too.
4. **Track filter**: `TrackFields` is `Record<SearchField, string>`, so
   TypeScript forces a value. Add `field: foldSearch(...)` in `trackFields()`;
   `matchesNode()` then uses the normal substring path automatically.
5. **Tests/docs**: add parser, search, and API tests; update the search syntax
   table and the help popup. No mapping table or facet count is needed unless
   the field is also browsed as a facet.

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
Values that the collator considers equal share a rank, allowing the same
tie-breaking chain as before:

| Sort | `ORDER BY` |
| --- | --- |
| `recent` | `latest DESC, album_rank, artist_rank` |
| `artist` | `artist_rank, album_rank, key_rank` |
| `album` | `album_rank, artist_rank, key_rank` |
| `year` | `year DESC, album_rank, artist_rank` |

SQLite sorts NULLs last for `DESC`, which matches the old comparator. Avoiding
the `latest IS NULL` expression on the leading sort term lets the
`(latest DESC, …)` and `(year DESC, …)` indexes serve deep `OFFSET`
pagination without a full sort.

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
album listing's correlated subquery returns them as a JSON array.

## Build and publication

`SqliteIndex.build()` performs the same row parsing as before (merging
` // …` titles, splitting tags, classifying country/region tags, parsing
artists, collecting composer tags, extracting bracketed/braced series labels,
and detecting recurring plain-title series), then:

1. Creates a fresh `:memory:` database and schema.
2. Inserts genres, regions, series, albums, parsed artists, source titles,
   comments, and the tag/series mappings in one transaction, yielding to the
   event loop between chunks.
3. Calculates ranks and stores build metadata.
4. Creates the FTS triggers and rebuilds `album_search`.
5. Returns the database; `Library` swaps it in and closes the previous one.

The old database stays readable throughout the rebuild, so requests are served
without a gap. A failed build leaves the previous index in place and is
reported through `/api/status`.

## Current boundaries

- Tracks are still read from PostgreSQL on demand; only album-level search is
  in SQLite. The next likely step is a `tracks` table (with a track FTS index)
  for track search and track-level facets.
- The database is rebuilt in full. Incremental updates would need to consume
  the change stream or a tighter fingerprint and apply upserts; the FTS
  triggers are already in place for row-level updates.
- The whole build runs in the main thread. Moving it to a worker thread (or
  streaming PostgreSQL rows and inserting directly) would reduce the build
  peak; the current 33k-album dataset settles around 370 MB RSS, including the
  84 MB SQLite database.
- Search covers album titles, source titles, and artist names. Track titles are
  not in the index yet; a future `tracks` FTS table would add `track:` as a
  field.
- The expression parser supports `AND`, `OR`, implicit AND, parentheses, and
  quoted phrases. `NOT`/negation is not implemented.
- Region detection is exact-tag only. A future pass could split compound tags
  (`Jazz/Brazil`, `Classical+Spain`) and classify the location component, and
  could canonicalize multilingual country spellings into one facet.
