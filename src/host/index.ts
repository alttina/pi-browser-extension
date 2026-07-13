import { PiSession } from './pi.js';

const session = new PiSession(process.env.PI_COMMAND || 'pi', ['agent']);
session.onMessage = (msg) => {
  const encoded = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(encoded.length, 0);
  process.stdout.write(Buffer.concat([header, encoded]));
};

let buffer: Buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) break;
    const json = buffer.subarray(4, 4 + length).toString('utf8');
    const msg = JSON.parse(json);
    if (msg.type === 'user') session.send(msg.text);
    buffer = buffer.subarray(4 + length);
  }
});

process.stdin.on('end', () => session.close());
