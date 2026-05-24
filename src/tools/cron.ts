import { registry } from './registry.js';
import { logger } from '../utils/logger.js';
import { addCron, removeCron, loadCrons, parseCronExpression } from '../runtime/cron.js';

export function registerCronTools() {
  registry.register({
    name: 'cron_schedule',
    description: 'Schedule a recurring task. Use this when the user asks you to do something regularly or on a schedule. Provide a natural language schedule like "every day at 8am" or "every monday".',
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: 'What to do when the cron fires. Be specific — this will be sent to you as a task.',
        },
        schedule: {
          type: 'string',
          description: 'When to run it. Natural language: "every day at 8am", "every monday", "every 30 minutes". Or a raw cron expression.',
        },
      },
      required: ['instruction', 'schedule'],
    },
    handler: async (input, sessionId?: string) => {
      const { instruction, schedule } = input as { instruction: string; schedule: string };
      const expression = parseCronExpression(schedule);
      if (!expression) {
        return `Could not parse schedule: "${schedule}". Try: "every day at 9am", "every monday", "every 30 minutes".`;
      }
      const job = addCron({
        expression,
        instruction,
        createdBy: 'agent',
        enabled: true,
        ...(sessionId ? { sessionId } : {}),
      });
      logger.success('CRON', `Agent scheduled: ${job.id}`);
      return `Scheduled. Job ID: ${job.id}. Will run: ${schedule} (${expression})`;
    },
  });

  registry.register({
    name: 'cron_list',
    description: 'List all scheduled cron jobs.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      const jobs = loadCrons();
      if (!jobs.length) return 'No cron jobs scheduled.';
      return jobs.map((j) =>
        `[${j.id}] ${j.enabled ? '✓' : '✗'} "${j.instruction}" — ${j.expression} (by ${j.createdBy})`
      ).join('\n');
    },
  });

  registry.register({
    name: 'cron_remove',
    description: 'Remove a scheduled cron job by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The cron job ID to remove.' },
      },
      required: ['id'],
    },
    handler: async (input) => {
      const { id } = input as { id: string };
      const removed = removeCron(id);
      return removed ? `Removed cron job: ${id}` : `Job not found: ${id}`;
    },
  });

  logger.success('TOOLS', 'Cron tools registered: cron_schedule, cron_list, cron_remove');
}
