import type { Message, ToolCallMessage, ToolResultMessage, DoneMessage, StatusMessage, AgentStatus } from '../shared/messages.js';

const chat = document.getElementById('chat') as HTMLDivElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;

const statusPanel = document.getElementById('agentStatusPanel') as HTMLDivElement;
const statusMain = document.getElementById('statusMain') as HTMLDivElement;
const statusLabel = document.getElementById('statusLabel') as HTMLSpanElement;
const statusTools = document.getElementById('statusTools') as HTMLSpanElement;
const statusTokens = document.getElementById('statusTokens') as HTMLSpanElement;
const statusStep = document.getElementById('statusStep') as HTMLSpanElement;

const statusLabels: Record<AgentStatus, string> = {
  thinking: 'Thinking',
  writing: 'Writing',
  screenshotting: 'Screenshotting',
  working: 'Working',
};

const stepLabels: Record<AgentStatus, string> = {
  thinking: 'Thinking…',
  writing: 'Writing…',
  screenshotting: 'Taking screenshot…',
  working: 'Running tool…',
};

function updateStatus(msg: StatusMessage) {
  statusPanel.classList.add('status-working');
  statusPanel.classList.remove('status-done');
  statusLabel.textContent = statusLabels[msg.state];
  statusTools.textContent = `Tools: ${msg.toolCount}`;
  if (msg.totalTokens && msg.totalTokens > 0) {
    statusTokens.classList.remove('hidden');
    statusTokens.textContent = `Tokens: ${msg.totalTokens.toLocaleString()}`;
  } else {
    statusTokens.classList.add('hidden');
  }
  statusStep.textContent = stepLabels[msg.state];
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
  statusPanel.classList.remove('status-working');
  statusPanel.classList.add('status-done');
  statusLabel.textContent = 'Done';
  statusTools.textContent = `Tools: ${toolCount}`;
  if (totalTokens && totalTokens > 0) {
    statusTokens.classList.remove('hidden');
    statusTokens.textContent = `Tokens: ${totalTokens.toLocaleString()}`;
  } else {
    statusTokens.classList.add('hidden');
  }
  statusStep.textContent = `Worked for ${formatDuration(totalMs)}`;
}

function resetStatus() {
  statusPanel.classList.remove('status-working', 'status-done');
  statusLabel.textContent = 'Ready';
  statusTools.textContent = 'Tools: 0';
  statusTokens.classList.add('hidden');
  statusStep.textContent = '—';
}

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
const toolHistory: { id: string; name: string; status: 'working' | 'done'; elapsedMs?: number }[] = [];

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
  toolHistory.push({ id: msg.id, name: msg.name, status: 'working' });
  chat.scrollTop = chat.scrollHeight;
}

function updateToolResult(msg: ToolResultMessage) {
  const card = toolCards.get(msg.id);
  if (!card) return;
  const status = card.querySelector('.tool-status') as HTMLElement;
  status.textContent = `done ${msg.elapsedMs}ms`;
  const entry = toolHistory.find((t) => t.id === msg.id);
  if (entry) {
    entry.status = 'done';
    entry.elapsedMs = msg.elapsedMs;
  }
}

function appendDone(msg: DoneMessage) {
  setDoneStatus(msg.toolCount, msg.totalMs, msg.totalTokens);

  const row = document.createElement('div');
  row.className = 'message agent';
  const trajectory = toolHistory.map((t) => escapeHtml(t.name)).join(' → ');
  const detailsId = `completion-details-${Date.now()}`;
  const tokenText = msg.totalTokens ? ` · ${msg.totalTokens.toLocaleString()} tokens` : '';
  row.innerHTML = `
    <div class="completion-card">
      <div class="completion-header">
        <div class="completion-badge">Done</div>
        <div class="completion-meta-inline">${msg.toolCount} tools${tokenText} · ${formatDuration(msg.totalMs)}</div>
      </div>
      <div class="completion-summary">${escapeHtml(msg.summary)}</div>
      <div class="completion-tools">
        <button class="completion-toggle" aria-expanded="false" aria-controls="${detailsId}">
          Show tool trajectory
        </button>
        <div id="${detailsId}" class="completion-details hidden">
          <div class="completion-trajectory">${trajectory || 'No tools used'}</div>
          <ul class="completion-tool-list">
            ${toolHistory.map((t) => `
              <li>
                <span class="tool-name-small">${escapeHtml(t.name)}</span>
                <span class="tool-status-small">${t.status === 'done' && t.elapsedMs !== undefined ? `${t.elapsedMs}ms` : t.status}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      </div>
      <div class="completion-actions">
        <button class="completion-action-btn copy-summary-btn">Copy summary</button>
        <button class="completion-action-btn new-task-btn">New task</button>
      </div>
    </div>
  `;
  chat.appendChild(row);

  const toggle = row.querySelector('.completion-toggle') as HTMLButtonElement;
  const details = row.querySelector(`#${detailsId}`) as HTMLDivElement;
  toggle.addEventListener('click', () => {
    const expanded = details.classList.toggle('hidden');
    toggle.textContent = expanded ? 'Show tool trajectory' : 'Hide tool trajectory';
    toggle.setAttribute('aria-expanded', String(!expanded));
  });

  const copyBtn = row.querySelector('.copy-summary-btn') as HTMLButtonElement;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(msg.summary).then(() => {
      copyBtn.textContent = 'Copied';
      setTimeout(() => (copyBtn.textContent = 'Copy summary'), 1200);
    });
  });

  const newTaskBtn = row.querySelector('.new-task-btn') as HTMLButtonElement;
  newTaskBtn.addEventListener('click', () => {
    input.value = '';
    input.focus();
    input.scrollIntoView({ behavior: 'smooth' });
  });

  chat.scrollTop = chat.scrollHeight;
  toolHistory.length = 0;
  toolCards.clear();
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
  toolHistory.length = 0;
  toolCards.clear();
  resetStatus();
  statusPanel.classList.add('status-working');
  statusLabel.textContent = 'Working';
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
  if (msg.type === 'tool_call' && msg.ui === true) appendToolCall(msg);
  else if (msg.type === 'tool_result' && msg.ui === true) updateToolResult(msg);
  else if (msg.type === 'status') updateStatus(msg);
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
