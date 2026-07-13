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
  row.innerHTML = `<div class="bubble agent-bubble">
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
