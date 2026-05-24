import { registry } from './registry.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';

function getApiKey(): string {
  const secretsPath = '.arden-secrets.json';
  if (fs.existsSync(secretsPath)) {
    const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
    if (secrets.MATON_API_KEY) return secrets.MATON_API_KEY;
  }
  return process.env.MATON_API_KEY ?? '';
}

async function matonRequest(endpoint: string, method: string, body?: object) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('MATON_API_KEY not set. Add it via arden onboard.');

  const res = await fetch(`https://api.maton.ai/v1${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Maton API error ${res.status}: ${err}`);
  }

  return res.json();
}

export function registerMatonTools() {
  registry.register({
    name: 'maton_list_connections',
    description: 'List all available app connections in Maton (Gmail, Calendar, Slack, etc).',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      logger.info('MATON', 'Listing connections');
      const data = await matonRequest('/connections', 'GET') as Record<string, unknown>;
      return JSON.stringify(data);
    },
  });

  registry.register({
    name: 'maton_run_action',
    description: 'Run an action on a connected app via Maton. Use maton_list_connections first to see what is available.',
    parameters: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'The Maton connection ID (e.g. gmail, google-calendar, slack).' },
        action:        { type: 'string', description: 'The action to run (e.g. send_email, create_event, send_message).' },
        params:        { type: 'string', description: 'JSON string of parameters for the action.' },
      },
      required: ['connection_id', 'action', 'params'],
    },
    handler: async (input) => {
      const { connection_id, action, params } = input as {
        connection_id: string;
        action: string;
        params: string;
      };
      logger.info('MATON', `Running ${action} on ${connection_id}`);
      const parsedParams = JSON.parse(params);
      const data = await matonRequest(`/connections/${connection_id}/actions/${action}`, 'POST', parsedParams);
      return JSON.stringify(data);
    },
  });

  registry.register({
    name: 'maton_proxy_request',
    description: 'Make an authenticated API request to any connected service via the Maton gateway.',
    parameters: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'The Maton connection ID.' },
        method:        { type: 'string', description: 'HTTP method: GET, POST, PUT, DELETE.', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
        path:          { type: 'string', description: 'API path to call on the connected service.' },
        body:          { type: 'string', description: 'JSON string body for POST/PUT requests.' },
      },
      required: ['connection_id', 'method', 'path'],
    },
    handler: async (input) => {
      const { connection_id, method, path, body } = input as {
        connection_id: string;
        method: string;
        path: string;
        body?: string;
      };
      logger.info('MATON', `Proxy ${method} ${path} via ${connection_id}`);
      const data = await matonRequest(
        `/proxy/${connection_id}${path}`,
        method,
        body ? JSON.parse(body) : undefined,
      );
      return JSON.stringify(data);
    },
  });

  logger.success('TOOLS', 'Maton tools registered: maton_list_connections, maton_run_action, maton_proxy_request');
}
