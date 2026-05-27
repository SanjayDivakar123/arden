import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import { loadConfig } from '../../config/loader.js';
import { logger } from '../../utils/logger.js';
import { redactSecrets } from '../../utils/secrets.js';
import type { Agent } from '../../runtime/agent.js';
import { handleSlashCommand } from '../../runtime/commands.js';

const config = loadConfig();

export async function startWhatsAppAdapter(agent: Agent) {
  if (!config.channels.whatsapp?.enabled) {
    logger.warn('WHATSAPP', 'Disabled in config — skipping');
    return;
  }

  const allowlist = config.channels.whatsapp.allowlist.map(String);
  const authDir = path.resolve('.arden-whatsapp-auth');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  async function connect() {
    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: {
        level: 'silent',
        trace: () => {}, debug: () => {}, info: () => {},
        warn: () => {}, error: () => {}, fatal: () => {},
        child: () => ({
          level: 'silent',
          trace: () => {}, debug: () => {}, info: () => {},
          warn: () => {}, error: () => {}, fatal: () => {},
          child: () => ({}) as any,
        }) as any,
      } as any,
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('WHATSAPP', 'Scan this QR code with WhatsApp on your phone:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        logger.warn('WHATSAPP', `Disconnected. Reconnecting: ${shouldReconnect}`);
        if (shouldReconnect) setTimeout(connect, 3000);
        else logger.error('WHATSAPP', 'Logged out. Delete .arden-whatsapp-auth and restart.');
      }

      if (connection === 'open') {
        logger.success('WHATSAPP', 'Connected and ready.');
        setGlobalSock(sock);
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        if (!msg.message) continue;

        const jid = msg.key.remoteJid ?? '';
        if (jid.endsWith('@g.us')) continue;

        const number = jid.replace('@s.whatsapp.net', '');
        const text =
          msg.message.conversation ??
          msg.message.extendedTextMessage?.text ??
          '';

        if (!text) continue;

        if (allowlist.length > 0 && !allowlist.includes(number) && !allowlist.includes('+' + number)) {
          logger.warn('WHATSAPP', `Blocked: ${number}`);
          continue;
        }

        const sessionId = `whatsapp:${number}`;
        logger.info('WHATSAPP', `${number}: ${redactSecrets(text).substring(0, 80)}`);

        try {
          await sock.sendPresenceUpdate('composing', jid);

          // Handle slash commands
          if (text.startsWith('/')) {
            const cmdReply = await handleSlashCommand(text, sessionId, agent);
            if (cmdReply !== null) {
              await sock.sendMessage(jid, { text: cmdReply });
              await sock.sendPresenceUpdate('paused', jid);
              continue;
            }
          }

          const isHeavyTask = text.length > 80 || /research|find|search|analyze|write|create|build|deploy|send|schedule|book|automate|look up|get me|can you/i.test(text);
          if (isHeavyTask) {
            const acks = [
              'On it.',
              'Got it, working on it.',
              'On it — give me a moment.',
              'Sure, on it.',
              'Working on that now.',
              'Understood. I am on it.',
              'One moment, processing that for you.',
              'Alright, let me take care of that.',
              'I am on the case.',
              'Working on it as we speak.'
            ];
            const ack = acks[Math.floor(Math.random() * acks.length)];
            await sock.sendMessage(jid, { text: ack ?? "On it." });
          }
          const reply = await agent.handle(sessionId, text);
          await sock.sendMessage(jid, { text: reply });
          await sock.sendPresenceUpdate('paused', jid);
        } catch (err) {
          logger.error('WHATSAPP', String(err));
          await sock.sendMessage(jid, { text: 'Something went wrong. Try again.' });
        }
      }
    });
  }

  await connect();
  logger.info('WHATSAPP', `Starting — allowlist: ${allowlist.join(', ') || 'open'}`);
}

let globalSock: any = null;

export function setGlobalSock(sock: any) {
  globalSock = sock;
}

export async function startWhatsAppNotify(number: string, message: string) {
  if (!globalSock) throw new Error('WhatsApp not connected');
  const jid = number.includes('@')
    ? number
    : number.replace('+', '') + '@s.whatsapp.net';
  await globalSock.sendMessage(jid, { text: message });
}
