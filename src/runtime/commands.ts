import fs from 'fs';
import path from 'path';
import { loadCrons } from './cron.js';
import type { Agent } from './agent.js';

export async function handleSlashCommand(
  command: string,
  sessionId: string,
  agent: Agent
): Promise<string | null> {
  const cmd = command.trim().toLowerCase().split(/\s+/)[0];

  switch (cmd) {
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
