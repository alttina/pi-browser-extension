# Pi SDK Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `pi agent` CLI spawn in the native host with a direct Pi SDK (`@earendil-works/pi-coding-agent`) `AgentSession`, registering custom `browser_*` tools whose execution is forwarded to the Chrome extension.

**Architecture:** The native host embeds Pi SDK, creates an `AgentSession` with only our custom browser tools, and subscribes to agent events. Tool calls from Pi are sent to the extension as `ToolCallMessage`; results come back as `ToolResultMessage` and are returned to Pi as `AgentToolResult`. Side panel receives the same message stream it did before, plus a new `assistant` message type for Pi's spoken text.

**Tech Stack:** TypeScript, Node.js, Chrome Extension MV3, `@earendil-works/pi-coding-agent`, `typebox`.

## Global Constraints

- Local-only: no remote backend, no proxying LLM traffic.
- Pi SDK is loaded from the project's `node_modules` (dev dependency) so the native host can `import` it at runtime.
- Chrome Extension MV3.
- Side panel fixed width 380px.
- Red Line System unchanged.
- Native Host must remain a single executable path referenced by `com.pi.browser_agent` in the host manifest.
- All official Pi computer-use browser tools are exposed via custom `ToolDefinition`s; first pass wires the existing three plus the missing four basic DOM tools.
- Frequent commits; each task ends with a passing test or a manual verification step.

---

## File Structure

```
/Users/mvgz0236/alttina/Tars/
├── design-mockups/                    # existing UI references
├── docs/superpowers/specs/            # updated design spec
├── docs/superpowers/plans/            # this plan
├── package.json                       # add Pi SDK + typebox dev deps
├── tsconfig.json
├── src/
│   ├── scripts/
│   │   ├── copy-assets.ts
│   │   ├── install-host.ts
│   │   └── mock-pi.ts                 # no longer used; will be removed
│   ├── extension/
│   │   ├── manifest.json
│   │   ├── sidepanel.html
│   │   ├── sidepanel.css
│   │   ├── sidepanel.ts               # render new assistant text messages
│   │   ├── settings.html
│   │   ├── settings.css
│   │   ├── settings.ts
│   │   ├── onboarding.html
│   │   ├── onboarding.css
│   │   ├── onboarding.ts
│   │   ├── content.ts                 # add type/navigate/get_text/find_element
│   │   └── background.ts              # unchanged; already forwards all messages
│   ├── host/
│   │   ├── index.ts                   # wire AgentHost to native messaging
│   │   ├── protocol.ts                # unchanged
│   │   ├── browser-tools.ts           # TypeBox schemas for browser_* tools
│   │   ├── agent.ts                   # AgentHost: SDK session + event mapping
│   │   └── pi.ts                      # REMOVE (old CLI wrapper)
│   ├── shared/
│   │   └── messages.ts                # add AssistantMessage
│   └── tests/
│       ├── protocol.test.ts           # unchanged
│       ├── pi.test.ts                 # REMOVE
│       └── agent.test.ts              # new: AgentHost event mapping
└── dist/
    ├── extension/
    └── host/
```

---

### Task 1: Add Pi SDK and typebox dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (via npm install)

**Interfaces:**
- Produces: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, and `typebox` available in `node_modules`.

- [ ] **Step 1: Add dev dependencies**

Edit `package.json` `devDependencies` to:

```json
"devDependencies": {
  "@earendil-works/pi-coding-agent": "^0.80.6",
  "@earendil-works/pi-agent-core": "^0.80.6",
  "@earendil-works/pi-ai": "^0.80.6",
  "@types/chrome": "^0.2.2",
  "@types/node": "^26.1.1",
  "puppeteer-core": "^25.3.0",
  "typebox": "^1.1.38",
  "typescript": "^5.5.0"
}
```

- [ ] **Step 2: Install**

```bash
npm install
```

Expected: `node_modules/@earendil-works/pi-coding-agent` exists.

- [ ] **Step 3: Verify**

```bash
ls node_modules/@earendil-works/pi-coding-agent/dist/index.js
ls node_modules/typebox
```

Expected: both paths exist.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add Pi SDK and typebox dependencies"
```

---

### Task 2: Add assistant text message type and side panel rendering

**Files:**
- Modify: `src/shared/messages.ts`
- Modify: `src/extension/sidepanel.ts`

**Interfaces:**
- Produces: `AssistantMessage { type: 'assistant'; text: string }` added to the `Message` union.
- Consumes: existing `appendAgentText()` in `sidepanel.ts`.

- [ ] **Step 1: Update shared messages**

`src/shared/messages.ts` becomes:

```ts
export interface UserMessage {
  type: 'user';
  text: string;
}

export interface AssistantMessage {
  type: 'assistant';
  text: string;
}

export interface ToolCallMessage {
  type: 'tool_call';
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultMessage {
  type: 'tool_result';
  id: string;
  result: unknown;
  elapsedMs: number;
}

export interface DoneMessage {
  type: 'done';
  summary: string;
  toolCount: number;
  totalMs: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type Message =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | ToolResultMessage
  | DoneMessage
  | ErrorMessage;
```

- [ ] **Step 2: Render assistant messages in side panel**

In `src/extension/sidepanel.ts`, update the listener at the bottom:

```ts
chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === 'tool_call') appendToolCall(msg);
  else if (msg.type === 'tool_result') updateToolResult(msg);
  else if (msg.type === 'done') appendDone(msg);
  else if (msg.type === 'assistant') appendAgentText(msg.text);
  else if (msg.type === 'error') appendAgentText(`Error: ${msg.message}`);
});
```

`background.ts` already forwards every native message via `chrome.runtime.sendMessage(msg)`, so no change is needed there.

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/messages.ts src/extension/sidepanel.ts
git commit -m "feat: add assistant text message type"
```

---

### Task 3: Define browser tool schemas

**Files:**
- Create: `src/host/browser-tools.ts`

**Interfaces:**
- Produces: TypeBox schemas and a `BrowserToolName` union for all browser tools.

- [ ] **Step 1: Create schemas file**

`src/host/browser-tools.ts`:

```ts
import { Type, type Static, type TSchema } from 'typebox';

export const ScreenshotSchema = Type.Object(
  {
    fullPage: Type.Optional(Type.Boolean({ description: 'Capture the full page instead of the viewport.' })),
  },
  { description: 'Take a screenshot of the current browser tab.' }
);

export const ScrollSchema = Type.Object(
  {
    direction: Type.Optional(Type.String({ description: 'Direction to scroll: "top", "bottom", or omit if using selector.' })),
    selector: Type.Optional(Type.String({ description: 'CSS selector of the element to scroll into view.' })),
  },
  { description: 'Scroll the page or a specific element into view.' }
);

export const ClickSchema = Type.Object(
  {
    selector: Type.String({ description: 'CSS selector of the element to click.' }),
  },
  { description: 'Click an element on the page.' }
);

export const TypeSchema = Type.Object(
  {
    selector: Type.String({ description: 'CSS selector of the input element.' }),
    text: Type.String({ description: 'Text to type into the element.' }),
    submit: Type.Optional(Type.Boolean({ description: 'Whether to press Enter after typing.' })),
  },
  { description: 'Type text into an input or textarea.' }
);

export const NavigateSchema = Type.Object(
  {
    url: Type.String({ description: 'URL to navigate the current tab to.' }),
  },
  { description: 'Navigate the current tab to a URL.' }
);

export const GetTextSchema = Type.Object(
  {
    selector: Type.Optional(Type.String({ description: 'CSS selector to extract text from. If omitted, returns page body text.' })),
  },
  { description: 'Get the visible text content of the page or an element.' }
);

export const FindElementSchema = Type.Object(
  {
    description: Type.Optional(Type.String({ description: 'Natural language description of the element being looked for.' })),
    selector: Type.Optional(Type.String({ description: 'Candidate CSS selector to verify.' })),
  },
  { description: 'Find interactive elements on the page or verify a candidate selector.' }
);

export type BrowserToolName =
  | 'browser_screenshot'
  | 'browser_scroll'
  | 'browser_click'
  | 'browser_type'
  | 'browser_navigate'
  | 'browser_get_text'
  | 'browser_find_element';

export type ScreenshotArgs = Static<typeof ScreenshotSchema>;
export type ScrollArgs = Static<typeof ScrollSchema>;
export type ClickArgs = Static<typeof ClickSchema>;
export type TypeArgs = Static<typeof TypeSchema>;
export type NavigateArgs = Static<typeof NavigateSchema>;
export type GetTextArgs = Static<typeof GetTextSchema>;
export type FindElementArgs = Static<typeof FindElementSchema>;
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/host/browser-tools.ts
git commit -m "feat: define browser tool schemas"
```

---

### Task 4: Create AgentHost (SDK session wrapper)

**Files:**
- Create: `src/host/agent.ts`
- Create: `src/tests/agent.test.ts`

**Interfaces:**
- Produces: `class AgentHost` with `getCustomTools()`, `bindSession(session)`, `sendUserMessage(text)`, `dispose()`, and `onMessage(msg)` callback.
- Consumes: `ToolDefinition` from Pi SDK, `ToolCallMessage`/`ToolResultMessage` from extension, `Message` union for side panel.

- [ ] **Step 1: Implement AgentHost**

`src/host/agent.ts`:

```ts
import { createAgentSession, type AgentSession, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai/compat';
import { Type, type Static, type TSchema } from 'typebox';
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
import type { Message, ToolCallMessage, ToolResultMessage, DoneMessage } from '../shared/messages.js';

export type SendToExtension = (toolCall: ToolCallMessage) => Promise<ToolResultMessage>;

export type SessionLike = Pick<AgentSession, 'subscribe' | 'sendUserMessage' | 'getLastAssistantText' | 'dispose'>;

export class AgentHost {
  private session?: SessionLike;
  private sendToExtension: SendToExtension;
  onMessage: (msg: Message) => void = () => {};

  private startMs = 0;
  private toolCount = 0;
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
    const { session } = await createAgentSession({
      noTools: 'builtin',
      customTools: tools,
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
        const callMsg: ToolCallMessage = { type: 'tool_call', id: toolCallId, name: toolName, args: (event.args as Record<string, unknown>) ?? {} };
        this.pendingToolCalls.set(toolCallId, { name: toolName, startMs: Date.now() });
        this.onMessage(callMsg);
        break;
      }
      case 'tool_execution_end': {
        const toolCallId = String(event.toolCallId);
        const pending = this.pendingToolCalls.get(toolCallId);
        const elapsedMs = pending ? Date.now() - pending.startMs : 0;
        const resultMsg: ToolResultMessage = { type: 'tool_result', id: toolCallId, result: event.result, elapsedMs };
        this.onMessage(resultMsg);
        this.pendingToolCalls.delete(toolCallId);
        break;
      }
      case 'agent_settled':
      case 'agent_end': {
        const summary = this.session?.getLastAssistantText() || 'Done.';
        const totalMs = Date.now() - this.startMs;
        const doneMsg: DoneMessage = { type: 'done', summary, toolCount: this.toolCount, totalMs };
        this.onMessage(doneMsg);
        break;
      }
    }
  }
}
```

- [ ] **Step 2: Write unit test**

`src/tests/agent.test.ts`:

```ts
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
        // Simulate Pi deciding to call a tool and then finishing.
        capturedListener?.({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'browser_click', args: { selector: 'button' } });
        capturedListener?.({ type: 'tool_execution_end', toolCallId: 'call-1', result: { clicked: true } });
        capturedListener?.({ type: 'agent_settled' });
      },
      getLastAssistantText: () => 'Clicked the button.',
      dispose: () => {},
    };

    const host = new AgentHost(async (toolCall: ToolCallMessage): Promise<ToolResultMessage> => {
      return { type: 'tool_result', id: toolCall.id, result: { clicked: true }, elapsedMs: 42 };
    });

    host.onMessage = (msg) => received.push(msg);
    host.bindSession(fakeSession);
    await host.sendUserMessage('Click the button');

    assert.strictEqual(received[0]?.type, 'tool_call');
    assert.strictEqual((received[0] as ToolCallMessage).name, 'browser_click');
    assert.strictEqual(received[1]?.type, 'tool_result');
    assert.strictEqual(received[2]?.type, 'done');
    assert.strictEqual((received[2] as { summary: string }).summary, 'Clicked the button.');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm run build && npm test
```

Expected: FAIL because `AgentHost` does not exist yet.

- [ ] **Step 4: Run test to verify it passes**

After writing `agent.ts`, run:

```bash
npm run build && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/host/agent.ts src/tests/agent.test.ts
git commit -m "feat: AgentHost with Pi SDK session and event mapping"
```

---

### Task 5: Wire AgentHost into the native host entry point

**Files:**
- Modify: `src/host/index.ts`
- Delete: `src/host/pi.ts`
- Delete: `src/tests/pi.test.ts`

**Interfaces:**
- Consumes: `AgentHost.getCustomTools()`, `AgentHost.createSession()`, `AgentHost.bindSession()`.
- Produces: length-prefixed native messaging protocol unchanged; `user` messages now start an SDK turn, `tool_result` messages resolve pending tool promises.

- [ ] **Step 1: Rewrite native host entry**

`src/host/index.ts`:

```ts
import { AgentHost } from './agent.js';
import { encodeMessage, decodeMessages } from './protocol.js';
import type { Message, ToolCallMessage, ToolResultMessage } from '../shared/messages.js';

const TOOL_RESULT_TIMEOUT_MS = 60_000;

const pendingToolCalls = new Map<
  string,
  { resolve: (msg: ToolResultMessage) => void; reject: (err: Error) => void; timeout: NodeJS.Timeout }
>();

async function main() {
  const host = new AgentHost(async (toolCall: ToolCallMessage): Promise<ToolResultMessage> => {
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
    process.stdout.write(encodeMessage(msg));
  };

  const tools = host.getCustomTools();
  const session = await host.createSession(tools);
  host.bindSession(session);

  let buffer = Buffer.alloc(0);
  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { messages, remainder } = decodeMessages(buffer);
    buffer = remainder;
    for (const msg of messages) {
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
```

- [ ] **Step 2: Remove old CLI wrapper files**

```bash
rm src/host/pi.ts src/tests/pi.test.ts
```

- [ ] **Step 3: Build and run tests**

```bash
npm run build && npm test
```

Expected: no TypeScript errors; protocol and agent tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/host/index.ts
git rm src/host/pi.ts src/tests/pi.test.ts
git commit -m "feat: native host uses Pi SDK AgentSession"
```

---

### Task 6: Extend content script for all browser tools

**Files:**
- Modify: `src/extension/content.ts`

**Interfaces:**
- Consumes: `browser_type`, `browser_navigate`, `browser_get_text`, `browser_find_element` tool calls.
- Produces: tool results matching existing `ToolResult` shape.

- [ ] **Step 1: Add helpers and new handlers**

Append to `src/extension/content.ts` before the `handlers` map (or integrate into a single refactored file):

```ts
function getSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    .filter((c) => !c.startsWith('pi-'))
    .join('.');
  return classes ? `${tag}.${classes}` : tag;
}

async function typeTool(args: { selector: string; text: string; submit?: boolean }): Promise<ToolResult> {
  const start = performance.now();
  const el = document.querySelector(args.selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) throw new Error(`Element not found: ${args.selector}`);
  el.focus();
  el.value = args.text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  if (args.submit) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 100));
  return { result: { typed: true }, elapsedMs: Math.round(performance.now() - start) };
}

async function navigateTool(args: { url: string }): Promise<ToolResult> {
  const start = performance.now();
  window.location.href = args.url;
  return { result: { navigated: args.url }, elapsedMs: Math.round(performance.now() - start) };
}

async function getTextTool(args: { selector?: string }): Promise<ToolResult> {
  const start = performance.now();
  if (args.selector) {
    const el = document.querySelector(args.selector);
    return { result: { text: el?.textContent?.trim() ?? '' }, elapsedMs: Math.round(performance.now() - start) };
  }
  return { result: { text: document.body.innerText?.trim() ?? '' }, elapsedMs: Math.round(performance.now() - start) };
}

async function findElementTool(args: { description?: string; selector?: string }): Promise<ToolResult> {
  const start = performance.now();
  if (args.selector) {
    const el = document.querySelector(args.selector);
    return {
      result: { found: !!el, selector: args.selector, text: el?.textContent?.trim().slice(0, 200) },
      elapsedMs: Math.round(performance.now() - start),
    };
  }
  const candidates = Array.from(document.querySelectorAll('button, a, input, textarea, select'))
    .slice(0, 10)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      selector: getSelector(el),
      text: el.textContent?.trim().slice(0, 80) || (el as HTMLInputElement).value || '',
    }));
  return { result: { candidates }, elapsedMs: Math.round(performance.now() - start) };
}
```

- [ ] **Step 2: Update handlers map**

Replace the existing `handlers` map with:

```ts
const handlers: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
  browser_scroll: scrollTool,
  browser_click: clickTool,
  browser_screenshot: screenshotTool,
  browser_type: typeTool,
  browser_navigate: navigateTool,
  browser_get_text: getTextTool,
  browser_find_element: findElementTool,
};
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/extension/content.ts
git commit -m "feat: support all browser tools in content script"
```

---

### Task 7: Remove obsolete mock-pi script

**Files:**
- Delete: `src/scripts/mock-pi.ts`

**Interfaces:**
- The mock CLI is no longer used because the native host now embeds the SDK directly.

- [ ] **Step 1: Delete file**

```bash
rm src/scripts/mock-pi.ts
```

- [ ] **Step 2: Build to confirm nothing references it**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git rm src/scripts/mock-pi.ts
git commit -m "chore: remove obsolete mock Pi CLI script"
```

---

### Task 8: Manual smoke test with real Pi

**Files:**
- None (manual).

**Interfaces:**
- End-to-end: extension side panel → background native port → native host AgentSession → Pi SDK → tool call → extension content script → result → Pi → done message.

- [ ] **Step 1: Build and install host**

```bash
npm run build
npm run install:host -- <your-extension-id>
```

Expected: host manifest written to Chrome NativeMessagingHosts directory.

- [ ] **Step 2: Load extension in Chrome**

Open `chrome://extensions/`, enable developer mode, click "Load unpacked", select `dist/extension/`.

- [ ] **Step 3: Open side panel on a page**

Navigate to a simple test page (e.g., `design-mockups/browser-page.html` served at `http://localhost:8766/browser-page.html`).
Click the Pi extension icon to open the side panel.

- [ ] **Step 4: Send a natural language command**

Type: "Scroll to the bottom and click Load more."

Expected:
- A `browser_scroll` tool card appears as "working", then "done <N>ms".
- A `browser_click` tool card appears and completes.
- A `browser_screenshot` tool card may appear if Pi asks for it.
- A red-bordered completion card appears with a summary, tool count, and total time.

- [ ] **Step 5: Commit only if smoke passes**

If the smoke test passes:

```bash
git commit --allow-empty -m "test: manual smoke test with Pi SDK passed"
```

If it fails, diagnose and fix in a follow-up commit before proceeding.

---

### Task 9: Update automated tests if needed

**Files:**
- Modify: `src/e2e/extension.e2e.ts` if it references the old mock CLI.

**Interfaces:**
- The e2e test should still load the extension; the native host will now start a real Pi session, which requires API credentials. For CI, skip real-Pi tests and rely on the `agent.test.ts` unit test.

- [ ] **Step 1: Check e2e file for old mock references**

```bash
grep -n "mock-pi\|PiSession\|pi agent" src/e2e/extension.e2e.ts || true
```

- [ ] **Step 2: Remove or update stale references**

If any references remain, remove them or replace with a note that the host now embeds the SDK.

- [ ] **Step 3: Commit**

```bash
git add src/e2e/extension.e2e.ts
git commit -m "test: update e2e file for SDK-based host"
```

---

## Spec Coverage

| Spec Requirement | Implementing Task |
|---|---|
| Native host embeds Pi SDK instead of CLI spawn | Task 4, Task 5 |
| Custom `browser_*` tools registered via `AgentSession.customTools` | Task 3, Task 4 |
| Tool execution forwarded to extension and result returned to Pi | Task 4, Task 5 |
| Agent events mapped to existing side panel messages | Task 2, Task 4 |
| Pi can "speak" via `assistant` text messages | Task 2 |
| All browser tools exposed (screenshot, scroll, click, type, navigate, get_text, find_element) | Task 3, Task 6 |
| Completion report with summary/tool count/total time | Task 4 |

## Placeholder Scan

- No TBD/TODO/fill-in-details steps remain.
- Every code-changing step includes the actual code.
- Every test step includes expected output.
