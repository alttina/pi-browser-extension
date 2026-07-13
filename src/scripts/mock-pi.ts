import { encodeMessage } from '../host/protocol.js';
import type { Message } from '../shared/messages.js';

process.stdin.on('data', (chunk: Buffer) => {
  let offset = 0;
  while (offset + 4 <= chunk.length) {
    const len = chunk.readUInt32LE(offset);
    if (offset + 4 + len > chunk.length) break;
    const json = chunk.subarray(offset + 4, offset + 4 + len).toString('utf8');
    const msg = JSON.parse(json) as Message;
    if (msg.type === 'user') {
      process.stdout.write(encodeMessage({ type: 'tool_call', id: '1', name: 'browser_scroll', args: { direction: 'bottom' } }));
      setTimeout(() => {
        process.stdout.write(encodeMessage({ type: 'tool_result', id: '1', result: { scrolled: true }, elapsedMs: 120 }));
        process.stdout.write(encodeMessage({ type: 'tool_call', id: '2', name: 'browser_click', args: { selector: 'button.load-more' } }));
        setTimeout(() => {
          process.stdout.write(encodeMessage({ type: 'tool_result', id: '2', result: { clicked: true }, elapsedMs: 45 }));
          process.stdout.write(encodeMessage({ type: 'done', summary: 'Clicked Load more.', toolCount: 2, totalMs: 165 }));
        }, 100);
      }, 100);
    }
    offset += 4 + len;
  }
});
