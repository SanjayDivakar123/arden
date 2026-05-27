import { registry } from './registry.js';
import { startWhatsAppNotify, startWhatsAppSendFile } from '../adapters/whatsapp/index.js';

function resolveRecipient(inputNumber: string | undefined, sessionId: string | undefined): string {
  const number = inputNumber?.trim();
  if (number) return number;
  if (sessionId?.startsWith('whatsapp:')) return sessionId.replace('whatsapp:', '');
  throw new Error('recipient_number is required outside a WhatsApp chat.');
}

export function registerWhatsAppTools() {
  registry.register({
    name: 'whatsapp_send_message',
    description: 'Send a text message through the connected WhatsApp session. If recipient_number is omitted inside a WhatsApp chat, send to the current chat.',
    parameters: {
      type: 'object',
      properties: {
        recipient_number: { type: 'string', description: 'Recipient phone number in international format. Optional when replying to the current WhatsApp chat.' },
        message: { type: 'string', description: 'Text message to send.' },
      },
      required: ['message'],
    },
    handler: async (input, sessionId) => {
      const { recipient_number, message } = input as { recipient_number?: string; message?: string };
      if (!message?.trim()) throw new Error('message is required.');
      const recipient = resolveRecipient(recipient_number, sessionId);
      await startWhatsAppNotify(recipient, message);
      return { success: true, recipient_number: recipient };
    },
  });

  registry.register({
    name: 'whatsapp_send_file',
    description: 'Send a local image file through the connected WhatsApp session. Use this for screenshots saved by tools such as browserbase_screenshot. If recipient_number is omitted inside a WhatsApp chat, send to the current chat.',
    parameters: {
      type: 'object',
      properties: {
        recipient_number: { type: 'string', description: 'Recipient phone number in international format. Optional when replying to the current WhatsApp chat.' },
        path: { type: 'string', description: 'Local file path to an image, such as a PNG screenshot.' },
        caption: { type: 'string', description: 'Optional caption.' },
      },
      required: ['path'],
    },
    handler: async (input, sessionId) => {
      const { recipient_number, path, caption } = input as { recipient_number?: string; path?: string; caption?: string };
      if (!path?.trim()) throw new Error('path is required.');
      const recipient = resolveRecipient(recipient_number, sessionId);
      await startWhatsAppSendFile(recipient, path, caption);
      return { success: true, recipient_number: recipient, path };
    },
  });
}
