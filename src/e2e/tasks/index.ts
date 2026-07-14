import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __resetFixtureState(): void;
  }
}

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
  requiredTools?: string[];
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

async function getTasks(page: Page): Promise<{ id: string; title: string; status: string; priority: string }[]> {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('taskflow:tasks') || '[]');
    } catch {
      return [];
    }
  });
}

async function getPosts(page: Page): Promise<{ id: string; title: string; category: string; author: string; body: string }[]> {
  return page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('devforum:posts') || '[]');
    } catch {
      return [];
    }
  });
}

export const TASKS: Task[] = [
  {
    id: 'search-add-to-cart',
    intent: 'Type "wireless headphones" into #search-input, then click #add-to-cart-p1.',
    startUrl: '/onestopshop/#/products',
    maxDurationMs: 45000,
    requiredTools: ['browser_type', 'browser_click'],
    async evaluate(page) {
      const cart = await getCart(page);
      const ok = cart.length === 1 && cart[0].productId === 'p1' && cart[0].quantity === 1;
      return { success: ok, reason: ok ? undefined : `cart=${JSON.stringify(cart)}` };
    },
  },
  {
    id: 'cheapest-in-category',
    intent: 'Type "audio" into #category-filter, type "price-asc" into #sort-order, then click #add-to-cart-p1.',
    startUrl: '/onestopshop/#/products',
    maxDurationMs: 45000,
    requiredTools: ['browser_type', 'browser_click'],
    async evaluate(page) {
      const cart = await getCart(page);
      const ok = cart.length === 1 && cart[0].productId === 'p1' && cart[0].quantity === 1;
      return { success: ok, reason: ok ? undefined : `cart=${JSON.stringify(cart)}` };
    },
  },
  {
    id: 'complete-checkout',
    intent: 'Click #add-to-cart-p3, click the Cart link, click #checkout-btn, type "Test User" into #full-name, type "123 Test St" into #address, type "4111 1111 1111 1111" into #card, click #captcha-checkbox, and click the Place order button.',
    startUrl: '/onestopshop/#/products',
    maxDurationMs: 90000,
    requiredTools: ['browser_click', 'browser_type'],
    async evaluate(page) {
      const orders = await getOrders(page);
      const cart = await getCart(page);
      const ok = orders.length === 1 && cart.length === 0;
      return { success: ok, reason: ok ? undefined : `orders=${orders.length}, cart=${JSON.stringify(cart)}` };
    },
  },
  {
    id: 'out-of-stock-recovery',
    intent: 'Click #add-to-cart-p5 (it is disabled/out of stock), then click #add-to-cart-p4.',
    startUrl: '/onestopshop/#/products',
    maxDurationMs: 45000,
    requiredTools: ['browser_click'],
    async evaluate(page) {
      const cart = await getCart(page);
      const hasWebcam = cart.some((item) => item.productId === 'p4');
      const hasMonitorArm = cart.some((item) => item.productId === 'p5');
      const ok = hasWebcam && !hasMonitorArm;
      return { success: ok, reason: ok ? undefined : `cart=${JSON.stringify(cart)}` };
    },
  },
  {
    id: 'taskflow-create-task',
    intent: 'Click #new-task-btn, type "Write E2E tests" into #task-title, type "Cover new fixture sites" into #task-description, and click #save-task-btn.',
    startUrl: '/taskflow/#/board',
    maxDurationMs: 45000,
    requiredTools: ['browser_click', 'browser_type'],
    async evaluate(page) {
      const tasks = await getTasks(page);
      const created = tasks.find((t) => t.title === 'Write E2E tests');
      const ok = !!created && created.status === 'todo';
      return { success: ok, reason: ok ? undefined : `tasks=${JSON.stringify(tasks)}` };
    },
  },
  {
    id: 'taskflow-edit-status',
    intent: 'Click #status-done and click #save-task-btn.',
    startUrl: '/taskflow/#/task/t2/edit',
    maxDurationMs: 45000,
    requiredTools: ['browser_click'],
    async evaluate(page) {
      const tasks = await getTasks(page);
      const task = tasks.find((t) => t.id === 't2');
      const ok = task?.status === 'done';
      return { success: ok, reason: ok ? undefined : `tasks=${JSON.stringify(tasks)}` };
    },
  },
  {
    id: 'devforum-search-open',
    intent: 'Type "async" into #search-input, click #post-link-post-2.',
    startUrl: '/devforum/#/',
    maxDurationMs: 45000,
    requiredTools: ['browser_type', 'browser_click'],
    async evaluate(page) {
      const url = page.url();
      const ok = url.includes('/post/post-2');
      return { success: ok, reason: ok ? undefined : `url=${url}` };
    },
  },
  {
    id: 'devforum-create-post',
    intent: 'Click #new-post-btn, type "tester" into #login-username, type "password" into #login-password, click #login-submit, type "Best testing library" into #post-title, type "What is your favorite testing library?" into #post-body, and click #submit-post.',
    startUrl: '/devforum/#/',
    maxDurationMs: 60000,
    requiredTools: ['browser_click', 'browser_type'],
    async evaluate(page) {
      const posts = await getPosts(page);
      const created = posts.find((p) => p.title === 'Best testing library');
      const ok = !!created && created.category === 'javascript' && created.author === 'tester';
      return { success: ok, reason: ok ? undefined : `posts=${JSON.stringify(posts)}` };
    },
  },
];
