import { config, resolveDsmFrontendBase } from './config.js';
import { loadPlaybackTrackIds } from './db.js';
import { audioStationUrl, type DsmClient } from './dsm.js';
import { library } from './library.js';

export class PlaybackUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaybackUnavailableError';
  }
}

/**
 * Hands an album off to Synology Audio Station using the signed-in user's DSM
 * session. The album replaces the Audio Station web-player queue; the browser
 * then opens the Audio Station app, which shows that queue.
 */
export class PlaybackService {
  constructor() {
    console.log(
      this.enabled
        ? '[playback] Synology Audio Station handoff enabled'
        : '[playback] Synology playback disabled (DSM_FRONTEND_URL is not configured)',
    );
  }

  get enabled(): boolean {
    return (
      config.dsmFrontendUrl !== null ||
      config.dsmFrontendPath !== null
    );
  }

  /**
   * Resolve the Audio Station target for a request. A fixed frontend URL is
   * returned unchanged; a path/port configuration uses the request origin.
   * Returns null when the origin cannot be resolved.
   */
  audioStationUrlFor(origin: string | null): string | null {
    const base = resolveDsmFrontendBase(
      {
        url: config.dsmFrontendUrl,
        originPath: config.dsmFrontendPath,
        originPort: config.dsmFrontendPort,
      },
      origin,
    );
    return base ? audioStationUrl(base) : null;
  }

  async playAlbum(
    client: DsmClient,
    album: string,
    artist: string,
  ): Promise<number> {
    const sources = library.sourceAlbumsFor(album, artist);
    const sourceAlbums = sources.length > 0 ? sources : [album];
    const trackIds = await loadPlaybackTrackIds(sourceAlbums, artist);
    if (trackIds.length === 0) {
      throw new PlaybackUnavailableError(
        'No playable tracks were found for this album',
      );
    }

    await client.updateWebPlayer(trackIds);
    return trackIds.length;
  }
}

export const playback = new PlaybackService();
