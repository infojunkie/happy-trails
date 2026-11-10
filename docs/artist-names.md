# Artist names and splitting

**Last updated:** 2026-11-09

This document records the current artist-parsing rules, the known edge cases,
and ideas for using the Discogs artist dump to improve them. The implementation
lives in [`src/server/artists.ts`](../src/server/artists.ts) and
[`src/server/config.ts`](../src/server/config.ts); tests live in
[`tests/artists/`](../tests/artists/).

## Current parser

`parseArtists()` is applied to:

- the effective album artist (`album_artist`, falling back to track `artist`);
- each track-level artist;
- composer tags through `parseComposers()`, which first uses the artist rules
  and then additionally splits semicolons and slashes.

The original `artist`/`albumArtist` strings are preserved for display and
search. Parsing only produces the `artists` array used for links and the search
index. Unmatched text remains plain, unlinked text in the UI.

### Processing order

1. Strip the internal split token, trim, and return early when empty.
2. Mask names from `ARTIST_EXCEPTIONS` with opaque placeholders. Exceptions are
   matched whole-name, case-insensitively, and restored verbatim.
3. Truncate at the first configured possessive determiner: the possessive and
   every following token are discarded. A possessive must be preceded by
   whitespace, so a leading `His Name Is Alive` is not truncated.
4. Strip a trailing separator left by the truncation
   (`Quincy Jones &` → `Quincy Jones`).
5. Replace configured separator words with the split token.
6. Replace punctuation runs with the split token when whitespace surrounds
   them (`Artist A & Artist B`, `Artist A / Artist B`, `Artist A - Artist B`).
7. Replace a comma followed by whitespace with the split token (`A, B, C`).
8. Split, restore exceptions, collapse whitespace, trim, and deduplicate
   case-insensitively.

### Separators

Default separator words (`ARTIST_SEPARATOR_WORDS` adds more):

```text
feat., accompanied by, com, part., avec, with, et, e, con, y, و, vs., mit
```

One-letter Latin words (`e`, `y`) are matched case-sensitively, so
`E Street Band` is not split and an uppercase `Y` is not a separator. Arabic
`و` has no case distinction.

Punctuation is a separator only when it has whitespace on both sides. This
keeps `AC/DC`, `Jay-Z`, and `R.E.M.` intact. A comma needs only the following
whitespace, so `A,B` stays intact while `A, B` splits.

### Possessives

Default possessives (`ARTIST_POSSESSIVES` adds more):

```text
his, her, their, its,
son, sa, ses, leur, leurs,
seu, sua, seus, suas,
su, sus
```

Everything after the first possessive is ignored. The intent is to keep the
band leader and drop a backing-ensemble description:

| Input | Parsed artists |
| --- | --- |
| `Quincy Jones & His Orchestra` | `Quincy Jones` |
| `Louis Prima et son Orchestre` | `Louis Prima` |
| `Art Blakey & His Jazz Messengers` | `Art Blakey` |
| `Badly Drawn Boy feat. Jools Holland & His Rhythm & Blues Orchestra` | `Badly Drawn Boy`, `Jools Holland` |
| `Michi Sarmiento y su Combo Bravo` | `Michi Sarmiento` |
| `João Gilberto e sua Orquestra` | `João Gilberto` |

Because **all** later tokens are discarded:

- named backing bands are dropped too (`Gene Vincent & His Blue Caps` →
  `Gene Vincent`);
- later artists are dropped
  (`Quincy Jones & His Orchestra & Wynton Marsalis` → `Quincy Jones`);
- cross-language collisions occur, for example `Hanine y Son Cubano` →
  `Hanine`, because `son` is a French possessive.

Exceptions can protect a complete string from both possessive truncation and
separator splitting.

### Exceptions

There are **no default exceptions**. `ARTIST_EXCEPTIONS` supplies names as a
vertical-bar-separated list (names may contain commas). Exceptions are masked
before possessives and separators, so a configured name is returned exactly as
written.

Configuration formats:

- `ARTIST_SEPARATOR_WORDS`: comma-separated words or phrases.
- `ARTIST_POSSESSIVES`: comma-separated words.
- `ARTIST_EXCEPTIONS`: vertical-bar-separated full names.

Examples of names that currently split unless configured as exceptions:

- `Earth, Wind & Fire` → `Earth`, `Wind`, `Fire`
- `Florence + The Machine` → `Florence`, `The Machine`
- `Simon & Garfunkel` → `Simon`, `Garfunkel`
- `Tom & Jerry` → `Tom`, `Jerry`

### Other current cases

| Input | Parsed artists | Reason |
| --- | --- | --- |
| `Paco de Lucía y Ramón de Algeciras` | both names | `y` separator, no possessive |
| `Billie Holiday accompanied by Ray Ellis & His Orchestra` | `Billie Holiday`, `Ray Ellis` | `accompanied by` separator, then possessive truncation |
| `Sister Rosetta Tharpe accompanied by The Sammy Price Trio` | both names | no possessive |
| `His Name Is Alive` | unchanged | leading possessive is not preceded by whitespace |

## Known limitations

- The parser cannot distinguish a band name from a collaboration credit using
  separator shape alone.
- A single-word-side heuristic (`Do not split if either side is one word`) was
  considered and rejected. It would keep the desired names but also merge real
  collaborations such as `Bonobo feat. Fink`, `Janet Jackson with Nelly`, and
  comma lists such as `Leonardo, Paula Fernandes`.
- A possessive is a blunt instrument: it solves leader-plus-backing-ensemble
  billings but drops named backing bands and later artists by design.
- Comma lists, `feat.`, `part.`, `vs.`, and similar credit markers remain hard
  splits; exceptions are required for names that contain them.
- The original artist string still contributes to free-text search even when
  its suffix is not in the `artists` array. This is intentional for display
  and search, but means a dropped suffix can still match a text search.

## Discogs artist dump

The app does **not** read this file yet. Everything in this section is a
proposal for future work.

The downloaded dump is:

```text
/home/kratib/Downloads/discogs_20261101_artists.xml
```

Facts measured from the current download:

- **2.2 GB** XML;
- **10,284,281** `<artist>` records;
- fields include `<name>`, `<realname>`, `<profile>`, `<namevariations>`,
  `<aliases>`, `<groups>`, and `<members>`.

The local library is much smaller:

- **69,632** distinct track `artist` strings;
- **13,849** distinct `album_artist` strings;
- roughly **17,500** track-artist strings containing separators.

This makes a library-filtered approach practical; the full dump should not be
loaded into the application at runtime.

### What the dump can answer

- Which local artist strings are known Discogs names or name variations?
- Which names currently being split are actually known artists?
- Which configured exceptions are unnecessary or still missing?
- What canonical names/IDs and aliases belong to a metadata spelling?

### Matching examples

Exact canonical names found:

- `Earth, Wind & Fire`
- `Florence + The Machine`
- `Nick Cave & The Bad Seeds`
- `Quincy Jones & His Orchestra`

Names that require case/whitespace normalization or are absent:

- `Chiclete Com Banana` exists; the local spelling is `Chiclete com Banana`.
- `Hanine Y Son Cubano` exists; the local spelling is `Hanine y Son Cubano`.
- `Ben e Jerry` was not found in an exact search.
- `Louis Prima et son Orchestre` was not found; Discogs has
  `Louis Prima And His Orchestra` instead.

Discogs coverage is useful but not complete, and spelling/translation variants
mean it cannot replace fallback rules.

## Suggested uses

### 1. Generate an exception report / list

**Lowest risk, recommended first.**

Offline:

1. Export distinct local artist and album-artist strings.
2. Stream the Discogs XML; extract canonical names and name variations.
3. Normalize both sides with the existing folding rules
   (`foldSearch`) plus whitespace normalization.
4. Match exact full strings first.
5. Produce a report of matches, current parser output, and candidate
   exceptions.

The result can feed `ARTIST_EXCEPTIONS` directly, or be reviewed first. It does
not require a runtime dependency on Discogs.

### 2. Build a library-specific known-name dictionary

Extract only Discogs names/variations that overlap with local artist strings,
then use a longest-match approach:

```text
Earth, Wind & Fire feat. Someone
└──────────────┘  └──────────────┘
  known name        separate credit
```

This can preserve known names inside longer credit strings, which exact
whole-string matching cannot do. It is more powerful but requires a matcher and
a clear policy for overlapping matches.

### 3. Canonicalize names and enrich search

Map local metadata to Discogs canonical names, IDs, and aliases to:

- normalize casing and punctuation;
- add aliases/name variations to artist search;
- link metadata variants to one canonical artist;
- avoid duplicate identities.

The original display spelling can be kept while using the canonical identity
for search/indexing.

### 4. Classify groups versus collaborations

`members`, `groups`, and `aliases` are signals, not proof. Discogs also has
entries for collaborative credits (`Artist A & Artist B`), so an exact match
does not automatically mean “do not split.” Use this only as supporting
evidence or in a reviewed report.

### 5. Audit parser decisions

An offline report can list:

- known names currently split;
- suspected false merges;
- local names absent from Discogs;
- candidates for `ARTIST_EXCEPTIONS`.

This is useful even if no runtime integration is done.

## Important design cautions

- **Do not load the whole dump at startup.** Filter it to names relevant to the
  local library, or precompute a compact SQLite/JSON artifact.
- **Normalize before matching.** Case, accents, punctuation, and whitespace
  differ between Discogs and local tags. Use `foldSearch` and collapse
  whitespace; consider explicit punctuation normalization.
- **Discogs cannot be the final authority.** A known Discogs entry can conflict
  with the desired display semantics. For example, Discogs has
  `Quincy Jones & His Orchestra`, while the current possessive rule deliberately
  reduces it to `Quincy Jones`.
- **Decide the ordering with existing rules.** Possessive truncation,
  `ARTIST_EXCEPTIONS`, and Discogs matching all compete to decide what is
  linked. The policy needs to be explicit before runtime integration.
- **Handle data quality.** Discogs names include disambiguation suffixes such
  as `(2)`, aliases, typos, and noisy variations. Prefer canonical names plus
  name variations for matching; do not blindly display them.
- **Refresh derived data.** The dump is monthly. Store the dump date/version in
  any generated artifact and regenerate it when the dump or local library
  changes.

## Recommended next milestone

Build the offline report only:

1. Export distinct local artist strings.
2. Stream the XML and extract normalized canonical names/variations.
3. Match exact whole strings and report matches with current parser output.
4. Review a sample and measure how many candidate exceptions are useful.
5. Then choose:
   - static `ARTIST_EXCEPTIONS` entries;
   - a generated exceptions file;
   - or a library-specific dictionary with longest-match parsing.

## Open questions

- Should a full-string Discogs match override possessive truncation, or should
  possessives run first?
- Are Discogs collaborative entries (`A & B`) one artist or two for this UI?
- Should candidate exceptions be applied automatically or manually reviewed?
- Should Discogs aliases affect display, search, or only matching?
- Is a static generated exceptions file sufficient, or is a maintained local
  SQLite dictionary worth the extra runtime complexity?
