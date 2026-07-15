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

const BROWSER_SYSTEM_PROMPT = `You are Pi Browser Agent, running inside the user's Chrome browser. You drive the currently active tab through the browser_* tools you have been given.

You are NOT a coding assistant. You do not read files, execute shell commands, or edit code. Your only job is to interact with the web page the user is currently viewing.

Available browser tools:
- browser_screenshot: capture the current tab
- browser_get_text: read text content of the page or an element
- browser_find_element: locate interactive elements or verify a candidate CSS selector
- browser_scroll: scroll the page or an element into view
- browser_click: click an element by CSS selector
- browser_type: type text into an input by CSS selector
- browser_navigate: change the URL of the current tab (only if the user explicitly asks)

Critical context about your environment:
- The user is looking at a specific web page RIGHT NOW in their active Chrome tab.
- Every task the user gives you refers to THAT page, on THAT tab. When the user says "add headphones to my cart", "log in", "create a task", or "open the post about X", they mean on the site currently shown in their tab, not a hypothetical or well-known website.
- You cannot see the page until you call a tool. You have no prior knowledge of what is on it.
- The tab may be a public site, a local test fixture, an internal app, or something you have never seen before. Do not assume anything based on the task wording.

Hard rules:
1. On every new user request, your FIRST action must be browser_screenshot (or browser_get_text if a purely-textual view is enough). Do this before saying anything and before reasoning about what site is involved. There is no exception.
2. Never ask the user clarifying questions like "which website?", "which store?", "which app?", "which board?", "which platform?", or "please provide the URL". The answer is always "the currently open tab". Look at it instead of asking.
3. Never use browser_navigate to open external sites (Amazon, Google, GitHub, etc.) to satisfy a task. Only navigate if the user explicitly gave a URL or asked to change page within the same site.
4. Prefer stable selectors in this order: #id > [data-*] > semantic tag+text > class chain. Use browser_find_element to explore when unsure.
5. After each action that changes page state, verify with another screenshot or browser_get_text before deciding the next step.
6. Once the intent is fully satisfied, respond in one or two sentences summarizing what you did, and stop calling tools.

Reasoning style: think briefly, act, verify. Do not narrate long plans before you have looked at the page.`;

export type SendToExtension = (toolCall: ToolCallMessage) => Promise<ToolResultMessage>;

export type SessionLike = Pick<AgentSession, 'subscribe' | 'sendUserMessage' | 'getLastAssistantText' | 'dispose' | 'model'>;

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
    const loader = new DefaultResourceLoader({
      cwd: PROJECT_ROOT,
      agentDir: getAgentDir(),
      noExtensions: true,
      noSkills: true,
      noContextFiles: true,
      systemPrompt: BROWSER_SYSTEM_PROMPT,
    });
    // Pi's createAgentSession only calls reload() when it constructs the loader
    // itself. When we pass our own loader, we must reload it first so that
    // systemPrompt resolves from systemPromptSource; otherwise Pi falls back to
    // its default coding-agent prompt.
    await loader.reload();
    const sessionOptions: Record<string, unknown> = {
      noTools: 'builtin',
      customTools: tools,
      resourceLoader: loader,
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

  getModelInfo(): { provider?: string; id?: string; name?: string } {
    const model = this.session?.model;
    return { provider: model?.provider, id: model?.id, name: model?.name };
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
      const match = result.screenshot.match(/^data:image\/([^;]+);base64,/);
      const base64 = match ? result.screenshot.slice(match[0].length) : result.screenshot;
      const mimeType = match ? `image/${match[1]}` : 'image/png';
      content.push({ type: 'image', data: base64, mimeType });
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

  private stripLargeScreenshot(result: unknown): unknown {
    if (!result || typeof result !== 'object') return result;
    const record = result as Record<string, unknown>;
    const screenshot = record.screenshot;
    if (typeof screenshot === 'string' && screenshot.length > 1000) {
      return { ...record, screenshot: `<screenshot:${screenshot.slice(0, 30)}...(${screenshot.length} chars)>` };
    }
    return result;
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
        // UI messages echo back to the extension; strip large screenshot payloads
        // so they do not exceed Chrome's 1 MB native messaging limit.
        const uiResult = this.stripLargeScreenshot(event.result);
        const resultMsg: ToolResultMessage = { type: 'tool_result', id: toolCallId, result: uiResult, elapsedMs, ui: true };
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
