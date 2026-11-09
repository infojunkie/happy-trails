import type {
  AlbumsResponse,
  FilterMode,
  GenresResponse,
  SessionResponse,
  SortKey,
  StatusResponse,
  TracksResponse,
} from '../shared/types.js';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') message = body.error;
    } catch {
      // Keep the generic message when the body is not JSON.
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

function getJson<T>(url: string): Promise<T> {
  return requestJson<T>(url);
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface AlbumRequest {
  genres: string[];
  genreMode: FilterMode;
  regions: string[];
  regionMode: FilterMode;
  q: string;
  sort: SortKey;
  offset: number;
  limit: number;
}

export const api = {
  status: (): Promise<StatusResponse> => getJson<StatusResponse>('/api/status'),

  session: (): Promise<SessionResponse> => getJson<SessionResponse>('/api/session'),

  login: (username: string, password: string): Promise<SessionResponse> =>
    postJson<SessionResponse>('/api/session/login', { username, password }),

  logout: (): Promise<SessionResponse> =>
    postJson<SessionResponse>('/api/session/logout', {}),

  genres: (): Promise<GenresResponse> => getJson<GenresResponse>('/api/genres'),

  albums: (request: AlbumRequest): Promise<AlbumsResponse> => {
    const params = new URLSearchParams();
    for (const genre of request.genres) params.append('genre', genre);
    for (const region of request.regions) params.append('region', region);
    params.set('genreMode', request.genreMode);
    params.set('regionMode', request.regionMode);
    if (request.q) params.set('q', request.q);
    params.set('sort', request.sort);
    params.set('offset', String(request.offset));
    params.set('limit', String(request.limit));
    return getJson<AlbumsResponse>(`/api/albums?${params.toString()}`);
  },

  tracks: (key: string, query = ''): Promise<TracksResponse> => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    const search = params.toString();
    return getJson<TracksResponse>(
      `/api/albums/${encodeURIComponent(key)}/tracks${search ? `?${search}` : ''}`,
    );
  },

  artworkAvailable: async (key: string): Promise<boolean> => {
    try {
      const response = await fetch(
        `/api/albums/${encodeURIComponent(key)}/artwork`,
        { method: 'HEAD', headers: { Accept: 'application/pdf' } },
      );
      return response.ok;
    } catch {
      return false;
    }
  },
};
