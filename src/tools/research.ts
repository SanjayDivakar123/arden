import type { ArdenTool } from './registry.js';
import { registry } from './registry.js';

export const researchTools: ArdenTool[] = [
  {
    name: 'research_web',
    description: 'Search the web and return a summary of results',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max: { type: 'string', description: 'Max results to return (default 5)' },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const { query, max } = input as { query: string; max?: string };
      const url = `https://ddg-api.herokuapp.com/search?query=${encodeURIComponent(query)}&limit=${max ?? '5'}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        const data: any = await res.json();
        return { success: true, results: data };
      } catch {
        return { success: false, error: 'Search unavailable. Use browser_navigate instead.' };
      }
    },
  },
  {
    name: 'research_person',
    description: 'Research a person by name — searches web for public info',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name of the person' },
        context: { type: 'string', description: 'Additional context e.g. company name' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      const { name, context } = input as { name: string; context?: string };
      const query = context ? `${name} ${context}` : name;
      const url = `https://ddg-api.herokuapp.com/search?query=${encodeURIComponent(query)}&limit=5`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        const data: any = await res.json();
        return { success: true, person: name, results: data };
      } catch {
        return { success: false, error: 'Search unavailable.' };
      }
    },
  },
  {
    name: 'research_company',
    description: 'Research a company by name',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Company name' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      const { name } = input as { name: string };
      const query = `${name} company overview news`;
      const url = `https://ddg-api.herokuapp.com/search?query=${encodeURIComponent(query)}&limit=5`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        const data: any = await res.json();
        return { success: true, company: name, results: data };
      } catch {
        return { success: false, error: 'Search unavailable.' };
      }
    },
  },
];

export function registerResearchTools() {
  for (const tool of researchTools) {
    registry.register(tool);
  }
}
