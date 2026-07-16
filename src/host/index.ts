import { AgentHost } from './agent.js';
import { encodeMessage, decodeMessages } from './protocol.js';
import { ContextLogger } from './context-logger.js';
import type { Message, ToolCallMessage, ToolResultMessage } from '../shared/messages.js';

const TOOL_RESULT_TIMEOUT_MS = 60_000;
const LOG_DIR = process.env.PI_BROWSER_AGENT_LOG_DIR;
const logger = LOG_DIR ? new ContextLogger(LOG_DIR) : null;

function sendError(message: string) {
  const errorMsg: Message = { type: 'error', message };
  try {
    process.stdout.write(encodeMessage(errorMsg));
  } catch (err) {
    console.error('[host] failed to send error message:', err);
  }
}

process.on('uncaughtException', (err: Error) => {
  console.error('[host] uncaughtException:', err);
  sendError(`Host crashed: ${err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error('[host] unhandledRejection:', reason);
  sendError(`Host error: ${message}`);
});

// Chrome may close the native-messaging pipe at any moment (extension reloads,
// service worker cycling out). Swallow the resulting EPIPE on stdout so we
// don't crash — the stdin 'end'/'close' handlers already exit cleanly.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') {
    process.exit(0);
  }
  console.error('[host] stdout error:', err);
});

const pendingToolCalls = new Map<
  string,
  { resolve: (msg: ToolResultMessage) => void; reject: (err: Error) => void; timeout: NodeJS.Timeout }
>();

async function main() {
  const host = new AgentHost(async (toolCall: ToolCallMessage): Promise<ToolResultMessage> => {
    logger?.log('out', toolCall);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingToolCalls.delete(toolCall.id);
        reject(new Error(`Timeout waiting for tool result: ${toolCall.name}`));
      }, TOOL_RESULT_TIMEOUT_MS);
      pendingToolCalls.set(toolCall.id, { resolve, reject, timeout });
      process.stdout.write(encodeMessage(toolCall));
    });
  });

  host.onMessage = (msg: Message) => {
    logger?.log('out', msg);
    try {
      process.stdout.write(encodeMessage(msg));
    } catch (err) {
      console.error('[host] failed to send message:', err);
    }
  };

  const tools = host.getCustomTools();
  const session = await host.createSession(tools);
  host.bindSession(session);

  function sendConfig() {
    const modelInfo = host.getModelInfo();
    if (modelInfo.id) {
      const configMsg: Message = { type: 'config', provider: modelInfo.provider, model: modelInfo.id };
      logger?.log('out', configMsg);
      process.stdout.write(encodeMessage(configMsg));
    }
  }
  sendConfig();

  let buffer = Buffer.alloc(0) as Buffer;
  // Serialize message handling so new_session's async resetSession() completes
  // before subsequent user/tool_result messages are processed. All handlers
  // run through this queue, but fire-and-forget ones resolve immediately.
  let handlerQueue: Promise<void> = Promise.resolve();

  function enqueue(fn: () => Promise<void> | void): void {
    handlerQueue = handlerQueue.then(() => fn()).catch((err) => {
      console.error('[host] queued handler failed:', err);
    });
  }

  process.stdin.on('data', (chunk: Buffer) => {
    try {
      buffer = Buffer.concat([buffer, chunk]) as unknown as Buffer;
      const { messages, remainder } = decodeMessages(buffer);
      buffer = remainder as unknown as Buffer;
      for (const msg of messages) {
        logger?.log('in', msg);
        if (msg.type === 'user') {
          enqueue(() => {
            host.sendUserMessage(msg.text).catch((err: Error) => {
              console.error('[host] sendUserMessage failed:', err);
              sendError(err.message);
            });
          });
        } else if (msg.type === 'tool_result') {
          enqueue(() => {
            const pending = pendingToolCalls.get(msg.id);
            if (pending) {
              clearTimeout(pending.timeout);
              pendingToolCalls.delete(msg.id);
              pending.resolve(msg);
            }
          });
        } else if (msg.type === 'new_session') {
          enqueue(async () => {
            // Reject any in-flight tool promises from the outgoing session so
            // the awaiter unwinds cleanly instead of hanging until timeout.
            for (const [id, pending] of pendingToolCalls) {
              clearTimeout(pending.timeout);
              pending.reject(new Error('Session reset before tool result arrived'));
              pendingToolCalls.delete(id);
            }
            try {
              await host.resetSession();
              sendConfig();
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error('[host] resetSession failed:', err);
              sendError(`Failed to reset session: ${message}`);
            }
          });
        } else if (msg.type === 'get_config') {
          enqueue(() => sendConfig());
        }
      }
    } catch (err) {
      console.error('[host] error processing stdin data:', err);
      sendError(err instanceof Error ? err.message : String(err));
    }
  });

  process.stdin.on('end', () => {
    console.error('[host] stdin ended');
    host.dispose();
    // Chrome has closed the pipe; any further stdout write triggers EPIPE.
    // Exit cleanly so we don't crash and pollute host-stderr.log.
    process.exit(0);
  });
  process.stdin.on('close', () => {
    console.error('[host] stdin closed');
    host.dispose();
    process.exit(0);
  });
}

main().catch((err: Error) => {
  console.error('[host] main failed:', err);
  sendError(err.message);
  process.exit(1);
});
