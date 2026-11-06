# In-memory SQLite search index

The album catalogue is aggregated from PostgreSQL and written to an in-memory
SQLite database at startup (and whenever the change fingerprint moves). SQLite
replaces the previous JavaScript arrays and `Map`s; query logic now lives in
SQL. The API keeps its existing fields and adds a separate `regions` facet and
album field.

The implementation is in [`src/server/sqliteIndex.ts`](../src/server/sqliteIndex.ts);
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
  content = 'albums',
  content_rowid = 'id',
  tokenize = 'trigram'
);
```

`album_search` is an external-content FTS5 table: the text is stored once in
`albums.search_text`, and FTS5 maintains the inverted index. Triggers are
created after the bulk load and `album_search` is populated with a single
`'rebuild'` command, which is substantially faster than indexing row by row.

## Why trigram?

The old search used `entry.search.includes(token)`, i.e. an arbitrary substring
match. FTS5's default `unicode61` tokenizer supports words and prefixes, not
substrings. The `trigram` tokenizer indexes every three-character sequence, so
a quoted phrase is a substring query and preserves the existing behaviour:

```sql
-- every >= 3 character token must appear somewhere in the folded text
JOIN album_search ON album_search.rowid = a.id
WHERE album_search MATCH ?   -- e.g. '"abbey" "road"'
```

The query builder emits one quoted phrase per token. Adjacent phrases in an
FTS5 `MATCH` are an implicit AND. Tokens shorter than three characters cannot be
represented by trigrams, so they use an exact scan of the folded column:

```sql
WHERE instr(a.search_text, ?) > 0
```

Both paths use the same `foldSearch()` output that was written to the index:
NFKD, combining-mark removal, lowercasing, and explicit mappings for Latin
letters that NFKD leaves alone (`ø`, `æ`, `œ`, `ß`, `ł`, …).

## Query layer

The queries below implement the album listing, search, facet, and match-mode
logic.

### Free-text album/artist search

```sql
SELECT a.key, a.album, a.artist, a.year, a.track_count, a.duration, a.latest
  FROM albums a
  JOIN album_search ON album_search.rowid = a.id
 WHERE album_search MATCH ?          -- '"one" "two"'
 ORDER BY a.latest DESC, a.album_rank, a.artist_rank
 LIMIT ? OFFSET ?;
```

`search_text` contains the merged album title, the effective album artist, all
parsed artists, every raw source title, and every distinct track-level artist.

### Genre filter

`genreMode=any` (default) uses an existence check; `genreMode=all` requires the
album to contain every selected tag:

```sql
-- any
WHERE EXISTS (
  SELECT 1
    FROM album_genres ag
   WHERE ag.album_id = a.id
     AND ag.genre_key IN (?, ?, …)
)

-- all; the final parameter is the number of selected genres
WHERE (SELECT COUNT(DISTINCT ag.genre_key)
         FROM album_genres ag
        WHERE ag.album_id = a.id
          AND ag.genre_key IN (?, ?, …)) = ?
```

### Region filter

The same two modes apply to `album_regions`/`region_key`:

```sql
-- any
WHERE EXISTS (
  SELECT 1
    FROM album_regions ar
   WHERE ar.album_id = a.id
     AND ar.region_key IN (?, ?, …)
)

-- all
WHERE (SELECT COUNT(DISTINCT ar.region_key)
         FROM album_regions ar
        WHERE ar.album_id = a.id
          AND ar.region_key IN (?, ?, …)) = ?
```

A genre selection and a region selection are combined with AND; each facet
applies its own any/all mode. With no selected tags, the corresponding
condition is omitted.

### Genre and region facets

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
```

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
```

## Build and publication

`SqliteIndex.build()` performs the same row parsing as before (merging
` // …` titles, splitting tags, classifying country/region tags, parsing
artists), then:

1. Creates a fresh `:memory:` database and schema.
2. Inserts genres, albums, parsed artists, source titles, and album genres in
   one transaction, yielding to the event loop between chunks.
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
  peak; the current 33k-album dataset settles around 300 MB RSS, including the
  47 MB SQLite database.
- Only `album_search` is indexed. Fielded search (`album:"…"` vs
  `artist:"…"`) would use separate FTS columns or additional virtual tables.
- Region detection is exact-tag only. A future pass could split compound tags
  (`Jazz/Brazil`, `Classical+Spain`) and classify the location component, and
  could canonicalize multilingual country spellings into one facet.
