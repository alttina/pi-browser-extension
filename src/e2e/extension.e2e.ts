import { launch, type Browser, type Target } from 'puppeteer-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { findChromium } from './find-chromium.js';
import { setupHost, EXTENSION_ID } from './setup-host.js';

const EXTENSION_PATH = resolve('dist/extension');
const TEST_HTML = '<!DOCTYPE html><html><head><title>Pi Agent E2E</title></head><body><h1>Pi Agent E2E</h1><button id="load-more">Load more</button></body></html>';

function resolve(p: string): string {
  return new URL(`file://${process.cwd()}/${p}`).pathname;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function startTestServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(TEST_HTML);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      assert(addr && typeof addr === 'object', 'server address is object');
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
  });
}

async function run() {
  const chromium = findChromium();
  if (!chromium) {
    console.log('SKIP: no Chromium/Chrome for Testing binary found');
    process.exit(0);
  }
  console.log(`Using Chromium: ${chromium}`);

  const { server, url: testUrl } = await startTestServer();
  console.log(`Test server: ${testUrl}`);

  const profileDir = mkdtempSync(join(tmpdir(), 'pi-browser-agent-e2e-'));
  const hostSetup = setupHost(profileDir);
  console.log(`Profile: ${profileDir}`);

  let browser: Browser | null = null;
  try {
    browser = await launch({
      headless: true,
      executablePath: chromium,
      userDataDir: profileDir,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    await new Promise((r) => setTimeout(r, 2000));

    const targets: Target[] = browser.targets();
    const swTarget = targets.find(
      (t: Target) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${EXTENSION_ID}/`)
    );
    assert(swTarget, 'service worker loaded');
    console.log('Service worker:', swTarget.url());

    // Content script test
    const page = await browser.newPage();
    page.on('console', (c: any) => console.log('[content console]', c.text()));
    page.on('pageerror', (err: any) => console.log('[content error]', err.message));
    await page.goto(testUrl);
    await new Promise((r) => setTimeout(r, 2000));

    const worker = await swTarget.worker();
    assert(worker, 'service worker has execution context');

    const contentResult = await worker.evaluate(async (expectedUrl: string) => {
      const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => chrome.tabs.query({}, resolve));
      const tab = tabs.find((t) => t.url === expectedUrl || t.url?.startsWith(expectedUrl));
      if (!tab?.id) return { ok: false, reason: 'tab not found', response: undefined };
      return await new Promise<{ ok: boolean; reason?: string; response?: unknown }>((resolve) => {
        chrome.tabs.sendMessage(
          tab.id!,
          { type: 'tool_call', name: 'browser_click', args: { selector: '#load-more' }, id: 'e2e-click' },
          (res) => {
            if (chrome.runtime.lastError) resolve({ ok: false, reason: chrome.runtime.lastError.message });
            else resolve({ ok: true, response: res });
          }
        );
      });
    }, testUrl);
    assert(contentResult.ok, `content script responded: ${contentResult.reason}`);
    console.log('Content script OK:', JSON.stringify(contentResult.response));

    // UI flow + native messaging end-to-end (single host via service-worker bridge)
    const sidePanelPage = await browser.newPage();
    await sidePanelPage.goto(`chrome-extension://${EXTENSION_ID}/sidepanel.html`);
    await new Promise((r) => setTimeout(r, 500));
    const hasInput = await sidePanelPage.evaluate(() => !!document.querySelector('#input'));
    const hasSend = await sidePanelPage.evaluate(() => !!document.querySelector('#sendBtn'));
    assert(hasInput, 'side panel has #input');
    assert(hasSend, 'side panel has #sendBtn');
    console.log('Side panel UI opened');

    await worker.evaluate(async (expectedUrl: string) => {
      const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => chrome.tabs.query({}, resolve));
      const targetTab = tabs.find((t) => t.url === expectedUrl || t.url?.startsWith(expectedUrl));
      (self as any).__piTabId = targetTab?.id;
      (self as any).__piReceived = [];
      const port = chrome.runtime.connectNative('com.pi.browser_agent');
      function forwardToTab(msg: any) {
        const tabId = (self as any).__piTabId;
        if (tabId) {
          chrome.tabs.sendMessage(tabId, msg, (res: any) => {
            if (res) port.postMessage(res);
          });
        }
      }
      port.onMessage.addListener((msg: any) => {
        (self as any).__piReceived.push(msg);
        if (msg.type === 'tool_call' && !msg.ui) {
          forwardToTab(msg);
        } else {
          chrome.runtime.sendMessage(msg).catch(() => {});
        }
      });
      chrome.runtime.onMessage.addListener((msg: any) => {
        if (msg.type === 'user' || msg.type === 'tool_result') port.postMessage(msg);
      });
    }, testUrl);

    await sidePanelPage.type('#input', 'click the load-more button');
    await sidePanelPage.click('#sendBtn');

    // Wait for the side panel to render the completion card (up to 20s).
    let nativeResult: { types: string[]; last: unknown[] } | null = null;
    for (let i = 0; i < 200; i++) {
      const hasCompletion = await sidePanelPage.evaluate(
        () => !!document.querySelector('.completion-summary')
      );
      nativeResult = await worker.evaluate(() => ({
        types: (self as any).__piReceived.map((m: any) => m.type),
        last: (self as any).__piReceived.slice(-10),
      }));
      if (hasCompletion && nativeResult.types.includes('done')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(nativeResult, 'native result captured');
    console.log('Native messaging received:', JSON.stringify(nativeResult.types), 'last:', JSON.stringify(nativeResult.last));

    const uiResult = await sidePanelPage.evaluate(() => {
      const chat = document.getElementById('chat') as HTMLDivElement;
      const toolNames = Array.from(chat.querySelectorAll('.tool-name')).map((el) => el.textContent);
      const completion = chat.querySelector('.completion-summary')?.textContent;
      const userBubbles = chat.querySelectorAll('.message.user').length;
      return { toolNames, completion, userBubbles };
    });
    assert(nativeResult.types.includes('tool_call'), 'received tool_call from native host');
    assert(nativeResult.types.includes('tool_result'), 'received tool_result from native host');
    assert(nativeResult.types.includes('done'), 'received done from native host');
    assert(uiResult.userBubbles >= 1, 'side panel rendered user message');
    assert(uiResult.toolNames.length > 0, 'side panel rendered at least one tool call');
    assert(uiResult.completion, 'side panel rendered completion card');
    console.log('Side panel UI flow OK:', JSON.stringify(uiResult));
    await sidePanelPage.close();

    await page.close();
    console.log('\nAll e2e assertions passed.');
  } finally {
    if (browser) await browser.close();
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
