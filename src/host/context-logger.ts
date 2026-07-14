import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Message, ToolResultMessage } from '../shared/messages.js';

export interface LogEntry {
  ts: number;
  direction: 'in' | 'out';
  type: Message['type'];
  payload: Message;
}

function extractScreenshot(result: unknown): { dataUrl: string; base64: string } | null {
  if (!result || typeof result !== 'object') return null;
  const screenshot = (result as Record<string, unknown>).screenshot;
  if (typeof screenshot !== 'string' || !screenshot.startsWith('data:image/png;base64,')) {
    return null;
  }
  const base64 = screenshot.slice('data:image/png;base64,'.length);
  if (!base64) return null;
  return { dataUrl: screenshot, base64 };
}

export class ContextLogger {
  private logPath: string;
  private screenshotCount = 0;

  constructor(public readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.logPath = join(dir, 'context.jsonl');
  }

  log(direction: 'in' | 'out', msg: Message): void {
    try {
      const entry = this.buildEntry(direction, msg);
      writeFileSync(this.logPath, JSON.stringify(entry) + '\n', { flag: 'a' });
    } catch (err) {
      console.error('[context-logger] failed to log message:', err);
    }
  }

  private buildEntry(direction: 'in' | 'out', msg: Message): LogEntry {
    if (msg.type === 'tool_result') {
      const screenshot = extractScreenshot(msg.result);
      if (screenshot) {
        this.screenshotCount += 1;
        const filename = `screenshot-${this.screenshotCount}.png`;
        writeFileSync(join(this.dir, filename), Buffer.from(screenshot.base64, 'base64'));
        const trimmed: ToolResultMessage = {
          ...msg,
          result: {
            ...(msg.result as Record<string, unknown>),
            screenshot: `<${filename}>`,
          },
        };
        return { ts: Date.now(), direction, type: msg.type, payload: trimmed };
      }
    }
    return { ts: Date.now(), direction, type: msg.type, payload: msg };
  }
}
