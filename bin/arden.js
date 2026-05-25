#!/usr/bin/env node
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(__dirname, '../src/cli/index.ts');

// Use npx if available, otherwise fallback to local node_modules
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['tsx', cli, ...process.argv.slice(2)];

const proc = spawn(command, args, { stdio: 'inherit' });
proc.on('exit', (code) => process.exit(code ?? 0));
