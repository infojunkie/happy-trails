import { foldSearch } from '../shared/text.js';
import type { FilterMode } from '../shared/types.js';

export interface FacetSelection {
  genres: string[];
  genreMode: FilterMode;
  regions: string[];
  regionMode: FilterMode;
  series: string[];
}

type FacetField = 'genre' | 'region' | 'serie';

interface ParsedTerm {
  field: FacetField;
  value: string;
}

const FIELD_TERM = /^(genre|region|serie):/i;
const CONNECTOR = /^(AND|OR)\b/i;

function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function facetTerm(field: FacetField, value: string): string {
  return `${field}:${quote(value)}`;
}

/** Parse one term at `index`, or return null when the text is not a term. */
function parseTerm(
  query: string,
  index: number,
): { term: ParsedTerm; next: number } | null {
  const prefix = FIELD_TERM.exec(query.slice(index));
  if (!prefix) return null;

  const field = prefix[1]?.toLowerCase() as FacetField;
  let cursor = index + prefix[0].length;

  if (query[cursor] === '"') {
    cursor += 1;
    let value = '';
    while (cursor < query.length) {
      const character = query[cursor];
      if (character === '\\' && cursor + 1 < query.length) {
        value += query[cursor + 1] ?? '';
        cursor += 2;
        continue;
      }
      if (character === '"') {
        cursor += 1;
        return value.trim()
          ? { term: { field, value }, next: cursor }
          : null;
      }
      value += character;
      cursor += 1;
    }
    return null;
  }

  const start = cursor;
  while (cursor < query.length && !/[\s()]/.test(query[cursor] ?? '')) {
    cursor += 1;
  }
  if (cursor === start) return null;
  return { term: { field, value: query.slice(start, cursor) }, next: cursor };
}

/**
 * Parse a query made only of `genre:`, `region:`, and `serie:` terms joined by
 * AND/OR/parentheses. Returns null when the query contains anything else, so
 * the facet controls only mirror pure facet queries.
 */
export function parseFacetQuery(query: string): FacetSelection | null {
  const trimmed = query.trim();
  const selection: FacetSelection = {
    genres: [],
    genreMode: 'any',
    regions: [],
    regionMode: 'any',
    series: [],
  };
  if (!trimmed) return selection;

  const seen = new Set<string>();
  const connectors = new Map<FacetField, FilterMode>();
  let index = 0;
  let parentheses = 0;
  let previous: ParsedTerm | null = null;
  let connector: 'AND' | 'OR' | null = null;

  const add = (term: ParsedTerm): void => {
    const key = `${term.field}\u0000${foldSearch(term.value).trim()}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (term.field === 'genre') selection.genres.push(term.value);
    else if (term.field === 'region') selection.regions.push(term.value);
    else selection.series.push(term.value);
  };

  while (index < trimmed.length) {
    const character = trimmed[index] ?? '';
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '(') {
      parentheses += 1;
      index += 1;
      continue;
    }
    if (character === ')') {
      parentheses -= 1;
      if (parentheses < 0) return null;
      index += 1;
      continue;
    }

    const rest = trimmed.slice(index);
    const matchedConnector = CONNECTOR.exec(rest);
    if (matchedConnector) {
      connector = matchedConnector[1]?.toUpperCase() as 'AND' | 'OR';
      index += matchedConnector[0].length;
      continue;
    }

    const parsed = parseTerm(trimmed, index);
    if (!parsed) return null;
    const { term, next } = parsed;

    if (previous) {
      if (previous.field === term.field) {
        // Generated groups use a single connector per field; a manual mix is
        // conservative and is rebuilt using the last connector seen.
        connectors.set(term.field, connector === 'OR' ? 'any' : 'all');
      } else if (connector === 'OR') {
        // Cross-field OR is a custom query; the facet controls only mirror
        // grouped facet expressions.
        return null;
      }
    } else if (connector !== null) {
      return null;
    }

    add(term);
    previous = term;
    connector = null;
    index = next;
  }

  if (parentheses !== 0 || connector !== null) return null;
  selection.genreMode = connectors.get('genre') ?? 'any';
  selection.regionMode = connectors.get('region') ?? 'any';
  return selection;
}

/** Build the top-bar query for the current facet selection. */
export function buildFacetQuery(selection: FacetSelection): string {
  const groups: string[] = [];
  const group = (
    field: FacetField,
    values: string[],
    mode: FilterMode,
  ): string =>
    values
      .map((value) => facetTerm(field, value))
      .join(mode === 'all' ? ' AND ' : ' OR ');

  if (selection.genres.length > 0) {
    groups.push(group('genre', selection.genres, selection.genreMode));
  }
  if (selection.regions.length > 0) {
    groups.push(group('region', selection.regions, selection.regionMode));
  }
  if (selection.series.length > 0) {
    groups.push(group('serie', selection.series, 'any'));
  }

  if (groups.length === 0) return '';
  if (groups.length === 1) return groups[0] ?? '';
  return groups.map((value) => `(${value})`).join(' AND ');
}
