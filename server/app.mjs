import http from 'node:http';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export const PUBLIC_LIMITS = Object.freeze({ perMinute: 5, perDay: 20, maxMessageChars: 1000, maxHistoryMessages: 6, maxHistoryChars: 6000 });
const MAX_BODY_BYTES = 32768;
const MAX_OUTPUT_TOKENS = 400;
export const MODEL = 'gpt-6-luna';
const fail = (status, code, message, retryAfter) => Object.assign(new Error(message), { status, code, retryAfter });

// Group IPv6 privacy addresses by /64; collapse IPv4-mapped IPv6 to IPv4.
export function normalizeIP(ip) {
  if (typeof ip !== 'string' || !isIP(ip) || ip.includes('%')) throw fail(403, 'invalid_client', 'Unable to verify this connection.');
  if (isIP(ip) === 4) return ip;
  let value = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const halves = value.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  const nums = groups.map(x => Number.parseInt(x, 16));
  if (nums.slice(0, 5).every(n => n === 0) && nums[5] === 65535) return [nums[6] >> 8, nums[6] & 255, nums[7] >> 8, nums[7] & 255].join('.');
  return nums.slice(0, 4).map(n => n.toString(16).padStart(4, '0')).join(':') + '::/64';
}

export function validateInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['message', 'history'].includes(k))) throw fail(400, 'invalid_request', 'Send a message and recent conversation only.');
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1000) throw fail(400, 'invalid_message', 'Please use between 1 and 1,000 characters.');
  const history = body.history ?? [];
  if (!Array.isArray(history) || history.length > 6 || history.length % 2 !== 0) throw fail(400, 'invalid_history', 'Please clear the conversation and try again.');
  let chars = 0;
  for (const [i, item] of history.entries()) {
    if (!item || typeof item !== 'object' || Object.keys(item).some(k => !['role', 'content'].includes(k)) || item.role !== (i % 2 === 0 ? 'user' : 'assistant') || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 4000 || (item.role === 'user' && item.content.length > 1000)) throw fail(400, 'invalid_history', 'Please clear the conversation and try again.');
    chars += item.content.length;
  }
  if (chars > 6000) throw fail(400, 'invalid_history', 'Please clear the conversation and try again.');
  return [...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: body.message.trim() }];
}

// UTF-8 bytes upper-bound text tokens. Include generous message framing, maximum
// output, the higher cache-write rate, and a 20% margin. Never refund reservations.
export function reserveCost(prompt, input) {
  const inputBound = Buffer.byteLength(prompt) + input.reduce((n, m) => n + Buffer.byteLength(m.content) + 128, 0) + 1024;
  return Math.ceil((inputBound * 0.125 + MAX_OUTPUT_TOKENS * 0.5) * 1.2);
}

async function readBody(req) {
  if (req.headers['content-encoding'] || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'invalid_content_type', 'Please send a JSON message.');
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw fail(413, 'request_too_large', 'This message is too large.');
  const chunks = [];
  let bytes = 0;
  const timer = setTimeout(() => req.destroy(), 8000);
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) throw fail(413, 'request_too_large', 'This message is too large.');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw fail(400, 'invalid_json', 'Please send a valid message.'); }
  } finally { clearTimeout(timer); }
}

export function createChatServer({ config, limiter, fetchImpl = fetch }) {
  if (!config.identitySalt || config.identitySalt.length < 32) throw new Error('Identity salt required');
  if (!Array.isArray(config.origins) || config.origins.length === 0) throw new Error('Origins required');
  if (Buffer.byteLength(config.prompt || '') > 16384) throw new Error('Prompt must be at most 16 KB');
  const enabled = config.enabled === true && config.promptReady === true && Boolean(config.apiKey) && Boolean(config.prompt?.trim());
  const active = new Set();
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 10000 }, async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    const json = (status, value) => { if (!res.destroyed) { res.writeHead(status); res.end(JSON.stringify(value)); } };
    let identity;
    let acquired = false;
    try {
      if (req.url === '/healthz' && req.method === 'GET') return json(200, { ok: true });
      const origin = req.headers.origin;
      if (!config.origins.includes(origin)) throw fail(403, 'origin_not_allowed', 'Please open chat from Jaeyeong’s website.');
      res.setHeader('Access-Control-Allow-Origin', origin);
      if (req.method === 'OPTIONS' && ['/v1/status', '/v1/chat'].includes(req.url)) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
        return json(204, null);
      }
      if (req.url === '/v1/status' && req.method === 'GET') return json(200, { enabled, message: enabled ? 'Ask about Jae.' : 'Coming soon — I’m getting ready to help you get to know Jae.', limits: PUBLIC_LIMITS });
      if (req.url !== '/v1/chat' || req.method !== 'POST') throw fail(404, 'not_found', 'Not found.');
      if (!enabled) throw fail(503, 'chat_disabled', 'Coming soon — please check back later.');
      const remote = req.socket.remoteAddress;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) throw fail(403, 'invalid_proxy', 'Unable to verify this connection.');
      // Production listens only on loopback behind our dedicated Cloudflare Tunnel.
      // Never accept X-Forwarded-For or a visitor-supplied session as quota identity.
      const clientIP = config.localTest === true ? remote : req.headers['cf-connecting-ip'];
      identity = createHmac('sha256', config.identitySalt).update(normalizeIP(clientIP)).digest('hex');
      if (active.has(identity)) throw fail(429, 'request_in_progress', 'Please wait for your current reply.', 5);
      if (active.size >= 2) throw fail(429, 'server_busy', 'Chat is busy. Please try again shortly.', 10);
      active.add(identity); acquired = true;
      const input = validateInput(await readBody(req));
      if (req.aborted || res.destroyed) return;
      const reservation = limiter.reserve(identity, reserveCost(config.prompt, input));
      let upstream;
      try {
        upstream = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: MODEL, instructions: config.prompt, input, reasoning: { effort: 'none' }, service_tier: 'default', max_output_tokens: MAX_OUTPUT_TOKENS, store: false }),
          signal: AbortSignal.timeout(45000),
        });
        if (!upstream.ok) throw fail(503, 'provider_unavailable', 'Chat is temporarily unavailable. Please try later.', 60);
        const result = await upstream.json();
        if (result.status === 'failed' || result.error) throw fail(503, 'provider_unavailable', 'Chat is temporarily unavailable. Please try later.', 60);
        const reply = (result.output ?? []).filter(o => o.type === 'message' && o.role === 'assistant').flatMap(o => o.content ?? []).filter(c => c.type === 'output_text' || c.type === 'refusal').map(c => c.text ?? c.refusal ?? '').join('\n').trim();
        if (!reply) throw fail(503, 'empty_reply', 'I couldn’t finish that reply. Please try later.', 60);
        limiter.finish(reservation.id, { inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens });
        return json(200, { reply, remainingToday: reservation.remainingToday });
      } catch (error) {
        // Keep the reservation: an interrupted request may still have been billed.
        throw error.status ? error : fail(503, 'provider_unavailable', 'Chat is temporarily unavailable. Please try later.', 60);
      }
    } catch (error) {
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      json(error.status || 503, { error: { code: error.code || 'service_unavailable', message: error.status ? error.message : 'Chat is temporarily unavailable.', ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) } });
    } finally { if (acquired) active.delete(identity); }
  });
  server.maxConnections = 64;
  server.keepAliveTimeout = 5000;
  return server;
}
