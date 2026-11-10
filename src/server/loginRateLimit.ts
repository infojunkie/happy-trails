import { config } from './config.js';

/** Hard cap on tracked keys so sprayed usernames cannot grow memory forever. */
const MAX_ENTRIES = 10_000;

interface Entry {
  count: number;
  resetAt: number;
}

export interface LoginRateLimitOptions {
  /** Failed attempts allowed per client IP per window. */
  ipMax: number;
  /** Failed attempts allowed per account per window. */
  accountMax: number;
  windowMs: number;
}

/**
 * In-memory fixed-window limiter for sign-in attempts.
 *
 * Failures are counted per client IP and per account. The account counter
 * stops a single account from being brute-forced even when requests arrive
 * through a shared proxy address; the IP counter stops one address from
 * spraying many account names. A successful sign-in clears that account's
 * failures. All state is in memory and expires with the window.
 */
export class LoginRateLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly options: LoginRateLimitOptions) {}

  /** Seconds to wait before retrying, or 0 when the attempt may proceed. */
  check(ip: string | null, account: string, now = Date.now()): number {
    return Math.max(
      this.retryAfter(this.ipKey(ip), this.options.ipMax, now),
      this.retryAfter(
        this.accountKey(account),
        this.options.accountMax,
        now,
      ),
    );
  }

  /**
   * Record the outcome of an attempt that reached the authentication step.
   * Only credential failures should be passed as `success: false`; transport
   * errors (DSM unreachable) must not lock accounts out.
   */
  record(
    ip: string | null,
    account: string,
    success: boolean,
    now = Date.now(),
  ): void {
    const accountKey = this.accountKey(account);
    if (success) {
      this.entries.delete(accountKey);
      return;
    }

    this.increment(this.ipKey(ip), now);
    this.increment(accountKey, now);
    this.prune(now);
  }

  private ipKey(ip: string | null): string | null {
    return ip ? `ip:${ip}` : null;
  }

  private accountKey(account: string): string {
    // DSM accounts are matched case-insensitively by the app.
    return `account:${account.trim().toLowerCase()}`;
  }

  private retryAfter(key: string | null, max: number, now: number): number {
    if (!key) return 0;
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now || entry.count < max) return 0;
    return Math.max(1, Math.ceil((entry.resetAt - now) / 1_000));
  }

  private increment(key: string | null, now: number): void {
    if (!key) return;
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      this.entries.set(key, {
        count: 1,
        resetAt: now + this.options.windowMs,
      });
      return;
    }
    entry.count += 1;
  }

  private prune(now: number): void {
    if (this.entries.size <= MAX_ENTRIES) return;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export const loginRateLimiter = new LoginRateLimiter({
  ipMax: config.loginRateLimitMax,
  accountMax: config.loginAccountLimitMax,
  windowMs: config.loginRateLimitWindowMs,
});
