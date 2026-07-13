import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAC_CANDIDATES = [
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
];

// Google Chrome stable on macOS ignores --load-extension from the command line,
// so we only fall back to it when no other Chromium build is available.
const FALLBACK_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function puppeteerCachePath(): string | null {
  const chromeRoot = join(homedir(), '.cache/puppeteer/chrome');
  if (!existsSync(chromeRoot)) return null;
  try {
    const platformDirs = readdirSync(chromeRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(chromeRoot, e.name))
      .sort();
    for (const dir of platformDirs.reverse()) {
      const binary = join(dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      if (existsSync(binary)) return binary;
    }
    return null;
  } catch {
    return null;
  }
}

export function findChromium(): string | null {
  for (const candidate of MAC_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  const cached = puppeteerCachePath();
  if (cached) return cached;
  for (const candidate of FALLBACK_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
