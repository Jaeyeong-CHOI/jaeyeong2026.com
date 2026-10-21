import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const DEFAULT_LIMITS = Object.freeze({
  ipPerMinute: 5,
  ipPerDay: 20,
  globalPerMinute: 10,
  globalPerDay: 200,
  globalPerMonth: 3000,
  dailyBudgetMicrousd: 250_000,
  monthlyBudgetMicrousd: 3_000_000,
});
const KST_OFFSET = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
}

function kstWindow(now) {
  const date = new Date(now + KST_OFFSET);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const dayStart = Date.UTC(year, month, date.getUTCDate()) - KST_OFFSET;
  return {
    dayStart,
    dayEnd: dayStart + DAY_MS,
    monthStart: Date.UTC(year, month, 1) - KST_OFFSET,
    monthEnd: Date.UTC(year, month + 1, 1) - KST_OFFSET,
  };
}

function blocked(code, message, resetMs, now) {
  return Object.assign(new Error(message), {
    status: 429,
    code,
    retryAfter: Math.max(1, Math.ceil((resetMs - now) / 1000)),
  });
}

/**
 * Persistent paid-attempt accounting. Pass only a keyed SHA-256 hex identity,
 * never an IP address, cookie value, or conversation text. Each accepted attempt
 * consumes quota before the provider call, even when that provider call fails.
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

  reserve(identity, costMicrousd, now = Date.now()) {
    if (typeof identity !== 'string' || !/^[a-f0-9]{64}$/i.test(identity)) {
      throw new TypeError('identity must be a keyed SHA-256 hex digest, not a raw IP address.');
    }
    positiveInteger(costMicrousd, 'costMicrousd');
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now + KST_OFFSET).getTime())) {
      throw new TypeError('now must be a valid nonnegative epoch millisecond integer.');
    }
    const identityKey = identity.toLowerCase();
    const { dayStart, dayEnd, monthStart, monthEnd } = kstWindow(now);
    const minuteStart = now - 60_000;
    const limit = this.#limits;

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      // The lower bound also includes the last minute of a previous month.
      const totals = this.#db.prepare(`
        SELECT
          COALESCE(SUM(created_ms > :minute), 0) AS global_minute,
          COALESCE(SUM(created_ms >= :day), 0) AS global_day,
          COALESCE(SUM(created_ms >= :month), 0) AS global_month,
          COALESCE(SUM(identity = :identity AND created_ms > :minute), 0) AS ip_minute,
          COALESCE(SUM(identity = :identity AND created_ms >= :day), 0) AS ip_day,
          COALESCE(SUM(CASE WHEN created_ms >= :day THEN cost_microusd ELSE 0 END), 0) AS cost_day,
          COALESCE(SUM(CASE WHEN created_ms >= :month THEN cost_microusd ELSE 0 END), 0) AS cost_month,
          MIN(CASE WHEN created_ms > :minute THEN created_ms END) AS global_oldest,
          MIN(CASE WHEN identity = :identity AND created_ms > :minute THEN created_ms END) AS ip_oldest
        FROM requests WHERE created_ms >= :start AND created_ms <= :now
      `).get({
        identity: identityKey, minute: minuteStart, day: dayStart,
        month: monthStart, start: Math.min(monthStart, minuteStart), now,
      });

      if (totals.ip_minute >= limit.ipPerMinute) {
        throw blocked('ip_rate_limit', 'Too many requests. Please wait a minute.', totals.ip_oldest + 60_000, now);
      }
      if (totals.ip_day >= limit.ipPerDay) {
        throw blocked('ip_daily_limit', 'Your daily message limit has been reached. Please try tomorrow.', dayEnd, now);
      }
      if (totals.global_minute >= limit.globalPerMinute) {
        throw blocked('global_rate_limit', 'The assistant is busy. Please try again shortly.', totals.global_oldest + 60_000, now);
      }
      if (totals.global_day >= limit.globalPerDay) {
        throw blocked('global_daily_limit', 'The assistant has reached its daily limit. Please try tomorrow.', dayEnd, now);
      }
      if (totals.global_month >= limit.globalPerMonth) {
        throw blocked('global_monthly_limit', 'The assistant has reached its monthly limit.', monthEnd, now);
      }
      if (costMicrousd > limit.dailyBudgetMicrousd - totals.cost_day) {
        throw blocked('daily_budget_limit', 'The assistant has reached its daily usage budget. Please try tomorrow.', dayEnd, now);
      }
      if (costMicrousd > limit.monthlyBudgetMicrousd - totals.cost_month) {
        throw blocked('monthly_budget_limit', 'The assistant has reached its monthly usage budget.', monthEnd, now);
      }

      const id = randomUUID();
      this.#db.prepare(`
        INSERT INTO requests (id, identity, created_ms, cost_microusd, status)
        VALUES (?, ?, ?, ?, 'reserved')
      `).run(id, identityKey, now, costMicrousd);
      this.#db.exec('COMMIT');
      return {
        id,
        remainingToday: Math.max(0, Math.min(limit.ipPerDay - totals.ip_day - 1, limit.globalPerDay - totals.global_day - 1)),
      };
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
