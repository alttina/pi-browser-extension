import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PiSession } from '../host/pi.js';
import { decodeMessages } from '../host/protocol.js';

describe('PiSession', () => {
  it('encodes user text as a valid length-prefixed JSON frame', () => {
    const session = new PiSession('echo');
    let captured: Buffer = Buffer.alloc(0);
    session.onChildStdin = (buf: Buffer) => { captured = buf; };
    session.send('hello');

    assert.ok(captured.length >= 4, 'captured buffer must contain at least a 4-byte length header');
    const length = captured.readUInt32LE(0);
    assert.strictEqual(length, captured.length - 4, 'payload length must match header value');

    const json = captured.subarray(4).toString('utf8');
    assert.doesNotThrow(() => JSON.parse(json), 'payload must be valid JSON');
    const decoded = JSON.parse(json);
    assert.strictEqual(decoded.type, 'user');
    assert.strictEqual(decoded.text, 'hello');

    const { messages, remainder } = decodeMessages(captured);
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(remainder.length, 0);
    assert.deepStrictEqual(messages[0], { type: 'user', text: 'hello' });

    session.close();
  });

  it('decodes length-prefixed JSON frames from stdout', (t, done) => {
    const session = new PiSession('node', ['-e', `
      const header = Buffer.alloc(4);
      const body = Buffer.from(JSON.stringify({ type: 'tool_call', id: '1', name: 'test', args: {} }), 'utf8');
      header.writeUInt32LE(body.length, 0);
      process.stdout.write(Buffer.concat([header, body]));
    `]);

    session.onMessage = (msg) => {
      assert.deepStrictEqual(msg, { type: 'tool_call', id: '1', name: 'test', args: {} });
      session.close();
      done();
    };
  });
});
