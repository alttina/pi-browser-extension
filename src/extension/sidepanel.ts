import type { Message, DoneMessage, StatusMessage, AgentStatus } from '../shared/messages.js';

const chat = document.getElementById('chat') as HTMLDivElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;

const statusEl = document.getElementById('agentStatus') as HTMLDivElement;

interface ToolHistoryEntry {
  id: string;
  name: string;
  args: Record<string, unknown>;
  elapsedMs?: number;
}

const toolHistory: ToolHistoryEntry[] = [];
const statusTitle = document.getElementById('statusTitle') as HTMLSpanElement;
const statusStep = document.getElementById('statusStep') as HTMLSpanElement;
const statusTools = document.getElementById('statusTools') as HTMLSpanElement;
const statusTokens = document.getElementById('statusTokens') as HTMLSpanElement;

const stepLabels: Record<AgentStatus, string> = {
  thinking: 'Thinking…',
  writing: 'Writing…',
  screenshotting: 'Screenshotting…',
  working: 'Working…',
};

function updateStatus(msg: StatusMessage) {
  statusEl.classList.add('status-working');
  statusEl.classList.remove('status-done');
  statusTitle.textContent = 'Working';
  statusStep.textContent = stepLabels[msg.state];
  statusTools.textContent = `${msg.toolCount} tool${msg.toolCount === 1 ? '' : 's'}`;
  if (msg.totalTokens && msg.totalTokens > 0) {
    statusTokens.classList.remove('hidden');
    statusTokens.textContent = `${msg.totalTokens.toLocaleString()} tokens`;
  } else {
    statusTokens.classList.add('hidden');
  }
}

function formatDuration(totalMs: number): string {
  const totalSeconds = Math.round(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}min`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

function setDoneStatus(toolCount: number, totalMs: number, totalTokens?: number) {
  statusEl.classList.remove('status-working');
  statusEl.classList.add('status-done');
  statusTitle.textContent = 'Done';
  statusStep.textContent = `Worked for ${formatDuration(totalMs)}`;
  statusTools.textContent = `${toolCount} tool${toolCount === 1 ? '' : 's'}`;
  if (totalTokens && totalTokens > 0) {
    statusTokens.classList.remove('hidden');
    statusTokens.textContent = `${totalTokens.toLocaleString()} tokens`;
  } else {
    statusTokens.classList.add('hidden');
  }
}

function resetStatus() {
  statusEl.classList.remove('status-working', 'status-done');
  statusTitle.textContent = 'Ready';
  statusStep.textContent = '—';
  statusTools.textContent = '0 tools';
  statusTokens.classList.add('hidden');
}

function appendUser(text: string) {
  chat.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'message user';
  row.innerHTML = `<div class="bubble"><div class="bubble-text">${escapeHtml(text)}</div></div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function appendSummary(summary: string) {
  const row = document.createElement('div');
  row.className = 'message agent summary';
  row.innerHTML = `<div class="bubble completion-summary"><div class="bubble-text">${escapeHtml(summary).replace(/\n/g, '<br>')}</div></div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function appendError(message: string) {
  const row = document.createElement('div');
  row.className = 'message agent error';
  row.innerHTML = `<div class="bubble"><div class="bubble-text">Error: ${escapeHtml(message)}</div></div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function appendDone(msg: DoneMessage) {
  setDoneStatus(msg.toolCount, msg.totalMs, msg.totalTokens);
  appendSummary(msg.summary);

  const history = document.createElement('div');
  history.id = 'tool-history';
  history.className = 'hidden';
  history.textContent = JSON.stringify(toolHistory);
  chat.appendChild(history);

  toolHistory.length = 0;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function send() {
  const text = input.value.trim();
  if (!text) return;
  appendUser(text);
  input.value = '';
  toolHistory.length = 0;
  resetStatus();
  statusEl.classList.add('status-working');
  statusTitle.textContent = 'Working';
  statusStep.textContent = 'Starting…';
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
  if (msg.type === 'tool_call' && msg.ui === true) {
    toolHistory.push({ id: msg.id, name: msg.name, args: msg.args });
  } else if (msg.type === 'tool_result' && msg.ui === true) {
    const entry = toolHistory.find((t) => t.id === msg.id);
    if (entry) entry.elapsedMs = msg.elapsedMs;
  } else if (msg.type === 'status') updateStatus(msg);
  else if (msg.type === 'done') appendDone(msg);
  else if (msg.type === 'error') appendError(msg.message);
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
