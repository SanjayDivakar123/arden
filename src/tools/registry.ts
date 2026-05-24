import { logger } from '../utils/logger.js';

export interface ArdenTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
  handler: (input: Record<string, unknown>, sessionId?: string) => Promise<unknown>;
}

class ToolRegistry {
  private tools: Map<string, ArdenTool> = new Map();

  register(tool: ArdenTool) {
    this.tools.set(tool.name, tool);
    logger.success('TOOLS', `Registered: ${tool.name}`);
  }

  unregister(name: string) {
    this.tools.delete(name);
    logger.warn('TOOLS', `Unregistered: ${name}`);
  }

  get(name: string): ArdenTool | undefined {
    return this.tools.get(name);
  }

  list(): ArdenTool[] {
    return Array.from(this.tools.values());
  }

  toAnthropicTools() {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  async call(name: string, input: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    logger.info('TOOLS', `Calling: ${name}`);
    return tool.handler(input, sessionId);
  }
}

export const registry = new ToolRegistry();
