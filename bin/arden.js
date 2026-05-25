#!/usr/bin/env node
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(__dirname, '../src/cli/index.ts');
const localTsx = path.resolve(__dirname, '../node_modules/.bin/tsx' + (process.platform === 'win32' ? '.cmd' : ''));

if (!fs.existsSync(path.resolve(__dirname, '../node_modules'))) {
  console.error('\x1b[31m✘ node_modules not found. Please run "npm install" first.\x1b[0m');
  process.exit(1);
}

const tsx = fs.existsSync(localTsx) ? localTsx : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
const args = tsx.includes('npx') ? ['tsx', cli, ...process.argv.slice(2)] : [cli, ...process.argv.slice(2)];

const proc = spawn(tsx, args, { stdio: 'inherit' });
proc.on('exit', (code) => process.exit(code ?? 0));
