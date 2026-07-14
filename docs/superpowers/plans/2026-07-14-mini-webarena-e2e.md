# Mini-WebArena E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing simplistic E2E test with a WebArena-style evaluation suite that runs realistic multi-step tasks on a local e-commerce fixture site.

**Architecture:** A Playwright runner loads the extension, serves a local `OneStopShop` SPA, and iterates over templated tasks. Each task sends a natural-language intent through the extension side panel, waits for the agent to settle, then evaluates success by inspecting final page state (cart/order in `localStorage`) rather than action sequences.

**Tech Stack:** TypeScript, Playwright, Chrome Extension Manifest V3, `node:http` static server, `localStorage` for fixture state.

## Global Constraints

- All fixture files live under `src/e2e/fixtures/onestopshop/`.
- The fixture site must be fully self-hosted; no external network dependencies.
- Tasks must be evaluated by final page state, not expected action sequence.
- The side panel must be opened via `chrome.sidePanel.open()` on the target tab.
- Existing unit tests (`npm test`) must continue to pass.

---

## Task 1: Create the OneStopShop Fixture Site

**Files:**
- Create: `src/e2e/fixtures/onestopshop/index.html`
- Create: `src/e2e/fixtures/onestopshop/styles.css`
- Create: `src/e2e/fixtures/onestopshop/app.js`

**Interfaces:**
- Produces: `window.__resetFixtureState()` callable from Playwright to reset cart and orders.
- Produces: `localStorage` keys `onestopshop:cart` and `onestopshop:orders`.
- Produces: Hash routes `#/`, `#/products`, `#/product/:id`, `#/cart`, `#/checkout`, `#/order/:id`.

- [ ] **Step 1: Write `src/e2e/fixtures/onestopshop/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OneStopShop</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-header">
    <a href="#/" class="logo">OneStopShop</a>
    <nav>
      <a href="#/products">Products</a>
      <a href="#/cart">Cart (<span id="cart-count">0</span>)</a>
    </nav>
  </header>

  <main id="app">
    <section id="home-view" class="view">
      <h1>Welcome to OneStopShop</h1>
      <p>Quality electronics for your workspace.</p>
      <a href="#/products" class="btn">Browse products</a>
    </section>

    <section id="products-view" class="view hidden">
      <div class="toolbar">
        <input type="search" id="search-input" placeholder="Search products...">
        <select id="category-filter">
          <option value="">All categories</option>
          <option value="audio">Audio</option>
          <option value="office">Office</option>
          <option value="accessories">Accessories</option>
        </select>
        <select id="sort-order">
          <option value="default">Sort by</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
        </select>
      </div>
      <div id="product-grid" class="product-grid"></div>
    </section>

    <section id="product-view" class="view hidden">
      <div id="product-detail"></div>
    </section>

    <section id="cart-view" class="view hidden">
      <h1>Shopping Cart</h1>
      <div id="cart-items"></div>
      <div id="cart-empty" class="hidden">Your cart is empty.</div>
      <div class="cart-actions">
        <a href="#/products" class="btn btn-secondary">Continue shopping</a>
        <button id="checkout-btn" class="btn btn-primary">Proceed to checkout</button>
      </div>
    </section>

    <section id="checkout-view" class="view hidden">
      <h1>Checkout</h1>
      <form id="checkout-form">
        <div class="form-group">
          <label for="full-name">Full name</label>
          <input type="text" id="full-name" required>
        </div>
        <div class="form-group">
          <label for="address">Shipping address</label>
          <input type="text" id="address" required>
        </div>
        <div class="form-group">
          <label for="card">Card number</label>
          <input type="text" id="card" required>
        </div>
        <button type="submit" class="btn btn-primary">Place order</button>
      </form>
    </section>

    <section id="order-view" class="view hidden">
      <h1>Order Confirmation</h1>
      <div id="order-detail"></div>
    </section>
  </main>

  <div id="toast" class="toast hidden"></div>

  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `src/e2e/fixtures/onestopshop/styles.css`**

```css
:root {
  --bg: #ffffff;
  --surface: #f8f9fa;
  --border: #dadce0;
  --text: #202124;
  --text-secondary: #5f6368;
  --accent: #eb0028;
  --radius: 8px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
}

.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.logo {
  font-weight: 700;
  font-size: 18px;
  color: var(--text);
  text-decoration: none;
}

nav { display: flex; gap: 16px; }
nav a { color: var(--text-secondary); text-decoration: none; }
nav a:hover { color: var(--text); }

main { padding: 24px; max-width: 960px; margin: 0 auto; }

.view.hidden { display: none; }

.btn {
  display: inline-block;
  padding: 8px 14px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  text-decoration: none;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.btn-secondary { background: var(--surface); }

.toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.toolbar input,
.toolbar select {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
}

.toolbar input { flex: 1; min-width: 180px; }

.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.product-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  background: var(--surface);
}

.product-card h3 { margin: 0 0 6px; font-size: 15px; }
.product-card .price { font-weight: 700; margin-bottom: 10px; }
.product-card .stock { font-size: 12px; color: var(--text-secondary); margin-bottom: 10px; }
.product-card a,
.product-card button { width: 100%; }

.product-detail { display: grid; gap: 16px; }
.product-detail h1 { margin: 0; }

.form-group { margin-bottom: 12px; }
.form-group label { display: block; font-weight: 600; margin-bottom: 4px; }
.form-group input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.cart-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}

.cart-actions {
  display: flex;
  justify-content: space-between;
  margin-top: 16px;
}

.toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 16px;
  background: var(--text);
  color: white;
  border-radius: var(--radius);
  opacity: 0;
  transition: opacity 0.2s;
}
.toast.visible { opacity: 1; }
.toast.hidden { display: none; }
```

- [ ] **Step 3: Write `src/e2e/fixtures/onestopshop/app.js`**

```javascript
const PRODUCTS = [
  { id: 'p1', name: 'Wireless Headphones', category: 'audio', price: 129.00, stock: 10 },
  { id: 'p2', name: 'Mechanical Keyboard', category: 'office', price: 89.00, stock: 5 },
  { id: 'p3', name: 'USB-C Hub', category: 'accessories', price: 49.00, stock: 20 },
  { id: 'p4', name: 'Webcam 4K', category: 'audio', price: 159.00, stock: 8 },
  { id: 'p5', name: 'Monitor Arm', category: 'office', price: 79.00, stock: 0 },
];

const CART_KEY = 'onestopshop:cart';
const ORDERS_KEY = 'onestopshop:orders';

function loadCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
  catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
}

function loadOrders() {
  try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]'); }
  catch { return []; }
}

function saveOrders(orders) {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
}

function updateCartCount() {
  const cart = loadCart();
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const el = document.getElementById('cart-count');
  if (el) el.textContent = String(count);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.classList.add('hidden'), 200);
  }, 2000);
}

function switchView(viewId) {
  document.querySelectorAll('.view').forEach((el) => el.classList.add('hidden'));
  const view = document.getElementById(viewId);
  if (view) view.classList.remove('hidden');
  window.scrollTo({ top: 0 });
}

function renderProducts() {
  const grid = document.getElementById('product-grid');
  if (!grid) return;

  const search = (document.getElementById('search-input')?.value || '').toLowerCase();
  const category = document.getElementById('category-filter')?.value || '';
  const sort = document.getElementById('sort-order')?.value || 'default';

  let filtered = PRODUCTS.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(search);
    const matchesCategory = !category || p.category === category;
    return matchesSearch && matchesCategory;
  });

  if (sort === 'price-asc') filtered.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') filtered.sort((a, b) => b.price - a.price);

  grid.innerHTML = filtered.map((p) => `
    <div class="product-card" data-product-id="${p.id}">
      <h3>${p.name}</h3>
      <div class="price">$${p.price.toFixed(2)}</div>
      <div class="stock">${p.stock > 0 ? 'In stock' : 'Out of stock'}</div>
      <a href="#/product/${p.id}" class="btn">View details</a>
    </div>
  `).join('');
}

function renderProductDetail(productId) {
  const container = document.getElementById('product-detail');
  const product = PRODUCTS.find((p) => p.id === productId);
  if (!container || !product) return;

  container.innerHTML = `
    <h1>${product.name}</h1>
    <div class="price">$${product.price.toFixed(2)}</div>
    <div class="stock">${product.stock > 0 ? 'In stock' : 'Out of stock'}</div>
    <p>Category: ${product.category}</p>
    <button id="add-to-cart-btn" class="btn btn-primary" ${product.stock === 0 ? 'disabled' : ''}>
      ${product.stock > 0 ? 'Add to cart' : 'Out of stock'}
    </button>
    <a href="#/products" class="btn btn-secondary">Back to products</a>
  `;

  const btn = document.getElementById('add-to-cart-btn');
  if (btn && product.stock > 0) {
    btn.addEventListener('click', () => {
      const cart = loadCart();
      const existing = cart.find((item) => item.productId === product.id);
      if (existing) existing.quantity += 1;
      else cart.push({ productId: product.id, quantity: 1 });
      saveCart(cart);
      showToast(`${product.name} added to cart`);
    });
  }
}

function renderCart() {
  const container = document.getElementById('cart-items');
  const empty = document.getElementById('cart-empty');
  const checkoutBtn = document.getElementById('checkout-btn');
  if (!container || !empty) return;

  const cart = loadCart();
  if (cart.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }

  empty.classList.add('hidden');
  if (checkoutBtn) checkoutBtn.disabled = false;

  container.innerHTML = cart.map((item) => {
    const product = PRODUCTS.find((p) => p.id === item.productId);
    if (!product) return '';
    return `
      <div class="cart-item" data-product-id="${product.id}">
        <div>
          <strong>${product.name}</strong>
          <div>Qty: ${item.quantity}</div>
        </div>
        <div>$${(product.price * item.quantity).toFixed(2)}</div>
      </div>
    `;
  }).join('');
}

function renderOrder(orderId) {
  const container = document.getElementById('order-detail');
  const orders = loadOrders();
  const order = orders.find((o) => o.orderId === orderId);
  if (!container || !order) return;

  container.innerHTML = `
    <p>Thank you, <strong>${order.shipping.name}</strong>!</p>
    <p>Order number: <strong>${order.orderId}</strong></p>
    <p>Total: $${order.total.toFixed(2)}</p>
    <p>Status: ${order.status}</p>
    <a href="#/products" class="btn">Continue shopping</a>
  `;
}

function handleCheckoutSubmit(e) {
  e.preventDefault();
  const cart = loadCart();
  if (cart.length === 0) return;

  const name = document.getElementById('full-name').value;
  const address = document.getElementById('address').value;
  const card = document.getElementById('card').value;

  const total = cart.reduce((sum, item) => {
    const product = PRODUCTS.find((p) => p.id === item.productId);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);

  const orderId = 'ORD-' + Math.random().toString(36).slice(2, 10).toUpperCase();
  const orders = loadOrders();
  orders.push({ orderId, items: cart, shipping: { name, address, card }, total, status: 'confirmed' });
  saveOrders(orders);
  saveCart([]);
  window.location.hash = `#/order/${orderId}`;
}

function route() {
  const hash = window.location.hash || '#/';
  const parts = hash.replace('#/', '').split('/').filter(Boolean);

  if (parts.length === 0) {
    switchView('home-view');
  } else if (parts[0] === 'products') {
    switchView('products-view');
    renderProducts();
  } else if (parts[0] === 'product' && parts[1]) {
    switchView('product-view');
    renderProductDetail(parts[1]);
  } else if (parts[0] === 'cart') {
    switchView('cart-view');
    renderCart();
  } else if (parts[0] === 'checkout') {
    switchView('checkout-view');
  } else if (parts[0] === 'order' && parts[1]) {
    switchView('order-view');
    renderOrder(parts[1]);
  } else {
    switchView('home-view');
  }
}

function init() {
  updateCartCount();
  window.addEventListener('hashchange', route);

  document.getElementById('search-input')?.addEventListener('input', renderProducts);
  document.getElementById('category-filter')?.addEventListener('change', renderProducts);
  document.getElementById('sort-order')?.addEventListener('change', renderProducts);
  document.getElementById('checkout-form')?.addEventListener('submit', handleCheckoutSubmit);
  document.getElementById('checkout-btn')?.addEventListener('click', () => {
    window.location.hash = '#/checkout';
  });

  route();
}

window.__resetFixtureState = function () {
  localStorage.removeItem(CART_KEY);
  localStorage.removeItem(ORDERS_KEY);
  updateCartCount();
  if (window.location.hash.startsWith('#/cart') || window.location.hash.startsWith('#/checkout') || window.location.hash.startsWith('#/order')) {
    window.location.hash = '#/';
  } else {
    route();
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

- [ ] **Step 4: Verify fixture site manually**

Run a local server and visually check all routes:

```bash
npx serve src/e2e/fixtures/onestopshop -p 8080
# Open http://localhost:8080 and navigate through products, cart, checkout.
```

Expected: Products render, search/filter/sort work, add-to-cart updates cart count, checkout creates an order.

---

## Task 2: Define the Task Suite

**Files:**
- Create: `src/e2e/tasks/index.ts`

**Interfaces:**
- Consumes: Playwright `Page` type.
- Produces: `Task` interface and exported `TASKS` array.
- Produces: `ChatState` type describing captured side-panel messages.

- [ ] **Step 1: Write `src/e2e/tasks/index.ts`**

```typescript
import type { Page } from '@playwright/test';

export interface ChatState {
  userMessages: string[];
  assistantMessages: string[];
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
  completion?: string;
}

export interface TaskResult {
  success: boolean;
  reason?: string;
}

export interface Task {
  id: string;
  intent: string;
  startUrl: string;
  maxDurationMs: number;
  evaluate: (page: Page, chat: ChatState) => Promise<TaskResult>;
}

async function getCart(page: Page): Promise<{ productId: string; quantity: number }[]> {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('onestopshop:cart') || '[]');
    } catch {
      return [];
    }
  });
}

async function getOrders(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('onestopshop:orders') || '[]');
    } catch {
      return [];
    }
  });
}

export const TASKS: Task[] = [
  {
    id: 'search-add-to-cart',
    intent: 'Search for wireless headphones and add them to your cart.',
    startUrl: '#/products',
    maxDurationMs: 30000,
    async evaluate(page) {
      const cart = await getCart(page);
      const ok = cart.length === 1 && cart[0].productId === 'p1' && cart[0].quantity === 1;
      return { success: ok, reason: ok ? undefined : `cart=${JSON.stringify(cart)}` };
    },
  },
  {
    id: 'cheapest-in-category',
    intent: 'Find the cheapest product in the audio category and add it to your cart.',
    startUrl: '#/products',
    maxDurationMs: 30000,
    async evaluate(page) {
      const cart = await getCart(page);
      const ok = cart.length === 1 && cart[0].productId === 'p1' && cart[0].quantity === 1;
      return { success: ok, reason: ok ? undefined : `cart=${JSON.stringify(cart)}` };
    },
  },
  {
    id: 'complete-checkout',
    intent: 'Add one USB-C Hub to your cart and complete checkout using name "Test User", address "123 Test St", card "4111 1111 1111 1111".',
    startUrl: '#/products',
    maxDurationMs: 45000,
    async evaluate(page) {
      const orders = await getOrders(page);
      const cart = await getCart(page);
      const ok = orders.length === 1 && cart.length === 0;
      return { success: ok, reason: ok ? undefined : `orders=${orders.length}, cart=${JSON.stringify(cart)}` };
    },
  },
  {
    id: 'out-of-stock-recovery',
    intent: 'Try to add the Monitor Arm to your cart. If it is out of stock, add the Webcam 4K instead.',
    startUrl: '#/products',
    maxDurationMs: 30000,
    async evaluate(page) {
      const cart = await getCart(page);
      const hasWebcam = cart.some((item) => item.productId === 'p4');
      const hasMonitorArm = cart.some((item) => item.productId === 'p5');
      const ok = hasWebcam && !hasMonitorArm;
      return { success: ok, reason: ok ? undefined : `cart=${JSON.stringify(cart)}` };
    },
  },
];
```

- [ ] **Step 2: Type-check task definitions**

```bash
npx tsc --noEmit src/e2e/tasks/index.ts
```

Expected: No TypeScript errors.

---

## Task 3: Create Evaluator Helpers

**Files:**
- Create: `src/e2e/evaluator.ts`

**Interfaces:**
- Consumes: `Task`, `ChatState`, `TaskResult` from `src/e2e/tasks/index.ts`.
- Consumes: Playwright `Page`.
- Produces: `captureChatState(page)` returning `Promise<ChatState>`.
- Produces: `runTask(runner, task)` orchestrating a single task.

- [ ] **Step 1: Write `src/e2e/evaluator.ts`**

```typescript
import type { Page } from '@playwright/test';
import type { ChatState, Task, TaskResult } from './tasks/index.js';

export async function captureChatState(sidePanelPage: Page): Promise<ChatState> {
  return sidePanelPage.evaluate(() => {
    const chat = document.getElementById('chat');
    if (!chat) return { userMessages: [], assistantMessages: [], toolCalls: [] };

    const userMessages = Array.from(chat.querySelectorAll('.message.user .bubble-text')).map(
      (el) => el.textContent || ''
    );
    const assistantMessages = Array.from(chat.querySelectorAll('.message.agent > .bubble > .bubble-text')).map(
      (el) => el.textContent || ''
    );
    const toolCalls = Array.from(chat.querySelectorAll('.agent-card')).map((card) => {
      const name = card.querySelector('.tool-name')?.textContent || '';
      const id = card.getAttribute('data-tool-id') || '';
      const args: Record<string, unknown> = {};
      card.querySelectorAll('.tool-param').forEach((row) => {
        const key = row.querySelector('.param-key')?.textContent || '';
        const value = row.querySelector('.param-value')?.textContent || '';
        if (key) {
          try { args[key] = JSON.parse(value); }
          catch { args[key] = value; }
        }
      });
      return { id, name, args };
    });
    const completion = chat.querySelector('.completion-summary')?.textContent || undefined;

    return { userMessages, assistantMessages, toolCalls, completion };
  });
}

export interface TaskRunner {
  targetPage: Page;
  sidePanelPage: Page;
  sendIntent(intent: string): Promise<void>;
  waitForCompletion(options: { timeoutMs: number }): Promise<boolean>;
}

export async function runTask(runner: TaskRunner, task: Task): Promise<{ result: TaskResult; chat: ChatState; durationMs: number }> {
  const start = Date.now();

  await runner.targetPage.evaluate(() => window.__resetFixtureState());
  await runner.targetPage.goto(`${runner.targetPage.url().split('#')[0]}${task.startUrl}`);

  await runner.sendIntent(task.intent);
  const completed = await runner.waitForCompletion({ timeoutMs: task.maxDurationMs });

  const chat = await captureChatState(runner.sidePanelPage);
  const durationMs = Date.now() - start;

  if (!completed) {
    return { result: { success: false, reason: `Timeout after ${durationMs}ms` }, chat, durationMs };
  }

  const result = await task.evaluate(runner.targetPage, chat);
  return { result, chat, durationMs };
}
```

- [ ] **Step 2: Type-check evaluator**

```bash
npx tsc --noEmit src/e2e/evaluator.ts
```

Expected: No TypeScript errors.

---

## Task 4: Rewrite the E2E Runner

**Files:**
- Modify: `src/e2e/extension.e2e.ts` (replace existing content)

**Interfaces:**
- Consumes: `TASKS` from `src/e2e/tasks/index.js`.
- Consumes: `captureChatState`, `runTask` from `src/e2e/evaluator.js`.
- Produces: Console test report and exit code.

- [ ] **Step 1: Replace `src/e2e/extension.e2e.ts`**

```typescript
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { setupHost, EXTENSION_ID } from './setup-host.js';
import { TASKS } from './tasks/index.js';
import { captureChatState, runTask, type TaskRunner } from './evaluator.js';

const EXTENSION_PATH = resolve('dist/extension');
const FIXTURE_ROOT = resolve('dist/e2e/fixtures/onestopshop');

function resolve(p: string): string {
  return new URL(`file://${process.cwd()}/${p}`).pathname;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function startFixtureServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const fs = require('node:fs');
      const path = require('node:path');
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      let filePath = path.join(FIXTURE_ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(FIXTURE_ROOT, 'index.html');
      }
      const ext = path.extname(filePath);
      const contentType =
        ext === '.css' ? 'text/css' :
        ext === '.js' ? 'application/javascript' :
        'text/html';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(fs.readFileSync(filePath));
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
    context.newPage(),
  ]);
  return worker;
}

async function openSidePanel(worker: Worker, targetUrl: string): Promise<void> {
  await worker.evaluate(async (expectedUrl: string) => {
    const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => chrome.tabs.query({}, resolve));
    const tab = tabs.find((t) => t.url === expectedUrl || t.url?.startsWith(expectedUrl));
    if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
  }, targetUrl);
}

async function run() {
  const { server, url: fixtureUrl } = await startFixtureServer();
  console.log(`Fixture server: ${fixtureUrl}`);

  const profileDir = mkdtempSync(join(tmpdir(), 'pi-browser-agent-e2e-'));
  const hostSetup = setupHost(profileDir);
  console.log(`Profile: ${profileDir}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
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

    // Connect native host once for all tasks.
    await worker.evaluate(() => {
      const port = chrome.runtime.connectNative('com.pi.browser_agent');
      (self as any).__piPort = port;
      (self as any).__piReceived = [];
      port.onMessage.addListener((msg: any) => {
        (self as any).__piReceived.push(msg);
        if (msg.type === 'tool_call' && !msg.ui) {
          const tabId = (self as any).__piTabId;
          if (tabId) {
            chrome.tabs.sendMessage(tabId, msg, (res: any) => {
              if (res) port.postMessage(res);
            });
          }
        } else {
          chrome.runtime.sendMessage(msg).catch(() => {});
        }
      });
      chrome.runtime.onMessage.addListener((msg: any) => {
        if (msg.type === 'user' || msg.type === 'tool_result') port.postMessage(msg);
      });
    });

    const targetPage: Page = await context.newPage();
    await targetPage.goto(fixtureUrl);

    // Track active tab for native host tool calls.
    await worker.evaluate(async (expectedUrl: string) => {
      const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => chrome.tabs.query({}, resolve));
      const tab = tabs.find((t) => t.url === expectedUrl || t.url?.startsWith(expectedUrl));
      (self as any).__piTabId = tab?.id;
    }, targetPage.url());

    await openSidePanel(worker, targetPage.url());

    // Playwright does not expose the side panel page directly; open it as a page as well for input.
    const sidePanelPage: Page = await context.newPage();
    await sidePanelPage.goto(`chrome-extension://${EXTENSION_ID}/sidepanel.html`);
    await sidePanelPage.waitForSelector('#input');
    await sidePanelPage.waitForSelector('#sendBtn');
    console.log('Side panel ready');

    const runner: TaskRunner = {
      targetPage,
      sidePanelPage,
      async sendIntent(intent: string) {
        await sidePanelPage.locator('#input').fill(intent);
        await sidePanelPage.locator('#sendBtn').click();
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
      const { result, durationMs } = await runTask(runner, task);
      results.push({ id: task.id, success: result.success, reason: result.reason, durationMs });
      const status = result.success ? 'PASS' : 'FAIL';
      console.log(`[${status}] ${task.id} (${durationMs}ms) ${result.reason ? '- ' + result.reason : ''}`);

      if (!result.success) {
        const ts = Date.now();
        await targetPage.screenshot({ path: `e2e-screenshots/${task.id}-page-${ts}.png` });
        await sidePanelPage.screenshot({ path: `e2e-screenshots/${task.id}-panel-${ts}.png` });
      }

      // Clear chat for next task by reloading side panel.
      await sidePanelPage.goto(`chrome-extension://${EXTENSION_ID}/sidepanel.html`);
      await sidePanelPage.waitForSelector('#input');
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
```

- [ ] **Step 2: Update `src/scripts/copy-assets.ts` to copy fixture files**

Read the current `src/scripts/copy-assets.ts` and add a copy step for `src/e2e/fixtures/onestopshop` to `dist/e2e/fixtures/onestopshop`.

Expected change: After the existing copy steps, add:

```typescript
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

function copyDir(src: string, dst: string) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = `${src}/${entry.name}`;
    const d = `${dst}/${entry.name}`;
    if (entry.isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

copyDir('src/e2e/fixtures/onestopshop', 'dist/e2e/fixtures/onestopshop');
```

- [ ] **Step 3: Build and run**

```bash
npm run build
npm run test:e2e
```

Expected: All 4 tasks pass. If any fail, inspect `e2e-screenshots/` and side-panel chat state.

---

## Task 5: Stabilization and Reporting Improvements

**Files:**
- Modify: `src/e2e/extension.e2e.ts`
- Modify: `src/e2e/evaluator.ts`

- [ ] **Step 1: Add richer console report**

In `src/e2e/extension.e2e.ts`, after each task print:
- Completion summary text from the agent.
- Tool-call trajectory (names only).

```typescript
const chat = await captureChatState(sidePanelPage);
console.log('  Completion:', chat.completion || '(none)');
console.log('  Tools:', chat.toolCalls.map((t) => t.name).join(' → '));
```

- [ ] **Step 2: Add trajectory success check**

In `src/e2e/tasks/index.ts`, for each task add an optional `requiredTools` array and update `evaluate` to verify the agent used at least one required tool when the task otherwise succeeded.

Example for `search-add-to-cart`:

```typescript
requiredTools: ['browser_click'],
evaluate: async (page, chat) => {
  const cart = await getCart(page);
  const stateOk = cart.length === 1 && cart[0].productId === 'p1';
  const usedTool = chat.toolCalls.some((t) => t.name === 'browser_click');
  return { success: stateOk && usedTool, reason: stateOk && !usedTool ? 'No click tool was used' : undefined };
},
```

- [ ] **Step 3: Re-run E2E after stabilization**

```bash
npm run test:e2e
```

Expected: All tasks pass with detailed reports.

---

## Self-Review

### Spec Coverage

| Spec Requirement | Implementing Task |
|------------------|-------------------|
| Self-hosted local fixture site | Task 1 |
| Natural-language task intents | Task 2 |
| Execution-based success checks | Task 2, Task 5 |
| Side panel opened via `chrome.sidePanel.open()` | Task 4 |
| Multi-step realistic tasks | Tasks 2, 4 |
| Tool-call trajectory capture | Task 3, Task 5 |
| CI-stable, no external sites | Task 1, Task 4 |

### Placeholder Scan

No TBD/TODO/fill-in-details remain. All code blocks are complete.

### Type Consistency

- `Task.evaluate` signature matches `runTask` usage: `(page: Page, chat: ChatState) => Promise<TaskResult>`.
- `captureChatState` returns `ChatState`, consumed by `runTask` and the runner.
- `TaskRunner` interface defines `sendIntent` and `waitForCompletion` used in `runTask`.

### Known Limitations

- The side panel is opened both through `chrome.sidePanel.open()` (realistic) and as a Playwright page (for input). This is necessary because Playwright cannot directly automate Chrome's side panel. The input page shares the same extension context and messaging, so it is functionally equivalent.
