import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __resetFixtureState(): void;
  }
}

export type TaskMode = 'natural' | 'smoke';

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
  /**
   * Two intent forms are provided for every task:
   * - `natural`: what a real user would say. The agent must plan, look at the
   *   page, and choose selectors on its own. This is the honest evaluation.
   * - `smoke`: prescriptive selector-level instructions used to verify the
   *   tool-execution pipeline without exercising planning. Handy when a
   *   fixture, tool implementation, or messaging path changes.
   */
  intents: { natural: string; smoke: string };
  startUrl: string;
  /**
   * Wall-clock budget in ms for the agent to reach a done state.
   *
   * Tiered by expected action count. Budgets are set generously so a
   * genuine, verifying agent can complete without being cut off mid-plan —
   * real users don't sit and watch, they fire an intent and come back later.
   *   - 120s simple:  1-3 concrete actions
   *   - 240s medium:  4-8 actions (navigate + fill form + submit)
   *   - 360s heavy:   9+ actions including multi-field typing sequences
   * Tightening these should follow evidence that the agent finishes with
   * budget to spare, not the other way around.
   */
  maxDurationMs: number;
  /**
   * Tools the agent is expected to use for this task. In `natural` mode this
   * is only recorded, never enforced — plans that differ from what we imagined
   * but still produce the right final state are considered successful. In
   * `smoke` mode it is enforced: the pipeline should exercise these tools.
   */
  expectedTools?: string[];
  evaluate: (page: Page, chat: ChatState) => Promise<TaskResult>;
}

export function selectIntent(task: Task, mode: TaskMode): string {
  return task.intents[mode];
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
    intents: {
      natural: 'Find a pair of wireless headphones on this store and add them to my cart.',
      smoke: 'Type "wireless headphones" into #search-input, then click #add-to-cart-p1.',
    },
    startUrl: '/onestopshop/#/products',
    maxDurationMs: 120000,
    expectedTools: ['browser_click'],
    async evaluate(page) {
      const cart = await getCart(page);
      const ok = cart.length === 1 && cart[0].productId === 'p1' && cart[0].quantity === 1;
      return { success: ok, reason: ok ? undefined : `cart=${JSON.stringify(cart)}` };
    },
  },
  {
    id: 'cheapest-in-category',
    intents: {
      natural: 'Add the cheapest audio product to my cart.',
      smoke: 'Type "audio" into #category-filter, type "price-asc" into #sort-order, then click #add-to-cart-p1.',
    },
    startUrl: '/onestopshop/#/products',
    maxDurationMs: 120000,
    expectedTools: ['browser_click'],
    async evaluate(page) {
      const cart = await getCart(page);
      const ok = cart.length === 1 && cart[0].productId === 'p1' && cart[0].quantity === 1;
      return { success: ok, reason: ok ? undefined : `cart=${JSON.stringify(cart)}` };
    },
  },
  {
    id: 'complete-checkout',
    intents: {
      natural:
        'Buy one USB-C Hub. On checkout use name "Test User", address "123 Test St", card "4111 1111 1111 1111", check the "I am not a robot" box, and place the order.',
      smoke:
        'Click #add-to-cart-p3, click the Cart link, click #checkout-btn, type "Test User" into #full-name, type "123 Test St" into #address, type "4111 1111 1111 1111" into #card, click #captcha-checkbox, and click the Place order button.',
    },
    startUrl: '/onestopshop/#/products',
    maxDurationMs: 360000,
    expectedTools: ['browser_click', 'browser_type'],
    async evaluate(page) {
      const orders = await getOrders(page);
      const cart = await getCart(page);
      const ok = orders.length === 1 && cart.length === 0;
      return { success: ok, reason: ok ? undefined : `orders=${orders.length}, cart=${JSON.stringify(cart)}` };
    },
  },
  {
    id: 'out-of-stock-recovery',
    intents: {
      natural: 'Add a Monitor Arm to my cart. If it is not available, add the Webcam 4K instead.',
      smoke: 'Click #add-to-cart-p5 (it is disabled/out of stock), then click #add-to-cart-p4.',
    },
    startUrl: '/onestopshop/#/products',
    maxDurationMs: 120000,
    expectedTools: ['browser_click'],
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
    intents: {
      natural:
        'Create a new task titled "Write E2E tests" with description "Cover new fixture sites". Leave the status as todo.',
      smoke:
        'Click #new-task-btn, type "Write E2E tests" into #task-title, type "Cover new fixture sites" into #task-description, and click #save-task-btn.',
    },
    startUrl: '/taskflow/#/board',
    maxDurationMs: 240000,
    expectedTools: ['browser_click', 'browser_type'],
    async evaluate(page) {
      const tasks = await getTasks(page);
      const created = tasks.find((t) => t.title === 'Write E2E tests');
      const ok = !!created && created.status === 'todo';
      return { success: ok, reason: ok ? undefined : `tasks=${JSON.stringify(tasks)}` };
    },
  },
  {
    id: 'taskflow-edit-status',
    intents: {
      natural: 'Open the task "Set up CI pipeline" from the board and mark it as done.',
      smoke: 'Click #edit-task-t2, click #status-done, and click #save-task-btn.',
    },
    startUrl: '/taskflow/#/board',
    maxDurationMs: 240000,
    expectedTools: ['browser_click'],
    async evaluate(page) {
      const tasks = await getTasks(page);
      const task = tasks.find((t) => t.id === 't2');
      const ok = task?.status === 'done';
      return { success: ok, reason: ok ? undefined : `tasks=${JSON.stringify(tasks)}` };
    },
  },
  {
    id: 'devforum-search-open',
    intents: {
      natural: 'Find and open the post about async/await.',
      smoke: 'Type "async" into #search-input, click #post-link-post-2.',
    },
    startUrl: '/devforum/#/',
    maxDurationMs: 120000,
    expectedTools: ['browser_click'],
    async evaluate(page) {
      const url = page.url();
      const ok = url.includes('/post/post-2');
      return { success: ok, reason: ok ? undefined : `url=${url}` };
    },
  },
  {
    id: 'devforum-create-post',
    intents: {
      natural:
        'Log in as user "tester" with password "password" and write a new post in the JavaScript category. Title it "Best testing library" with body "What is your favorite testing library?".',
      smoke:
        'Click #new-post-btn, type "tester" into #login-username, type "password" into #login-password, click #login-submit, type "Best testing library" into #post-title, type "What is your favorite testing library?" into #post-body, and click #submit-post.',
    },
    startUrl: '/devforum/#/',
    maxDurationMs: 360000,
    expectedTools: ['browser_click', 'browser_type'],
    async evaluate(page) {
      const posts = await getPosts(page);
      const created = posts.find((p) => p.title === 'Best testing library');
      const ok = !!created && created.category === 'javascript' && created.author === 'tester';
      return { success: ok, reason: ok ? undefined : `posts=${JSON.stringify(posts)}` };
    },
  },
];
