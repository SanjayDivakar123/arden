import type { ArdenTool } from './registry.js';
import { registry } from './registry.js';

export const financeTools: ArdenTool[] = [
  {
    name: 'finance_price',
    description: 'Get current price of a stock, crypto, or asset',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol e.g. AAPL, BTC-USD' },
      },
      required: ['symbol'],
    },
    handler: async (input) => {
      const { symbol } = input as { symbol: string };
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
      const res = await fetch(url);
      const data: any = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      const currency = data?.chart?.result?.[0]?.meta?.currency;
      return { success: true, symbol, price, currency };
    },
  },
  {
    name: 'finance_portfolio',
    description: 'Get prices for multiple symbols at once',
    parameters: {
      type: 'object',
      properties: {
        symbols: { type: 'string', description: 'Comma-separated symbols e.g. AAPL,TSLA,BTC-USD' },
      },
      required: ['symbols'],
    },
    handler: async (input) => {
      const { symbols } = input as { symbols: string };
      const list = symbols.split(',').map(s => s.trim());
      const results = await Promise.all(
        list.map(async (symbol) => {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
          const res = await fetch(url);
          const data: any = await res.json();
          const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
          return { symbol, price };
        })
      );
      return { success: true, portfolio: results };
    },
  },
  {
    name: 'finance_news',
    description: 'Get latest financial news for a symbol',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol' },
      },
      required: ['symbol'],
    },
    handler: async (input) => {
      const { symbol } = input as { symbol: string };
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&newsCount=5`;
      const res = await fetch(url);
      const data: any = await res.json();
      const news = (data?.news ?? []).map((n: any) => ({ title: n.title, link: n.link, publisher: n.publisher }));
      return { success: true, symbol, news };
    },
  },
];

export function registerFinanceTools() {
  for (const tool of financeTools) {
    registry.register(tool);
  }
}
