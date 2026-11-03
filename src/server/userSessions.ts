import crypto from 'node:crypto';
import type { Request } from 'express';
import { config } from './config.js';
import { DsmClient } from './dsm.js';

const SESSION_COOKIE = 'mw_session';
const SESSION_TTL_MS = 8 * 60 * 60_000;
const CLEANUP_INTERVAL_MS = 10 * 60_000;

export interface UserSession {
  client: DsmClient;
  account: string;
  expiresAt: number;
}

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/**
 * In-memory, per-browser DSM sessions established with the user's own
 * credentials. Passwords are never written to disk or returned to the browser;
 * the DsmClient holds them in memory only so it can renew an expired token.
 */
export class UserSessionStore {
  readonly cookieName = SESSION_COOKIE;
  private readonly sessions = new Map<string, UserSession>();
  private readonly timer: NodeJS.Timeout;

  constructor() {
    this.timer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  get enabled(): boolean {
    return config.dsmUrl !== null;
  }

  async login(
    username: string,
    password: string,
  ): Promise<{ sessionId: string; account: string }> {
    const url = config.dsmUrl;
    if (!url) throw new Error('Synology DSM URL is not configured');

    const client = new DsmClient({
      url,
      user: username,
      pass: password,
      timeoutMs: config.dsmTimeoutMs,
      rejectUnauthorized: config.dsmRejectUnauthorized,
    });
    const account = await client.connect();

    const sessionId = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(sessionId, {
      client,
      account,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return { sessionId, account };
  }

  get(req: Request): UserSession | null {
    const sessionId = cookieValue(req, SESSION_COOKIE);
    if (!sessionId) return null;

    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  destroy(req: Request): void {
    const sessionId = cookieValue(req, SESSION_COOKIE);
    if (sessionId) this.sessions.delete(sessionId);
  }

  cookieOptions(req: Request) {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: req.secure,
      path: '/',
      maxAge: SESSION_TTL_MS,
    };
  }

  clearCookieOptions(req: Request) {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: req.secure,
      path: '/',
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }
}

export const userSessions = new UserSessionStore();
