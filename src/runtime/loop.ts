import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { getSecret } from '../utils/secrets.js';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface LoopOptions {
  provider?: 'anthropic' | 'openai';
  model: string;
  systemPrompt: string;
  messages: Message[];
  tools?: unknown[];
  maxIterations?: number;
  requireCompletionReport?: boolean;
  onToolCall?: (name: string, input: unknown) => Promise<unknown>;
}

export interface LoopResult {
  reply: string;
  toolsUsed: string[];
  iterations: number;
}

export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  if (opts.provider === 'openai') return runOpenAILoop(opts);
  return runAnthropicLoop(opts);
}

async function runAnthropicLoop(opts: LoopOptions): Promise<LoopResult> {
  const {
    model,
    systemPrompt,
    messages,
    tools = [],
    maxIterations = 10,
    onToolCall,
  } = opts;

  const history: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const toolsUsed: string[] = [];
  let iterations = 0;
  let finalReply = '';

  while (iterations < maxIterations) {
    iterations++;
    logger.info('LOOP', `Iteration ${iterations}/${maxIterations}`);

    const requestParams: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: history,
    };

    if (tools.length > 0) {
      requestParams.tools = tools as Anthropic.Tool[];
    }

    const apiKey = getSecret('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create(requestParams);

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      finalReply = textBlock ? (textBlock as Anthropic.TextBlock).text : '';
      logger.success('LOOP', `Completed in ${iterations} iterations`);
      break;
    }

    if (response.stop_reason === 'tool_use' && onToolCall) {
      history.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        toolsUsed.push(block.name);
        logger.info('TOOL', `Calling ${block.name}`);

        let result: unknown;
        try {
          result = await onToolCall(block.name, block.input);
        } catch (err) {
          result = `Error: ${String(err)}`;
          logger.error('TOOL', `${block.name} failed: ${String(err)}`);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }

      history.push({ role: 'user', content: toolResults });
      continue;
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    finalReply = textBlock ? (textBlock as Anthropic.TextBlock).text : '';
    break;
  }

  if (iterations >= maxIterations) {
    logger.warn('LOOP', 'Hit max iterations');
    finalReply = finalReply || 'Task incomplete — hit iteration limit.';
  }

  return { reply: finalReply, toolsUsed, iterations };
}

type OpenAIResponseOutputItem = {
  id?: string;
  type: string;
  role?: string;
  content?: Array<{ type: string; text?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
};

type OpenAIResponse = {
  output?: OpenAIResponseOutputItem[];
  output_text?: string;
  error?: { message?: string };
};

function extractOpenAIText(response: OpenAIResponse): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }

  const chunks: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function parseOpenAIToolArguments(args: string | undefined): Record<string, unknown> {
  if (!args) return {};
  try {
    const parsed = JSON.parse(args) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function createOpenAIResponse(body: Record<string, unknown>): Promise<OpenAIResponse> {
  const apiKey = getSecret('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json() as OpenAIResponse;
  if (!res.ok) {
    throw new Error(`OpenAI API error ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`);
  }
  return data;
}

async function runOpenAILoop(opts: LoopOptions): Promise<LoopResult> {
  const {
    model,
    systemPrompt,
    messages,
    tools = [],
    maxIterations = 10,
    onToolCall,
  } = opts;

  const history: unknown[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const toolsUsed: string[] = [];
  let iterations = 0;
  let finalReply = '';

  while (iterations < maxIterations) {
    iterations++;
    logger.info('LOOP', `OpenAI iteration ${iterations}/${maxIterations}`);

    const response = await createOpenAIResponse({
      model,
      instructions: systemPrompt,
      input: history,
      max_output_tokens: 4096,
      ...(tools.length > 0 ? { tools } : {}),
    });

    const functionCalls = (response.output ?? []).filter((item) => item.type === 'function_call');
    if (functionCalls.length === 0) {
      finalReply = extractOpenAIText(response);
      logger.success('LOOP', `Completed in ${iterations} iterations`);
      break;
    }

    history.push(...(response.output ?? []));

    for (const call of functionCalls) {
      if (!call.name || !call.call_id) continue;
      toolsUsed.push(call.name);
      logger.info('TOOL', `Calling ${call.name}`);

      let result: unknown;
      try {
        result = onToolCall
          ? await onToolCall(call.name, parseOpenAIToolArguments(call.arguments))
          : {};
      } catch (err) {
        result = `Error: ${String(err)}`;
        logger.error('TOOL', `${call.name} failed: ${String(err)}`);
      }

      history.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
  }

  if (iterations >= maxIterations) {
    logger.warn('LOOP', 'Hit max iterations');
    finalReply = finalReply || 'Task incomplete — hit iteration limit.';
  }

  return { reply: finalReply, toolsUsed, iterations };
}
