import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { encodeMessage, decodeMessages } from './protocol.js';
import type { Message, UserMessage } from '../shared/messages.js';

export class PiSession {
  private child: ChildProcessWithoutNullStreams;
  private buffer: Buffer = Buffer.alloc(0);
  onMessage: (msg: Message) => void = () => {};
  onChildStdin: (buf: Buffer) => void = () => {};

  constructor(piCommand: string, args: string[] = []) {
    this.child = spawn(piCommand, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (chunk: Buffer) => this.handleData(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => {
      console.error('[pi stderr]', chunk.toString('utf8'));
    });
  }

  send(text: string) {
    const msg: UserMessage = { type: 'user', text };
    const encoded = encodeMessage(msg);
    this.onChildStdin(encoded);
    this.child.stdin.write(encoded);
  }

  private handleData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const { messages, remainder } = decodeMessages(this.buffer);
    this.buffer = remainder;
    for (const msg of messages) {
      this.onMessage(msg);
    }
  }

  close() {
    this.child.kill();
  }
}
