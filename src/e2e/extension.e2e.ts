import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createServer, type Server } from 'node:http';
import { setupHost, EXTENSION_ID } from './setup-host.js';
import { TASKS } from './tasks/index.js';
import type { Task, TaskMode } from './tasks/index.js';
import { runTask, type TaskRunSummary, type TaskRunner } from './evaluator.js';

const EXTENSION_PATH = resolve('dist/extension');
const FIXTURE_ROOT = resolve('dist/e2e/fixtures');

function resolve(p: string): string {
  return new URL(`file://${process.cwd()}/${p}`).pathname;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function parseMode(raw: string | undefined): TaskMode {
  const value = (raw || 'natural').toLowerCase();
  if (value === 'natural' || value === 'smoke') return value;
  throw new Error(`Invalid E2E_MODE=${raw}. Expected "natural" or "smoke".`);
}

function selectTasks(all: Task[], filter: string | undefined): Task[] {
  if (!filter) return all;
  const wanted = new Set(
    filter
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  const selected = all.filter((t) => wanted.has(t.id));
  const missing = Array.from(wanted).filter((id) => !all.some((t) => t.id === id));
  if (missing.length > 0) {
    throw new Error(`Unknown task ID(s) in E2E_TASKS: ${missing.join(', ')}`);
  }
  if (selected.length === 0) {
    throw new Error('E2E_TASKS filter produced an empty task set.');
  }
  return selected;
}

function truncate(s: string | undefined, max: number): string {
  if (!s) return '';
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

function printSummaryTable(summaries: TaskRunSummary[]) {
  const rows = summaries.map((s) => ({
    task: s.id,
    status: s.success ? 'PASS' : s.timedOut ? 'TIMEOUT' : 'FAIL',
    tools: s.toolCallCount,
    ms: s.durationMs,
    trajectory: truncate(s.toolTrajectory.join(' → '), 60),
    note: truncate(s.reason || s.completion, 60),
  }));

  const columns: { key: keyof (typeof rows)[number]; label: string; align: 'l' | 'r' }[] = [
    { key: 'task', label: 'Task', align: 'l' },
    { key: 'status', label: 'Status', align: 'l' },
    { key: 'tools', label: 'Tools', align: 'r' },
    { key: 'ms', label: 'Ms', align: 'r' },
    { key: 'trajectory', label: 'Trajectory', align: 'l' },
    { key: 'note', label: 'Note', align: 'l' },
  ];

  const widths = columns.map((c) =>
    Math.max(c.label.length, ...rows.map((r) => String(r[c.key] ?? '').length)),
  );

  const pad = (text: string, width: number, align: 'l' | 'r') =>
    align === 'r' ? text.padStart(width) : text.padEnd(width);

  const header = columns.map((c, i) => pad(c.label, widths[i], c.align)).join('  ');
  const divider = widths.map((w) => '-'.repeat(w)).join('  ');
  console.log('\n' + header);
  console.log(divider);
  for (const r of rows) {
    console.log(columns.map((c, i) => pad(String(r[c.key] ?? ''), widths[i], c.align)).join('  '));
  }
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
  const mode = parseMode(process.env.E2E_MODE);
  const tasks = selectTasks(TASKS, process.env.E2E_TASKS);
  console.log(`E2E mode: ${mode}`);
  console.log(`Tasks: ${tasks.map((t) => t.id).join(', ')}`);

  const { server, url: fixtureUrl } = await startFixtureServer();
  console.log(`Fixture server: ${fixtureUrl}`);

  const profileDir = mkdtempSync(join(tmpdir(), 'pi-browser-agent-e2e-'));
  const logDir = join(process.cwd(), 'e2e-context-logs', `${mode}-${Date.now()}`);
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

  const summaries: TaskRunSummary[] = [];
  const runStartedAt = new Date().toISOString();

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
      async newSession() {
        // Fire the message via the sidepanel page so it goes through the same
        // background → native host path a real user would exercise.
        await sidePanelPage.evaluate(() => {
          chrome.runtime.sendMessage({ type: 'new_session' });
        });
        // Give the host time to dispose the old Pi session and construct a
        // new one. resetSession internally awaits createAgentSession, which
        // does a bit of I/O; 500ms is a safe upper bound for a local host.
        await sidePanelPage.waitForTimeout(500);
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

    for (const task of tasks) {
      console.log(`\nRunning task: ${task.id} [${mode}]`);
      const { summary } = await runTask(runner, task, { mode });
      summaries.push(summary);

      const status = summary.success ? 'PASS' : summary.timedOut ? 'TIMEOUT' : 'FAIL';
      console.log(
        `[${status}] ${summary.id} (${summary.durationMs}ms, ${summary.toolCallCount} tools)`
        + (summary.reason ? ` - ${summary.reason}` : ''),
      );
      console.log(`  Intent: ${summary.intent}`);
      console.log(`  Completion: ${summary.completion || '(none)'}`);
      console.log(`  Trajectory: ${summary.toolTrajectory.join(' → ') || '(none)'}`);
      if (summary.missingExpectedTools.length > 0) {
        console.log(`  Missing expected tools: ${summary.missingExpectedTools.join(', ')}`);
      }

      if (!summary.success) {
        const ts = Date.now();
        await targetPage
          .screenshot({ path: `e2e-screenshots/${task.id}-page-${ts}.png` })
          .catch(() => {});
        await sidePanelPage
          .screenshot({ path: `e2e-screenshots/${task.id}-panel-${ts}.png` })
          .catch(() => {});
      }

      // Clear chat for next task by reloading the side panel page.
      await sidePanelPage.goto(`chrome-extension://${EXTENSION_ID}/sidepanel.html`);
      await sidePanelPage.waitForSelector('#input');
      await targetPage.bringToFront();
    }

    const passed = summaries.filter((r) => r.success).length;
    const total = summaries.length;
    console.log(`\nE2E summary [${mode}]: ${passed}/${total} tasks passed`);
    printSummaryTable(summaries);

    if (passed < total) {
      throw new Error(`E2E failed: ${total - passed} task(s) failed`);
    }

    console.log('\nAll E2E assertions passed.');
  } finally {
    try {
      const summaryPath = join(logDir, 'summary.json');
      const passed = summaries.filter((r) => r.success).length;
      const timedOut = summaries.filter((r) => r.timedOut).length;
      writeFileSync(
        summaryPath,
        JSON.stringify(
          {
            mode,
            startedAt: runStartedAt,
            finishedAt: new Date().toISOString(),
            fixtureUrl,
            total: summaries.length,
            passed,
            failed: summaries.length - passed,
            timedOut,
            tasks: summaries,
          },
          null,
          2,
        ),
      );
      console.log(`Summary written: ${summaryPath}`);
    } catch (err) {
      console.error('Failed to write summary.json:', err);
    }

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
