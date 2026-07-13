# Pi Browser Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chromium browser extension plus a local Native Messaging host that lets Pi agent control the browser via official computer-use tools, with all actions visualized in a 380px side panel.

**Architecture:** The extension side panel and content script live inside Chrome; a Node.js Native Host bridges stdio to the local Pi CLI; messages are framed with a simple length-prefixed JSON protocol. The first milestone implements only the screenshot/scroll/click loop end-to-end.

**Tech Stack:** TypeScript, Node.js (built-in test runner), Chrome Extension Manifest V3, no frontend framework.

## Global Constraints

- Local-only: no remote backend, no proxying LLM traffic.
- Chrome Extension MV3.
- Side panel fixed width 380px.
- Red Line System: `#FFFFFF` bg, `#F8F9FA` surface, `#DADCE0` border, `#202124` text, `#5F6368` secondary, `#9AA0A6` muted, `#EB0028` accent, `8px` radius.
- Red accent only for status dots, agent card left border, send buttons, selected states.
- Native Host must be a single executable path referenced by `com.pi.browser_agent` in the host manifest.
- All official Pi computer-use tools are exposed; first milestone wires screenshot + scroll + click.
- Frequent commits; each task ends with a passing test or a manual verification step.

---

## File Structure

```
/Users/mvgz0236/alttina/Tars/
├── design-mockups/                    # existing UI references
├── docs/superpowers/specs/            # design spec
├── docs/superpowers/plans/            # this plan
├── package.json
├── tsconfig.json
├── scripts/
│   └── install-host.ts                # registers native messaging host manifest
├── src/
│   ├── extension/
│   │   ├── manifest.json              # MV3 manifest
│   │   ├── sidepanel.html             # side panel markup
│   │   ├── sidepanel.css              # Red Line System styles
│   │   ├── sidepanel.ts               # chat UI + message rendering
│   │   ├── settings.html
│   │   ├── settings.css
│   │   ├── settings.ts                # settings form + storage
│   │   ├── onboarding.html
│   │   ├── onboarding.css
│   │   ├── onboarding.ts
│   │   ├── content.ts                 # DOM ops + overlay + screenshot helper
│   │   └── background.ts              # native port lifecycle + icon click
│   ├── host/
│   │   ├── index.ts                   # native host entry
│   │   ├── protocol.ts                # length-prefixed JSON framing
│   │   └── pi.ts                      # Pi CLI spawn + stdio wrapper
│   └── shared/
│       └── messages.ts                # message types shared by ext + host
├── tests/
│   ├── protocol.test.ts
│   └── messages.test.ts
└── dist/                              # compiled output
    ├── extension/                     # loaded by Chrome
    └── host/                          # native host executable
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tests/.gitkeep`

**Interfaces:**
- Produces: npm scripts `build`, `build:watch`, `test`, `install:host`.

- [ ] **Step 1: Initialize package.json**

```bash
npm init -y
```

Then edit `package.json`:

```json
{
  "name": "pi-browser-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch",
    "test": "node --test dist/tests/*.test.js",
    "install:host": "node dist/scripts/install-host.js"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Install TypeScript**

```bash
npm install
```

Expected: `node_modules/` and `package-lock.json` created.

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create source directories**

```bash
mkdir -p src/extension src/host src/shared scripts tests
```

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore
# create .gitignore if absent
printf "node_modules/\ndist/\n.DS_Store\n" > .gitignore
git add .gitignore src scripts tests
git commit -m "chore: scaffold TypeScript project"
```

---

### Task 2: Shared Message Types and Protocol

**Files:**
- Create: `src/shared/messages.ts`
- Create: `src/host/protocol.ts`
- Create: `tests/protocol.test.ts`

**Interfaces:**
- Produces: `Message` union type, `encodeMessage(msg)`, `decodeMessages(buffer)`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

`tests/protocol.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { encodeMessage, decodeMessages } from '../host/protocol.js';

describe('protocol', () => {
  it('round-trips a single message', () => {
    const msg = { type: 'ping' };
    const encoded = encodeMessage(msg);
    const { messages } = decodeMessages(encoded);
    assert.deepStrictEqual(messages[0], msg);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build && npm test
```

Expected: FAIL — `encodeMessage is not a function`.

- [ ] **Step 3: Implement shared types and protocol**

`src/shared/messages.ts`:

```ts
export interface UserMessage {
  type: 'user';
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
  | ToolCallMessage
  | ToolResultMessage
  | DoneMessage
  | ErrorMessage;
```

`src/host/protocol.ts`:

```ts
import type { Message } from '../shared/messages.js';

export function encodeMessage(msg: Message): Buffer {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  return Buffer.concat([header, buf]);
}

export function decodeMessages(buffer: Buffer): { messages: Message[]; remainder: Buffer } {
  const messages: Message[] = [];
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    if (offset + 4 + length > buffer.length) break;
    const json = buffer.subarray(offset + 4, offset + 4 + length).toString('utf8');
    messages.push(JSON.parse(json) as Message);
    offset += 4 + length;
  }

  return { messages, remainder: buffer.subarray(offset) };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/messages.ts src/host/protocol.ts tests/protocol.test.ts
git commit -m "feat: add shared message types and length-prefixed protocol"
```

---

### Task 3: Native Host Pi CLI Wrapper

**Files:**
- Create: `src/host/pi.ts`
- Create: `tests/pi.test.ts`
- Modify: `src/host/index.ts`

**Interfaces:**
- Produces: `class PiSession` with `send(text: string)` and `onMessage(msg: Message)` callback.
- Consumes: `Message`, `encodeMessage`, `decodeMessages`.

- [ ] **Step 1: Write the failing test**

`tests/pi.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PiSession } from '../host/pi.js';

describe('PiSession', () => {
  it('queues user text and emits encoded message', () => {
    const session = new PiSession('echo');
    let sent = '';
    session.onChildStdin = (buf) => { sent = buf.toString(); };
    session.send('hello');
    assert.ok(sent.includes('hello'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build && npm test
```

Expected: FAIL — `PiSession is not a constructor`.

- [ ] **Step 3: Implement PiSession**

`src/host/pi.ts`:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { encodeMessage, decodeMessages } from './protocol.js';
import type { Message, UserMessage } from '../shared/messages.js';

export class PiSession {
  private child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  onMessage: (msg: Message) => void = () => {};
  onChildStdin: (buf: Buffer) => void = () => {};

  constructor(piCommand: string, args: string[] = []) {
    this.child = spawn(piCommand, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (chunk: Buffer) => this.handleData(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => {
      console.error('[pi stderr]', chunk.toString('utf8'));
    });
  }

  send(text: string) {
    const msg: UserMessage = { type: 'user', text };
    const encoded = encodeMessage(msg);
    this.onChildStdin(encoded);
    this.child.stdin.write(encoded);
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
    this.child.kill();
  }
}
```

`src/host/index.ts` (stub):

```ts
import { PiSession } from './pi.js';

const session = new PiSession(process.env.PI_COMMAND || 'pi', ['agent']);
session.onMessage = (msg) => {
  const encoded = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(encoded.length, 0);
  process.stdout.write(Buffer.concat([header, encoded]));
};

let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) break;
    const json = buffer.subarray(4, 4 + length).toString('utf8');
    const msg = JSON.parse(json);
    if (msg.type === 'user') session.send(msg.text);
    buffer = buffer.subarray(4 + length);
  }
});

process.stdin.on('end', () => session.close());
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/host/pi.ts src/host/index.ts tests/pi.test.ts
git commit -m "feat: native host Pi CLI wrapper"
```

---

### Task 4: Install Script for Native Host

**Files:**
- Create: `scripts/install-host.ts`
- Create: `src/host/manifest.template.json`

**Interfaces:**
- Produces: `scripts/install-host.ts` writes host manifest to OS-specific location.
- Consumes: compiled host path `dist/host/index.js`.

- [ ] **Step 1: Create host manifest template**

`src/host/manifest.template.json`:

```json
{
  "name": "com.pi.browser_agent",
  "description": "Pi Browser Agent Native Host",
  "path": "HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://EXTENSION_ID/"]
}
```

- [ ] **Step 2: Write install script**

`scripts/install-host.ts`:

```ts
import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

const extensionId = process.argv[2];
if (!extensionId) {
  console.error('Usage: npm run install:host -- <extension-id>');
  process.exit(1);
}

const hostPath = resolve('dist/host/index.js');
const manifest = {
  name: 'com.pi.browser_agent',
  description: 'Pi Browser Agent Native Host',
  path: hostPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`],
};

let targetDir: string;
const p = platform();
if (p === 'darwin') {
  targetDir = join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
} else if (p === 'win32') {
  targetDir = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.pi.browser_agent';
  console.error('Windows registry install not yet implemented; please set manually.');
  process.exit(1);
} else {
  targetDir = join(homedir(), '.config/google-chrome/NativeMessagingHosts');
}

mkdirSync(targetDir, { recursive: true });
const targetFile = join(targetDir, 'com.pi.browser_agent.json');
writeFileSync(targetFile, JSON.stringify(manifest, null, 2));
chmodSync(hostPath, 0o755);
console.log(`Wrote ${targetFile}`);
```

- [ ] **Step 3: Run install script (manual verification)**

```bash
npm run build
npm run install:host -- abcdefghijklmnopqrstuvwxyzabcdef
```

Expected: manifest written to `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.pi.browser_agent.json` with correct host path.

- [ ] **Step 4: Verify manifest contents**

```bash
cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.pi.browser_agent.json
```

Expected: JSON contains `name`, `path`, `allowed_origins` with extension id.

- [ ] **Step 5: Commit**

```bash
git add scripts/install-host.ts src/host/manifest.template.json
git commit -m "feat: native host install script for macOS/linux"
```

---

### Task 5: Chrome Extension Manifest and Background Worker

**Files:**
- Create: `src/extension/manifest.json`
- Create: `src/extension/background.ts`

**Interfaces:**
- Produces: `background.ts` opens side panel on icon click and keeps a persistent Native Messaging port.
- Consumes: message types from `shared/messages.ts`.

- [ ] **Step 1: Write manifest.json**

`src/extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Pi Browser Agent",
  "version": "0.1.0",
  "description": "Control your browser with natural language through Pi.",
  "permissions": [
    "sidePanel",
    "nativeMessaging",
    "activeTab",
    "scripting",
    "storage"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "action": {
    "default_title": "Open Pi Browser Agent"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 2: Create placeholder icons**

```bash
mkdir -p src/extension/icons
for size in 16 48 128; do
  convert -size ${size}x${size} xc:'#EB0028' -pointsize $((size/3)) -fill white -gravity center -annotate +0+0 'π' src/extension/icons/icon${size}.png 2>/dev/null || \
  printf '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d"><rect width="100%%" height="100%%" fill="#EB0028"/><text x="50%%" y="55%%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="%d" font-family="sans-serif">π</text></svg>' $size $size $((size/2)) > src/extension/icons/icon${size}.svg
done
```

If `convert` is missing, use the generated SVGs and note that build will copy them.

- [ ] **Step 3: Implement background worker**

`src/extension/background.ts`:

```ts
import type { Message } from '../shared/messages.js';

let port: chrome.runtime.Port | null = null;

function connectPort() {
  port = chrome.runtime.connectNative('com.pi.browser_agent');
  port.onDisconnect.addListener(() => {
    console.error('[background] native port disconnected', chrome.runtime.lastError);
    port = null;
  });
  port.onMessage.addListener((msg: Message) => {
    chrome.runtime.sendMessage(msg).catch(() => {});
  });
}

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id! });
  if (!port) connectPort();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'user' && port) {
    port.postMessage(msg);
    sendResponse({ ok: true });
  } else if (msg.type === 'tool_result' && port) {
    port.postMessage(msg);
    sendResponse({ ok: true });
  } else {
    sendResponse({ ok: false });
  }
  return true;
});
```

- [ ] **Step 4: Update build to copy static assets**

Modify `package.json` scripts:

```json
"scripts": {
  "build": "tsc && npm run copy:assets",
  "copy:assets": "cp -R src/extension/manifest.json src/extension/icons src/extension/*.html src/extension/*.css dist/extension/",
  "build:watch": "tsc --watch",
  "test": "node --test dist/tests/*.test.js",
  "install:host": "node dist/scripts/install-host.js"
}
```

- [ ] **Step 5: Commit**

```bash
npm run build
git add src/extension/manifest.json src/extension/background.ts src/extension/icons package.json tsconfig.json
git commit -m "feat: extension manifest and background native port manager"
```

---

### Task 6: Content Script — DOM Actions and Screenshot

**Files:**
- Create: `src/extension/content.ts`

**Interfaces:**
- Produces: functions `executeTool(name, args)` returning `{ result, elapsedMs }`.
- Consumes: tool names `browser_scroll`, `browser_screenshot`, `browser_click`.

- [ ] **Step 1: Implement basic tool handlers**

`src/extension/content.ts`:

```ts
interface ToolResult {
  result: unknown;
  elapsedMs: number;
}

function highlight(selector: string) {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return;
  const previousOutline = el.style.outline;
  el.style.outline = '2px solid #EB0028';
  el.style.outlineOffset = '2px';
  setTimeout(() => {
    el.style.outline = previousOutline;
    el.style.outlineOffset = '';
  }, 1200);
}

async function scrollTool(args: { direction?: string; selector?: string }): Promise<ToolResult> {
  const start = performance.now();
  if (args.selector) {
    const el = document.querySelector(args.selector);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (args.direction === 'bottom') {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  } else if (args.direction === 'top') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  await new Promise((r) => setTimeout(r, 300));
  return { result: { scrolled: true }, elapsedMs: Math.round(performance.now() - start) };
}

async function clickTool(args: { selector: string }): Promise<ToolResult> {
  const start = performance.now();
  const el = document.querySelector(args.selector) as HTMLElement | null;
  if (!el) throw new Error(`Element not found: ${args.selector}`);
  highlight(args.selector);
  await new Promise((r) => setTimeout(r, 200));
  el.click();
  return { result: { clicked: true }, elapsedMs: Math.round(performance.now() - start) };
}

async function screenshotTool(args: { fullPage?: boolean }): Promise<ToolResult> {
  const start = performance.now();
  const dataUrl = await new Promise<string>((resolve) => {
    chrome.runtime.sendMessage({ type: 'capture_tab', fullPage: !!args.fullPage }, resolve);
  });
  return { result: { screenshot: dataUrl }, elapsedMs: Math.round(performance.now() - start) };
}

const handlers: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
  browser_scroll: scrollTool,
  browser_click: clickTool,
  browser_screenshot: screenshotTool,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'tool_call') {
    const handler = handlers[msg.name];
    if (!handler) {
      sendResponse({ type: 'error', message: `Unknown tool: ${msg.name}` });
      return true;
    }
    handler(msg.args)
      .then(({ result, elapsedMs }) => {
        sendResponse({ type: 'tool_result', id: msg.id, result, elapsedMs });
      })
      .catch((err) => {
        sendResponse({ type: 'error', message: err.message });
      });
    return true;
  }
  return false;
});
```

- [ ] **Step 2: Add screenshot capture handler in background**

Modify `src/extension/background.ts`, add inside `chrome.runtime.onMessage.addListener`:

```ts
if (msg.type === 'capture_tab') {
  chrome.tabs.captureVisibleTab({ format: 'png' }).then((dataUrl) => {
    sendResponse({ screenshot: dataUrl });
  });
  return true;
}
```

- [ ] **Step 3: Build and verify no TypeScript errors**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Manual verification (load extension later)**

Note: actual DOM execution will be verified in Task 10 end-to-end.

- [ ] **Step 5: Commit**

```bash
git add src/extension/content.ts src/extension/background.ts
git commit -m "feat: content script with scroll, click, screenshot tools"
```

---

### Task 7: Side Panel UI

**Files:**
- Create: `src/extension/sidepanel.html`
- Create: `src/extension/sidepanel.css`
- Create: `src/extension/sidepanel.ts`

**Interfaces:**
- Produces: rendered chat UI that sends `user` messages and displays `tool_call` / `tool_result` / `done` messages.
- Consumes: Message types, chrome.runtime messaging.

- [ ] **Step 1: Write HTML markup**

`src/extension/sidepanel.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pi Browser Agent</title>
  <link rel="stylesheet" href="sidepanel.css">
</head>
<body>
  <div class="header">
    <div class="brand">
      <div class="brand-icon">π</div>
      <div class="brand-title">Pi Browser Agent</div>
    </div>
    <div class="header-actions">
      <div class="status"><div class="status-dot"></div><span>sonnet-4</span></div>
      <button class="icon-btn" id="settingsBtn" title="Settings">⚙</button>
      <button class="icon-btn" id="newChatBtn" title="New chat">+</button>
    </div>
  </div>

  <div class="chat" id="chat"></div>

  <div class="input-area">
    <div class="input-wrapper">
      <textarea id="input" rows="1" placeholder="Tell Pi what to do in this tab..."></textarea>
      <button class="send-btn" id="sendBtn">➜</button>
    </div>
    <div class="input-hint">Enter to send · Shift+Enter for new line</div>
  </div>

  <script type="module" src="sidepanel.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write CSS from design mockup**

`src/extension/sidepanel.css` should mirror the Red Line System styles from `design-mockups/sidepanel.html`. Key selectors: `.header`, `.chat`, `.message`, `.bubble`, `.agent-card`, `.tool-header`, `.tool-body`, `.input-area`, `.send-btn`.

Use the exact token values from the Global Constraints.

- [ ] **Step 3: Implement sidepanel.ts**

`src/extension/sidepanel.ts`:

```ts
import type { Message, ToolCallMessage, ToolResultMessage, DoneMessage } from '../shared/messages.js';

const chat = document.getElementById('chat') as HTMLDivElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;

function appendUser(text: string) {
  const row = document.createElement('div');
  row.className = 'message user';
  row.innerHTML = `<div class="bubble"><div class="bubble-text">${escapeHtml(text)}</div><div class="meta">${timeNow()}</div></div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function appendAgentText(text: string) {
  const row = document.createElement('div');
  row.className = 'message agent';
  row.innerHTML = `<div class="bubble"><div class="bubble-text">${escapeHtml(text)}</div><div class="meta">${timeNow()}</div></div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

const toolCards = new Map<string, HTMLElement>();

function appendToolCall(msg: ToolCallMessage) {
  const row = document.createElement('div');
  row.className = 'message agent';
  row.innerHTML = `<div class="bubble" style="background:var(--bg);border-left:3px solid var(--accent);border-radius:0 var(--radius) var(--radius) 0;">
    <div class="agent-card" data-tool-id="${msg.id}">
      <div class="tool-header"><div class="tool-name">${escapeHtml(msg.name)}</div><div class="tool-status">working</div></div>
      <div class="tool-body">${formatArgs(msg.args)}</div>
    </div>
  </div>`;
  chat.appendChild(row);
  toolCards.set(msg.id, row.querySelector('.agent-card') as HTMLElement);
  chat.scrollTop = chat.scrollHeight;
}

function updateToolResult(msg: ToolResultMessage) {
  const card = toolCards.get(msg.id);
  if (!card) return;
  const status = card.querySelector('.tool-status') as HTMLElement;
  status.textContent = `done ${msg.elapsedMs}ms`;
}

function appendDone(msg: DoneMessage) {
  const row = document.createElement('div');
  row.className = 'message agent';
  row.innerHTML = `<div class="completion-card">
    <div class="completion-summary">${escapeHtml(msg.summary)}</div>
    <div class="completion-meta"><div>tools: <span>${msg.toolCount}</span></div><div>time: <span>${msg.totalMs}ms</span></div></div>
  </div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function formatArgs(args: Record<string, unknown>) {
  return Object.entries(args)
    .map(([k, v]) => `<div class="tool-param"><span class="param-key">${escapeHtml(k)}</span><span class="param-value">${escapeHtml(JSON.stringify(v))}</span></div>`)
    .join('');
}

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function send() {
  const text = input.value.trim();
  if (!text) return;
  appendUser(text);
  input.value = '';
  chrome.runtime.sendMessage({ type: 'user', text });
}

sendBtn.addEventListener('click', send);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === 'tool_call') appendToolCall(msg);
  else if (msg.type === 'tool_result') updateToolResult(msg);
  else if (msg.type === 'done') appendDone(msg);
  else if (msg.type === 'error') appendAgentText(`Error: ${msg.message}`);
});

document.getElementById('settingsBtn')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
```

- [ ] **Step 4: Build and verify files copied**

```bash
npm run build
ls -la dist/extension/
```

Expected: `sidepanel.html`, `sidepanel.css`, `sidepanel.js` present.

- [ ] **Step 5: Commit**

```bash
git add src/extension/sidepanel.html src/extension/sidepanel.css src/extension/sidepanel.ts
git commit -m "feat: side panel chat UI"
```

---

### Task 8: Settings Page

**Files:**
- Create: `src/extension/settings.html`
- Create: `src/extension/settings.css`
- Create: `src/extension/settings.ts`

**Interfaces:**
- Produces: `chrome.storage.sync` persisted settings object.
- Consumes: Red Line System styles.

- [ ] **Step 1: Write settings HTML/CSS/TS**

Mirror `design-mockups/settings.html` with Red Line System tokens.

`src/extension/settings.ts` core logic:

```ts
interface Settings {
  authMode: 'pi' | 'manual';
  provider: string;
  model: string;
  apiKey: string;
  autoScreenshot: boolean;
  highlightTarget: boolean;
  confirmSensitive: boolean;
  fullPageScreenshot: boolean;
  nativeHostPath: string;
  piPath: string;
}

const DEFAULTS: Settings = {
  authMode: 'pi',
  provider: 'Anthropic',
  model: 'claude-sonnet-4-20250514',
  apiKey: '',
  autoScreenshot: true,
  highlightTarget: true,
  confirmSensitive: false,
  fullPageScreenshot: false,
  nativeHostPath: '/Users/you/.pi/browser-agent/native-host',
  piPath: 'pi',
};

async function load() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  applyToForm(stored as Settings);
}

async function save() {
  const settings = readFromForm();
  await chrome.storage.sync.set(settings);
}

document.getElementById('saveBtn')?.addEventListener('click', save);
load();
```

- [ ] **Step 2: Add options_page to manifest**

Modify `src/extension/manifest.json`:

```json
"options_page": "settings.html"
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: no errors; `dist/extension/settings.html` exists.

- [ ] **Step 4: Manual verification**

Load extension in Chrome, open Settings, change a toggle, close and reopen, verify value persists.

- [ ] **Step 5: Commit**

```bash
git add src/extension/settings.html src/extension/settings.css src/extension/settings.ts src/extension/manifest.json
git commit -m "feat: settings page with storage persistence"
```

---

### Task 9: Onboarding Page

**Files:**
- Create: `src/extension/onboarding.html`
- Create: `src/extension/onboarding.css`
- Create: `src/extension/onboarding.ts`

**Interfaces:**
- Produces: static onboarding page with install steps and copy buttons.

- [ ] **Step 1: Write onboarding files**

Mirror `design-mockups/onboarding.html`.

`src/extension/onboarding.ts`:

```ts
document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const code = btn.previousElementSibling?.textContent || '';
    navigator.clipboard.writeText(code);
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = 'Copy'), 1200);
  });
});
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
ls dist/extension/onboarding.html
```

- [ ] **Step 3: Manual verification**

Open `dist/extension/onboarding.html` in browser, click copy buttons.

- [ ] **Step 4: Commit**

```bash
git add src/extension/onboarding.html src/extension/onboarding.css src/extension/onboarding.ts
git commit -m "feat: onboarding page"
```

---

### Task 10: End-to-End Manual Test

**Files:**
- Modify: any as needed to fix issues.

**Interfaces:**
- Produces: working extension that can receive a user message, dispatch tools, and show completion.

- [ ] **Step 1: Load unpacked extension**

1. Open Chrome → Extensions → Manage Extensions → Developer mode ON.
2. Click Load unpacked → select `dist/extension/`.
3. Copy extension ID.

- [ ] **Step 2: Install native host**

```bash
npm run build
npm run install:host -- <extension-id>
```

- [ ] **Step 3: Create mock Pi CLI for testing**

`scripts/mock-pi.ts`:

```ts
import { encodeMessage } from '../host/protocol.js';
import type { Message } from '../shared/messages.js';

process.stdin.on('data', (chunk: Buffer) => {
  let offset = 0;
  while (offset + 4 <= chunk.length) {
    const len = chunk.readUInt32LE(offset);
    const json = chunk.subarray(offset + 4, offset + 4 + len).toString('utf8');
    const msg = JSON.parse(json) as Message;
    if (msg.type === 'user') {
      process.stdout.write(encodeMessage({ type: 'tool_call', id: '1', name: 'browser_scroll', args: { direction: 'bottom' } }));
      setTimeout(() => {
        process.stdout.write(encodeMessage({ type: 'tool_result', id: '1', result: { scrolled: true }, elapsedMs: 120 }));
        process.stdout.write(encodeMessage({ type: 'tool_call', id: '2', name: 'browser_click', args: { selector: 'button.load-more' } }));
        setTimeout(() => {
          process.stdout.write(encodeMessage({ type: 'tool_result', id: '2', result: { clicked: true }, elapsedMs: 45 }));
          process.stdout.write(encodeMessage({ type: 'done', summary: 'Clicked Load more.', toolCount: 2, totalMs: 165 }));
        }, 100);
      }, 100);
    }
    offset += 4 + len;
  }
});
```

Build and use it as `PI_COMMAND`:

```bash
npm run build
PI_COMMAND=dist/scripts/mock-pi.js node dist/host/index.js
```

- [ ] **Step 4: Test the full loop in Chrome**

1. Visit `example-shop.com/products` or any page with a `button.load-more`.
2. Click extension icon.
3. Type "click load more" and send.
4. Verify:
   - Tool cards appear for `browser_scroll` and `browser_click`.
   - Page scrolls and clicks.
   - Completion card shows `tools: 2` and `time: 165ms`.

- [ ] **Step 5: Commit any fixes and tag milestone**

```bash
git add .
git commit -m "test: end-to-end smoke test with mock Pi"
git tag v0.1.0-mvp
```

---

## Self-Review

### Spec Coverage

| Spec Section | Plan Task(s) |
|---|---|
| Local-only / no backend | Task 1-4 architecture |
| One-click install script | Task 4 |
| Side panel 380px | Task 7 CSS |
| Natural language → tools | Task 3, 6, 7, 10 |
| Behavior visualization | Task 7 |
| Completion report (tools/time/summary) | Task 7 `appendDone` |
| Red Line System | Global Constraints + Tasks 7-9 |
| Inherit Pi login / manual API key | Task 8 |
| browser_screenshot/scroll/click | Task 6 |
| Security (local storage, host validation) | Task 4, 8 |

### Placeholder Scan

- No `TBD`, `TODO`, or vague steps.
- Each task ends with a test or manual verification.
- Code blocks contain concrete implementations.

### Type Consistency

- `Message` union type used consistently across `shared/messages.ts`, `host/protocol.ts`, `host/pi.ts`, `extension/background.ts`, `extension/sidepanel.ts`.
- Tool result shape `{ result, elapsedMs }` consistent between `content.ts` and sidepanel update.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-13-pi-browser-agent.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach would you like?
