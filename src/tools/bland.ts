import fs from 'fs';
import type { ArdenTool } from './registry.js';
import { registry } from './registry.js';

const BLAND_API = 'https://api.bland.ai/v1';

function getKey(): string {
  const secretsPath = '/Users/sanjaydivakar/arden/.arden-secrets.json';
  let secrets: Record<string, string> = {};
  if (fs.existsSync(secretsPath)) {
    secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
  }
  const key = secrets.BLAND_API_KEY ?? process.env.BLAND_API_KEY ?? '';
  if (!key) throw new Error('BLAND_API_KEY not configured');
  return key;
}

function getFromNumber(): string {
  try {
    const s = JSON.parse(fs.readFileSync('/Users/sanjaydivakar/arden/.arden-secrets.json', 'utf8'));
    return s.BLAND_FROM_NUMBER ?? process.env.BLAND_FROM_NUMBER ?? '';
  } catch { return process.env.BLAND_FROM_NUMBER ?? ''; }
}

function getEncryptedKey(): string {
  try {
    const s = JSON.parse(fs.readFileSync('/Users/sanjaydivakar/arden/.arden-secrets.json', 'utf8'));
    return s.BLAND_ENCRYPTED_KEY ?? process.env.BLAND_ENCRYPTED_KEY ?? '';
  } catch { return process.env.BLAND_ENCRYPTED_KEY ?? ''; }
}

async function blandFetch(endpoint: string, method = 'GET', body?: object) {
  const res = await fetch(`${BLAND_API}${endpoint}`, {
    method,
    headers: {
      'authorization': getKey(),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : null,
  });
  return res.json();
}

export const blandTools: ArdenTool[] = [
  {
    name: 'bland_call',
    description: 'Make an outbound phone call via Bland.ai. The agent will speak to the recipient.',
    parameters: {
      type: 'object',
      properties: {
        phone_number: { type: 'string', description: 'Phone number to call e.g. +12125551234' },
        task: { type: 'string', description: 'What the AI should say and accomplish on the call' },
        voice: { type: 'string', description: 'Voice ID or name to use (optional)' },
        max_duration: { type: 'string', description: 'Max call duration in minutes (default 10)' },
        first_sentence: { type: 'string', description: 'First thing the AI says when call connects' },
        wait_for_greeting: { type: 'string', description: 'Set to "true" to wait for recipient to speak first' },
      },
      required: ['phone_number', 'task'],
    },
    handler: async (input) => {
      const { phone_number, task, voice, max_duration, first_sentence, wait_for_greeting } = input as Record<string, string>;
      const body: Record<string, unknown> = {
        phone_number,
        task,
        model: 'enhanced',
        max_duration: parseInt(max_duration ?? '10'),
        from: getFromNumber(),
        encrypted_key: getEncryptedKey(),
      };
      if (voice) body.voice = voice;
      if (first_sentence) body.first_sentence = first_sentence;
      if (wait_for_greeting) body.wait_for_greeting = wait_for_greeting === 'true';
      const data = await blandFetch('/calls', 'POST', body);
      return { success: true, call_id: data.call_id, status: data.status, data };
    },
  },
  {
    name: 'bland_call_status',
    description: 'Get the status and transcript of a Bland.ai call',
    parameters: {
      type: 'object',
      properties: {
        call_id: { type: 'string', description: 'The call ID returned from bland_call' },
      },
      required: ['call_id'],
    },
    handler: async (input) => {
      const { call_id } = input as { call_id: string };
      const data = await blandFetch(`/calls/${call_id}`);
      return {
        success: true,
        status: data.status,
        duration: data.call_length,
        transcript: data.transcripts,
        summary: data.summary,
        recording: data.recording_url,
      };
    },
  },
  {
    name: 'bland_list_calls',
    description: 'List recent Bland.ai calls',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: 'Number of calls to return (default 10)' },
      },
      required: [],
    },
    handler: async (input) => {
      const { limit } = input as { limit?: string };
      const data = await blandFetch(`/calls?limit=${limit ?? '10'}`);
      const calls = (data.calls ?? []).map((c: any) => ({
        call_id: c.call_id,
        phone_number: c.to,
        status: c.status,
        duration: c.call_length,
        created_at: c.created_at,
        summary: c.summary,
      }));
      return { success: true, calls };
    },
  },
  {
    name: 'bland_stop_call',
    description: 'Stop an active Bland.ai call',
    parameters: {
      type: 'object',
      properties: {
        call_id: { type: 'string', description: 'The call ID to stop' },
      },
      required: ['call_id'],
    },
    handler: async (input) => {
      const { call_id } = input as { call_id: string };
      const data = await blandFetch(`/calls/${call_id}/stop`, 'POST');
      return { success: true, data };
    },
  },
  {
    name: 'bland_create_pathway',
    description: 'Create a Bland.ai conversational pathway for structured calls',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Pathway name' },
        description: { type: 'string', description: 'What this pathway does' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      const { name, description } = input as { name: string; description?: string };
      const data = await blandFetch('/pathways', 'POST', { name, description });
      return { success: true, pathway_id: data.pathway_id, data };
    },
  },
  {
    name: 'bland_call_with_pathway',
    description: 'Make a call using a pre-built Bland.ai pathway',
    parameters: {
      type: 'object',
      properties: {
        phone_number: { type: 'string', description: 'Phone number to call' },
        pathway_id: { type: 'string', description: 'Pathway ID to use' },
        first_sentence: { type: 'string', description: 'Opening line when call connects' },
      },
      required: ['phone_number', 'pathway_id'],
    },
    handler: async (input) => {
      const { phone_number, pathway_id, first_sentence } = input as Record<string, string>;
      const body: Record<string, unknown> = { phone_number, pathway_id };
      if (first_sentence) body.first_sentence = first_sentence;
      const data = await blandFetch('/calls', 'POST', body);
      return { success: true, call_id: data.call_id, status: data.status };
    },
  },
];

export function registerBlandTools() {
  for (const tool of blandTools) {
    registry.register(tool);
  }
}
