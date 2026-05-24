#!/usr/bin/env node
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsx = path.resolve(__dirname, '../node_modules/.bin/tsx');
const cli = path.resolve(__dirname, '../src/cli/index.ts');

const proc = spawn(tsx, [cli, ...process.argv.slice(2)], { stdio: 'inherit' });
proc.on('exit', (code) => process.exit(code ?? 0));
