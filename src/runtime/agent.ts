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

  private resolveModel(userMessage: string): string {
    const msg = userMessage.toLowerCase();

    // Haiku: simple, fast tasks
    const haikuPatterns = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|got it|confirm|cancel|remind me|what time|status|ping|check)[s!?.]*$/i;
    if (haikuPatterns.test(msg.trim()) || msg.length < 40) {
      return this.config.agent.haiku_model;
    }

    // Opus: complex, high-stakes tasks
    const opusPatterns = /analyze|strategy|legal|tax|regulatory|contract|audit|deep.?dive|comprehensive|write.*report|draft.*proposal|investment|financial.?model|due.?diligence/i;
    if (opusPatterns.test(msg)) {
      return this.config.agent.opus_model;
    }

    // Sonnet: default for everything else
    return this.config.agent.model;
  }

  async handle(sessionId: string, userMessage: string): Promise<string> {
    const session = this.getSession(sessionId);
    const systemPrompt = this.memory.buildSystemPrompt(this.config.agent.name);

    logger.info('AGENT', `[${sessionId}] ${userMessage.substring(0, 80)}`);
    this.memory.logToday(`User: ${userMessage}`);

    session.push({ role: 'user', content: userMessage });

    const tools = registry.toAnthropicTools();
    const model = this.resolveModel(userMessage);
    logger.info('AGENT', `Model selected: ${model}`);

    const result = await runLoop({
      model,
      systemPrompt,
      messages: session,
      tools: tools.length > 0 ? tools as any : undefined,
      maxIterations: this.config.loop.max_iterations,
      requireCompletionReport: this.config.loop.require_completion_report,
      onToolCall: async (name, input) => {
        return registry.call(name, input as Record<string, unknown>, sessionId);
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

  async compactSession(sessionId: string): Promise<string> {
    const session = this.getSession(sessionId);
    if (session.length === 0) return 'No conversation to compact.';
    const summary = await runLoop({
      model: this.config.agent.model,
      systemPrompt: 'Summarize this conversation in a concise paragraph capturing the key points, decisions, and context.',
      messages: session,
      maxIterations: 1,
      requireCompletionReport: false,
      onToolCall: async () => ({}),
    });
    this.sessions.set(sessionId, [
      { role: 'user', content: '[Conversation compacted]' },
      { role: 'assistant', content: `Previous conversation summary: ${summary.reply}` },
    ]);
    return summary.reply;
  }
}
