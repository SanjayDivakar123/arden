import fs from 'fs';
import path from 'path';
import Browserbase from '@browserbasehq/sdk';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { registry } from './registry.js';
import { logger } from '../utils/logger.js';
import { getSecret } from '../utils/secrets.js';

type BrowserbaseSession = {
  browser: Browser;
  page: Page;
  sessionId: string;
};

const sessions = new Map<string, BrowserbaseSession>();

function getBrowserbaseConfig() {
  const apiKey = getSecret('BROWSERBASE_API_KEY');
  const projectId = getSecret('BROWSERBASE_PROJECT_ID');
  if (!apiKey) throw new Error('BROWSERBASE_API_KEY not set. Add it via arden onboard or .arden-secrets.json.');
  return { apiKey, projectId };
}

function getClient() {
  const { apiKey } = getBrowserbaseConfig();
  return new Browserbase({ apiKey });
}

async function createSession(): Promise<BrowserbaseSession> {
  const bb = getClient();
  const { projectId } = getBrowserbaseConfig();
  const options = projectId ? { projectId } : {};
  const session = await bb.sessions.create(options);
  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = context.pages()[0] ?? await context.newPage();
  const managedSession = { browser, page, sessionId: session.id };
  sessions.set(session.id, managedSession);
  logger.info('BROWSERBASE', `Session created: ${session.id}`);
  return managedSession;
}

async function getSession(sessionId?: string): Promise<BrowserbaseSession> {
  if (!sessionId) return createSession();
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Browserbase session not found: ${sessionId}. Start with browserbase_navigate.`);
  return session;
}

async function pageSummary(page: Page) {
  const title = await page.title();
  const url = page.url();
  const text = await page.evaluate(() => document.body?.innerText ?? '');
  return { title, url, text: text.substring(0, 8000) };
}

async function clickTarget(page: Page, target: string) {
  try {
    await page.locator(target).first().click({ timeout: 5000 });
    return;
  } catch {
    await page.getByText(target, { exact: false }).first().click({ timeout: 10000 });
  }
}

export function registerBrowserbaseTools() {
  registry.register({
    name: 'browserbase_navigate',
    description: 'Create or reuse a Browserbase cloud browser session, navigate to a URL, and return visible page text.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to navigate to.' },
        session_id: { type: 'string', description: 'Existing Browserbase session ID to reuse, if any.' },
      },
      required: ['url'],
    },
    handler: async (input) => {
      const { url, session_id } = input as { url: string; session_id?: string };
      const session = await getSession(session_id);
      logger.info('BROWSERBASE', `Navigating ${session.sessionId} to: ${url}`);
      await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return { success: true, session_id: session.sessionId, ...await pageSummary(session.page) };
    },
  });

  registry.register({
    name: 'browserbase_extract_text',
    description: 'Extract visible text from an existing Browserbase cloud browser session.',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Existing Browserbase session ID.' },
      },
      required: ['session_id'],
    },
    handler: async (input) => {
      const { session_id } = input as { session_id: string };
      const session = await getSession(session_id);
      return { success: true, session_id, ...await pageSummary(session.page) };
    },
  });

  registry.register({
    name: 'browserbase_screenshot',
    description: 'Take a screenshot in a Browserbase cloud browser. Provide either a URL or an existing session_id.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Optional URL to navigate to before taking the screenshot.' },
        session_id: { type: 'string', description: 'Existing Browserbase session ID to reuse, if any.' },
        path: { type: 'string', description: 'File path to save screenshot. Defaults to workspace/browserbase-screenshot.png.' },
      },
      required: [],
    },
    handler: async (input) => {
      const { url, session_id, path: screenshotPath } = input as { url?: string; session_id?: string; path?: string };
      const session = await getSession(session_id);
      if (url) await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const outputPath = screenshotPath ?? `workspace/browserbase-${Date.now()}.png`;
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      await session.page.screenshot({ path: outputPath, fullPage: true });
      return { success: true, session_id: session.sessionId, path: outputPath, ...await pageSummary(session.page) };
    },
  });

  registry.register({
    name: 'browserbase_click',
    description: 'Click an element in an existing Browserbase cloud browser session by CSS selector or visible text.',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Existing Browserbase session ID.' },
        selector: { type: 'string', description: 'CSS selector or visible text to click.' },
      },
      required: ['session_id', 'selector'],
    },
    handler: async (input) => {
      const { session_id, selector } = input as { session_id: string; selector: string };
      const session = await getSession(session_id);
      await clickTarget(session.page, selector);
      return { success: true, session_id, clicked: selector, ...await pageSummary(session.page) };
    },
  });

  registry.register({
    name: 'browserbase_type',
    description: 'Type text into an input in an existing Browserbase cloud browser session.',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Existing Browserbase session ID.' },
        selector: { type: 'string', description: 'CSS selector of the input field.' },
        text: { type: 'string', description: 'Text to type.' },
      },
      required: ['session_id', 'selector', 'text'],
    },
    handler: async (input) => {
      const { session_id, selector, text } = input as { session_id: string; selector: string; text: string };
      const session = await getSession(session_id);
      await session.page.fill(selector, text);
      return { success: true, session_id, selector };
    },
  });

  registry.register({
    name: 'browserbase_close',
    description: 'Close a Browserbase cloud browser session.',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Existing Browserbase session ID.' },
      },
      required: ['session_id'],
    },
    handler: async (input) => {
      const { session_id } = input as { session_id: string };
      const session = sessions.get(session_id);
      if (!session) return { success: true, session_id, closed: false };
      await session.browser.close();
      sessions.delete(session_id);
      return { success: true, session_id, closed: true };
    },
  });

  logger.success('TOOLS', 'Browserbase tools registered: browserbase_navigate, browserbase_extract_text, browserbase_screenshot, browserbase_click, browserbase_type, browserbase_close');
}

