import { $ } from './dom.js';

const dialog = $<HTMLDialogElement>('#cover-lightbox');
const title = $('#cover-lightbox-title');
const stage = $('#cover-lightbox-stage');
const image = $<HTMLImageElement>('#cover-lightbox-image');
const error = $('#cover-lightbox-error');
const closeButton = $<HTMLButtonElement>('#cover-lightbox-close');

let usingFallback = false;

function originalCoverUrl(albumKey: string): string {
  return `/api/albums/${encodeURIComponent(albumKey)}/cover/original`;
}

function fallbackCoverUrl(albumKey: string): string {
  return `/api/albums/${encodeURIComponent(albumKey)}/cover`;
}

/**
 * Show a full-size album cover in the shared lightbox.
 *
 * The native modal dialog supplies Escape handling, the top layer, and focus
 * trapping. The X button and a click on the dark backdrop dismiss it; clicking
 * the image itself does not.
 */
export function openCoverLightbox(
  albumKey: string,
  album: string,
  artist: string,
): void {
  const label = artist
    ? `Cover of ${album} by ${artist}`
    : `Cover of ${album}`;
  usingFallback = false;
  title.textContent = album;
  title.title = label;
  image.hidden = false;
  error.hidden = true;
  image.alt = label;
  dialog.dataset.albumKey = albumKey;
  image.src = originalCoverUrl(albumKey);
  dialog.setAttribute('aria-label', label);
  if (!dialog.open) dialog.showModal();
  closeButton.focus();
}

closeButton.addEventListener('click', () => {
  dialog.close();
});

dialog.addEventListener('click', (event) => {
  // The header, image, and close button stop at their own targets. The dark
  // area around the image targets the stage; the dialog itself is also a
  // dismissible fallback.
  if (event.target === dialog || event.target === stage) dialog.close();
});

image.addEventListener('error', () => {
  if (!dialog.open) return;
  if (!usingFallback) {
    // Not every album has a full-resolution file; fall back to Synology's
    // 480px AudioStation cover.
    usingFallback = true;
    image.src = fallbackCoverUrl(
      dialog.dataset.albumKey ?? '',
    );
    return;
  }
  image.hidden = true;
  error.hidden = false;
});

dialog.addEventListener('close', () => {
  // Abort an in-flight image request and reset the state for the next cover.
  image.removeAttribute('src');
  image.hidden = false;
  error.hidden = true;
  title.textContent = 'Cover';
  usingFallback = false;
  delete dialog.dataset.albumKey;
});
