import { Bot } from 'grammy';
import { env, loadConfig } from '../../config/loader.js';
import { logger } from '../../utils/logger.js';
import { redactSecrets } from '../../utils/secrets.js';
import { handleSlashCommand } from '../../runtime/commands.js';


import { Agent } from '../../runtime/agent.js';

const config = loadConfig();

export function startTelegramAdapter(agent: Agent) {
  if (!config.channels.telegram?.enabled) {
    logger.warn('TELEGRAM', 'Disabled in config — skipping');
    return;
  }
  if (!env.TELEGRAM_BOT_TOKEN) {
    logger.warn('TELEGRAM', 'No bot token — skipping');
    return;
  }

  const allowlist = config.channels.telegram.allowlist.map(String);
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  bot.on('message:text', async (ctx) => {
    const userId = String(ctx.from?.id ?? '');
    const username = ctx.from?.username ?? userId;

    if (allowlist.length > 0 && !allowlist.includes(userId)) {
      logger.warn('TELEGRAM', `Blocked unauthorized user: ${userId}`);
      return;
    }

    const sessionId = `telegram:${userId}`;
    const userMessage = ctx.message.text;

    logger.info('TELEGRAM', `@${username}: ${redactSecrets(userMessage).substring(0, 80)}`);

    try {
      await ctx.replyWithChatAction('typing');

      // Handle slash commands
      if (userMessage.startsWith('/')) {
        const cmdReply = await handleSlashCommand(userMessage, sessionId, agent);
        if (cmdReply !== null) {
          await ctx.reply(cmdReply);
          return;
        }
      }

      // Handle slash commands
      if (userMessage.startsWith('/')) {
        const cmdReply = await handleSlashCommand(userMessage, sessionId, agent);
        if (cmdReply !== null) {
          await ctx.reply(cmdReply);
          return;
        }
      }
      const isHeavyTask = userMessage.length > 80 || /research|find|search|analyze|write|create|build|deploy|send|schedule|book|automate|look up|get me|can you/i.test(userMessage);
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
        await ctx.reply(ack ?? "On it.");
      }
      const reply = await agent.handle(sessionId, userMessage);
      await ctx.reply(reply, { parse_mode: 'HTML' });
    } catch (err) {
      logger.error('TELEGRAM', String(err));
      await ctx.reply('Something went wrong. Try again.');
    }
  });

  bot.start();
  logger.success('TELEGRAM', `Bot started — allowlist: ${allowlist.join(', ') || 'open'}`);
}
