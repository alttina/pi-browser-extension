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

function getEl<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function applyToForm(settings: Settings) {
  getEl<HTMLInputElement>('provider').value = settings.provider;
  getEl<HTMLInputElement>('model').value = settings.model;
  getEl<HTMLInputElement>('apiKey').value = settings.apiKey;
  getEl<HTMLInputElement>('nativeHostPath').value = settings.nativeHostPath;
  getEl<HTMLInputElement>('piPath').value = settings.piPath;

  document.querySelectorAll('.radio-option').forEach((el) => {
    el.classList.toggle('selected', el.getAttribute('data-value') === settings.authMode);
  });

  document.querySelectorAll('.toggle').forEach((el) => {
    const key = el.getAttribute('data-key') as keyof Settings;
    el.classList.toggle('active', !!settings[key]);
  });
}

function readFromForm(): Settings {
  const authMode = document.querySelector('.radio-option.selected')?.getAttribute('data-value') as 'pi' | 'manual';
  const toggles: Record<string, boolean> = {};
  document.querySelectorAll('.toggle').forEach((el) => {
    const key = el.getAttribute('data-key');
    if (key) toggles[key] = el.classList.contains('active');
  });

  return {
    authMode: authMode || 'pi',
    provider: getEl<HTMLInputElement>('provider').value,
    model: getEl<HTMLInputElement>('model').value,
    apiKey: getEl<HTMLInputElement>('apiKey').value,
    autoScreenshot: toggles.autoScreenshot ?? DEFAULTS.autoScreenshot,
    highlightTarget: toggles.highlightTarget ?? DEFAULTS.highlightTarget,
    confirmSensitive: toggles.confirmSensitive ?? DEFAULTS.confirmSensitive,
    fullPageScreenshot: toggles.fullPageScreenshot ?? DEFAULTS.fullPageScreenshot,
    nativeHostPath: getEl<HTMLInputElement>('nativeHostPath').value,
    piPath: getEl<HTMLInputElement>('piPath').value,
  };
}

async function load() {
  const stored = await chrome.storage.local.get(DEFAULTS as unknown as Record<string, unknown>);
  applyToForm(stored as unknown as Settings);
}

async function save() {
  const settings = readFromForm();
  await chrome.storage.local.set(settings as unknown as Record<string, unknown>);
  const saveBtn = getEl<HTMLButtonElement>('saveBtn');
  const original = saveBtn.textContent;
  saveBtn.textContent = 'Saved';
  setTimeout(() => (saveBtn.textContent = original), 1200);
}

async function reset() {
  await chrome.storage.local.set(DEFAULTS as unknown as Record<string, unknown>);
  applyToForm(DEFAULTS);
}

function toggle(el: HTMLElement) {
  el.classList.toggle('active');
}

function selectAuth(value: string) {
  document.querySelectorAll('.radio-option').forEach((el) => {
    el.classList.toggle('selected', el.getAttribute('data-value') === value);
  });
}

document.getElementById('saveBtn')?.addEventListener('click', save);
document.getElementById('resetBtn')?.addEventListener('click', reset);

document.querySelectorAll('.toggle').forEach((el) => {
  el.addEventListener('click', () => toggle(el as HTMLElement));
});

document.querySelectorAll('.radio-option').forEach((el) => {
  el.addEventListener('click', () => selectAuth(el.getAttribute('data-value') || 'pi'));
});

load();
