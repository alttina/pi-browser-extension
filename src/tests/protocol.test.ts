import { describe, it } from 'node:test';
import assert from 'node:assert';
import { encodeMessage, decodeMessages } from '../host/protocol.js';

describe('protocol', () => {
  it('round-trips a single message', () => {
    const msg = { type: 'user' as const, text: 'ping' };
    const encoded = encodeMessage(msg);
    const { messages } = decodeMessages(encoded);
    assert.deepStrictEqual(messages[0], msg);
  });
});
