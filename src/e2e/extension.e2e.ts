import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createServer, type Server } from 'node:http';
import { setupHost, EXTENSION_ID } from './setup-host.js';
import { TASKS } from './tasks/index.js';
import { runTask, captureChatState, type TaskRunner } from './evaluator.js';

const EXTENSION_PATH = resolve('dist/extension');
const FIXTURE_ROOT = resolve('dist/e2e/fixtures');

function resolve(p: string): string {
  return new URL(`file://${process.cwd()}/${p}`).pathname;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function startFixtureServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const parts = url.pathname.split('/').filter(Boolean);
      const fixtureName = parts[0] || 'onestopshop';
      const remainingPath = parts.slice(1).join('/') || 'index.html';
      const fixtureDir = join(FIXTURE_ROOT, fixtureName);
      if (!existsSync(fixtureDir) || !statSync(fixtureDir).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      let filePath = join(fixtureDir, remainingPath);
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        filePath = join(fixtureDir, 'index.html');
      }
      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const ext = extname(filePath);
      const contentType =
        ext === '.css' ? 'text/css' :
        ext === '.js' ? 'application/javascript' :
        'text/html';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      assert(addr && typeof addr === 'object', 'server address is object');
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
  });
}

async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  const [worker] = await Promise.all([
    context.waitForEvent('serviceworker'),
    // Opening a temporary tab encourages Chrome to start the extension service worker.
    context.newPage().then(async (p) => {
      await p.goto('about:blank');
      return p;
    }),
  ]);
  return worker;
}

async function closeBlankTabs(context: BrowserContext, keepPages: Page[]) {
  const keepUrls = new Set(keepPages.map((p) => p.url()));
  for (const page of context.pages()) {
    if (page.url() === 'about:blank' && !keepPages.includes(page)) {
      await page.close().catch(() => {});
    }
  }
}

async function openRealSidePanel(targetPage: Page) {
  // Open the real Chrome side panel using a hidden content-script trigger button.
  // The click is a genuine user gesture, so the background script's
  // chrome.sidePanel.open() call is accepted by Chrome.
  await targetPage.bringToFront();
  await targetPage.waitForSelector('#pi-browser-agent-trigger');
  await targetPage.click('#pi-browser-agent-trigger');
  await new Promise((r) => setTimeout(r, 800));
}

async function run() {
  const { server, url: fixtureUrl } = await startFixtureServer();
  console.log(`Fixture server: ${fixtureUrl}`);

  const profileDir = mkdtempSync(join(tmpdir(), 'pi-browser-agent-e2e-'));
  const logDir = join(process.cwd(), 'e2e-context-logs', Date.now().toString());
  mkdirSync(logDir, { recursive: true });
  const hostSetup = setupHost(profileDir, logDir);
  console.log(`Profile: ${profileDir}`);
  console.log(`Context logs: ${logDir}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    // Let Chrome resize the page when the real side panel opens.
    viewport: null,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  try {
    const worker = await getServiceWorker(context);
    console.log('Service worker:', worker.url());

    const targetPage: Page = await context.newPage();
    await targetPage.goto(`${fixtureUrl}onestopshop/`);

    // Open the real Chrome side panel on the target tab so the user sees it during tests.
    await openRealSidePanel(targetPage);

    // Load the side panel UI in a separate page so we can drive it and read its DOM
    // without relying on Playwright being able to access the actual side panel surface.
    const sidePanelPage: Page = await context.newPage();
    await sidePanelPage.goto(`chrome-extension://${EXTENSION_ID}/sidepanel.html`);
    await sidePanelPage.waitForSelector('#input');
    await sidePanelPage.waitForSelector('#sendBtn');
    console.log('Side panel ready');

    // Close the helper blank tabs; keep only the fixture tab and the side-panel page.
    await closeBlankTabs(context, [targetPage, sidePanelPage]);

    // Keep the target fixture tab active so the background script routes tool calls
    // to the correct tab.
    await targetPage.bringToFront();

    mkdirSync('e2e-screenshots', { recursive: true });

    const runner: TaskRunner = {
      targetPage,
      sidePanelPage,
      baseUrl: fixtureUrl.replace(/\/$/, ''),
      async clearChat() {
        await sidePanelPage.evaluate(() => {
          chrome.runtime.sendMessage({ type: 'clear_chat' });
        });
      },
      async sendIntent(intent: string) {
        await sidePanelPage.evaluate((text: string) => {
          const input = document.getElementById('input') as HTMLTextAreaElement;
          const sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
          input.value = text;
          sendBtn.click();
        }, intent);
        // Ensure the fixture tab stays the active tab for tool-call routing.
        await targetPage.bringToFront();
      },
      async waitForCompletion({ timeoutMs }) {
        try {
          await sidePanelPage.waitForSelector('.completion-summary', { timeout: timeoutMs });
          return true;
        } catch {
          return false;
        }
      },
    };

    const results: { id: string; success: boolean; reason?: string; durationMs: number }[] = [];

    for (const task of TASKS) {
      console.log(`\nRunning task: ${task.id}`);
      const { result, chat, durationMs } = await runTask(runner, task);
      results.push({ id: task.id, success: result.success, reason: result.reason, durationMs });
      const status = result.success ? 'PASS' : 'FAIL';
      console.log(`[${status}] ${task.id} (${durationMs}ms) ${result.reason ? '- ' + result.reason : ''}`);
      console.log(`  Completion: ${chat.completion || '(none)'}`);
      console.log(`  Tools: ${chat.toolCalls.map((t) => t.name).join(' → ') || '(none)'}`);

      if (!result.success) {
        const ts = Date.now();
        await targetPage.screenshot({ path: `e2e-screenshots/${task.id}-page-${ts}.png` });
        await sidePanelPage.screenshot({ path: `e2e-screenshots/${task.id}-panel-${ts}.png` });
      }

      // Clear chat for next task by reloading the side panel page.
      await sidePanelPage.goto(`chrome-extension://${EXTENSION_ID}/sidepanel.html`);
      await sidePanelPage.waitForSelector('#input');
      await targetPage.bringToFront();
    }

    const passed = results.filter((r) => r.success).length;
    const total = results.length;
    console.log(`\nE2E summary: ${passed}/${total} tasks passed`);

    if (passed < total) {
      throw new Error(`E2E failed: ${total - passed} task(s) failed`);
    }

    console.log('\nAll E2E assertions passed.');
  } finally {
    await context.close();
    server.close();
    rmSync(profileDir, { recursive: true, force: true });
    try {
      rmSync(hostSetup.wrapperPath, { force: true });
    } catch {}
  }
}

run().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
