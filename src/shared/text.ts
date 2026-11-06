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
