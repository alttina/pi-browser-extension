import { AgentHost } from './agent.js';
import { encodeMessage, decodeMessages } from './protocol.js';
import { ContextLogger } from './context-logger.js';
import type { Message, ToolCallMessage, ToolResultMessage } from '../shared/messages.js';

const TOOL_RESULT_TIMEOUT_MS = 60_000;
const LOG_DIR = process.env.PI_BROWSER_AGENT_LOG_DIR;
const logger = LOG_DIR ? new ContextLogger(LOG_DIR) : null;

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
    process.stdout.write(encodeMessage(msg));
  };

  const tools = host.getCustomTools();
  const session = await host.createSession(tools);
  host.bindSession(session);

  const modelId = host.getModelId();
  if (modelId) {
    const configMsg: Message = { type: 'config', model: modelId };
    logger?.log('out', configMsg);
    process.stdout.write(encodeMessage(configMsg));
  }

  let buffer = Buffer.alloc(0) as Buffer;
  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]) as unknown as Buffer;
    const { messages, remainder } = decodeMessages(buffer);
    buffer = remainder as unknown as Buffer;
    for (const msg of messages) {
      logger?.log('in', msg);
      if (msg.type === 'user') {
        host.sendUserMessage(msg.text).catch((err: Error) => {
          process.stdout.write(encodeMessage({ type: 'error', message: err.message }));
        });
      } else if (msg.type === 'tool_result') {
        const pending = pendingToolCalls.get(msg.id);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingToolCalls.delete(msg.id);
          pending.resolve(msg);
        }
      }
    }
  });

  process.stdin.on('end', () => {
    host.dispose();
  });
}

main().catch((err: Error) => {
  process.stdout.write(encodeMessage({ type: 'error', message: err.message }));
  process.exit(1);
});
