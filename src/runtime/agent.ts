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

const MATON_APP_ALIASES: Record<string, string> = {
  gmail: 'google-mail',
  'google mail': 'google-mail',
  googlemail: 'google-mail',
  email: 'google-mail',
  calendar: 'google-calendar',
  'google calendar': 'google-calendar',
  gcal: 'google-calendar',
  sheets: 'google-sheets',
  spreadsheet: 'google-sheets',
  spreadsheets: 'google-sheets',
  'google sheets': 'google-sheets',
  docs: 'google-docs',
  'google docs': 'google-docs',
  drive: 'google-drive',
  'google drive': 'google-drive',
  zoho: 'zoho-mail',
  'zoho mail': 'zoho-mail',
  zohomail: 'zoho-mail',
  slack: 'slack',
  notion: 'notion',
  hubspot: 'hubspot',
  salesforce: 'salesforce',
  outlook: 'microsoft-outlook',
  'microsoft outlook': 'microsoft-outlook',
  teams: 'microsoft-teams',
  'microsoft teams': 'microsoft-teams',
  airtable: 'airtable',
};

const MATON_DOCS_OR_CODE_HINTS = /\b(openapi|oas|scalar|curl|endpoint|responses?|query parameters?|authentication|bearer token|authorization:|content-type|selected auth type|client libraries|server:|enum|type:string)\b/i;

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
    .replace(/^(for|with|to)\s+/, '')
    .replace(/\b(account|accounts|app|integration|oauth|authorization|connection|connect link|link|please|for me|through maton|via maton|with maton|now)\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]+$/g, '')
    .trim();
}

function normalizeMatonAppMention(value: string, allowSlug: boolean): string | null {
  const cleaned = cleanMatonAppRequest(value);
  if (!cleaned) return null;

  const alias = MATON_APP_ALIASES[cleaned];
  if (alias) return alias;

  const slug = cleaned.replace(/[_\s]+/g, '-');
  if (Object.values(MATON_APP_ALIASES).includes(slug)) return slug;
  if (allowSlug && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug)) return slug;
  return null;
}

function parseMatonLinkRequest(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  const slashMatch = trimmed.match(/^\/maton\s+(?:link|connect|create)\s+(.+)$/i);
  if (slashMatch) return normalizeMatonAppMention(slashMatch[1] ?? '', true);

  if (trimmed.length > 180 || MATON_DOCS_OR_CODE_HINTS.test(trimmed)) {
    return null;
  }

  const explicitPatterns: Array<{ pattern: RegExp; allowSlug: boolean }> = [
    { pattern: /^maton\s+(?:link|connect|authorize|auth)\s+(?:my\s+)?(.+)$/i, allowSlug: true },
    { pattern: /^(?:link|connect|authorize|auth)\s+(?:my\s+)?(.+?)\s+(?:through|via|with)\s+maton$/i, allowSlug: true },
    { pattern: /^(?:create|make|generate)\s+(?:a\s+)?(?:maton\s+)?(?:connect\s+)?(?:connection\s+)?link\s+(?:for|to)\s+(?:my\s+)?(.+)$/i, allowSlug: true },
    { pattern: /^(?:create|make|generate)\s+(?:a\s+)?(?:maton\s+)?connection\s+(?:for|to)\s+(?:my\s+)?(.+)$/i, allowSlug: true },
    { pattern: /^(?:link|connect|authorize|auth)\s+(?:my\s+)?(.+)$/i, allowSlug: false },
    { pattern: /^(?:no\s+)?(?:try|use|do(?:\s+it)?)\s+(?:for|with)\s+(?:my\s+)?(.+)$/i, allowSlug: false },
  ];

  for (const { pattern, allowSlug } of explicitPatterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const app = normalizeMatonAppMention(match[1] ?? '', allowSlug);
    if (app) return app;
  }

  return null;
}

function formatMatonError(err: unknown): string {
  const text = String(err);
  const invalidApp = text.match(/Invalid app name:\s*([A-Za-z0-9_-]+)/i)?.[1];
  if (invalidApp) {
    return `Maton rejected app "${invalidApp}". Try an exact app slug like google-mail, zoho-mail, google-calendar, or slack.`;
  }
  return text.length > 800 ? `${text.slice(0, 800)}...` : text;
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

  private channelContext(sessionId: string): string {
    if (sessionId.startsWith('whatsapp:')) {
      return [
        '# Current Channel',
        'You are replying inside an active WhatsApp chat through Arden. Do not claim you are not on WhatsApp.',
        'Your final reply sends text back to the current chat. If the user asks you to send a WhatsApp message, image, or screenshot, use the WhatsApp tools when available.',
        'For current-chat sends, omit recipient_number so the tool targets this WhatsApp chat.',
      ].join('\n');
    }

    if (sessionId.startsWith('telegram:')) {
      return [
        '# Current Channel',
        'You are replying inside an active Telegram chat through Arden. Your final reply sends text back to the current chat.',
      ].join('\n');
    }

    return [
      '# Current Channel',
      'You are replying through Arden chat.',
    ].join('\n');
  }

  async handle(sessionId: string, userMessage: string): Promise<string> {
    const session = this.getSession(sessionId);
    const systemPrompt = [
      this.memory.buildSystemPrompt(this.config.agent.name),
      this.channelContext(sessionId),
    ].join('\n\n---\n\n');
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
        return `I could not create the Maton link: ${formatMatonError(err)}`;
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
