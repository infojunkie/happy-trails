import { el } from './dom.js';

/**
 * Non-interactive warning shown when the browser cannot decode a track's
 * format natively. The visible glyph is decorative; the accessible name is
 * also exposed as a tooltip.
 */
export function unsupportedFormatBadge(): HTMLElement {
  return el(
    'span',
    {
      class: 'track-warning',
      role: 'img',
      title: 'Unsupported format',
      'aria-label': 'Unsupported format',
    },
    el('span', { class: 'track-warning-icon', 'aria-hidden': 'true', text: '⚠' }),
  );
}
