import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface LoopOptions {
  model: string;
  systemPrompt: string;
  messages: Message[];
  tools?: Anthropic.Tool[];
  maxIterations?: number;
  requireCompletionReport?: boolean;
  onToolCall?: (name: string, input: unknown) => Promise<unknown>;
}

export interface LoopResult {
  reply: string;
  toolsUsed: string[];
  iterations: number;
}

const client = new Anthropic();

export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
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
      requestParams.tools = tools;
    }

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
