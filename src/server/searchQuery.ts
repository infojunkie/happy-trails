/**
 * Parser for the top search bar.
 *
 * Grammar (case-insensitive keywords):
 *
 *   expression := andExpr (OR andExpr)*
 *   andExpr    := primary ((AND)? primary)*
 *   primary    := '(' expression ')' | term
 *   term       := [field ':'] (quoted | word)
 *   quoted     := '"' ... '"'
 *
 * Bare terms search every indexed field. Values may contain punctuation; spaces
 * require quotes. A query consisting only of unquoted, fieldless keywords is
 * treated as one quoted phrase. Unknown field names are treated as ordinary
 * text so titles containing colons still work. A malformed expression is
 * reported as null and the caller falls back to the pre-syntax search behavior.
 */

export const SEARCH_FIELDS = [
  'all',
  'album',
  'artist',
  'serie',
  'source',
  'trackartist',
  'composer',
] as const;

export type SearchField = (typeof SEARCH_FIELDS)[number];

export interface SearchTermNode {
  kind: 'term';
  field: SearchField;
  value: string;
  quoted: boolean;
}

export interface SearchAndNode {
  kind: 'and';
  left: SearchNode;
  right: SearchNode;
}

export interface SearchOrNode {
  kind: 'or';
  left: SearchNode;
  right: SearchNode;
}

export type SearchNode = SearchTermNode | SearchAndNode | SearchOrNode;

/** SQLite columns holding the folded text for each searchable field. */
export const SEARCH_FIELD_COLUMNS: Readonly<Record<SearchField, string>> = {
  all: 'search_text',
  album: 'search_album',
  artist: 'search_artist',
  serie: 'search_serie',
  source: 'search_source',
  trackartist: 'search_track_artist',
  composer: 'search_composer',
};

const FIELD_ALIASES = new Map<string, SearchField>([
  ['all', 'all'],
  ['any', 'all'],
  ['album', 'album'],
  ['artist', 'artist'],
  ['serie', 'serie'],
  ['label', 'serie'],
  ['source', 'source'],
  ['disc', 'source'],
  ['trackartist', 'trackartist'],
  ['track_artist', 'trackartist'],
  ['track-artist', 'trackartist'],
  ['guest', 'trackartist'],
  ['composer', 'composer'],
  ['composers', 'composer'],
]);

type Token =
  | {
      type: 'term';
      field: SearchField;
      value: string;
      quoted: boolean;
    }
  | { type: 'op'; op: 'AND' | 'OR' }
  | { type: 'lparen' }
  | { type: 'rparen' };

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const character = input[index];
    if (character === undefined) break;

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '(') {
      tokens.push({ type: 'lparen' });
      index += 1;
      continue;
    }
    if (character === ')') {
      tokens.push({ type: 'rparen' });
      index += 1;
      continue;
    }

    let field: SearchField = 'all';
    let cursor = index;
    while (
      cursor < input.length &&
      /[A-Za-z0-9_-]/.test(input[cursor] ?? '')
    ) {
      cursor += 1;
    }
    if (cursor > index && input[cursor] === ':') {
      const mapped = FIELD_ALIASES.get(
        input.slice(index, cursor).toLowerCase(),
      );
      if (mapped) {
        field = mapped;
        index = cursor + 1;
      }
    }

    let value = '';
    let quoted = false;

    if (input[index] === '"') {
      quoted = true;
      index += 1;
      while (index < input.length) {
        const characterAt = input[index];
        if (characterAt === '\\' && index + 1 < input.length) {
          value += input[index + 1] ?? '';
          index += 2;
          continue;
        }
        if (characterAt === '"') {
          index += 1;
          break;
        }
        value += characterAt;
        index += 1;
      }
    } else {
      const valueStart = index;
      while (
        index < input.length &&
        !/\s/.test(input[index] ?? '') &&
        input[index] !== '(' &&
        input[index] !== ')'
      ) {
        index += 1;
      }
      value = input.slice(valueStart, index);
    }

    const trimmed = value.trim();
    if (!trimmed) return null;

    if (field === 'all' && !quoted) {
      const upper = trimmed.toUpperCase();
      if (upper === 'AND' || upper === 'OR') {
        tokens.push({ type: 'op', op: upper });
        continue;
      }
    }

    tokens.push({
      type: 'term',
      field,
      value: quoted ? value : trimmed,
      quoted,
    });
  }

  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): SearchNode | null {
    if (this.tokens.length === 0) return null;
    const node = this.parseOr();
    return node && this.index === this.tokens.length ? node : null;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private parseOr(): SearchNode | null {
    let left = this.parseAnd();
    if (!left) return null;

    while (true) {
      const token = this.peek();
      if (token?.type !== 'op' || token.op !== 'OR') break;
      this.index += 1;
      const right = this.parseAnd();
      if (!right) return null;
      left = { kind: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): SearchNode | null {
    let left = this.parsePrimary();
    if (!left) return null;

    while (true) {
      const token = this.peek();
      if (token?.type === 'op' && token.op === 'AND') {
        this.index += 1;
        const right = this.parsePrimary();
        if (!right) return null;
        left = { kind: 'and', left, right };
        continue;
      }
      if (token?.type === 'term' || token?.type === 'lparen') {
        const right = this.parsePrimary();
        if (!right) return null;
        left = { kind: 'and', left, right };
        continue;
      }
      return left;
    }
  }

  private parsePrimary(): SearchNode | null {
    const token = this.peek();
    if (!token) return null;

    if (token.type === 'lparen') {
      this.index += 1;
      const node = this.parseOr();
      if (!node || this.peek()?.type !== 'rparen') return null;
      this.index += 1;
      return node;
    }

    if (token.type === 'term') {
      this.index += 1;
      return {
        kind: 'term',
        field: token.field,
        value: token.value,
        quoted: token.quoted,
      };
    }

    return null;
  }
}

export function parseSearchQuery(input: string): SearchNode | null {
  const tokens = tokenize(input);
  if (!tokens) return null;

  // A query made only of unquoted, fieldless keywords is a phrase, not an
  // implicit AND. Use AND/OR or quotes to search the words independently.
  // Rebuild the phrase from token values so an explicit `all:` prefix is not
  // included in the text.
  const keywords: string[] = [];
  let keywordOnly = tokens.length > 0;
  for (const token of tokens) {
    if (token.type !== 'term' || token.field !== 'all' || token.quoted) {
      keywordOnly = false;
      break;
    }
    keywords.push(token.value);
  }
  if (keywordOnly) {
    return { kind: 'term', field: 'all', value: keywords.join(' '), quoted: true };
  }

  return new Parser(tokens).parse();
}
