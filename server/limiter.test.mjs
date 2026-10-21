import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { UsageLimiter, RATE_LIMIT_PER_MINUTE } from './limiter.mjs';

const BASE = Date.UTC(2030, 5, 15, 3); // Noon KST; beyond startup retention pruning.
function create(t, limits = {}, dbPath = ':memory:') {
  const limiter = new UsageLimiter({ dbPath, limits });
  t.after(() => limiter.close());
  return limiter;
}
function rejects(fn, retryAfter) {
  assert.throws(fn, (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.code, 'global_rate_limit');
    assert.equal(typeof error.message, 'string');
    assert.ok(Number.isInteger(error.retryAfter) && error.retryAfter > 0);
    if (retryAfter !== undefined) assert.equal(error.retryAfter, retryAfter);
    return true;
  });
}

test('shared rolling minute allows exactly five; rejected calls do not move the reset boundary', (t) => {
  const limiter = create(t);
  assert.equal(RATE_LIMIT_PER_MINUTE, 5);
  for (let i = 0; i < 5; i++) {
    const reservation = limiter.reserve(1, BASE + i * 1000);
    assert.ok(reservation.id);
    assert.equal(Object.hasOwn(reservation, 'remainingToday'), false);
  }
  rejects(() => limiter.reserve(1, BASE + 5000), 55);
  rejects(() => limiter.reserve(1, BASE + 59_999), 1);
  limiter.reserve(1, BASE + 60_000);
  rejects(() => limiter.reserve(1, BASE + 60_000), 1);
  limiter.reserve(1, BASE + 61_000);
});

test('daily/monthly counts and cost estimates never deny requests outside the rolling minute', (t) => {
  const limiter = create(t);
  // 3,001 attempts within eleven hours exceed both former count ceilings.
  // Every individual estimate also exceeds the former monthly budget.
  for (let i = 0; i < 3001; i++) {
    const reservation = limiter.reserve(4_000_000, BASE + i * 13_000);
    assert.ok(reservation.id);
  }
});

test('day and month boundaries do not reset the shared rolling-minute window', (t) => {
  for (const boundary of [Date.UTC(2030, 5, 15, 15), Date.UTC(2030, 5, 30, 15)]) {
    const limiter = create(t);
    for (let i = 0; i < 5; i++) limiter.reserve(1, boundary - 1);
    rejects(() => limiter.reserve(1, boundary), 60);
    limiter.reserve(1, boundary + 59_999);
  }
});

test('restart and independent DB connections preserve and share minute reservations', (t) => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'site-chat-limiter-')), 'usage.sqlite');
  const initial = new UsageLimiter({ dbPath });
  for (let i = 0; i < 3; i++) initial.reserve(1, BASE);
  initial.close();
  const restarted = create(t, {}, dbPath);
  const peer = create(t, {}, dbPath);
  restarted.reserve(1, BASE + 1000);
  peer.reserve(1, BASE + 2000);
  rejects(() => restarted.reserve(1, BASE + 3000), 57);
  rejects(() => peer.reserve(1, BASE + 3000), 57);
  peer.reserve(1, BASE + 60_000);
});

test('old schema with per-network identities remains readable and counts toward the shared minute', (t) => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'site-chat-legacy-')), 'usage.sqlite');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE requests (
      id TEXT PRIMARY KEY,
      identity TEXT NOT NULL,
      created_ms INTEGER NOT NULL,
      cost_microusd INTEGER NOT NULL CHECK (cost_microusd > 0),
      status TEXT NOT NULL CHECK (status IN ('reserved', 'completed')),
      input_tokens INTEGER,
      output_tokens INTEGER
    );
    CREATE INDEX requests_created_idx ON requests(created_ms);
    CREATE INDEX requests_identity_created_idx ON requests(identity, created_ms);
  `);
  const insert = legacy.prepare("INSERT INTO requests (id, identity, created_ms, cost_microusd, status) VALUES (?, ?, ?, ?, 'reserved')");
  for (let i = 0; i < 5; i++) insert.run(`legacy-${i}`, String(i).repeat(64), BASE, 100);
  legacy.close();
  const limiter = create(t, {}, dbPath);
  rejects(() => limiter.reserve(1, BASE + 1), 60);
  const next = limiter.reserve(1, BASE + 60_000);
  const db = new DatabaseSync(dbPath);
  t.after(() => db.close());
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM requests').get().total, 6);
  assert.equal(db.prepare('SELECT identity FROM requests WHERE id = ?').get(next.id).identity, 'global');
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM requests WHERE id LIKE 'legacy-%'").get().total, 5);
});

test('finished and failed provider attempts both keep minute reservations and cost diagnostics', (t) => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'site-chat-finish-')), 'usage.sqlite');
  const limiter = create(t, {}, dbPath);
  const successful = limiter.reserve(50, BASE);
  limiter.finish(successful.id, { inputTokens: 12, outputTokens: 4 });
  limiter.finish(successful.id, { inputTokens: 999, outputTokens: 999 });
  for (let i = 0; i < 4; i++) limiter.reserve(50, BASE);
  rejects(() => limiter.reserve(1, BASE), 60);
  const db = new DatabaseSync(dbPath);
  t.after(() => db.close());
  const records = db.prepare('SELECT * FROM requests ORDER BY rowid').all();
  assert.equal(records.length, 5);
  assert.equal(records[0].cost_microusd, 50);
  assert.equal(records[0].status, 'completed');
  assert.equal(records[0].input_tokens, 12);
  assert.equal(records[1].status, 'reserved');
  assert.equal(records[1].input_tokens, null);
  assert.ok(records.every(row => row.identity === 'global'));
});

test('startup retention prunes only data older than ninety days', (t) => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'site-chat-retention-')), 'usage.sqlite');
  const initial = new UsageLimiter({ dbPath });
  const now = Date.now();
  const old = initial.reserve(1, now - 91 * 86_400_000);
  initial.reserve(1, now - 89 * 86_400_000);
  initial.reserve(1, now);
  initial.close();
  create(t, {}, dbPath);
  const db = new DatabaseSync(dbPath);
  t.after(() => db.close());
  const ids = db.prepare('SELECT id FROM requests').all().map((row) => row.id);
  assert.equal(ids.length, 2);
  assert.ok(!ids.includes(old.id));
});

test('invalid minute limits, removed limit options, costs, timestamps and diagnostics are rejected', (t) => {
  for (const limits of [{ globalPerMinute: 0 }, { globalPerMinute: -1 }, { globalPerMinute: 1.5 }, { globalPerMinute: Infinity }, { ipPerDay: 20 }, { ipPerMinute: 5 }, { globalPerDay: 200 }, { globalPerMonth: 3000 }, { dailyBudgetMicrousd: 1 }, { monthlyBudgetMicrousd: 1 }, { wrong: 5 }, null]) {
    assert.throws(() => new UsageLimiter({ dbPath: ':memory:', limits }), TypeError);
  }
  const limiter = create(t);
  for (const cost of [0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '127.0.0.1']) {
    assert.throws(() => limiter.reserve(cost, BASE), TypeError);
  }
  for (const time of [NaN, Infinity, -1, 1.5]) assert.throws(() => limiter.reserve(1, time), TypeError);
  const request = limiter.reserve(1, BASE);
  assert.throws(() => limiter.finish(request.id, { inputTokens: -1 }), TypeError);
  assert.throws(() => limiter.finish('not-found'), RangeError);
  limiter.finish(request.id, { inputTokens: 0, outputTokens: 0 });
});
