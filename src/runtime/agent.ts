import { runLoop } from './loop.js';
import type { Message } from './loop.js';
import { Memory } from '../memory/index.js';
import type { ArdenConfig } from '../config/loader.js';
import { logger } from '../utils/logger.js';
import { registry } from '../tools/registry.js';
import { getSecret, redactSecrets, setSecret } from '../utils/secrets.js';

type ParsedSecretUpdate = {
  key: string;
  value: string;
};

const SECRET_KEY_PATTERN = /^[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|ENCRYPTED_KEY|AUTH_TOKEN|PROJECT_ID|FROM_NUMBER|NUMBER|GATEWAY_PORT)$/;

const SECRET_ALIASES: Array<{ key: string; labels: string[] }> = [
  { key: 'BROWSERBASE_PROJECT_ID', labels: ['browserbase project id', 'browserbase project'] },
  { key: 'BLAND_ENCRYPTED_KEY', labels: ['bland byot encrypted key', 'bland encrypted key', 'bland byot'] },
  { key: 'BLAND_FROM_NUMBER', labels: ['bland caller id', 'bland from number'] },
  { key: 'TELEGRAM_BOT_TOKEN', labels: ['telegram bot token', 'telegram token', 'telegram'] },
  { key: 'MATON_API_KEY', labels: ['maton api key', 'maton key', 'maton'] },
  { key: 'BROWSERBASE_API_KEY', labels: ['browserbase api key', 'browserbase key', 'browserbase'] },
  { key: 'BLAND_API_KEY', labels: ['bland ai api key', 'bland api key', 'bland ai', 'bland'] },
  { key: 'OPENAI_API_KEY', labels: ['openai api key', 'openai key', 'openai'] },
  { key: 'ANTHROPIC_API_KEY', labels: ['anthropic api key', 'anthropic key', 'claude api key', 'claude key', 'anthropic'] },
  { key: 'GEMINI_API_KEY', labels: ['gemini api key', 'google ai api key', 'gemini key', 'gemini'] },
  { key: 'OPENCODE_API_KEY', labels: ['opencode api key', 'opencode key', 'opencode'] },
  { key: 'WHATSAPP_NUMBER', labels: ['whatsapp number', 'whatsapp'] },
  { key: 'ARDEN_AUTH_TOKEN', labels: ['arden auth token', 'gateway auth token'] },
  { key: 'ARDEN_GATEWAY_PORT', labels: ['arden gateway port', 'gateway port'] },
];

const KNOWN_MATON_APP_HINTS = /\b(gmail|google mail|zoho|zoho mail|slack|notion|calendar|google calendar|sheets|google sheets|docs|google docs|drive|google drive|hubspot|salesforce|outlook|microsoft outlook|teams|microsoft teams)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanSecretValue(value: string): string {
  let cleaned = value.trim();
  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '');
  if (!cleaned.slice(0, -1).includes('.') && /[.,;]$/.test(cleaned)) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned.trim();
}

function normalizeSecretKey(value: string): string | null {
  const key = value.trim().toUpperCase();
  return SECRET_KEY_PATTERN.test(key) ? key : null;
}

function parseSecretUpdate(message: string): ParsedSecretUpdate | null {
  const trimmed = message.trim();

  const slashMatch = trimmed.match(/^\/(?:secret|setkey|api-key|apikey)\s+(?:set\s+)?([A-Za-z][A-Za-z0-9_]*)\s+(.+)$/i);
  if (slashMatch) {
    const key = normalizeSecretKey(slashMatch[1] ?? '');
    const value = cleanSecretValue(slashMatch[2] ?? '');
    if (key && value) return { key, value };
  }

  const assignmentMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*(?:api_key|token|secret|encrypted_key|auth_token|project_id|from_number|number|gateway_port))\s*[:=]\s*(.+)$/i);
  if (assignmentMatch) {
    const key = normalizeSecretKey(assignmentMatch[1] ?? '');
    const value = cleanSecretValue(assignmentMatch[2] ?? '');
    if (key && value) return { key, value };
  }

  for (const alias of SECRET_ALIASES) {
    for (const label of alias.labels) {
      const re = new RegExp(
        `(?:^|\\b)(?:my\\s+|the\\s+|save\\s+|set\\s+|here(?:'s|\\s+is)\\s+(?:my\\s+)?)?${escapeRegExp(label)}(?:\\s+(?:api\\s*key|key|token|bot\\s*token|project\\s*id|caller\\s*id|from\\s*number|encrypted[_\\s-]?key|port))?\\s*(?:is|=|:)\\s*(.+)$`,
        'i',
      );
      const match = trimmed.match(re);
      if (!match) continue;
      const value = cleanSecretValue(match[1] ?? '');
      if (value) return { key: alias.key, value };
    }
  }

  return null;
}

function cleanMatonAppRequest(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^my\s+/, '')
    .replace(/\b(account|accounts|app|integration|oauth|authorization|please|for me|through maton|via maton|with maton)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMatonLinkRequest(message: string): string | null {
  const trimmed = message.trim();
  const patterns = [
    /\bmaton\s+(?:link|connect|authorize|auth)\s+(?:my\s+)?([a-z][a-z0-9 _-]{1,60})\b/i,
    /\b(?:link|connect|authorize|auth)\s+(?:my\s+)?([a-z][a-z0-9 _-]{1,60})\s+(?:through|via|with)\s+maton\b/i,
    /\b(?:link|connect|authorize|auth)\s+(?:my\s+)?([a-z][a-z0-9 _-]{1,60})\b/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const app = cleanMatonAppRequest(match[1] ?? '');
    if (!app) continue;
    if (/\bmaton\b/i.test(trimmed) || KNOWN_MATON_APP_HINTS.test(app)) return app;
  }

  return null;
}

function formatMatonConnectionResult(result: unknown): string {
  const parsed = typeof result === 'string'
    ? JSON.parse(result) as { message?: string; url?: string; app?: string }
    : result as { message?: string; url?: string; app?: string };
  if (parsed.message) return parsed.message;
  if (parsed.url) return `Open this Maton link to finish connecting ${parsed.app ?? 'the app'}: ${parsed.url}`;
  return `Maton connection created:\n${typeof result === 'string' ? result : JSON.stringify(result)}`;
}

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

  private providerForModel(model: string): 'anthropic' | 'openai' {
    const configuredProvider = this.config.agent.provider?.toLowerCase();
    if (configuredProvider === 'openai' || model.startsWith('openai/')) return 'openai';
    return 'anthropic';
  }

  private modelMatchesProvider(model: string, provider: 'anthropic' | 'openai'): boolean {
    if (provider === 'openai') {
      return model.startsWith('openai/') || /^(gpt|o\d|chat-latest)/i.test(model);
    }
    return model.startsWith('claude');
  }

  private normalizeModel(model: string): string {
    return model.replace(/^openai\//, '').replace(/^anthropic\//, '');
  }

  private resolveModel(userMessage: string): { provider: 'anthropic' | 'openai'; model: string } {
    const msg = userMessage.toLowerCase();
    const defaultModel = this.config.agent.model;
    const provider = this.providerForModel(defaultModel);
    const smallModel = this.modelMatchesProvider(this.config.agent.haiku_model, provider)
      ? this.config.agent.haiku_model
      : defaultModel;
    const largeModel = this.modelMatchesProvider(this.config.agent.opus_model, provider)
      ? this.config.agent.opus_model
      : defaultModel;

    // Haiku: simple, fast tasks
    const haikuPatterns = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|got it|confirm|cancel|remind me|what time|status|ping|check)[s!?.]*$/i;
    if (haikuPatterns.test(msg.trim()) || msg.length < 40) {
      return { provider, model: this.normalizeModel(smallModel) };
    }

    // Opus: complex, high-stakes tasks
    const opusPatterns = /analyze|strategy|legal|tax|regulatory|contract|audit|deep.?dive|comprehensive|write.*report|draft.*proposal|investment|financial.?model|due.?diligence/i;
    if (opusPatterns.test(msg)) {
      return { provider, model: this.normalizeModel(largeModel) };
    }

    // Sonnet: default for everything else
    return { provider, model: this.normalizeModel(defaultModel) };
  }

  async handle(sessionId: string, userMessage: string): Promise<string> {
    const session = this.getSession(sessionId);
    const systemPrompt = this.memory.buildSystemPrompt(this.config.agent.name);
    const safeUserMessage = redactSecrets(userMessage);

    const secretUpdate = parseSecretUpdate(userMessage);
    if (secretUpdate) {
      setSecret(secretUpdate.key, secretUpdate.value);
      logger.info('AGENT', `[${sessionId}] Saved ${secretUpdate.key} from chat`);
      this.memory.logToday(`User saved ${secretUpdate.key} from chat.`);
      const needsRestart = ['TELEGRAM_BOT_TOKEN', 'WHATSAPP_NUMBER', 'ARDEN_GATEWAY_PORT', 'ARDEN_AUTH_TOKEN'].includes(secretUpdate.key);
      return needsRestart
        ? `Saved ${secretUpdate.key}. Restart the gateway for that setting to take effect.`
        : `Saved ${secretUpdate.key}. I can use it now.`;
    }

    const matonLinkApp = parseMatonLinkRequest(userMessage);
    if (matonLinkApp) {
      logger.info('AGENT', `[${sessionId}] Maton link request: ${matonLinkApp}`);
      this.memory.logToday(`User requested a Maton connection link for ${matonLinkApp}.`);
      if (!getSecret('MATON_API_KEY')) {
        return 'Send me your Maton API key first, for example: MATON_API_KEY=your_key';
      }
      try {
        const result = await registry.call('maton_create_connection', { app: matonLinkApp }, sessionId);
        return formatMatonConnectionResult(result);
      } catch (err) {
        return `I could not create the Maton link: ${String(err)}`;
      }
    }

    logger.info('AGENT', `[${sessionId}] ${safeUserMessage.substring(0, 80)}`);
    this.memory.logToday(`User: ${safeUserMessage}`);

    session.push({ role: 'user', content: userMessage });

    const { provider, model } = this.resolveModel(userMessage);
    const tools = provider === 'openai' ? registry.toOpenAITools() : registry.toAnthropicTools();
    logger.info('AGENT', `Model selected: ${provider}:${model}`);

    const result = await runLoop({
      provider,
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
    const provider = this.providerForModel(this.config.agent.model);
    const summary = await runLoop({
      provider,
      model: this.normalizeModel(this.config.agent.model),
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
