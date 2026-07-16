import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export const EXTENSION_ID = 'oiehamhpkhapjjgnbmdfnbfbpnnmloid';
export const NATIVE_HOST_NAME = 'com.pi.browser_agent';

export interface HostSetup {
  profileDir: string;
  manifestPath: string;
  wrapperPath: string;
}

/**
 * Write a per-profile wrapper script and native messaging manifest.
 *
 * The wrapper path is derived from the profile directory basename so parallel
 * E2E runs each get their own wrapper file; without this, two runs starting
 * near-simultaneously would race on `dist/e2e/host-wrapper.sh` (with distinct
 * PI_BROWSER_AGENT_LOG_DIR values) and cross-contaminate their logs. The
 * manifest lives inside the profile directory, so each Chromium instance
 * sees its own host registration.
 */
export function setupHost(profileDir: string, logDir?: string): HostSetup {
  const projectRoot = resolve('.');
  const hostIndex = resolve('dist/host/index.js');
  const nativeHostsDir = join(profileDir, 'NativeMessagingHosts');

  mkdirSync(nativeHostsDir, { recursive: true });

  const wrapperName = `host-wrapper-${basename(profileDir)}.sh`;
  const wrapperPath = join(projectRoot, 'dist/e2e', wrapperName);

  const logDirLine = logDir ? `export PI_BROWSER_AGENT_LOG_DIR=${logDir}\n` : '';
  const wrapper = `#!/bin/bash\ncd ${projectRoot}\nexport PI_THINKING_LEVEL=off\n${logDirLine}exec node ${hostIndex}\n`;

  mkdirSync(resolve('dist/e2e'), { recursive: true });
  writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
  chmodSync(wrapperPath, 0o755);

  const manifest = {
    name: NATIVE_HOST_NAME,
    description: 'Pi Browser Agent Native Host',
    path: wrapperPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  };

  const manifestPath = join(nativeHostsDir, `${NATIVE_HOST_NAME}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return { profileDir, manifestPath, wrapperPath };
}
