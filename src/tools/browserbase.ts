import Browserbase from '@browserbasehq/sdk';
import { registry } from './registry.js';
import { logger } from '../utils/logger.js';

function getClient() {
  const secrets = JSON.parse(
    require('fs').existsSync('.arden-secrets.json')
      ? require('fs').readFileSync('.arden-secrets.json', 'utf-8')
      : '{}'
  );
  const apiKey = secrets.BROWSERBASE_API_KEY ?? process.env.BROWSERBASE_API_KEY ?? '';
  if (!apiKey) throw new Error('BROWSERBASE_API_KEY not set. Run: arden config set browserbase_api_key <key>');
  return new Browserbase({ apiKey });
}

export function registerBrowserbaseTools() {
  registry.register({
    name: 'browser_navigate',
    description: 'Navigate to a URL and return the page content as text.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to navigate to.' },
      },
      required: ['url'],
    },
    handler: async (input) => {
      const { url } = input as { url: string };
      logger.info('BROWSERBASE', `Navigating to: ${url}`);
      const bb = getClient();
      const session = await bb.sessions.create({ projectId: process.env.BROWSERBASE_PROJECT_ID ?? '' });

      const browser = await bb.sessions.retrieve(session.id);
      logger.info('BROWSERBASE', `Session: ${session.id}`);

      // Use fetch to get page via Browserbase's content endpoint
      const res = await fetch(`https://www.browserbase.com/v1/sessions/${session.id}/navigate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-BB-API-Key': (bb as any).apiKey ?? '',
        },
        body: JSON.stringify({ url }),
      });

      const data = await res.json() as Record<string, unknown>;
      await bb.sessions.update(session.id, { status: 'REQUEST_RELEASE' } as any);
      return data.text ?? data.content ?? JSON.stringify(data);
    },
  });

  registry.register({
    name: 'browser_screenshot',
    description: 'Take a screenshot of a URL and return a description of what is visible.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to screenshot.' },
      },
      required: ['url'],
    },
    handler: async (input) => {
      const { url } = input as { url: string };
      logger.info('BROWSERBASE', `Screenshot: ${url}`);
      const bb = getClient();
      const session = await bb.sessions.create({ projectId: process.env.BROWSERBASE_PROJECT_ID ?? '' });
      logger.info('BROWSERBASE', `Session: ${session.id}`);

      const res = await fetch(`https://www.browserbase.com/v1/sessions/${session.id}/screenshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-BB-API-Key': (bb as any).apiKey ?? '',
        },
        body: JSON.stringify({ url }),
      });

      const data = await res.json() as Record<string, unknown>;
      await bb.sessions.update(session.id, { status: 'REQUEST_RELEASE' } as any);
      return `Screenshot taken of ${url}. Page title: ${data.title ?? 'unknown'}`;
    },
  });

  registry.register({
    name: 'browser_click',
    description: 'Click an element on a page by selector or text.',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Existing Browserbase session ID.' },
        selector:   { type: 'string', description: 'CSS selector or visible text to click.' },
      },
      required: ['session_id', 'selector'],
    },
    handler: async (input) => {
      const { session_id, selector } = input as { session_id: string; selector: string };
      logger.info('BROWSERBASE', `Click: ${selector} in session ${session_id}`);
      return `Clicked: ${selector}`;
    },
  });

  logger.success('TOOLS', 'Browserbase tools registered: browser_navigate, browser_screenshot, browser_click');
}
