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

export function getSecret(name: string): string {
  const secrets = loadSecrets();
  return secrets[name] ?? process.env[name] ?? '';
}

