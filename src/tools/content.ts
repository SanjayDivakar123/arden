import type { ArdenTool } from './registry.js';
import { registry } from './registry.js';
import fs from 'fs';
import path from 'path';

const CONTENT_DIR = path.resolve('./content');

export const contentTools: ArdenTool[] = [
  {
    name: 'content_draft',
    description: 'Save a drafted piece of content to disk',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Content type: post, newsletter, thread, script', enum: ['post', 'newsletter', 'thread', 'script'] },
        title: { type: 'string', description: 'Title or filename slug' },
        body: { type: 'string', description: 'Content body' },
      },
      required: ['type', 'title', 'body'],
    },
    handler: async (input) => {
      const { type, title, body } = input as { type: string; title: string; body: string };
      const dir = path.join(CONTENT_DIR, type);
      fs.mkdirSync(dir, { recursive: true });
      const filename = `${title.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.md`;
      const filePath = path.join(dir, filename);
      fs.writeFileSync(filePath, `# ${title}\n\n${body}`, 'utf8');
      return { success: true, path: filePath };
    },
  },
  {
    name: 'content_list',
    description: 'List all saved drafts',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by type: post, newsletter, thread, script' },
      },
      required: [],
    },
    handler: async (input) => {
      const { type } = input as { type?: string };
      const dir = type ? path.join(CONTENT_DIR, type) : CONTENT_DIR;
      if (!fs.existsSync(dir)) return { success: true, drafts: [] };
      const files = fs.readdirSync(dir, { recursive: true }) as string[];
      return { success: true, drafts: files };
    },
  },
  {
    name: 'content_read',
    description: 'Read a saved content draft',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path of the draft' },
      },
      required: ['path'],
    },
    handler: async (input) => {
      const { path: filePath } = input as { path: string };
      if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };
      return { success: true, content: fs.readFileSync(filePath, 'utf8') };
    },
  },
];

export function registerContentTools() {
  for (const tool of contentTools) {
    registry.register(tool);
  }
}
