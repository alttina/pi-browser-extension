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
    intent: 'Type "wireless headphones" into #search-input, then click #add-to-cart-p1.',
    startUrl: '#/products',
    maxDurationMs: 45000,
    async evaluate(page) {
      const cart = await getCart(page);
      const ok = cart.length === 1 && cart[0].productId === 'p1' && cart[0].quantity === 1;
      return { success: ok, reason: ok ? undefined : `cart=${JSON.stringify(cart)}` };
    },
  },
  {
    id: 'cheapest-in-category',
    intent: 'Type "audio" into #category-filter, type "price-asc" into #sort-order, then click #add-to-cart-p1.',
    startUrl: '#/products',
    maxDurationMs: 45000,
    async evaluate(page) {
      const cart = await getCart(page);
      const ok = cart.length === 1 && cart[0].productId === 'p1' && cart[0].quantity === 1;
      return { success: ok, reason: ok ? undefined : `cart=${JSON.stringify(cart)}` };
    },
  },
  {
    id: 'complete-checkout',
    intent: 'Click #add-to-cart-p3, click the Cart link, click #checkout-btn, type "Test User" into #full-name, type "123 Test St" into #address, type "4111 1111 1111 1111" into #card, and click the Place order button.',
    startUrl: '#/products',
    maxDurationMs: 90000,
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
    startUrl: '#/products',
    maxDurationMs: 45000,
    async evaluate(page) {
      const cart = await getCart(page);
      const hasWebcam = cart.some((item) => item.productId === 'p4');
      const hasMonitorArm = cart.some((item) => item.productId === 'p5');
      const ok = hasWebcam && !hasMonitorArm;
      return { success: ok, reason: ok ? undefined : `cart=${JSON.stringify(cart)}` };
    },
  },
];
