import type { ArdenTool } from './registry.js';
import { registry } from './registry.js';

export const deviceTools: ArdenTool[] = [
  {
    name: 'device_http',
    description: 'Send an HTTP request to a smart device or local API endpoint',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Device endpoint URL' },
        method: { type: 'string', description: 'HTTP method: GET, POST, PUT', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
        body: { type: 'string', description: 'JSON body for POST/PUT requests' },
        headers: { type: 'string', description: 'JSON headers object' },
      },
      required: ['url', 'method'],
    },
    handler: async (input) => {
      const { url, method, body, headers } = input as { url: string; method: string; body?: string; headers?: string };
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(headers ? JSON.parse(headers) : {}) },
        body: body ?? null,
        signal: AbortSignal.timeout(10000),
      });
      const text = await res.text();
      return { success: true, status: res.status, body: text.substring(0, 2000) };
    },
  },
  {
    name: 'device_homeassistant',
    description: 'Control a Home Assistant entity (lights, switches, etc.)',
    parameters: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'Entity ID e.g. light.living_room' },
        action: { type: 'string', description: 'Action: turn_on, turn_off, toggle', enum: ['turn_on', 'turn_off', 'toggle'] },
        brightness: { type: 'string', description: 'Brightness 0-255 (for lights)' },
      },
      required: ['entity_id', 'action'],
    },
    handler: async (input) => {
      const { entity_id, action, brightness } = input as { entity_id: string; action: string; brightness?: string };
      const haUrl = process.env.HOME_ASSISTANT_URL;
      const haToken = process.env.HOME_ASSISTANT_TOKEN;
      if (!haUrl || !haToken) return { success: false, error: 'HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN not set in .env' };
      const domain = entity_id.split('.')[0];
      const body: any = { entity_id };
      if (brightness) body.brightness = parseInt(brightness);
      const res = await fetch(`${haUrl}/api/services/${domain}/${action}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${haToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { success: res.ok, status: res.status };
    },
  },
];

export function registerDeviceTools() {
  for (const tool of deviceTools) {
    registry.register(tool);
  }
}
