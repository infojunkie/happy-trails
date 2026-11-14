import type { AlbumSummary } from '../shared/types.js';
import { el } from './dom.js';

/** Stable hash used to tint generated cover placeholders. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function initials(value: string): string {
  const cleaned = value.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  return letters || '♪';
}

/** Cover artwork with a deterministic gradient/initials placeholder. */
export function createCover(
  album: Pick<AlbumSummary, 'key' | 'album'>,
  extraClass = '',
): HTMLElement {
  const cover = el('span', {
    class: `cover ${extraClass}`.trim(),
    'aria-hidden': 'true',
  });
  cover.style.setProperty('--cover-hue', String(hashString(album.key) % 360));
  cover.append(
    el('span', { class: 'cover-initials', text: initials(album.album) }),
  );

  const image = el('img', {
    class: 'cover-image',
    alt: '',
    loading: 'lazy',
    decoding: 'async',
  });
  image.addEventListener('load', () => cover.classList.add('has-cover'));
  image.addEventListener('error', () => image.remove());
  image.src = `/api/albums/${encodeURIComponent(album.key)}/cover`;
  cover.append(image);

  return cover;
}
