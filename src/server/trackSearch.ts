import { regionKey } from '../shared/text.js';
import { parseArtists } from './artists.js';
import type { TrackRow } from './db.js';
import { isRegionTag } from './regions.js';
import { foldSearch, genreKey, searchTokens } from './search.js';
import {
  parseSearchQuery,
  type SearchField,
  type SearchNode,
} from './searchQuery.js';

type TrackFields = Record<SearchField, string>;

// eslint-disable-next-line no-control-regex -- control characters are the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function legacySearchNode(input: string): SearchNode | null {
  let node: SearchNode | null = null;
  for (const token of searchTokens(input)) {
    const term: SearchNode = {
      kind: 'term',
      field: 'all',
      value: token,
      quoted: false,
    };
    node = node
      ? { kind: 'and', left: node, right: term }
      : term;
  }
  return node;
}

function splitTrackTags(genre: string | null): {
  genres: string[];
  regions: string[];
} {
  const genres: string[] = [];
  const regions: string[] = [];

  for (const part of (genre ?? '').split(',')) {
    const name = part.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (isRegionTag(name)) regions.push(name);
    else genres.push(name);
  }
  return { genres, regions };
}

function trackFields(
  track: TrackRow,
  album: string,
  serieKeys: string,
): TrackFields {
  const source = track.source_album ?? '(Unknown Album)';
  const albumArtists = parseArtists(track.album_artist);
  const trackArtists = parseArtists(track.artist);
  const allArtists = [
    track.album_artist,
    ...albumArtists,
    track.artist ?? '',
    ...trackArtists,
  ].join(' ');
  const albumText = [album, source].join(' ');
  const composer = track.composer ?? '';
  const { genres, regions } = splitTrackTags(track.genre);
  const genreTags = genres.map(genreKey);
  const regionTags = regions.map(regionKey);

  return {
    all: foldSearch(
      [albumText, allArtists, composer, ...genres, ...regions].join(' '),
    ),
    album: foldSearch(albumText),
    artist: foldSearch(allArtists),
    track: foldSearch(track.title),
    genre:
      genreTags.length > 0 ? `\u0000${genreTags.join('\u0000')}\u0000` : '',
    region:
      regionTags.length > 0 ? `\u0000${regionTags.join('\u0000')}\u0000` : '',
    serie: serieKeys,
    source: foldSearch(source),
    composer: foldSearch(composer),
  };
}

function matchesNode(node: SearchNode, fields: TrackFields): boolean {
  switch (node.kind) {
    case 'term': {
      if (
        node.field === 'genre' ||
        node.field === 'region' ||
        node.field === 'serie'
      ) {
        const key =
          node.field === 'genre'
            ? genreKey(node.value)
            : node.field === 'region'
              ? regionKey(node.value)
              : foldSearch(node.value).replace(/\s+/g, ' ').trim();
        if (!key || CONTROL_CHARS.test(key)) return false;
        return fields[node.field].includes(`\u0000${key}\u0000`);
      }

      const value = foldSearch(node.value).trim();
      if (!value || CONTROL_CHARS.test(value)) return false;
      return fields[node.field].includes(value);
    }
    case 'and':
      return matchesNode(node.left, fields) && matchesNode(node.right, fields);
    case 'or':
      return matchesNode(node.left, fields) || matchesNode(node.right, fields);
  }
}

/**
 * Build a predicate for track-level search. The query uses the same parser and
 * folding as the album index; each track is evaluated independently so fielded
 * searches such as `composer:beatles` narrow the track list.
 */
export function createTrackMatcher(
  album: string,
  query: string,
  serieKeys = '',
): (track: TrackRow) => boolean {
  const trimmed = query.trim();
  if (!trimmed) return () => true;

  const node = parseSearchQuery(query) ?? legacySearchNode(trimmed);
  if (!node) return () => true;

  return (track) => matchesNode(node, trackFields(track, album, serieKeys));
}
