import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { loadConfig, env } from '../config/loader.js';
import { Agent } from '../runtime/agent.js';
import { logger } from '../utils/logger.js';
import { loadSecrets } from '../utils/secrets.js';

const config = loadConfig();
const app = express();
app.use(express.json());

const agent = new Agent(config);

// Auth middleware
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers['x-arden-token'];
  if (env.ARDEN_AUTH_TOKEN && token !== env.ARDEN_AUTH_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// REST: send a message to the agent
app.post('/message', requireAuth, async (req, res) => {
  const { session_id, message } = req.body;
  if (!session_id || !message) {
    res.status(400).json({ error: 'session_id and message required' });
    return;
  }
  try {
    const reply = await agent.handle(session_id, message);
    res.json({ reply });
  } catch (err) {
    logger.error('GATEWAY', String(err));
    res.status(500).json({ error: 'Agent error' });
  }
});

// REST: clear a session
app.delete('/session/:id', requireAuth, (req, res) => {
  agent.clearSession(String(req.params["id"] ?? ""));
  res.json({ ok: true });
});

// REST: health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    agent: config.agent.name,
    model: config.agent.model,
    uptime: process.uptime(),
  });
});

// WebSocket: real-time channel adapters connect here
const server = createServer(app);
const wss = new WebSocketServer({ server });

const adapters = new Map<string, WebSocket>();

wss.on('connection', (ws, req) => {
  const adapterId = req.url?.replace('/', '') ?? 'unknown';
  adapters.set(adapterId, ws);
  logger.success('GATEWAY', `Adapter connected: ${adapterId}`);

  ws.on('message', async (raw) => {
    try {
      const { session_id, message, channel } = JSON.parse(raw.toString());
      logger.info('GATEWAY', `[${channel}] ${session_id}: ${message.substring(0, 60)}`);
      const reply = await agent.handle(session_id, message);
      ws.send(JSON.stringify({ session_id, reply }));
    } catch (err) {
      logger.error('GATEWAY', String(err));
      ws.send(JSON.stringify({ error: String(err) }));
    }
  });

  ws.on('close', () => {
    adapters.delete(adapterId);
    logger.warn('GATEWAY', `Adapter disconnected: ${adapterId}`);
  });
});

const secrets = loadSecrets();
const configuredPort = Number(
  process.env.ARDEN_GATEWAY_PORT
    ?? secrets.ARDEN_GATEWAY_PORT
    ?? config.gateway?.port
    ?? env.ARDEN_GATEWAY_PORT
);
const PORT = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 3000;
server.on('error', (err: Error & { code?: string }) => {
  if (err.code === 'EADDRINUSE') {
    logger.error('GATEWAY', `Port ${PORT} is already in use.`);
    logger.info('GATEWAY', `Stop the existing process or run with ARDEN_GATEWAY_PORT=${PORT + 1}.`);
  } else {
    logger.error('GATEWAY', String(err));
  }
  process.exit(1);
});

server.listen(PORT, () => {
  logger.success('GATEWAY', `Arden gateway running on port ${PORT}`);
  logger.success('GATEWAY', `Agent: ${config.agent.name} (${config.agent.model})`);
  logger.info('GATEWAY', `Health: http://localhost:${PORT}/health`);
});

// Boot channel adapters
import { startTelegramAdapter } from '../adapters/telegram/index.js';
startTelegramAdapter(agent);
import { startWhatsAppAdapter } from '../adapters/whatsapp/index.js';
startWhatsAppAdapter(agent);

import { startHeartbeat } from '../runtime/heartbeat.js';

async function getNotifyFn() {
  const cfg = loadConfig();
  return async (msg: string) => {
    const promises = [];

    // Send via Telegram
    if (cfg.channels.telegram?.enabled) {
      const allowlist = cfg.channels.telegram.allowlist;
      if (allowlist.length > 0) {
        promises.push((async () => {
          try {
            const { Bot } = await import('grammy');
            const { env: e } = await import('../config/loader.js');
            if (!e.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN missing');
            const bot = new Bot(e.TELEGRAM_BOT_TOKEN);
            for (const userId of allowlist) {
              await bot.api.sendMessage(userId, msg);
            }
          } catch (err) {
            logger.error('NOTIFY', 'Telegram notify failed: ' + String(err));
          }
        })());
      }
    }

    // Send via WhatsApp
    if (cfg.channels.whatsapp?.enabled) {
      const recipients = Array.from(new Set([
        ...cfg.channels.whatsapp.allowlist,
        env.WHATSAPP_NUMBER,
      ].filter(Boolean)));

      if (recipients.length > 0) {
        promises.push((async () => {
          try {
            const { startWhatsAppNotify } = await import('../adapters/whatsapp/index.js');
            for (const number of recipients) {
              await startWhatsAppNotify(number, msg);
            }
          } catch (err) {
            logger.error('NOTIFY', 'WhatsApp notify failed: ' + String(err));
          }
        })());
      } else {
        logger.warn('NOTIFY', 'WhatsApp notification skipped: no outbound recipient configured.');
      }
    }

    await Promise.allSettled(promises);
  };
}

getNotifyFn().then((notifyFn) => {
  startHeartbeat(agent, config, notifyFn);
});

import { registerBrowserbaseTools } from '../tools/browserbase.js';
import { registerMatonTools } from '../tools/maton.js';
registerBrowserbaseTools();
registerMatonTools();

import { registerCronTools } from '../tools/cron.js';
import { loadCrons, startCronJobs } from '../runtime/cron.js';
registerCronTools();

async function reloadCronJobs() {
  const notifyFn = await getNotifyFn();
  startCronJobs(agent, notifyFn);
  return loadCrons().filter((j) => j.enabled).length;
}

app.post('/cron/reload', requireAuth, async (_req, res) => {
  try {
    const active = await reloadCronJobs();
    res.json({ ok: true, active });
  } catch (err) {
    logger.error('CRON', `Reload failed: ${String(err)}`);
    res.status(500).json({ error: 'Cron reload failed' });
  }
});

reloadCronJobs();

import { registerShellTools } from '../tools/shell.js';
registerShellTools();

import { registerBrowserTools } from '../tools/browser.js';
registerBrowserTools();

import { registerSkillsTools } from '../tools/skills.js';
import { registerFinanceTools } from '../tools/finance.js';
import { registerResearchTools } from '../tools/research.js';
import { registerContentTools } from '../tools/content.js';
import { registerDeviceTools } from '../tools/devices.js';
registerSkillsTools();
registerFinanceTools();
registerResearchTools();
registerContentTools();
registerDeviceTools();

import { registerBlandTools } from '../tools/bland.js';
registerBlandTools();
