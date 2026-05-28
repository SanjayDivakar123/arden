#!/usr/bin/env node
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(__dirname, '../src/cli/index.ts');

function resolveTsxCli() {
  try {
    return require.resolve('tsx/cli');
  } catch {
    try {
      return path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');
    } catch {
      return null;
    }
  }
}

const tsxCli = resolveTsxCli();
if (!tsxCli) {
  console.error('\x1b[31m✘ tsx not found. Please run "npm install" first.\x1b[0m');
  process.exit(1);
}

const proc = spawn(process.execPath, [tsxCli, cli, ...process.argv.slice(2)], { stdio: 'inherit' });
proc.on('error', (err) => {
  console.error(`\x1b[31m✘ Failed to start Arden CLI: ${err.message}\x1b[0m`);
  process.exit(1);
});
proc.on('exit', (code) => process.exit(code ?? 0));
