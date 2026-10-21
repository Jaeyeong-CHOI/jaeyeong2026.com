import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MAX_PROMPT_BYTES } from './constants.mjs';

const action = process.argv[2];
if (!['status', 'enable', 'disable'].includes(action)) {
  console.error('Usage: node server/manage.mjs status|enable|disable');
  process.exit(1);
}
const path = process.env.CHAT_CONFIG || join(homedir(), '.config/jaeyeong2026-chat/config.json');
const config = JSON.parse(readFileSync(path, 'utf8'));
if (action !== 'status') {
  if (action === 'enable') {
    const prompt = readFileSync(config.promptFile, 'utf8');
    if (!prompt.trim() || prompt.includes('PROMPT_PENDING') || Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) {
      console.error(`Install the final system prompt first (nonempty, at most ${MAX_PROMPT_BYTES / 1024} KiB).`);
      process.exit(1);
    }
  }
  config.enabled = action === 'enable';
  config.promptReady = action === 'enable';
  writeFileSync(path + '.tmp', JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  renameSync(path + '.tmp', path);
  execFileSync('/bin/launchctl', ['kickstart', '-k', `gui/${process.getuid()}/ai.openclaw.jaeyeong-chat`]);
}
console.log(JSON.stringify({ enabled: config.enabled && config.promptReady, promptFile: config.promptFile, port: config.port }));
