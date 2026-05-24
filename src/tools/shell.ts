import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import type { ArdenTool } from './registry.js';

const execAsync = promisify(exec);

export const shellTools: ArdenTool[] = [
  {
    name: 'shell_exec',
    description: 'Execute a shell command and return stdout/stderr',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
      },
      required: ['command'],
    },
    handler: async (input) => {
      const { command, cwd } = input as { command: string; cwd?: string };
      try {
        const { stdout, stderr } = await execAsync(command, { cwd, timeout: 30000 });
        return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
      } catch (err: any) {
        return { success: false, error: err.message, stdout: err.stdout, stderr: err.stderr };
      }
    },
  },
  {
    name: 'file_read',
    description: 'Read the contents of a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path' },
      },
      required: ['path'],
    },
    handler: async (input) => {
      const { path: filePath } = input as { path: string };
      try {
        const content = fs.readFileSync(path.resolve(filePath), 'utf8');
        return { success: true, content };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
  {
    name: 'file_write',
    description: 'Write content to a file, creating it if it does not exist',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write to' },
        content: { type: 'string', description: 'Content to write' },
        append: { type: 'string', description: 'Set to "true" to append instead of overwrite' },
      },
      required: ['path', 'content'],
    },
    handler: async (input) => {
      const { path: filePath, content, append } = input as { path: string; content: string; append?: string };
      try {
        const resolved = path.resolve(filePath);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        if (append === 'true') {
          fs.appendFileSync(resolved, content, 'utf8');
        } else {
          fs.writeFileSync(resolved, content, 'utf8');
        }
        return { success: true, path: resolved };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
  {
    name: 'file_list',
    description: 'List files in a directory',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list' },
      },
      required: ['path'],
    },
    handler: async (input) => {
      const { path: dirPath } = input as { path: string };
      try {
        const files = fs.readdirSync(path.resolve(dirPath));
        return { success: true, files };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
  {
    name: 'file_delete',
    description: 'Delete a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to delete' },
      },
      required: ['path'],
    },
    handler: async (input) => {
      const { path: filePath } = input as { path: string };
      try {
        fs.unlinkSync(path.resolve(filePath));
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },
];

import { registry } from './registry.js';

export function registerShellTools() {
  for (const tool of shellTools) {
    registry.register(tool);
  }
}
