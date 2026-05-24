import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import type { Agent } from './agent.js';

export interface CronJob {
  id: string;
  expression: string;
  instruction: string;
  createdBy: 'user' | 'agent';
  createdAt: string;
  enabled: boolean;
  sessionId?: string;
}

const CRON_PATH = path.resolve('.arden-crons.json');
const activeTasks = new Map<string, cron.ScheduledTask>();

export function loadCrons(): CronJob[] {
  if (!fs.existsSync(CRON_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(CRON_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveCrons(jobs: CronJob[]) {
  fs.writeFileSync(CRON_PATH, JSON.stringify(jobs, null, 2));
}

export function addCron(job: Omit<CronJob, 'id' | 'createdAt'>): CronJob {
  const jobs = loadCrons();
  const newJob: CronJob = {
    ...job,
    id: `cron_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  jobs.push(newJob);
  saveCrons(jobs);
  return newJob;
}

export function removeCron(id: string): boolean {
  const jobs = loadCrons();
  const filtered = jobs.filter((j) => j.id !== id);
  if (filtered.length === jobs.length) return false;
  saveCrons(filtered);
  const task = activeTasks.get(id);
  if (task) { task.stop(); activeTasks.delete(id); }
  return true;
}

export function toggleCron(id: string, enabled: boolean): boolean {
  const jobs = loadCrons();
  const job = jobs.find((j) => j.id === id);
  if (!job) return false;
  job.enabled = enabled;
  saveCrons(jobs);
  const task = activeTasks.get(id);
  if (task) { enabled ? task.start() : task.stop(); }
  return true;
}

// Convert natural language schedule to cron expression using simple patterns
export function parseCronExpression(schedule: string): string | null {
  const s = schedule.toLowerCase();

  if (s.includes('every minute'))                          return '* * * * *';
  if (s.includes('every 5 min'))                          return '*/5 * * * *';
  if (s.includes('every 10 min'))                         return '*/10 * * * *';
  if (s.includes('every 15 min'))                         return '*/15 * * * *';
  if (s.includes('every 30 min'))                         return '*/30 * * * *';
  if (s.includes('every hour'))                           return '0 * * * *';
  if (s.includes('every 2 hour'))                         return '0 */2 * * *';
  if (s.includes('every 6 hour'))                         return '0 */6 * * *';
  if (s.includes('every 12 hour'))                        return '0 */12 * * *';
  if (s.includes('every day') || s.includes('daily')) {
    const match = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (match) {
      let hour = parseInt(match[1] ?? "0");
      const min = parseInt(match[2] ?? '0');
      if (match[3] === 'pm' && hour !== 12) hour += 12;
      if (match[3] === 'am' && hour === 12) hour = 0;
      return `${min} ${hour} * * *`;
    }
    return '0 9 * * *';
  }
  if (s.includes('every morning'))                        return '0 8 * * *';
  if (s.includes('every evening'))                        return '0 18 * * *';
  if (s.includes('every night'))                          return '0 21 * * *';
  if (s.includes('every monday'))                         return '0 9 * * 1';
  if (s.includes('every tuesday'))                        return '0 9 * * 2';
  if (s.includes('every wednesday'))                      return '0 9 * * 3';
  if (s.includes('every thursday'))                       return '0 9 * * 4';
  if (s.includes('every friday'))                         return '0 9 * * 5';
  if (s.includes('every saturday'))                       return '0 9 * * 6';
  if (s.includes('every sunday'))                         return '0 9 * * 0';
  if (s.includes('every weekday'))                        return '0 9 * * 1-5';
  if (s.includes('every weekend'))                        return '0 10 * * 6,0';

  // Raw cron expression passed directly
  if (/^[\d\s\*\/,\-]+$/.test(schedule.trim()) && schedule.trim().split(/\s+/).length === 5) {
    return schedule.trim();
  }

  return null;
}

export function startCronJobs(agent: Agent, notifyFn: (msg: string) => Promise<void>) {
  const jobs = loadCrons();
  let started = 0;

  for (const job of jobs) {
    if (!job.enabled) continue;
    if (!cron.validate(job.expression)) {
      logger.warn('CRON', `Invalid expression for job ${job.id}: ${job.expression}`);
      continue;
    }

    const task = cron.schedule(job.expression, async () => {
      logger.info('CRON', `Running job ${job.id}: ${job.instruction.substring(0, 60)}`);
      try {
        const sessionId = job.sessionId ?? `cron:${job.id}`;
        const reply = await agent.handle(sessionId, job.instruction);
        if (reply && reply.trim() !== 'HEARTBEAT_OK') {
          // If sessionId is a whatsapp session, notify via WhatsApp directly
          if (job.sessionId && job.sessionId.startsWith('whatsapp:')) {
            const number = job.sessionId.replace('whatsapp:', '').replace('@s.whatsapp.net', '').replace('@lid', '');
            try {
              const { startWhatsAppNotify } = await import('../adapters/whatsapp/index.js');
              await startWhatsAppNotify(number, reply);
            } catch {
              await notifyFn(reply);
            }
          } else {
            await notifyFn(reply);
          }
        }
      } catch (err) {
        logger.error('CRON', `Job ${job.id} failed: ${String(err)}`);
      }
    });

    activeTasks.set(job.id, task);
    started++;
    logger.success('CRON', `Scheduled: "${job.instruction.substring(0, 50)}" (${job.expression})`);
  }

  logger.info('CRON', `${started} job(s) active`);
}
