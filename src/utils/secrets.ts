import fs from 'fs';
import path from 'path';

export function loadSecrets(): Record<string, string> {
  const candidates = [
    path.resolve('.arden-secrets.json'),
    path.join(process.env.HOME ?? '', '.arden-secrets.json'),
  ];

  for (const secretsPath of candidates) {
    if (!secretsPath || !fs.existsSync(secretsPath)) continue;
    try {
      return JSON.parse(fs.readFileSync(secretsPath, 'utf-8')) as Record<string, string>;
    } catch {
      return {};
    }
  }

  return {};
}

function secretsWritePath(): string {
  const localPath = path.resolve('.arden-secrets.json');
  const localConfigPath = path.resolve('arden.config.json');
  const homePath = path.join(process.env.HOME ?? '', '.arden-secrets.json');

  if (fs.existsSync(localPath) || fs.existsSync(localConfigPath)) return localPath;
  if (homePath && fs.existsSync(homePath)) return homePath;
  return localPath;
}

export function saveSecrets(secrets: Record<string, string>): void {
  fs.writeFileSync(secretsWritePath(), JSON.stringify(secrets, null, 2), { mode: 0o600 });
}

export function setSecret(name: string, value: string): void {
  const key = name.trim().toUpperCase();
  const secretValue = value.trim();
  if (!key) throw new Error('Secret name is required.');
  if (!secretValue) throw new Error(`Secret value is required for ${key}.`);

  const secrets = loadSecrets();
  secrets[key] = secretValue;
  saveSecrets(secrets);
  process.env[key] = secretValue;
}

export function getSecret(name: string): string {
  const secrets = loadSecrets();
  return secrets[name] ?? process.env[name] ?? '';
}

export function redactSecrets(value: string): string {
  return value
    .replace(/\b([A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|ENCRYPTED_KEY|AUTH_TOKEN|PROJECT_ID|FROM_NUMBER|NUMBER|GATEWAY_PORT)\s*[:=]\s*)([^\s]+)/gi, '$1[redacted]')
    .replace(/\b((?:api\s*key|token|secret|encrypted[_\s-]?key|bot\s*token)\s*(?:is|=|:)\s*)([^\s]+)/gi, '$1[redacted]')
    .replace(/\b(sk-(?:ant-)?[A-Za-z0-9._-]{12,})\b/g, '[redacted]');
}
