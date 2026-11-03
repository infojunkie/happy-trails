import { config } from './config.js';

/** Placeholder used while splitting; stripped from input first. */
const SPLIT_TOKEN = '\u0000';

/**
 * A run of non-letter/non-digit characters is a separator only when it has
 * whitespace on both sides. This keeps "AC/DC", "Jay-Z", and "R.E.M." intact
 * while splitting "Artist A & Artist B" and "Artist A / Artist B".
 */
const PUNCTUATION_SEPARATOR = /\s+[^\p{L}\p{N}\s]+\s+/gu;

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

const WORD_SEPARATORS = buildWordSeparators(config.artistSeparatorWords);

/**
 * Split an artist/album_artist value into individual artist names.
 *
 * Rules:
 * - A punctuation run is a separator only when surrounded by whitespace.
 * - Configured words (`ARTIST_SEPARATOR_WORDS`) are separators when they are
 *   standalone words surrounded by whitespace. One-letter words are matched
 *   case-sensitively.
 */
export function parseArtists(value: string | null | undefined): string[] {
  const raw = (value ?? '').replaceAll(SPLIT_TOKEN, '').trim();
  if (!raw) return [];

  let text = raw;
  for (const pattern of WORD_SEPARATORS) {
    text = text.replace(pattern, SPLIT_TOKEN);
  }
  text = text.replace(PUNCTUATION_SEPARATOR, SPLIT_TOKEN);

  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(SPLIT_TOKEN)) {
    const name = part.replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}
