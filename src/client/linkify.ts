import { el } from './dom.js';

/** Absolute http(s) URLs, stopping at whitespace or markup delimiters. */
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

/** Punctuation that usually ends the sentence rather than the URL. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

function trimTrailingPunctuation(value: string): string {
  let url = value;
  while (TRAILING_PUNCTUATION.test(url)) {
    url = url.slice(0, -1);
  }
  return url;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Turn a plain-text value into DOM nodes, with absolute http(s) URLs rendered
 * as external links. Everything else stays a text node, so metadata cannot
 * inject markup.
 */
export function linkifiedText(text: string): Array<Node | string> {
  const nodes: Array<Node | string> = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimTrailingPunctuation(match[0]);
    if (!url || !isHttpUrl(url)) continue;

    const start = match.index ?? cursor;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      el(
        'a',
        {
          class: 'comment-link',
          href: url,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        url,
      ),
    );
    cursor = start + url.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
