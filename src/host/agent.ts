import { createAgentSession, DefaultResourceLoader, getAgentDir, type AgentSession, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai/compat';
import { Type, type Static, type TSchema } from 'typebox';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ScreenshotSchema,
  ScrollSchema,
  ClickSchema,
  TypeSchema,
  NavigateSchema,
  GetTextSchema,
  FindElementSchema,
  type BrowserToolName,
} from './browser-tools.js';
import type { Message, ToolCallMessage, ToolResultMessage, DoneMessage, StatusMessage, AgentStatus } from '../shared/messages.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const BROWSER_SYSTEM_PROMPT = `You are a browser automation assistant controlling the active Chrome tab.
Use the provided browser_* tools to complete the user's request.

Rules:
- Start by taking a screenshot or reading the page to understand the current state.
- Use browser_find_element to locate elements when you are unsure of the exact selector.
- Prefer robust CSS selectors such as IDs, data attributes, or stable class names.
- Do not navigate to external sites unless explicitly asked.
- Once the requested action is finished, respond briefly and stop.`;

export type SendToExtension = (toolCall: ToolCallMessage) => Promise<ToolResultMessage>;

export type SessionLike = Pick<AgentSession, 'subscribe' | 'sendUserMessage' | 'getLastAssistantText' | 'dispose'>;

export class AgentHost {
  private session?: SessionLike;
  private sendToExtension: SendToExtension;
  onMessage: (msg: Message) => void = () => {};

  private startMs = 0;
  private toolCount = 0;
  private totalTokens = 0;
  private currentStatus: AgentStatus = 'thinking';
  private settled = false;
  private pendingToolCalls = new Map<string, { name: BrowserToolName; startMs: number }>();

  constructor(sendToExtension: SendToExtension) {
    this.sendToExtension = sendToExtension;
  }

  getCustomTools(): ToolDefinition[] {
    return [
      this.defineTool('browser_screenshot', ScreenshotSchema, 'Take a screenshot of the current browser tab.', 'Use this to observe the page state after actions or before deciding.'),
      this.defineTool('browser_scroll', ScrollSchema, 'Scroll the page or a specific element into view.', 'Use this when content is below the fold or when targeting an element that is not visible.'),
      this.defineTool('browser_click', ClickSchema, 'Click an element on the page.', 'Use this to press buttons, follow links, or select options.'),
      this.defineTool('browser_type', TypeSchema, 'Type text into an input or textarea.', 'Use this to fill forms or search boxes.'),
      this.defineTool('browser_navigate', NavigateSchema, 'Navigate the current tab to a URL.', 'Use this to open a new page when the user asks.'),
      this.defineTool('browser_get_text', GetTextSchema, 'Get the visible text content of the page or an element.', 'Use this to read page content or extract specific text.'),
      this.defineTool('browser_find_element', FindElementSchema, 'Find interactive elements or verify a candidate selector.', 'Use this to locate buttons, links, inputs, or confirm a selector exists.'),
    ];
  }

  async createSession(tools: ToolDefinition[]): Promise<SessionLike> {
    const sessionOptions: Record<string, unknown> = {
      noTools: 'builtin',
      customTools: tools,
      resourceLoader: new DefaultResourceLoader({
        cwd: PROJECT_ROOT,
        agentDir: getAgentDir(),
        noExtensions: true,
        appendSystemPrompt: [BROWSER_SYSTEM_PROMPT],
      }),
    };
    const thinkingLevel = process.env.PI_THINKING_LEVEL;
    if (thinkingLevel) {
      sessionOptions.thinkingLevel = thinkingLevel;
    }
    const { session } = await createAgentSession(sessionOptions as any);
    return session;
  }

  bindSession(session: SessionLike) {
    this.session = session;
    session.subscribe((event) => this.handleEvent(event as unknown as Record<string, unknown>));
  }

  async sendUserMessage(text: string) {
    if (!this.session) throw new Error('Agent session not bound');
    this.startMs = Date.now();
    this.toolCount = 0;
    this.totalTokens = 0;
    this.currentStatus = 'thinking';
    this.settled = false;
    await this.session.sendUserMessage(text);
  }

  dispose() {
    this.session?.dispose();
    this.session = undefined;
  }

  private defineTool<T extends TSchema>(
    name: BrowserToolName,
    schema: T,
    description: string,
    promptSnippet: string
  ): ToolDefinition<T> {
    return {
      name,
      label: name,
      description,
      promptSnippet,
      parameters: schema,
      executionMode: 'sequential',
      execute: (toolCallId, params) => this.executeTool(toolCallId, name, params as Static<T>),
    } as ToolDefinition<T>;
  }

  private async executeTool(toolCallId: string, name: BrowserToolName, args: unknown): Promise<AgentToolResult<unknown>> {
    this.toolCount++;
    const callMsg: ToolCallMessage = { type: 'tool_call', id: toolCallId, name, args: args as Record<string, unknown> };
    const startMs = Date.now();
    const resultMsg = await this.sendToExtension(callMsg);
    const elapsedMs = resultMsg.elapsedMs ?? (Date.now() - startMs);
    const result = resultMsg.result as Record<string, unknown> | undefined;

    const content: (TextContent | ImageContent)[] = [];
    if (result && typeof result.screenshot === 'string') {
      const base64 = result.screenshot.replace(/^data:image\/[^;]+;base64,/, '');
      content.push({ type: 'image', data: base64, mimeType: 'image/png' });
    }
    const textResult = typeof result === 'object' && result !== null ? JSON.stringify(result) : String(result);
    content.push({ type: 'text', text: textResult });

    return { content, details: { ...(result ?? {}), elapsedMs } };
  }

  private emitStatus(state: AgentStatus) {
    if (state === this.currentStatus) return;
    this.currentStatus = state;
    const status: StatusMessage = {
      type: 'status',
      state,
      toolCount: this.toolCount,
      totalTokens: this.totalTokens || undefined,
    };
    this.onMessage(status);
  }

  private handleEvent(event: Record<string, unknown>) {
    switch (event.type) {
      case 'message_update': {
        const assistantEvent = event.assistantMessageEvent as Record<string, unknown> | undefined;
        const eventType = assistantEvent?.type;
        if (eventType === 'text_delta') {
          this.emitStatus('writing');
        } else if (eventType === 'thinking_delta') {
          this.emitStatus('thinking');
        } else if (eventType === 'toolcall_start') {
          this.emitStatus('working');
        }
        break;
      }
      case 'message_end': {
        const message = event.message as Record<string, unknown> | undefined;
        const usage = message?.usage as Record<string, unknown> | undefined;
        const totalTokens = typeof usage?.totalTokens === 'number' ? usage.totalTokens : 0;
        if (totalTokens > 0) {
          this.totalTokens = totalTokens;
        }
        break;
      }
      case 'tool_execution_start': {
        const toolCallId = String(event.toolCallId);
        const toolName = String(event.toolName) as BrowserToolName;
        const callMsg: ToolCallMessage = { type: 'tool_call', id: toolCallId, name: toolName, args: (event.args as Record<string, unknown>) ?? {}, ui: true };
        this.pendingToolCalls.set(toolCallId, { name: toolName, startMs: Date.now() });
        this.onMessage(callMsg);
        this.emitStatus(toolName === 'browser_screenshot' ? 'screenshotting' : 'working');
        break;
      }
      case 'tool_execution_end': {
        const toolCallId = String(event.toolCallId);
        const pending = this.pendingToolCalls.get(toolCallId);
        const elapsedMs = pending ? Date.now() - pending.startMs : 0;
        const resultMsg: ToolResultMessage = { type: 'tool_result', id: toolCallId, result: event.result, elapsedMs, ui: true };
        this.onMessage(resultMsg);
        this.pendingToolCalls.delete(toolCallId);
        this.emitStatus('thinking');
        break;
      }
      case 'agent_settled':
      case 'agent_end': {
        if (this.settled) break;
        this.settled = true;
        const summary = this.session?.getLastAssistantText() || 'Done.';
        const totalMs = Date.now() - this.startMs;
        const doneMsg: DoneMessage = { type: 'done', summary, toolCount: this.toolCount, totalMs, totalTokens: this.totalTokens || undefined };
        this.onMessage(doneMsg);
        break;
      }
    }
  }
}
