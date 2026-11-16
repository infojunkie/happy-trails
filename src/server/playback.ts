import { config, resolveDsmFrontendBase } from './config.js';
import {
  loadPlaybackTrackIdForMusicId,
  loadPlaybackTrackIds,
  loadPlaybackTrackIdsForMusicIds,
  loadTracks,
} from './db.js';
import {
  audioStationUrl,
  type AudioStream,
  type DsmClient,
} from './dsm.js';
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
      config.nativePlaybackEnabled
        ? '[playback] Native streaming enabled'
        : '[playback] Native streaming disabled (NATIVE_PLAYBACK_ENABLED=false or DSM_URL is not configured)',
    );
    console.log(
      this.enabled
        ? '[playback] Audio Station fallback enabled'
        : '[playback] Audio Station fallback disabled',
    );
  }

  /** Whether the Audio Station handoff is offered as a fallback. */
  get enabled(): boolean {
    return config.audioStationFallbackEnabled;
  }

  /**
   * Open a track's audio stream for the native player. The music id is mapped
   * to the Audio Station song id; the returned stream is piped to the browser.
   */
  async openStream(
    client: DsmClient,
    musicId: number,
    options: {
      range?: string;
      ifRange?: string;
      method?: 'GET' | 'HEAD';
    } = {},
  ): Promise<AudioStream | null> {
    const audioStationId = await loadPlaybackTrackIdForMusicId(musicId);
    if (audioStationId === null) return null;
    return client.openAudioStream(audioStationId, options);
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
