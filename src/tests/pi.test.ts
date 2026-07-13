import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PiSession } from '../host/pi.js';

describe('PiSession', () => {
  it('queues user text and emits encoded message', () => {
    const session = new PiSession('echo');
    let sent = '';
    session.onChildStdin = (buf: Buffer) => { sent = buf.toString(); };
    session.send('hello');
    assert.ok(sent.includes('hello'));
  });
});
