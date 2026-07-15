import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AgentHost, type SessionLike } from '../host/agent.js';
import type { Message, ToolCallMessage, ToolResultMessage } from '../shared/messages.js';

describe('AgentHost', () => {
  it('emits tool_call on tool_execution_start and tool_result on tool_execution_end', async () => {
    const received: Message[] = [];
    let capturedListener: ((event: unknown) => void) | undefined;

    const fakeSession: SessionLike = {
      subscribe: (listener) => {
        capturedListener = listener as (event: unknown) => void;
        return () => {};
      },
      sendUserMessage: async (_text: string) => {
        capturedListener?.({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'browser_click', args: { selector: 'button' } });
        capturedListener?.({ type: 'tool_execution_end', toolCallId: 'call-1', result: { clicked: true } });
        capturedListener?.({ type: 'agent_settled' });
      },
      getLastAssistantText: () => 'Clicked the button.',
      dispose: () => {},
      model: undefined,
    };

    const host = new AgentHost(async (toolCall: ToolCallMessage): Promise<ToolResultMessage> => {
      return { type: 'tool_result', id: toolCall.id, result: { clicked: true }, elapsedMs: 42 };
    });

    host.onMessage = (msg) => received.push(msg);
    host.bindSession(fakeSession);
    await host.sendUserMessage('Click the button');

    assert.strictEqual(received[0]?.type, 'tool_call');
    assert.strictEqual((received[0] as ToolCallMessage).name, 'browser_click');
    const toolResult = received.find((m) => m.type === 'tool_result');
    assert.ok(toolResult, 'expected a tool_result message');
    const done = received.find((m) => m.type === 'done') as { summary: string } | undefined;
    assert.ok(done, 'expected a done message');
    assert.strictEqual(done.summary, 'Clicked the button.');
  });
});
