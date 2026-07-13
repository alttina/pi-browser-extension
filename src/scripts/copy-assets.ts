import { cpSync, existsSync } from 'node:fs';

const assets = [
  'manifest.json',
  'icons',
  'sidepanel.html',
  'sidepanel.css',
  'settings.html',
  'settings.css',
  'onboarding.html',
  'onboarding.css',
];

for (const asset of assets) {
  const src = `src/extension/${asset}`;
  if (existsSync(src)) {
    cpSync(src, `dist/extension/${asset}`, { recursive: true, force: true });
  }
}
