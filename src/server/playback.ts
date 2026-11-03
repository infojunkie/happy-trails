import { config } from './config.js';
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
      config.dsmUrl
        ? '[playback] Synology Audio Station handoff enabled'
        : '[playback] Synology playback disabled (DSM_URL is not configured)',
    );
  }

  get enabled(): boolean {
    return config.dsmUrl !== null;
  }

  get audioStationUrl(): string | null {
    return config.dsmUrl ? audioStationUrl(config.dsmUrl) : null;
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
