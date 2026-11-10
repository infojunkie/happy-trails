import { config, resolveDsmFrontendBase } from './config.js';
import {
  loadPlaybackTrackIdForMusicId,
  loadPlaybackTrackIds,
  loadPlaybackTrackIdsForMusicIds,
  loadTracks,
} from './db.js';
import { audioStationUrl, type DsmClient } from './dsm.js';
import { library } from './library.js';
import { createTrackMatcher } from './trackSearch.js';

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
    return config.dsmFrontendUrl !== null || config.dsmFrontendPort !== null;
  }

  /**
   * Resolve the Audio Station target for a request. A fixed frontend URL is
   * returned unchanged; a ":port" configuration applies the port to the
   * allow-listed origin the browser used. Returns null when the origin cannot
   * be resolved.
   */
  audioStationUrlFor(origin: string | null): string | null {
    const base = resolveDsmFrontendBase(
      {
        url: config.dsmFrontendUrl,
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
    query: string | null = null,
  ): Promise<number> {
    const sources = library.sourceAlbumsFor(album, artist);
    const sourceAlbums = sources.length > 0 ? sources : [album];

    let trackIds: number[];
    if (query && query.trim()) {
      const rows = await loadTracks(sourceAlbums, album, artist);
      const matches = createTrackMatcher(album, query);
      trackIds = await loadPlaybackTrackIdsForMusicIds(
        rows.filter((row) => matches(row)).map((row) => row.id),
      );
      if (trackIds.length === 0) {
        throw new PlaybackUnavailableError(
          'No tracks in this album match the current search',
        );
      }
    } else {
      trackIds = await loadPlaybackTrackIds(sourceAlbums, artist);
      if (trackIds.length === 0) {
        throw new PlaybackUnavailableError(
          'No playable tracks were found for this album',
        );
      }
    }

    await client.updateWebPlayer(trackIds);
    return trackIds.length;
  }

  async playTrack(client: DsmClient, musicId: number): Promise<number> {
    const audioStationId = await loadPlaybackTrackIdForMusicId(musicId);
    if (audioStationId === null) {
      throw new PlaybackUnavailableError(
        'No playable copy of this track was found',
      );
    }
    await client.updateWebPlayer([audioStationId]);
    return 1;
  }
}

export const playback = new PlaybackService();
