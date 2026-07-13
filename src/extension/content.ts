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

const handlers: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
  browser_scroll: scrollTool,
  browser_click: clickTool,
  browser_screenshot: screenshotTool,
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
