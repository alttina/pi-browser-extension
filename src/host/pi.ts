import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { encodeMessage, decodeMessages } from './protocol.js';
import type { Message, UserMessage, ErrorMessage } from '../shared/messages.js';

export class PiSession {
  private child: ChildProcessWithoutNullStreams;
  private buffer: Buffer = Buffer.alloc(0);
  onMessage: (msg: Message) => void = () => {};
  onChildStdin: (buf: Buffer) => void = () => {};

  constructor(piCommand: string, args: string[] = []) {
    this.child = spawn(piCommand, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this.child.on('error', (err: Error) => {
      const msg: ErrorMessage = { type: 'error', message: err.message };
      this.onMessage(msg);
    });

    this.child.stdin.on('error', (err: Error) => {
      const msg: ErrorMessage = { type: 'error', message: `stdin error: ${err.message}` };
      this.onMessage(msg);
    });

    this.child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code !== 0 && code !== null) {
        const msg: ErrorMessage = {
          type: 'error',
          message: `child exited with code ${code}${signal ? ` (signal ${signal})` : ''}`,
        };
        this.onMessage(msg);
      }
    });

    this.child.stdout.on('data', (chunk: Buffer) => this.handleData(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => {
      console.error('[pi stderr]', chunk.toString('utf8'));
    });
  }

  send(text: string) {
    const msg: UserMessage = { type: 'user', text };
    const encoded = encodeMessage(msg);
    this.onChildStdin(encoded);
    if (!this.child.stdin.destroyed && this.child.stdin.writable) {
      this.child.stdin.write(encoded);
    }
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
    if (!this.child.killed) {
      this.child.kill();
    }
  }
}
