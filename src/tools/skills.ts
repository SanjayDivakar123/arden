import fs from 'fs';
import path from 'path';
import type { ArdenTool } from './registry.js';
import { registry } from './registry.js';

const SKILLS_DIR = path.resolve(process.env.ARDEN_SKILLS_DIR ?? './skills');

export const skillsTools: ArdenTool[] = [
  {
    name: 'skills_list',
    description: 'List all available skills',
    parameters: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      if (!fs.existsSync(SKILLS_DIR)) return { success: true, skills: [] };
      const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md') || f.endsWith('.json'));
      return { success: true, skills: files };
    },
  },
  {
    name: 'skills_read',
    description: 'Read a skill by filename',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill filename e.g. "research.md"' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      const { name } = input as { name: string };
      const filePath = path.join(SKILLS_DIR, name);
      if (!fs.existsSync(filePath)) return { success: false, error: 'Skill not found' };
      const content = fs.readFileSync(filePath, 'utf8');
      return { success: true, content };
    },
  },
  {
    name: 'skills_save',
    description: 'Save a new skill',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill filename e.g. "my-skill.md"' },
        content: { type: 'string', description: 'Skill content/instructions' },
      },
      required: ['name', 'content'],
    },
    handler: async (input) => {
      const { name, content } = input as { name: string; content: string };
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
      fs.writeFileSync(path.join(SKILLS_DIR, name), content, 'utf8');
      return { success: true };
    },
  },
];

export function registerSkillsTools() {
  for (const tool of skillsTools) {
    registry.register(tool);
  }
}
