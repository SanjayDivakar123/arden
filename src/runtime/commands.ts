import fs from 'fs';
import path from 'path';
import { loadCrons } from './cron.js';
import type { Agent } from './agent.js';
import { getSecret, setSecret } from '../utils/secrets.js';
import { registry } from '../tools/registry.js';

function formatMatonConnectionResult(result: unknown): string {
  const parsed = typeof result === 'string'
    ? JSON.parse(result) as { message?: string; url?: string; connect_url?: string; app?: string }
    : result as { message?: string; url?: string; connect_url?: string; app?: string };
  const url = parsed.url ?? parsed.connect_url;
  if (parsed.message) return parsed.message;
  if (url) return `Open this Maton link to finish connecting ${parsed.app ?? 'the app'}: ${url}`;
  return `Maton connection created:\n${typeof result === 'string' ? result : JSON.stringify(result)}`;
}

function formatMatonError(err: unknown): string {
  const text = String(err);
  const invalidApp = text.match(/Invalid app name:\s*([A-Za-z0-9_-]+)/i)?.[1];
  if (invalidApp) {
    return `Maton rejected app "${invalidApp}". Try an exact app slug like google-mail, zoho-mail, google-calendar, or slack.`;
  }
  return text.length > 800 ? `${text.slice(0, 800)}...` : text;
}

export async function handleSlashCommand(
  command: string,
  sessionId: string,
  agent: Agent
): Promise<string | null> {
  const trimmed = command.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = (parts[0] ?? '').toLowerCase();

  switch (cmd) {
    case '/maton': {
      const action = (parts[1] ?? '').toLowerCase();
      if (!['link', 'connect', 'create'].includes(action)) {
        return 'Usage: /maton link gmail';
      }
      const app = parts.slice(2).join(' ').trim();
      if (!app) return 'Usage: /maton link gmail';
      if (!getSecret('MATON_API_KEY')) {
        return 'Send me your Maton API key first, for example: MATON_API_KEY=your_key';
      }
      try {
        const result = await registry.call('maton_create_connection', { app }, sessionId);
        return formatMatonConnectionResult(result);
      } catch (err) {
        return `I could not create the Maton link: ${formatMatonError(err)}`;
      }
    }

    case '/secret':
    case '/setkey':
    case '/apikey':
    case '/api-key': {
      const key = cmd === '/secret' && parts[1]?.toLowerCase() === 'set'
        ? parts[2]
        : parts[1];
      const valueStart = cmd === '/secret' && parts[1]?.toLowerCase() === 'set' ? 3 : 2;
      const value = parts.slice(valueStart).join(' ').trim();
      if (!key || !value) {
        return 'Usage: /secret set MATON_API_KEY your_key';
      }
      try {
        setSecret(key, value);
        return `Saved ${key.toUpperCase()}.`;
      } catch (err) {
        return `Could not save secret: ${String(err)}`;
      }
    }

    case '/status': {
      const uptime = Math.floor(process.uptime());
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const s = uptime % 60;
      const crons = loadCrons().filter((j) => j.enabled);
      const mem = process.memoryUsage();
      return [
        'Arden gateway status',
        `Uptime: ${h}h ${m}m ${s}s`,
        `Memory: ${Math.round(mem.rss / 1024 / 1024)}MB`,
        `Active crons: ${crons.length}`,
        `Session: ${sessionId}`,
      ].join('\n');
    }

    case '/memory': {
      const workspacePath = path.resolve('./workspace');
      const memPath = path.join(workspacePath, 'MEMORY.md');
      if (!fs.existsSync(memPath)) return 'No memory file found.';
      const content = fs.readFileSync(memPath, 'utf8');
      return content.substring(0, 3000) || 'Memory is empty.';
    }

    case '/crons': {
      const jobs = loadCrons();
      if (!jobs.length) return 'No cron jobs scheduled.';
      return jobs.map((j) =>
        `${j.enabled ? '✓' : '✗'} [${j.id}]\n"${j.instruction.substring(0, 60)}"\n${j.expression}`
      ).join('\n\n');
    }

    case '/clear': {
      agent.clearSession(sessionId);
      return 'Session cleared. Starting fresh.';
    }

    case '/update': {
      const { execSync } = await import('child_process');
      try {
        execSync('npm install -g ardenai@latest', { timeout: 60000 });
        setTimeout(() => {
          execSync('arden restart gateway');
        }, 2000);
        return 'Updated to latest version. Restarting in 2 seconds...';
      } catch (err: any) {
        return `Update failed: ${err.message}`;
      }
    }

    case '/compact': {
      const summary = await agent.compactSession(sessionId);
      return `Conversation compacted. Summary:\n\n${summary}`;
    }

    default:
      return null;
  }
}
