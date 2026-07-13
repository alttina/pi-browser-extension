interface ToolResult {
  result: unknown;
  elapsedMs: number;
}

function highlight(selector: string) {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return;
  const computedStyle = window.getComputedStyle(el);
  const previousOutline = computedStyle.outline;
  const previousOutlineOffset = computedStyle.outlineOffset;
  el.style.outline = '2px solid #EB0028';
  el.style.outlineOffset = '2px';
  setTimeout(() => {
    el.style.outline = previousOutline;
    el.style.outlineOffset = previousOutlineOffset;
  }, 1200);
}

async function scrollTool(args: Record<string, unknown>): Promise<ToolResult> {
  const { direction, selector } = args as { direction?: string; selector?: string };
  const start = performance.now();
  let scrolled = false;
  if (selector) {
    const el = document.querySelector(selector);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrolled = true;
    }
  } else if (direction === 'bottom') {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    scrolled = true;
  } else if (direction === 'top') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    scrolled = true;
  }
  await new Promise((r) => setTimeout(r, 300));
  return { result: { scrolled }, elapsedMs: Math.round(performance.now() - start) };
}

async function clickTool(args: Record<string, unknown>): Promise<ToolResult> {
  const { selector } = args as { selector: string };
  const start = performance.now();
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) throw new Error(`Element not found: ${selector}`);
  highlight(selector);
  await new Promise((r) => setTimeout(r, 200));
  el.click();
  return { result: { clicked: true }, elapsedMs: Math.round(performance.now() - start) };
}

async function screenshotTool(args: Record<string, unknown>): Promise<ToolResult> {
  const { fullPage } = args as { fullPage?: boolean };
  const start = performance.now();
  const dataUrl = await new Promise<string>((resolve) => {
    chrome.runtime.sendMessage({ type: 'capture_tab', fullPage: !!fullPage }, (response) => {
      resolve(response?.screenshot || '');
    });
  });
  return { result: { screenshot: dataUrl }, elapsedMs: Math.round(performance.now() - start) };
}

function getSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    .filter((c) => !c.startsWith('pi-'))
    .join('.');
  return classes ? `${tag}.${classes}` : tag;
}

async function typeTool(args: Record<string, unknown>): Promise<ToolResult> {
  const { selector, text, submit } = args as { selector: string; text: string; submit?: boolean };
  const start = performance.now();
  const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) throw new Error(`Element not found: ${selector}`);
  el.focus();
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  if (submit) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 100));
  return { result: { typed: true }, elapsedMs: Math.round(performance.now() - start) };
}

async function navigateTool(args: Record<string, unknown>): Promise<ToolResult> {
  const { url } = args as { url: string };
  const start = performance.now();
  window.location.href = url;
  return { result: { navigated: url }, elapsedMs: Math.round(performance.now() - start) };
}

async function getTextTool(args: Record<string, unknown>): Promise<ToolResult> {
  const { selector } = args as { selector?: string };
  const start = performance.now();
  if (selector) {
    const el = document.querySelector(selector);
    return { result: { text: el?.textContent?.trim() ?? '' }, elapsedMs: Math.round(performance.now() - start) };
  }
  return { result: { text: document.body.innerText?.trim() ?? '' }, elapsedMs: Math.round(performance.now() - start) };
}

async function findElementTool(args: Record<string, unknown>): Promise<ToolResult> {
  const { selector } = args as { description?: string; selector?: string };
  const start = performance.now();
  if (selector) {
    const el = document.querySelector(selector);
    return {
      result: { found: !!el, selector, text: el?.textContent?.trim().slice(0, 200) },
      elapsedMs: Math.round(performance.now() - start),
    };
  }
  const candidates = Array.from(document.querySelectorAll('button, a, input, textarea, select'))
    .slice(0, 10)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      selector: getSelector(el),
      text: el.textContent?.trim().slice(0, 80) || (el as HTMLInputElement).value || '',
    }));
  return { result: { candidates }, elapsedMs: Math.round(performance.now() - start) };
}

const handlers: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
  browser_scroll: scrollTool,
  browser_click: clickTool,
  browser_screenshot: screenshotTool,
  browser_type: typeTool,
  browser_navigate: navigateTool,
  browser_get_text: getTextTool,
  browser_find_element: findElementTool,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'tool_call') {
    const handler = handlers[msg.name];
    if (!handler) {
      sendResponse({ type: 'error', message: `Unknown tool: ${msg.name}` });
      return true;
    }
    handler(msg.args)
      .then(({ result, elapsedMs }) => {
        sendResponse({ type: 'tool_result', id: msg.id, result, elapsedMs });
      })
      .catch((err) => {
        sendResponse({ type: 'error', message: err.message });
      });
    return true;
  }
  return false;
});
