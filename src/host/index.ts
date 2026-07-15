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

  const modelInfo = host.getModelInfo();
  function sendConfig() {
    if (modelInfo.id) {
      const configMsg: Message = { type: 'config', provider: modelInfo.provider, model: modelInfo.id };
      logger?.log('out', configMsg);
      process.stdout.write(encodeMessage(configMsg));
    }
  }
  sendConfig();

  let buffer = Buffer.alloc(0) as Buffer;
  process.stdin.on('data', (chunk: Buffer) => {
    try {
      buffer = Buffer.concat([buffer, chunk]) as unknown as Buffer;
      const { messages, remainder } = decodeMessages(buffer);
      buffer = remainder as unknown as Buffer;
      for (const msg of messages) {
        logger?.log('in', msg);
        if (msg.type === 'user') {
          host.sendUserMessage(msg.text).catch((err: Error) => {
            console.error('[host] sendUserMessage failed:', err);
            sendError(err.message);
          });
        } else if (msg.type === 'tool_result') {
          const pending = pendingToolCalls.get(msg.id);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingToolCalls.delete(msg.id);
            pending.resolve(msg);
          }
        } else if (msg.type === 'get_config') {
          sendConfig();
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
  });
  process.stdin.on('close', () => {
    console.error('[host] stdin closed');
    host.dispose();
  });
}

main().catch((err: Error) => {
  console.error('[host] main failed:', err);
  sendError(err.message);
  process.exit(1);
});
