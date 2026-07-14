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
  GetTextSchema,
  FindElementSchema,
  type BrowserToolName,
} from './browser-tools.js';
import type { Message, ToolCallMessage, ToolResultMessage, DoneMessage } from '../shared/messages.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const BROWSER_SYSTEM_PROMPT = `You are a browser automation assistant controlling the active Chrome tab.
The tab currently shows a small mock e-commerce site called OneStopShop. Operate ONLY on the current page. Do NOT navigate to any external site such as Amazon, Google, or any real store.

Use the provided browser_* tools to complete the user's request.

Rules:
- Start by taking a screenshot or reading the page to understand the current state.
- Valid CSS selectors use IDs (e.g. #search-input, #add-to-cart-p1), classes (e.g. .btn), or data attributes (e.g. [data-product-id='p1']). Do NOT use :contains(), :has(), XPath, or any non-standard pseudo-selectors.
- When you need to click or type, first use browser_find_element with a natural-language description to verify the element exists and obtain a valid CSS selector. Only click or type selectors that were returned by browser_find_element.
- Each product card has data-product-id='p1' (etc.). The Add to cart button for a product has id='add-to-cart-p1' (etc.).
- Use the search box (#search-input), category filter (#category-filter), and sort order (#sort-order) on the products page.
- To complete checkout, add the item, click the Cart link, click Proceed to checkout, fill the form fields (#full-name, #address, #card), and click Place order.
- Once the requested action is finished, respond briefly and stop.`;

export type SendToExtension = (toolCall: ToolCallMessage) => Promise<ToolResultMessage>;

export type SessionLike = Pick<AgentSession, 'subscribe' | 'sendUserMessage' | 'getLastAssistantText' | 'dispose'>;

export class AgentHost {
  private session?: SessionLike;
  private sendToExtension: SendToExtension;
  onMessage: (msg: Message) => void = () => {};

  private startMs = 0;
  private toolCount = 0;
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
      this.defineTool('browser_get_text', GetTextSchema, 'Get the visible text content of the page or an element.', 'Use this to read page content or extract specific text.'),
      this.defineTool('browser_find_element', FindElementSchema, 'Find interactive elements or verify a candidate selector.', 'Use this to locate buttons, links, inputs, or confirm a selector exists.'),
    ];
  }

  async createSession(tools: ToolDefinition[]): Promise<SessionLike> {
    const { session } = await createAgentSession({
      noTools: 'builtin',
      customTools: tools,
      thinkingLevel: 'off',
      resourceLoader: new DefaultResourceLoader({
        cwd: PROJECT_ROOT,
        agentDir: getAgentDir(),
        noExtensions: true,
        appendSystemPrompt: [BROWSER_SYSTEM_PROMPT],
      }),
    });
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

  private handleEvent(event: Record<string, unknown>) {
    switch (event.type) {
      case 'tool_execution_start': {
        const toolCallId = String(event.toolCallId);
        const toolName = String(event.toolName) as BrowserToolName;
        const callMsg: ToolCallMessage = { type: 'tool_call', id: toolCallId, name: toolName, args: (event.args as Record<string, unknown>) ?? {}, ui: true };
        this.pendingToolCalls.set(toolCallId, { name: toolName, startMs: Date.now() });
        this.onMessage(callMsg);
        break;
      }
      case 'tool_execution_end': {
        const toolCallId = String(event.toolCallId);
        const pending = this.pendingToolCalls.get(toolCallId);
        const elapsedMs = pending ? Date.now() - pending.startMs : 0;
        const resultMsg: ToolResultMessage = { type: 'tool_result', id: toolCallId, result: event.result, elapsedMs, ui: true };
        this.onMessage(resultMsg);
        this.pendingToolCalls.delete(toolCallId);
        break;
      }
      case 'agent_settled':
      case 'agent_end': {
        if (this.settled) break;
        this.settled = true;
        const summary = this.session?.getLastAssistantText() || 'Done.';
        const totalMs = Date.now() - this.startMs;
        const doneMsg: DoneMessage = { type: 'done', summary, toolCount: this.toolCount, totalMs };
        this.onMessage(doneMsg);
        break;
      }
    }
  }
}
