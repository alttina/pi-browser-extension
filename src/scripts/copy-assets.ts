import { cpSync, existsSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';

const assets = [
  'manifest.json',
  'icons',
  'sidepanel.html',
  'sidepanel.css',
  'settings.html',
  'settings.css',
  'onboarding.html',
  'onboarding.css',
  'offscreen.html',
];

for (const asset of assets) {
  const src = `src/extension/${asset}`;
  if (existsSync(src)) {
    cpSync(src, `dist/extension/${asset}`, { recursive: true, force: true });
  }
}

function copyDir(src: string, dst: string) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = `${src}/${entry.name}`;
    const d = `${dst}/${entry.name}`;
    if (entry.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

for (const fixture of readdirSync('src/e2e/fixtures', { withFileTypes: true })) {
  if (fixture.isDirectory()) {
    copyDir(`src/e2e/fixtures/${fixture.name}`, `dist/e2e/fixtures/${fixture.name}`);
  }
}
