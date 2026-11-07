import { config } from './config.js';

/** Placeholder used while splitting; stripped from input first. */
const SPLIT_TOKEN = '\u0000';

/**
 * A run of non-letter/non-digit characters is a separator only when it has
 * whitespace on both sides. This keeps "AC/DC", "Jay-Z", and "R.E.M." intact
 * while splitting "Artist A & Artist B" and "Artist A / Artist B".
 */
const PUNCTUATION_SEPARATOR = /\s+[^\p{L}\p{N}\s]+\s+/gu;

/**
 * A comma followed by whitespace separates names: "A, B, C". The optional
 * leading whitespace also accepts "A , B". Commas without a following space
 * (for example "AC,DC") are left alone.
 */
const COMMA_SEPARATOR = /\s*,\s+/gu;

/** Private-use delimiters that cannot appear in normal artist names. */
const EXCEPTION_OPEN = String.fromCharCode(0xe000);
const EXCEPTION_CLOSE = String.fromCharCode(0xe001);
const EXCEPTION_TOKEN_RE = new RegExp(
  `${EXCEPTION_OPEN}(\\d+)${EXCEPTION_CLOSE}`,
  'g',
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildWordSeparators(words: readonly string[]): RegExp[] {
  const seen = new Set<string>();
  const patterns: RegExp[] = [];

  for (const word of words) {
    const base = word.trim().replace(/\.+$/, '');
    if (!base) continue;

    const key = base.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const escaped = escapeRegExp(base).replace(/\\?\s+/g, '\\s+');
    // One-letter words are case-sensitive so "E Street Band" is not split.
    const flags = base.length === 1 ? 'gu' : 'giu';
    patterns.push(new RegExp(`\\s+${escaped}\\.?\\s+`, flags));
  }

  return patterns;
}

function buildExceptionPatterns(names: readonly string[]): RegExp[] {
  const seen = new Set<string>();
  const patterns: RegExp[] = [];

  // Longest first, so "Earth, Wind & Fire" wins over a hypothetical "Earth".
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const base = name.trim();
    if (!base) continue;

    const key = base.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const escaped = escapeRegExp(base).replace(/\\?\s+/g, '\\s+');
    // Match whole names only, so a name embedded in a longer word is left to
    // the normal rules.
    patterns.push(
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'),
    );
  }

  return patterns;
}

const WORD_SEPARATORS = buildWordSeparators(config.artistSeparatorWords);
const EXCEPTION_PATTERNS = buildExceptionPatterns(config.artistExceptions);

/**
 * Replace configured exception names with opaque placeholders so none of the
 * separator rules can touch their punctuation. The original spelling is
 * restored after splitting, so exceptions are returned exactly as written.
 */
function maskExceptions(value: string): {
  text: string;
  restore: (value: string) => string;
} {
  let text = value;
  const originals: string[] = [];

  for (const pattern of EXCEPTION_PATTERNS) {
    text = text.replace(pattern, (match) => {
      const index = originals.length;
      originals.push(match);
      return `${EXCEPTION_OPEN}${index}${EXCEPTION_CLOSE}`;
    });
  }

  return {
    text,
    restore(value: string): string {
      return value.replace(
        EXCEPTION_TOKEN_RE,
        (token: string, index: string) => originals[Number(index)] ?? token,
      );
    },
  };
}

/**
 * Split an artist/album_artist value into individual artist names.
 *
 * Rules:
 * - A punctuation run is a separator only when surrounded by whitespace.
 * - A comma followed by whitespace is a separator: "A, B, C" → three names.
 * - Configured words (`ARTIST_SEPARATOR_WORDS`) are separators when they are
 *   standalone words surrounded by whitespace. One-letter words are matched
 *   case-sensitively.
 * - Names in `ARTIST_EXCEPTIONS` are kept intact and returned verbatim.
 */
export function parseArtists(value: string | null | undefined): string[] {
  const raw = (value ?? '').replaceAll(SPLIT_TOKEN, '').trim();
  if (!raw) return [];

  const masked = maskExceptions(raw);
  let text = masked.text;

  for (const pattern of WORD_SEPARATORS) {
    text = text.replace(pattern, SPLIT_TOKEN);
  }
  text = text.replace(PUNCTUATION_SEPARATOR, SPLIT_TOKEN);
  text = text.replace(COMMA_SEPARATOR, SPLIT_TOKEN);

  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(SPLIT_TOKEN)) {
    const name = masked.restore(part.replace(/\s+/g, ' ').trim()).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

/**
 * Split a composer tag into individual names. It reuses artist rules, then
 * additionally splits semicolons and slashes, including without surrounding
 * whitespace (for example "jacques dutronc/jacques lanzmann").
 */
export function parseComposers(
  value: string | null | undefined,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const part of parseArtists(value)) {
    for (const piece of part.split(/\s*[;/]\s*/u)) {
      const name = piece.replace(/\s+/g, ' ').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }

  return names;
}
