import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import type { Agent } from './agent.js';
import type { ArdenConfig } from '../config/loader.js';

function intervalToCron(interval: string): string {
  if (interval === '1m')  return '* * * * *';
  if (interval === '5m')  return '*/5 * * * *';
  if (interval === '15m') return '*/15 * * * *';
  if (interval === '30m') return '*/30 * * * *';
  if (interval === '1h')  return '0 * * * *';
  if (interval === '6h')  return '0 */6 * * *';
  if (interval === '12h') return '0 */12 * * *';
  if (interval === '24h') return '0 0 * * *';
  return '*/30 * * * *';
}

export function startHeartbeat(agent: Agent, config: ArdenConfig, notifyFn: (msg: string) => Promise<void>) {
  if (!config.heartbeat.enabled) {
    logger.warn('HEARTBEAT', 'Disabled in config — skipping');
    return;
  }

  const cronExpr = intervalToCron(config.heartbeat.interval);
  logger.success('HEARTBEAT', `Started — interval: ${config.heartbeat.interval} (${cronExpr})`);

  cron.schedule(cronExpr, async () => {
    logger.info('HEARTBEAT', 'Tick — running checklist');

    try {
      const reply = await agent.handle('heartbeat', 'Run your heartbeat checklist now.');

      if (reply.trim() === 'HEARTBEAT_OK') {
        logger.info('HEARTBEAT', 'Nothing to report.');
        return;
      }

      logger.info('HEARTBEAT', `Notifying: ${reply.substring(0, 80)}`);
      await notifyFn(reply);
    } catch (err) {
      logger.error('HEARTBEAT', String(err));
    }
  });
}
