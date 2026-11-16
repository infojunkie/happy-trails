/**
 * File extensions that current desktop and mobile browsers can decode
 * natively. Keep this conservative: unsupported tracks get a warning in the
 * UI and can fall back to Audio Station.
 */
const BROWSER_AUDIO_EXTENSIONS = new Set([
  'aac',
  'flac',
  'm4a',
  'mp3',
  'mp4',
  'oga',
  'ogg',
  'opus',
  'wav',
  'wave',
  'weba',
  'webm',
]);

/** Whether the file extension maps to a browser-native audio format. */
export function isPlayableAudioExtension(
  value: string | null | undefined,
): boolean {
  const extension = (value ?? '').trim().toLowerCase();
  return extension.length > 0 && BROWSER_AUDIO_EXTENSIONS.has(extension);
}
