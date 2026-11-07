/**
 * Text folding shared by the Node indexer and the browser. Keep this module
 * dependency-free; it is compiled for both targets.
 */

/**
 * Latin letters that NFKD does not decompose into ASCII. Without these,
 * searches such as "Soren" or "Michal" miss "Søren" and "Michał".
 */
const SPECIAL_LATIN: Readonly<Record<string, string>> = {
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ß: 'ss',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
  ŋ: 'ng',
  ħ: 'h',
  ŧ: 't',
  ĸ: 'k',
  ĳ: 'ij',
  ƒ: 'f',
};

const SPECIAL_LATIN_RE = new RegExp(
  `[${Object.keys(SPECIAL_LATIN).join('')}]`,
  'g',
);

/** Case-, accent-, and ligature-insensitive folding for free-text search. */
export function foldSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(
      SPECIAL_LATIN_RE,
      (character) => SPECIAL_LATIN[character] ?? character,
    );
}

/**
 * Stable key for a country/region tag. Folding accents and apostrophe
 * variants groups spellings such as "Grèce"/"Grece" and
 * "Côte d’Ivoire"/"Cote d'Ivoire".
 */
export function regionKey(name: string): string {
  return foldSearch(name)
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** A piece of an artist display string; `name` marks a searchable artist. */
export interface ArtistSegment {
  text: string;
  name: string | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findArtistPart(
  source: string,
  name: string,
  from: number,
): { start: number; end: number; text: string } | null {
  if (!name) return null;
  const pattern = new RegExp(
    escapeRegExp(name).replace(/\\?\s+/g, '\\s+'),
    'i',
  );
  const match = pattern.exec(source.slice(from));
  if (!match) return null;
  const start = from + match.index;
  return { start, end: start + match[0].length, text: match[0] };
}

/**
 * Split the original artist string into plain punctuation segments and
 * searchable artist segments, preserving the source spelling and punctuation.
 * Returns null when the parsed names cannot be located in the original text,
 * so callers can fall back to the joined artist list.
 */
export function artistSegments(
  original: string | null | undefined,
  artists: readonly string[],
): ArtistSegment[] | null {
  const source = (original ?? '').trim();
  if (!source) return null;

  const names = artists.length > 0 ? artists : [source];
  const segments: ArtistSegment[] = [];
  let cursor = 0;

  for (const name of names) {
    const match = findArtistPart(source, name, cursor);
    if (!match) return null;
    if (match.start > cursor) {
      segments.push({ text: source.slice(cursor, match.start), name: null });
    }
    segments.push({ text: match.text, name });
    cursor = match.end;
  }

  if (cursor < source.length) {
    segments.push({ text: source.slice(cursor), name: null });
  }

  return segments;
}
