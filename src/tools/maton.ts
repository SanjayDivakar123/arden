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
  const httpMethod = method.toUpperCase();

  const res = await fetch(`${MATON_API}${endpoint}`, {
    method: httpMethod,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(connectionId ? { 'Maton-Connection': connectionId } : {}),
    },
    body: body && !['GET', 'HEAD'].includes(httpMethod) ? JSON.stringify(body) : null,
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

const NATIVE_PATH_APP_PREFIXES: Record<string, string> = {
  gmail: 'google-mail',
  calendar: 'google-calendar',
};

const APP_NATIVE_PATH_PREFIXES: Record<string, string> = {
  'google-mail': 'gmail',
  'google-calendar': 'calendar',
};

function normalizeProxyPath(rawPath: string, app?: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) throw new Error('Maton path must not be empty.');

  let path = trimmed;
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path);
    path = `${url.pathname}${url.search}`;
  }

  const queryIndex = path.indexOf('?');
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : path.slice(queryIndex);
  const parts = pathname.split('/').filter(Boolean);
  const appName = app?.trim();
  const first = parts[0];

  if (appName && first !== appName) {
    const nativePrefix = APP_NATIVE_PATH_PREFIXES[appName];
    if (nativePrefix && first !== nativePrefix) {
      parts.unshift(nativePrefix);
    }
    parts.unshift(appName);
  } else if (first && NATIVE_PATH_APP_PREFIXES[first]) {
    parts.unshift(NATIVE_PATH_APP_PREFIXES[first]);
  }

  return `/${parts.join('/')}${query}`;
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
    description: 'Run a native app API call via Maton. Prefer maton_proxy_request for new tasks. Use full Maton paths like /google-mail/gmail/v1/users/me/messages. Native Gmail paths like /gmail/v1/users/me/messages are accepted and normalized.',
    parameters: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'Optional Maton connection ID to route to a specific account.' },
        app:           { type: 'string', description: 'Optional app name for older callers, e.g. google-mail. Prefer including it in the path.' },
        action:        { type: 'string', description: 'Native app path, e.g. /google-mail/gmail/v1/users/me/messages. Bare /gmail/v1/... paths are normalized to /google-mail/gmail/v1/...' },
        params:        { type: 'string', description: 'JSON string body for POST/PUT requests. Leave blank for GET.' },
        method:        { type: 'string', description: 'HTTP method: GET, POST, PUT, DELETE. Defaults to GET without params, POST with params.', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
      },
      required: ['action'],
    },
    handler: async (input) => {
      const { connection_id, app, action, params, method } = input as {
        connection_id?: string;
        app?: string;
        action: string;
        params?: string;
        method?: string;
      };
      const httpMethod = method ?? (params ? 'POST' : 'GET');
      const normalizedPath = normalizeProxyPath(action, app);
      logger.info('MATON', `${httpMethod} ${normalizedPath}`);
      const parsedParams = parseJsonParam(params, 'params');
      const data = await matonRequest(normalizedPath, httpMethod, parsedParams, connection_id);
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
        app:           { type: 'string', description: 'Optional app name for older callers, e.g. google-mail. Prefer full paths like /google-mail/gmail/v1/...' },
        method:        { type: 'string', description: 'HTTP method: GET, POST, PUT, DELETE.', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
        path:          { type: 'string', description: 'Maton proxy path including the app name, e.g. /google-mail/gmail/v1/users/me/messages or /google-calendar/calendar/v3/calendars/primary/events. Bare /gmail/v1/... paths are normalized automatically.' },
        body:          { type: 'string', description: 'JSON string body for POST/PUT requests.' },
      },
      required: ['method', 'path'],
    },
    handler: async (input) => {
      const { connection_id, app, method, path, body } = input as {
        connection_id?: string;
        app?: string;
        method: string;
        path: string;
        body?: string;
      };
      const normalizedPath = normalizeProxyPath(path, app);
      logger.info('MATON', `Proxy ${method} ${normalizedPath}`);
      const data = await matonRequest(
        normalizedPath,
        method,
        parseJsonParam(body, 'body'),
        connection_id,
      );
      return JSON.stringify(data);
    },
  });

  logger.success('TOOLS', 'Maton tools registered: maton_list_connections, maton_run_action, maton_proxy_request');
}
