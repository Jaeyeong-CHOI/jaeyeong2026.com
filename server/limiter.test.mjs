import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { UsageLimiter } from './limiter.mjs';

const BASE = Date.UTC(2030, 5, 15, 3); // Noon KST; safely beyond startup retention pruning.
const who = (value = 'visitor') => createHash('sha256').update(value).digest('hex');
function create(t, limits = {}, dbPath = ':memory:') {
  const limiter = new UsageLimiter({ dbPath, limits });
  t.after(() => limiter.close());
  return limiter;
}
function rejects(fn, code, retryAfter) {
  assert.throws(fn, (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.code, code);
    assert.equal(typeof error.message, 'string');
    assert.ok(Number.isInteger(error.retryAfter) && error.retryAfter > 0);
    if (retryAfter !== undefined) assert.equal(error.retryAfter, retryAfter);
    return true;
  });
}

test('IP minute ceiling allows exactly five; rolling boundary expires precisely', (t) => {
  const limiter = create(t);
  for (let i = 0; i < 5; i++) limiter.reserve(who(), 1, BASE);
  rejects(() => limiter.reserve(who(), 1, BASE + 1), 'ip_rate_limit', 60);
  rejects(() => limiter.reserve(who(), 1, BASE + 59_999), 'ip_rate_limit', 1);
  assert.equal(limiter.reserve(who(), 1, BASE + 60_000).remainingToday, 14);
});

test('IP daily ceiling counts all accepted attempts and rejects attempt twenty-one', (t) => {
  const limiter = create(t);
  for (let i = 0; i < 20; i++) {
    assert.equal(limiter.reserve(who(), 1, BASE + i * 60_000).remainingToday, 19 - i);
  }
  rejects(() => limiter.reserve(who(), 1, BASE + 21 * 60_000), 'ip_daily_limit');
});

test('global minute cap spans distinct identities', (t) => {
  const limiter = create(t);
  for (let i = 0; i < 10; i++) limiter.reserve(who(String(i)), 1, BASE);
  rejects(() => limiter.reserve(who('eleventh'), 1, BASE), 'global_rate_limit', 60);
  limiter.reserve(who('eleventh'), 1, BASE + 60_000);
});

test('global daily cap reaches its configured exact ceiling', (t) => {
  const limiter = create(t, { globalPerDay: 3 });
  for (let i = 0; i < 3; i++) limiter.reserve(who(String(i)), 1, BASE);
  rejects(() => limiter.reserve(who('fourth'), 1, BASE), 'global_daily_limit');
});

test('global monthly ceiling counts previous KST days', (t) => {
  const limiter = create(t, { globalPerMonth: 2 });
  limiter.reserve(who('one'), 1, BASE);
  limiter.reserve(who('two'), 1, BASE + 86_400_000);
  rejects(() => limiter.reserve(who('three'), 1, BASE + 2 * 86_400_000), 'global_monthly_limit');
});

test('daily budget permits exact amount and no overage; rejected reservation consumes nothing', (t) => {
  const limiter = create(t, { dailyBudgetMicrousd: 100 });
  limiter.reserve(who(), 60, BASE);
  rejects(() => limiter.reserve(who(), 41, BASE), 'daily_budget_limit');
  assert.equal(limiter.reserve(who(), 40, BASE).remainingToday, 18);
  rejects(() => limiter.reserve(who(), 1, BASE), 'daily_budget_limit');
});

test('monthly budget persists over daily resets and accepts exact ceiling', (t) => {
  const limiter = create(t, { monthlyBudgetMicrousd: 100 });
  limiter.reserve(who(), 60, BASE);
  limiter.reserve(who(), 40, BASE + 86_400_000);
  rejects(() => limiter.reserve(who(), 1, BASE + 2 * 86_400_000), 'monthly_budget_limit');
});

test('KST midnight resets daily quotas, not the rolling minute window', (t) => {
  const limiter = create(t, { ipPerDay: 1 });
  const midnight = Date.UTC(2030, 5, 15, 15);
  limiter.reserve(who(), 1, midnight - 1);
  rejects(() => limiter.reserve(who(), 1, midnight - 1), 'ip_daily_limit', 1);
  assert.equal(limiter.reserve(who(), 1, midnight).remainingToday, 0);
});

test('KST month boundary resets monthly quota/budget but retains prior-month rolling minute', (t) => {
  const limiter = create(t, { globalPerMonth: 1, monthlyBudgetMicrousd: 1, ipPerMinute: 1 });
  const monthStart = Date.UTC(2030, 6, 1, 0) - 9 * 3_600_000;
  limiter.reserve(who(), 1, monthStart - 1);
  rejects(() => limiter.reserve(who(), 1, monthStart), 'ip_rate_limit', 60);
  limiter.reserve(who(), 1, monthStart + 60_000);
});

test('restart and independent DB connection preserve and share reservation quota', (t) => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'site-chat-limiter-')), 'usage.sqlite');
  const initial = new UsageLimiter({ dbPath, limits: { ipPerDay: 2 } });
  initial.reserve(who(), 1, BASE);
  initial.close();
  const restarted = create(t, { ipPerDay: 2 }, dbPath);
  const peer = create(t, { ipPerDay: 2 }, dbPath);
  assert.equal(restarted.reserve(who(), 1, BASE + 60_000).remainingToday, 0);
  rejects(() => peer.reserve(who(), 1, BASE + 120_000), 'ip_daily_limit');
});

test('provider failure and finish preserve full reserved spend; diagnostics contain no text', (t) => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'site-chat-finish-')), 'usage.sqlite');
  const limiter = create(t, { dailyBudgetMicrousd: 100 }, dbPath);
  const successful = limiter.reserve(who(), 50, BASE);
  limiter.finish(successful.id, { inputTokens: 12, outputTokens: 4 });
  const failed = limiter.reserve(who('failed'), 50, BASE);
  limiter.finish(failed.id);
  rejects(() => limiter.reserve(who(), 1, BASE), 'daily_budget_limit');
  const db = new DatabaseSync(dbPath);
  t.after(() => db.close());
  const records = db.prepare('SELECT * FROM requests ORDER BY rowid').all();
  assert.equal(records.length, 2);
  assert.equal(records[0].cost_microusd, 50);
  assert.equal(records[0].status, 'completed');
  assert.equal(records[0].input_tokens, 12);
  assert.equal(records[1].cost_microusd, 50);
  assert.equal(records[1].input_tokens, null);
  assert.match(records[1].identity, /^[a-f0-9]{64}$/);
});

test('unfinished/crashed provider attempts retain reservations after restart', (t) => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'site-chat-pending-')), 'usage.sqlite');
  const initial = new UsageLimiter({ dbPath, limits: { dailyBudgetMicrousd: 50 } });
  initial.reserve(who(), 50, BASE);
  initial.close();
  const restarted = create(t, { dailyBudgetMicrousd: 50 }, dbPath);
  rejects(() => restarted.reserve(who(), 1, BASE + 60_000), 'daily_budget_limit');
});

test('startup retention prunes only data older than ninety days', (t) => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'site-chat-retention-')), 'usage.sqlite');
  const initial = new UsageLimiter({ dbPath });
  const now = Date.now();
  initial.reserve(who('old'), 1, now - 91 * 86_400_000);
  initial.reserve(who('recent'), 1, now - 89 * 86_400_000);
  initial.reserve(who('today'), 1, now);
  initial.close();
  create(t, {}, dbPath);
  const db = new DatabaseSync(dbPath);
  t.after(() => db.close());
  const identities = db.prepare('SELECT identity FROM requests').all().map((row) => row.identity);
  assert.equal(identities.length, 2);
  assert.ok(!identities.includes(who('old')));
});

test('invalid limits, costs, identity, timestamps, and diagnostics are rejected', (t) => {
  for (const limits of [{ ipPerDay: 0 }, { ipPerMinute: -1 }, { globalPerMonth: 1.5 }, { wrong: 5 }, { dailyBudgetMicrousd: Infinity }, null]) {
    assert.throws(() => new UsageLimiter({ dbPath: ':memory:', limits }), TypeError);
  }
  const limiter = create(t);
  for (const cost of [0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => limiter.reserve(who(), cost, BASE), TypeError);
  }
  assert.throws(() => limiter.reserve('127.0.0.1', 1, BASE), TypeError);
  assert.throws(() => limiter.reserve(who(), 1, NaN), TypeError);
  const request = limiter.reserve(who(), 1, BASE);
  assert.throws(() => limiter.finish(request.id, { inputTokens: -1 }), TypeError);
  assert.throws(() => limiter.finish('not-found'), RangeError);
  limiter.finish(request.id, { inputTokens: 0, outputTokens: 0 });
});
