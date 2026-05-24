import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import type { ArdenTool } from './registry.js';
import { registry } from './registry.js';

let browser: Browser | null = null;
let page: Page | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

async function getPage(): Promise<Page> {
  if (!page || page.isClosed()) {
    const b = await getBrowser();
    page = await b.newPage();
  }
  return page;
}

export const browserTools: ArdenTool[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL in the browser',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to navigate to' },
      },
      required: ['url'],
    },
    handler: async (input) => {
      const { url } = input as { url: string };
      const p = await getPage();
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const title = await p.title();
      return { success: true, url, title };
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to save the screenshot' },
      },
      required: ['path'],
    },
    handler: async (input) => {
      const { path } = input as { path: string };
      const p = await getPage();
      await p.screenshot({ path, fullPage: true });
      return { success: true, path };
    },
  },
  {
    name: 'browser_extract_text',
    description: 'Extract all visible text from the current page',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      const p = await getPage();
      const text = await p.evaluate(() => document.body.innerText);
      return { success: true, text: text.substring(0, 8000) };
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element on the page by CSS selector or text',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector or text to click' },
      },
      required: ['selector'],
    },
    handler: async (input) => {
      const { selector } = input as { selector: string };
      const p = await getPage();
      await p.click(selector, { timeout: 10000 });
      return { success: true, clicked: selector };
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input field',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input field' },
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['selector', 'text'],
    },
    handler: async (input) => {
      const { selector, text } = input as { selector: string; text: string };
      const p = await getPage();
      await p.fill(selector, text);
      return { success: true };
    },
  },
  {
    name: 'browser_extract_links',
    description: 'Extract all links from the current page',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      const p = await getPage();
      const links = await p.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]')).map((a) => ({
          text: (a as HTMLAnchorElement).innerText.trim(),
          href: (a as HTMLAnchorElement).href,
        }))
      );
      return { success: true, links: links.slice(0, 100) };
    },
  },
  {
    name: 'browser_close',
    description: 'Close the browser',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      if (browser) {
        await browser.close();
        browser = null;
        page = null;
      }
      return { success: true };
    },
  },
];

export function registerBrowserTools() {
  for (const tool of browserTools) {
    registry.register(tool);
  }
}
