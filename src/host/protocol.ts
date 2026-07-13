import type { Message } from '../shared/messages.js';

export function encodeMessage(msg: Message): Buffer {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  return Buffer.concat([header, buf]);
}

export function decodeMessages(buffer: Buffer): { messages: Message[]; remainder: Buffer } {
  const messages: Message[] = [];
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    if (offset + 4 + length > buffer.length) break;
    const json = buffer.subarray(offset + 4, offset + 4 + length).toString('utf8');
    messages.push(JSON.parse(json) as Message);
    offset += 4 + length;
  }

  return { messages, remainder: buffer.subarray(offset) };
}
