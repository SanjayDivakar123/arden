import { runLoop } from './loop.js';
import type { Message } from './loop.js';
import { Memory } from '../memory/index.js';
import type { ArdenConfig } from '../config/loader.js';
import { logger } from '../utils/logger.js';
import { registry } from '../tools/registry.js';

export class Agent {
  private config: ArdenConfig;
  private memory: Memory;
  private sessions: Map<string, Message[]> = new Map();

  constructor(config: ArdenConfig) {
    this.config = config;
    this.memory = new Memory(config.agent.workspace);
    logger.success('AGENT', `${config.agent.name} initialized`);
  }

  private getSession(sessionId: string): Message[] {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, []);
    }
    return this.sessions.get(sessionId)!;
  }

  async handle(sessionId: string, userMessage: string): Promise<string> {
    const session = this.getSession(sessionId);
    const systemPrompt = this.memory.buildSystemPrompt(this.config.agent.name);

    logger.info('AGENT', `[${sessionId}] ${userMessage.substring(0, 80)}`);
    this.memory.logToday(`User: ${userMessage}`);

    session.push({ role: 'user', content: userMessage });

    const tools = registry.toAnthropicTools();

    const result = await runLoop({
      model: this.config.agent.model,
      systemPrompt,
      messages: session,
      tools: tools.length > 0 ? tools as any : undefined,
      maxIterations: this.config.loop.max_iterations,
      requireCompletionReport: this.config.loop.require_completion_report,
      onToolCall: async (name, input) => {
        return registry.call(name, input as Record<string, unknown>);
      },
    });

    session.push({ role: 'assistant', content: result.reply });
    this.memory.logToday(`Agent: ${result.reply}`);

    if (session.length > 40) {
      this.sessions.set(sessionId, session.slice(-40));
    }

    return result.reply;
  }

  clearSession(sessionId: string) {
    this.sessions.delete(sessionId);
    logger.info('AGENT', `Session ${sessionId} cleared`);
  }
}
