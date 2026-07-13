import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const EXTENSION_ID = 'oiehamhpkhapjjgnbmdfnbfbpnnmloid';
export const NATIVE_HOST_NAME = 'com.pi.browser_agent';

export interface HostSetup {
  profileDir: string;
  manifestPath: string;
  wrapperPath: string;
  runnerPath: string;
}

export function setupMockHost(profileDir: string): HostSetup {
  const projectRoot = resolve('.');
  const hostIndex = resolve('dist/host/index.js');
  const mockPi = resolve('dist/scripts/mock-pi.js');
  const nativeHostsDir = join(profileDir, 'NativeMessagingHosts');

  mkdirSync(nativeHostsDir, { recursive: true });

  const runnerPath = join(projectRoot, 'dist/e2e/mock-pi-runner.sh');
  const wrapperPath = join(projectRoot, 'dist/e2e/mock-pi-wrapper.sh');

  const runner = `#!/bin/bash\nexec node ${mockPi} agent\n`;
  const wrapper = `#!/bin/bash\nexport PI_COMMAND=${runnerPath}\nexec node ${hostIndex}\n`;

  mkdirSync(resolve('dist/e2e'), { recursive: true });
  writeFileSync(runnerPath, runner, { mode: 0o755 });
  writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
  chmodSync(runnerPath, 0o755);
  chmodSync(wrapperPath, 0o755);

  const manifest = {
    name: NATIVE_HOST_NAME,
    description: 'Pi Browser Agent Native Host (e2e mock)',
    path: wrapperPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  };

  const manifestPath = join(nativeHostsDir, `${NATIVE_HOST_NAME}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return { profileDir, manifestPath, wrapperPath, runnerPath };
}
