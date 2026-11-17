/** Messages exchanged between Library and the index builder worker. */

export interface IndexWorkerData {
  databasePath: string;
  version: number;
}

export type IndexWorkerMessage =
  | {
      ok: true;
      fingerprint: string;
      albumCount: number;
      trackCount: number;
      databaseBytes: number;
    }
  | { ok: false; error: string };
