import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface ArdenConfig {
  agent: {
    name: string;
    model: string;
    fallback_model: string;
    workspace: string;
    haiku_model: string;
    opus_model: string;
  };
  channels: {
    telegram?: { enabled: boolean; allowlist: string[] };
    whatsapp?: { enabled: boolean; allowlist: string[] };
  };
  gateway?: { port: number };
  loop: {
    max_iterations: number;
    require_completion_report: boolean;
  };
  heartbeat: {
    enabled: boolean;
    interval: string;
  };
}

const DEFAULTS: ArdenConfig = {
  agent: {
    name: 'Agent',
    model: 'claude-sonnet-4-6',
    fallback_model: 'claude-haiku-4-5-20251001',
    haiku_model: 'claude-haiku-4-5-20251001',
    opus_model: 'claude-opus-4-6',
    workspace: './workspace',
  },
  channels: {},
  loop: { max_iterations: 10, require_completion_report: true },
  heartbeat: { enabled: false, interval: '30m' },
};

export function loadConfig(configPath = './arden.config.json'): ArdenConfig {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) return DEFAULTS;
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  return { ...DEFAULTS, ...raw, agent: { ...DEFAULTS.agent, ...raw.agent } };
}

function loadSecrets(): Record<string, string> {
  const secretsPath = path.resolve('.arden-secrets.json');
  if (fs.existsSync(secretsPath)) {
    try {
      return JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

const secrets = loadSecrets();

export const env = {
  ANTHROPIC_API_KEY:  secrets.ANTHROPIC_API_KEY  ?? process.env.ANTHROPIC_API_KEY  ?? '',
  TELEGRAM_BOT_TOKEN: secrets.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN ?? '',
  WHATSAPP_NUMBER:    secrets.WHATSAPP_NUMBER     ?? process.env.WHATSAPP_NUMBER     ?? '',
  ARDEN_GATEWAY_PORT: parseInt(secrets.ARDEN_GATEWAY_PORT ?? process.env.ARDEN_GATEWAY_PORT ?? '3000'),
  ARDEN_AUTH_TOKEN:   secrets.ARDEN_AUTH_TOKEN   ?? process.env.ARDEN_AUTH_TOKEN   ?? '',
};
