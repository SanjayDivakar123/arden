import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';

const require = createRequire(import.meta.url);

export function resolveTsxLoader(): string {
  try {
    return require.resolve('tsx');
  } catch {
    try {
      return path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'loader.mjs');
    } catch {
      throw new Error('tsx not found. Please run "npm install" first.');
    }
  }
}

export function resolveTsxCli(): string {
  try {
    return require.resolve('tsx/cli');
  } catch {
    try {
      return path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');
    } catch {
      throw new Error('tsx not found. Please run "npm install" first.');
    }
  }
}

export function tsxNodeImportArg(): string {
  return `--import=${pathToFileURL(resolveTsxLoader()).href}`;
}

export function tsxNodeCommand(entry: string, args: string[] = []) {
  return {
    command: process.execPath,
    args: [tsxNodeImportArg(), entry, ...args],
  };
}
