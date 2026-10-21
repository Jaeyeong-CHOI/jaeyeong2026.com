import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createChatServer } from './app.mjs';
import { UsageLimiter } from './limiter.mjs';

process.umask(0o077);
const configPath = process.env.CHAT_CONFIG || join(homedir(), '.config/jaeyeong2026-chat/config.json');
const settings = JSON.parse(readFileSync(configPath, 'utf8'));
const config = { ...settings, apiKey: process.env.OPENAI_API_KEY, prompt: readFileSync(settings.promptFile, 'utf8') };
if (!Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535) throw new Error('Invalid port');
mkdirSync(dirname(settings.dbPath), { recursive: true, mode: 0o700 });
const limiter = new UsageLimiter({ dbPath: settings.dbPath });
chmodSync(settings.dbPath, 0o600);
const server = createChatServer({ config, limiter });
server.listen(settings.port, '127.0.0.1', () => console.log(`Chat API listening on loopback:${settings.port}; public chat ${config.enabled && config.promptReady ? 'enabled' : 'disabled'}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { limiter.close(); process.exit(0); }));
