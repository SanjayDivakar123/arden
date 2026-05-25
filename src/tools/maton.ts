import { registry } from './registry.js';
import { logger } from '../utils/logger.js';
import { getSecret } from '../utils/secrets.js';

const MATON_API = 'https://api.maton.ai';

function getApiKey(): string {
  return getSecret('MATON_API_KEY');
}

async function matonRequest(endpoint: string, method: string, body?: object, connectionId?: string) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('MATON_API_KEY not set. Add it via arden onboard.');

  const res = await fetch(`${MATON_API}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(connectionId ? { 'Maton-Connection': connectionId } : {}),
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Maton API error ${res.status}: ${err}`);
  }

  return res.json();
}

function parseJsonParam(value: string | undefined, fieldName: string): object | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as object;
  } catch {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
}

function normalizeProxyPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export function registerMatonTools() {
  registry.register({
    name: 'maton_list_connections',
    description: 'List available app connections in Maton. Optionally filter by app and status.',
    parameters: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Optional app filter, e.g. google-mail, google-calendar, slack.' },
        status: { type: 'string', description: 'Optional status filter, e.g. ACTIVE, PENDING, FAILED.' },
      },
      required: [],
    },
    handler: async (input) => {
      const { app, status } = input as { app?: string; status?: string };
      logger.info('MATON', 'Listing connections');
      const params = new URLSearchParams();
      if (app) params.set('app', app);
      if (status) params.set('status', status);
      const qs = params.toString();
      const data = await matonRequest(`/connections${qs ? `?${qs}` : ''}`, 'GET') as Record<string, unknown>;
      return JSON.stringify(data);
    },
  });

  registry.register({
    name: 'maton_run_action',
    description: 'Run a native app API call via Maton. Prefer maton_proxy_request for new tasks. The action value must be a native app path like /google-mail/gmail/v1/users/me/messages.',
    parameters: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'Optional Maton connection ID to route to a specific account.' },
        action:        { type: 'string', description: 'Native app path, e.g. /google-mail/gmail/v1/users/me/messages.' },
        params:        { type: 'string', description: 'JSON string body for POST requests. Leave blank for GET.' },
        method:        { type: 'string', description: 'HTTP method: GET, POST, PUT, DELETE. Defaults to POST.', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
      },
      required: ['action'],
    },
    handler: async (input) => {
      const { connection_id, action, params, method } = input as {
        connection_id?: string;
        action: string;
        params?: string;
        method?: string;
      };
      const httpMethod = method ?? 'POST';
      logger.info('MATON', `${httpMethod} ${action}`);
      const parsedParams = parseJsonParam(params, 'params');
      const data = await matonRequest(normalizeProxyPath(action), httpMethod, parsedParams, connection_id);
      return JSON.stringify(data);
    },
  });

  registry.register({
    name: 'maton_proxy_request',
    description: 'Make an authenticated API request to any connected service via the Maton gateway.',
    parameters: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'Optional Maton connection ID to route to a specific account.' },
        method:        { type: 'string', description: 'HTTP method: GET, POST, PUT, DELETE.', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
        path:          { type: 'string', description: 'Maton proxy path including the app name, e.g. /google-mail/gmail/v1/users/me/messages or /google-calendar/calendar/v3/calendars/primary/events.' },
        body:          { type: 'string', description: 'JSON string body for POST/PUT requests.' },
      },
      required: ['method', 'path'],
    },
    handler: async (input) => {
      const { connection_id, method, path, body } = input as {
        connection_id?: string;
        method: string;
        path: string;
        body?: string;
      };
      logger.info('MATON', `Proxy ${method} ${path}`);
      const data = await matonRequest(
        normalizeProxyPath(path),
        method,
        parseJsonParam(body, 'body'),
        connection_id,
      );
      return JSON.stringify(data);
    },
  });

  logger.success('TOOLS', 'Maton tools registered: maton_list_connections, maton_run_action, maton_proxy_request');
}
