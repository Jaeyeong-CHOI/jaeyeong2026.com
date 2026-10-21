import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export const RATE_LIMIT_PER_MINUTE = 5;
const DEFAULT_LIMITS = Object.freeze({ globalPerMinute: RATE_LIMIT_PER_MINUTE });
const DAY_MS = 24 * 60 * 60 * 1000;

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
}

function blocked(code, message, resetMs, now) {
  return Object.assign(new Error(message), {
    status: 429,
    code,
    retryAfter: Math.max(1, Math.ceil((resetMs - now) / 1000)),
  });
}

/**
 * Persistent site-wide paid-attempt accounting. Each accepted attempt consumes
 * the shared minute quota before the provider call, even if that call fails.
 * No user/network identity is collected. Costs are diagnostics, not a budget cap.
 */
export class UsageLimiter {
  #db;
  #limits;

  constructor({ dbPath, limits = {} } = {}) {
    if (typeof dbPath !== 'string' || !dbPath.trim()) {
      throw new TypeError('dbPath must be a nonempty string.');
    }
    if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
      throw new TypeError('limits must be an object.');
    }
    for (const [key, value] of Object.entries(limits)) {
      if (!Object.hasOwn(DEFAULT_LIMITS, key)) throw new TypeError(`Unknown limit: ${key}`);
      positiveInteger(value, key);
    }
    this.#limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits });
    this.#db = new DatabaseSync(dbPath);
    try {
      this.#db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS requests (
          id TEXT PRIMARY KEY,
          identity TEXT NOT NULL,
          created_ms INTEGER NOT NULL,
          cost_microusd INTEGER NOT NULL CHECK (cost_microusd > 0),
          status TEXT NOT NULL CHECK (status IN ('reserved', 'completed')),
          input_tokens INTEGER,
          output_tokens INTEGER
        );
        CREATE INDEX IF NOT EXISTS requests_created_idx ON requests(created_ms);
        CREATE INDEX IF NOT EXISTS requests_identity_created_idx ON requests(identity, created_ms);
      `);
      this.#db.prepare('DELETE FROM requests WHERE created_ms < ?').run(Date.now() - 90 * DAY_MS);
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  reserve(costMicrousd, now = Date.now()) {
    positiveInteger(costMicrousd, 'costMicrousd');
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
      throw new TypeError('now must be a valid nonnegative epoch millisecond integer.');
    }
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const totals = this.#db.prepare(`
        SELECT COUNT(*) AS count, MIN(created_ms) AS oldest
        FROM requests WHERE created_ms > ? AND created_ms <= ?
      `).get(now - 60_000, now);
      if (totals.count >= this.#limits.globalPerMinute) {
        throw blocked('global_rate_limit', `The site-wide limit is ${this.#limits.globalPerMinute} requests per minute. Please try again shortly.`, totals.oldest + 60_000, now);
      }
      const id = randomUUID();
      // Keep the existing schema/history; old per-network rows also count toward
      // the shared minute window. New rows no longer identify visitors.
      this.#db.prepare(`
        INSERT INTO requests (id, identity, created_ms, cost_microusd, status)
        VALUES (?, 'global', ?, ?, 'reserved')
      `).run(id, now, costMicrousd);
      this.#db.exec('COMMIT');
      return { id };
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Diagnostics only: completing a request never refunds its cost or quota. */
  finish(id, { inputTokens, outputTokens } = {}) {
    if (typeof id !== 'string' || !id) throw new TypeError('id must be a request ID.');
    for (const [name, value] of Object.entries({ inputTokens, outputTokens })) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new TypeError(`${name} must be a nonnegative safe integer.`);
      }
    }
    const row = this.#db.prepare('SELECT status FROM requests WHERE id = ?').get(id);
    if (!row) throw new RangeError('Unknown request ID.');
    // Repeated finish calls leave the original diagnostics unchanged.
    this.#db.prepare(`
      UPDATE requests SET status = 'completed', input_tokens = ?, output_tokens = ?
      WHERE id = ? AND status = 'reserved'
    `).run(inputTokens ?? null, outputTokens ?? null, id);
  }

  close() {
    this.#db.close();
  }
}
