import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

const extensionId = process.argv[2];
if (!extensionId) {
  console.error('Usage: npm run install:host -- <extension-id>');
  process.exit(1);
}

const projectRoot = resolve();
const hostPath = resolve('dist/host/index.js');
const wrapperPath = resolve('dist/host/run-host.sh');

const logFile = join(projectRoot, 'host-stderr.log');
const wrapper = `#!/bin/bash
# Auto-generated native messaging host wrapper for Pi Browser Agent.
# Chrome launches this script directly; it then runs the Node host.
export PATH="${projectRoot}/node_modules/.bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.pi/bin:$PATH"
cd "${projectRoot}"
exec node "${hostPath}" 2>>"${logFile}"
`;

mkdirSync(resolve('dist/host'), { recursive: true });
writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
chmodSync(wrapperPath, 0o755);

const manifest = {
  name: 'com.pi.browser_agent',
  description: 'Pi Browser Agent Native Host',
  path: wrapperPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`],
};

let targetDir: string;
const p = platform();
if (p === 'darwin') {
  targetDir = join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
} else if (p === 'win32') {
  targetDir = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.pi.browser_agent';
  console.error('Windows registry install not yet implemented; please set manually.');
  process.exit(1);
} else {
  targetDir = join(homedir(), '.config/google-chrome/NativeMessagingHosts');
}

mkdirSync(targetDir, { recursive: true });
const targetFile = join(targetDir, 'com.pi.browser_agent.json');
writeFileSync(targetFile, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${targetFile}`);
console.log(`Wrote ${wrapperPath}`);
