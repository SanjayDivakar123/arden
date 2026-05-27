import { registry } from './registry.js';
import { logger } from '../utils/logger.js';
import { getSecret } from '../utils/secrets.js';

const MATON_CONTROL_API = 'https://ctrl.maton.ai';
const MATON_GATEWAY_API = 'https://gateway.maton.ai';

function getApiKey(): string {
  return getSecret('MATON_API_KEY');
}

async function matonRequest(
  endpoint: string,
  method: string,
  body?: object,
  connectionId?: string,
  baseUrl = MATON_GATEWAY_API,
) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('MATON_API_KEY not set. Send MATON_API_KEY=your_key in chat or add it via arden onboard.');
  const httpMethod = method.toUpperCase();

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: httpMethod,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(connectionId ? { 'Maton-Connection': connectionId } : {}),
    },
    body: body && !['GET', 'HEAD'].includes(httpMethod) ? JSON.stringify(body) : null,
  });

  if (!res.ok) {
    const text = await res.text();
    let err: string;
    try {
      const json = JSON.parse(text) as { error?: string; message?: string };
      err = json.error ?? json.message ?? JSON.stringify(json);
    } catch {
      err = text;
    }
    throw new Error(`Maton API error ${res.status}: ${err}`);
  }

  return res.json();
}

async function matonControlRequest(endpoint: string, method: string, body?: object) {
  return matonRequest(endpoint, method, body, undefined, MATON_CONTROL_API);
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

const MATON_APP_ALIASES: Record<string, string> = {
  gmail: 'google-mail',
  'google mail': 'google-mail',
  googlemail: 'google-mail',
  email: 'google-mail',
  calendar: 'google-calendar',
  'google calendar': 'google-calendar',
  gcal: 'google-calendar',
  sheets: 'google-sheets',
  spreadsheet: 'google-sheets',
  spreadsheets: 'google-sheets',
  'google sheets': 'google-sheets',
  docs: 'google-docs',
  'google docs': 'google-docs',
  drive: 'google-drive',
  'google drive': 'google-drive',
  zoho: 'zoho-mail',
  'zoho mail': 'zoho-mail',
  zohomail: 'zoho-mail',
  slack: 'slack',
  notion: 'notion',
  hubspot: 'hubspot',
  salesforce: 'salesforce',
  outlook: 'microsoft-outlook',
  'microsoft outlook': 'microsoft-outlook',
  teams: 'microsoft-teams',
  'microsoft teams': 'microsoft-teams',
};

type MatonConnection = {
  connection_id?: string;
  id?: string;
  status?: string;
  url?: string;
  connect_url?: string;
  connection_url?: string;
  auth_url?: string;
  app?: string;
  method?: string;
  metadata?: unknown;
};

function normalizeMatonApp(rawApp: string): string {
  const normalized = rawApp
    .trim()
    .toLowerCase()
    .replace(/^my\s+/, '')
    .replace(/\s+/g, ' ');

  if (!normalized) throw new Error('app is required.');
  return MATON_APP_ALIASES[normalized] ?? normalized.replace(/[_\s]+/g, '-');
}

function extractConnection(data: unknown): MatonConnection {
  if (!data || typeof data !== 'object') return {};
  const record = data as Record<string, unknown>;
  const nested = record.connection ?? record.data ?? record.result;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as MatonConnection;
  }
  return record as MatonConnection;
}

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

type ZohoAccount = {
  accountId?: string | number;
  account_id?: string | number;
  accountID?: string | number;
  zuid?: string | number;
  isDefaultAccount?: boolean;
  incomingUserName?: string;
  emailAddress?: Array<{
    mailId?: string;
    isPrimary?: boolean;
  }>;
};

function assertNonEmpty(value: string | undefined, fieldName: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${fieldName} is required.`);
  return trimmed;
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildGmailRawMessage(input: {
  from?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  content: string;
  contentType: string;
}): string {
  const headers = [
    input.from ? `From: ${input.from}` : null,
    `To: ${input.to}`,
    input.cc ? `Cc: ${input.cc}` : null,
    input.bcc ? `Bcc: ${input.bcc}` : null,
    `Subject: ${input.subject}`,
    `Content-Type: ${input.contentType === 'html' ? 'text/html' : 'text/plain'}; charset=UTF-8`,
    'MIME-Version: 1.0',
  ].filter(Boolean);

  return base64UrlEncode(`${headers.join('\r\n')}\r\n\r\n${input.content}`);
}

function getZohoAccountId(account: ZohoAccount): string | undefined {
  const id = account.accountId ?? account.account_id ?? account.accountID ?? account.zuid;
  return id === undefined ? undefined : String(id);
}

function getZohoFromAddress(account: ZohoAccount): string | undefined {
  const primary = account.emailAddress?.find((email) => email.isPrimary)?.mailId;
  return primary ?? account.emailAddress?.[0]?.mailId ?? account.incomingUserName;
}

async function resolveZohoAccount(accountId: string | undefined, connectionId: string | undefined): Promise<{
  accountId: string;
  fromAddress?: string;
}> {
  if (accountId?.trim()) return { accountId: accountId.trim() };

  const data = await matonRequest('/zoho-mail/api/accounts', 'GET', undefined, connectionId) as {
    data?: ZohoAccount[];
  };
  const accounts = Array.isArray(data.data) ? data.data : [];
  const account = accounts.find((item) => item.isDefaultAccount) ?? accounts[0];
  const resolved = account ? getZohoAccountId(account) : undefined;
  if (!resolved) {
    throw new Error('Could not resolve a Zoho Mail account ID. Pass account_id explicitly.');
  }
  const inferredFromAddress = account ? getZohoFromAddress(account) : undefined;
  return inferredFromAddress
    ? { accountId: resolved, fromAddress: inferredFromAddress }
    : { accountId: resolved };
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
      const data = await matonControlRequest(`/connections${qs ? `?${qs}` : ''}`, 'GET') as Record<string, unknown>;
      return JSON.stringify(data);
    },
  });

  registry.register({
    name: 'maton_create_connection',
    description: 'Create a Maton OAuth/API connection for an app and return the connect URL the user should open. Use this when the user asks to link or connect Gmail, Zoho Mail, Slack, Notion, Google Calendar, Google Sheets, or another app through Maton.',
    parameters: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Maton app name or common alias, e.g. gmail, google-mail, zoho, zoho-mail, slack, notion, google-calendar.' },
        method: { type: 'string', description: 'Optional connection method. Usually omit it for OAuth apps. Examples: OAUTH2, API_KEY, BASIC, OAUTH1, MCP.' },
      },
      required: ['app'],
    },
    handler: async (input) => {
      const { app, method } = input as { app?: string; method?: string };
      const appName = normalizeMatonApp(assertNonEmpty(app, 'app'));
      const body: Record<string, string> = { app: appName };
      const connectionMethod = cleanOptional(method);
      if (connectionMethod) body.method = connectionMethod;

      logger.info('MATON', `Creating connection for ${appName}`);
      const data = await matonControlRequest('/connections', 'POST', body);
      const connection = extractConnection(data);
      const connectionId = connection.connection_id ?? connection.id;
      const connectUrl = connection.url ?? connection.connect_url ?? connection.connection_url ?? connection.auth_url;

      return JSON.stringify({
        app: connection.app ?? appName,
        connection_id: connectionId,
        status: connection.status,
        url: connectUrl,
        connect_url: connectUrl,
        message: connectUrl
          ? `Open this Maton link to finish connecting ${connection.app ?? appName}: ${connectUrl}`
          : `Maton created a connection for ${connection.app ?? appName}, but did not return a connect URL.`,
        raw: data,
      });
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

      let parsedBody: object | undefined;
      if (body) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          // If not valid JSON, treat as raw string if it's not empty
          if (body.trim()) parsedBody = { raw: body };
        }
      }

      const data = await matonRequest(
        normalizedPath,
        method,
        parsedBody,
        connection_id,
      );
      return JSON.stringify(data);
    },
  });

  registry.register({
    name: 'maton_send_email',
    description: 'Send email through Maton using native provider APIs, bypassing generic action routing. Supports zoho-mail via /zoho-mail/api/accounts/{accountId}/messages and google-mail via /google-mail/gmail/v1/users/me/messages/send. Use only when the user explicitly asks to send email.',
    parameters: {
      type: 'object',
      properties: {
        app:            { type: 'string', description: 'Email app to send through.', enum: ['zoho-mail', 'google-mail'] },
        connection_id:  { type: 'string', description: 'Optional Maton connection ID to route to a specific account.' },
        account_id:     { type: 'string', description: 'Zoho Mail account ID. Optional; Arden will use the default Zoho account when omitted.' },
        from_address:   { type: 'string', description: 'Optional sender address. Must be authorized by the connected mail account.' },
        to:             { type: 'string', description: 'Recipient email address or comma-separated recipient list.' },
        cc:             { type: 'string', description: 'Optional comma-separated CC recipients.' },
        bcc:            { type: 'string', description: 'Optional comma-separated BCC recipients.' },
        subject:        { type: 'string', description: 'Email subject.' },
        content:        { type: 'string', description: 'Email body content.' },
        content_type:   { type: 'string', description: 'Email body type. Defaults to text.', enum: ['text', 'html'] },
      },
      required: ['app', 'to', 'subject', 'content'],
    },
    handler: async (input) => {
      const {
        app,
        connection_id,
        account_id,
        from_address,
        to,
        cc,
        bcc,
        subject,
        content,
        content_type,
      } = input as Record<string, string | undefined>;

      const mailApp = assertNonEmpty(app, 'app');
      const toAddress = assertNonEmpty(to, 'to');
      const emailSubject = assertNonEmpty(subject, 'subject');
      const emailContent = assertNonEmpty(content, 'content');
      const contentType = content_type === 'html' ? 'html' : 'text';

      if (mailApp === 'zoho-mail') {
        const zohoAccount = await resolveZohoAccount(account_id, connection_id);
        const fromAddress = cleanOptional(from_address) ?? zohoAccount.fromAddress;
        if (!fromAddress) {
          throw new Error('from_address is required for Zoho Mail when Arden cannot infer it from /api/accounts.');
        }
        const body: Record<string, string> = {
          fromAddress,
          toAddress,
          subject: emailSubject,
          content: emailContent,
          mailFormat: contentType === 'html' ? 'html' : 'plaintext',
        };
        const ccAddress = cleanOptional(cc);
        const bccAddress = cleanOptional(bcc);
        if (ccAddress) body.ccAddress = ccAddress;
        if (bccAddress) body.bccAddress = bccAddress;

        logger.info('MATON', `Send email via /zoho-mail/api/accounts/${zohoAccount.accountId}/messages`);
        const data = await matonRequest(
          `/zoho-mail/api/accounts/${encodeURIComponent(zohoAccount.accountId)}/messages`,
          'POST',
          body,
          connection_id,
        );
        return JSON.stringify(data);
      }

      if (mailApp === 'google-mail') {
        logger.info('MATON', 'Send email via /google-mail/gmail/v1/users/me/messages/send');
        const message = {
          to: toAddress,
          subject: emailSubject,
          content: emailContent,
          contentType,
        } as {
          from?: string;
          to: string;
          cc?: string;
          bcc?: string;
          subject: string;
          content: string;
          contentType: string;
        };
        const fromAddress = cleanOptional(from_address);
        const ccAddress = cleanOptional(cc);
        const bccAddress = cleanOptional(bcc);
        if (fromAddress) message.from = fromAddress;
        if (ccAddress) message.cc = ccAddress;
        if (bccAddress) message.bcc = bccAddress;
        const raw = buildGmailRawMessage(message);
        const data = await matonRequest(
          '/google-mail/gmail/v1/users/me/messages/send',
          'POST',
          { raw },
          connection_id,
        );
        return JSON.stringify(data);
      }

      throw new Error(`Unsupported email app for maton_send_email: ${mailApp}`);
    },
  });

  logger.success('TOOLS', 'Maton tools registered: maton_list_connections, maton_create_connection, maton_run_action, maton_proxy_request, maton_send_email');
}
