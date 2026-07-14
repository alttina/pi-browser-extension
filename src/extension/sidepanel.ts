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
  if (msg.type === 'tool_call' && msg.ui === true) appendToolCall(msg);
  else if (msg.type === 'tool_result' && msg.ui === true) updateToolResult(msg);
  else if (msg.type === 'done') appendDone(msg);
  else if (msg.type === 'assistant') appendAgentText(msg.text);
  else if (msg.type === 'error') appendAgentText(`Error: ${msg.message}`);
});

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

const settingsView = document.getElementById('settingsView') as HTMLDivElement;
const chatView = document.getElementById('chat') as HTMLDivElement;
const inputArea = document.getElementById('inputArea') as HTMLDivElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
const closeSettingsBtn = document.getElementById('closeSettingsBtn') as HTMLButtonElement;
const statusBadge = document.getElementById('statusBadge') as HTMLDivElement;
const newChatBtn = document.getElementById('newChatBtn') as HTMLButtonElement;

function showSettings() {
  chatView.classList.add('hidden');
  inputArea.classList.add('hidden');
  settingsView.classList.remove('hidden');
  settingsBtn.classList.add('hidden');
  newChatBtn.classList.add('hidden');
  statusBadge.classList.add('hidden');
  closeSettingsBtn.classList.remove('hidden');
}

function hideSettings() {
  chatView.classList.remove('hidden');
  inputArea.classList.remove('hidden');
  settingsView.classList.add('hidden');
  settingsBtn.classList.remove('hidden');
  newChatBtn.classList.remove('hidden');
  statusBadge.classList.remove('hidden');
  closeSettingsBtn.classList.add('hidden');
}

function getSettingEl<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function applyToForm(settings: Settings) {
  getSettingEl<HTMLInputElement>('provider').value = settings.provider;
  getSettingEl<HTMLInputElement>('model').value = settings.model;
  getSettingEl<HTMLInputElement>('apiKey').value = settings.apiKey;
  getSettingEl<HTMLInputElement>('nativeHostPath').value = settings.nativeHostPath;
  getSettingEl<HTMLInputElement>('piPath').value = settings.piPath;

  document.querySelectorAll('#settingsView .radio-option').forEach((el) => {
    el.classList.toggle('selected', el.getAttribute('data-value') === settings.authMode);
  });

  document.querySelectorAll('#settingsView .toggle').forEach((el) => {
    const key = el.getAttribute('data-key') as keyof Settings;
    el.classList.toggle('active', !!settings[key]);
  });
}

function readFromForm(): Settings {
  const authMode = document.querySelector('#settingsView .radio-option.selected')?.getAttribute('data-value') as 'pi' | 'manual';
  const toggles: Record<string, boolean> = {};
  document.querySelectorAll('#settingsView .toggle').forEach((el) => {
    const key = el.getAttribute('data-key');
    if (key) toggles[key] = el.classList.contains('active');
  });

  return {
    authMode: authMode || 'pi',
    provider: getSettingEl<HTMLInputElement>('provider').value,
    model: getSettingEl<HTMLInputElement>('model').value,
    apiKey: getSettingEl<HTMLInputElement>('apiKey').value,
    autoScreenshot: toggles.autoScreenshot ?? DEFAULTS.autoScreenshot,
    highlightTarget: toggles.highlightTarget ?? DEFAULTS.highlightTarget,
    confirmSensitive: toggles.confirmSensitive ?? DEFAULTS.confirmSensitive,
    fullPageScreenshot: toggles.fullPageScreenshot ?? DEFAULTS.fullPageScreenshot,
    nativeHostPath: getSettingEl<HTMLInputElement>('nativeHostPath').value,
    piPath: getSettingEl<HTMLInputElement>('piPath').value,
  };
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS as unknown as Record<string, unknown>);
  applyToForm(stored as unknown as Settings);
}

async function saveSettings() {
  const settings = readFromForm();
  await chrome.storage.local.set(settings as unknown as Record<string, unknown>);
  const saveBtn = getSettingEl<HTMLButtonElement>('saveBtn');
  const original = saveBtn.textContent;
  saveBtn.textContent = 'Saved';
  setTimeout(() => (saveBtn.textContent = original), 1200);
}

async function resetSettings() {
  await chrome.storage.local.set(DEFAULTS as unknown as Record<string, unknown>);
  applyToForm(DEFAULTS);
}

function toggleSetting(el: HTMLElement) {
  el.classList.toggle('active');
}

function selectAuth(value: string) {
  document.querySelectorAll('#settingsView .radio-option').forEach((el) => {
    el.classList.toggle('selected', el.getAttribute('data-value') === value);
  });
}

settingsBtn.addEventListener('click', () => {
  loadSettings();
  showSettings();
});

closeSettingsBtn.addEventListener('click', hideSettings);

getSettingEl<HTMLButtonElement>('saveBtn').addEventListener('click', saveSettings);
getSettingEl<HTMLButtonElement>('resetBtn').addEventListener('click', resetSettings);

document.querySelectorAll('#settingsView .toggle').forEach((el) => {
  el.addEventListener('click', () => toggleSetting(el as HTMLElement));
});

document.querySelectorAll('#settingsView .radio-option').forEach((el) => {
  el.addEventListener('click', () => selectAuth(el.getAttribute('data-value') || 'pi'));
});
