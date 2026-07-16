interface ToolResult {
  result: unknown;
  elapsedMs: number;
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '\\"');
}

function getSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const productId = el.getAttribute('data-product-id') || el.closest('[data-product-id]')?.getAttribute('data-product-id');
  if (productId) {
    const tag = el.tagName.toLowerCase();
    return `[data-product-id="${escapeAttr(productId)}"] ${tag}`;
  }
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList)
    .filter((c) => !c.startsWith('pi-'))
    .join('.');
  return classes ? `${tag}.${classes}` : tag;
}

function elementText(el: Element): string {
  return (
    el.textContent?.trim() ||
    (el as HTMLInputElement).placeholder?.trim() ||
    (el as HTMLInputElement).value?.trim() ||
    el.getAttribute('aria-label')?.trim() ||
    ''
  );
}

/**
 * Detect Playwright-only pseudo-classes (:has-text, :nth-match, :hasText)
 * that browsers do not implement. Agents keep reaching for them despite the
 * system-prompt ban, so we return a hard, actionable error here instead of
 * letting the click fall through to a generic "Element not found".
 * `:contains(...)` is intentionally NOT rejected — resolveElement's fallback
 * salvages that syntax by extracting the text and doing a real DOM search.
 */
const PLAYWRIGHT_ONLY_PSEUDO = /:(has-text|hasText|nth-match)\s*\(/i;

function rejectPlaywrightPseudo(selector: string): void {
  const match = selector.match(PLAYWRIGHT_ONLY_PSEUDO);
  if (!match) return;
  const pseudo = match[0].replace(/\s*\($/, '');
  throw new Error(
    `Selector "${selector}" uses ${pseudo}, a Playwright-only pseudo-class that browsers do not implement. ` +
      `document.querySelector cannot match this and never will. Do not retry with a variant. ` +
      `Call browser_find_element with a natural-language description of the target ` +
      `(for example: "Log in button in the header", "Add to cart button for USB-C Hub").`,
  );
}

function containsText(el: Element, query: string): boolean {
  return elementText(el).toLowerCase().includes(query.toLowerCase());
}

function findElementsByText(query: string, tagHint?: string): Element[] {
  const selector = tagHint ? tagHint : 'button, a, input, textarea, select, [role="button"], [role="link"]';
  const candidates = Array.from(document.querySelectorAll(selector));
  const direct = candidates.filter((el) => containsText(el, query));
  if (direct.length > 0) return direct;
  // Also search within ancestor containers for interactive children.
  const containers = Array.from(document.querySelectorAll('div, article, section, li'));
  return containers
    .filter((el) => elementText(el).toLowerCase().includes(query.toLowerCase()))
    .flatMap((el) => Array.from(el.querySelectorAll('button, a, [role="button"], input, select, textarea')))
    .slice(0, 5);
}

function parseContainsClauses(selector: string): string[] {
  const matches: string[] = [];
  const regex = /:contains\((['"])(.*?)\1\)/g;
  let m;
  while ((m = regex.exec(selector)) !== null) {
    matches.push(m[2]);
  }
  return matches;
}

function resolveElement(selector: string, roleHint?: string): HTMLElement | null {
  try {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el) return el;
  } catch {
    // Invalid selector; fall through to text search.
  }
  const containsClauses = parseContainsClauses(selector);
  if (containsClauses.length > 0) {
    // The last :contains clause usually describes the target element.
    const targetText = containsClauses[containsClauses.length - 1];
    const contextTexts = containsClauses.slice(0, -1);

    // Determine a target tag hint from the substring just before the last :contains.
    const lastIndex = selector.lastIndexOf(`:contains(`);
    const beforeLast = selector.slice(0, lastIndex).trim();
    const tagMatch = beforeLast.match(/([a-z*]+)$/i);
    const tagHint = tagMatch && tagMatch[1] !== '*' ? tagMatch[1] : (roleHint || undefined);

    let matches = findElementsByText(targetText, tagHint);
    if (matches.length === 0) {
      matches = findElementsByText(targetText);
    }
    if (contextTexts.length > 0) {
      matches = matches.filter((el) =>
        contextTexts.every((ctx) =>
          el.closest('div, article, section, li, .product-card')?.textContent?.toLowerCase().includes(ctx.toLowerCase())
        )
      );
    }
    if (matches.length > 0) return matches[0] as HTMLElement;
  }
  // Treat the whole string as a natural-language description.
  const matches = findElementsByText(selector);
  if (matches.length > 0) return matches[0] as HTMLElement;
  return null;
}

function highlight(el: Element) {
  const htmlEl = el as HTMLElement;
  const computedStyle = window.getComputedStyle(htmlEl);
  const previousOutline = computedStyle.outline;
  const previousOutlineOffset = computedStyle.outlineOffset;
  htmlEl.style.outline = '2px solid #EB0028';
  htmlEl.style.outlineOffset = '2px';
  setTimeout(() => {
    htmlEl.style.outline = previousOutline;
    htmlEl.style.outlineOffset = previousOutlineOffset;
  }, 1200);
}

async function scrollTool(args: Record<string, unknown>): Promise<ToolResult> {
  const { direction, selector } = args as { direction?: string; selector?: string };
  const start = performance.now();
  let scrolled = false;
  if (selector) {
    const el = resolveElement(selector);
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
  rejectPlaywrightPseudo(selector);
  const start = performance.now();
  const el = resolveElement(selector, 'button');
  if (!el) throw new Error(`Element not found: ${selector}`);
  highlight(el);
  await new Promise((r) => setTimeout(r, 200));
  const disabled = (el as HTMLButtonElement).disabled ?? false;
  el.click();
  return { result: { clicked: true, disabled }, elapsedMs: Math.round(performance.now() - start) };
}

async function screenshotTool(args: Record<string, unknown>): Promise<ToolResult> {
  const { fullPage } = args as { fullPage?: boolean };
  const start = performance.now();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'capture_tab', fullPage: !!fullPage }, (response) => {
      const lastError = chrome.runtime.lastError?.message;
      if (lastError) {
        reject(new Error(`capture_tab failed: ${lastError}`));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response?.screenshot || '');
    });
  });
  return { result: { screenshot: dataUrl }, elapsedMs: Math.round(performance.now() - start) };
}

async function typeTool(args: Record<string, unknown>): Promise<ToolResult> {
  const { selector, text, submit } = args as { selector: string; text: string; submit?: boolean };
  rejectPlaywrightPseudo(selector);
  const start = performance.now();
  const el = resolveElement(selector) as HTMLInputElement | HTMLTextAreaElement | null;
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
    const el = resolveElement(selector);
    return { result: { text: el?.textContent?.trim() ?? '' }, elapsedMs: Math.round(performance.now() - start) };
  }
  return { result: { text: document.body.innerText?.trim() ?? '' }, elapsedMs: Math.round(performance.now() - start) };
}

async function findElementTool(args: Record<string, unknown>): Promise<ToolResult> {
  const { description, selector } = args as { description?: string; selector?: string };
  const start = performance.now();
  if (selector && !description) {
    const el = resolveElement(selector);
    return {
      result: { found: !!el, selector, text: el?.textContent?.trim().slice(0, 200) },
      elapsedMs: Math.round(performance.now() - start),
    };
  }
  const query = (description || selector || '').trim();
  if (query) {
    const matches = findElementsByText(query);
    if (matches.length === 1) {
      const el = matches[0];
      return {
        result: { found: true, selector: getSelector(el), text: elementText(el) },
        elapsedMs: Math.round(performance.now() - start),
      };
    }
    if (matches.length > 1) {
      return {
        result: {
          found: true,
          multiple: true,
          candidates: matches.slice(0, 5).map((el) => ({
            selector: getSelector(el),
            text: elementText(el),
          })),
        },
        elapsedMs: Math.round(performance.now() - start),
      };
    }
  }
  const candidates = Array.from(document.querySelectorAll('button, a, input, textarea, select'))
    .slice(0, 10)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      selector: getSelector(el),
      text: elementText(el),
    }));
  return { result: { found: false, candidates }, elapsedMs: Math.round(performance.now() - start) };
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

function injectSidePanelTrigger() {
  if (document.getElementById('pi-browser-agent-trigger')) return;
  const btn = document.createElement('button');
  btn.id = 'pi-browser-agent-trigger';
  btn.setAttribute('aria-hidden', 'true');
  btn.setAttribute('data-testid', 'pi-open-side-panel');
  // Positioned in-viewport but visually hidden so Playwright can click it as a real user gesture.
  btn.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:auto;z-index:2147483647;border:none;padding:0;margin:0;';
  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open_side_panel' });
  });
  document.body.appendChild(btn);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectSidePanelTrigger);
} else {
  injectSidePanelTrigger();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'tool_call' && msg.ui !== true) {
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
        sendResponse({ type: 'tool_result', id: msg.id, result: { error: err.message }, elapsedMs: 0 });
      });
    return true;
  }
  return false;
});
