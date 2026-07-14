# Mini-WebArena E2E Test Redesign

## Goal

Replace the current simplistic E2E test with a realistic, human-like browser-agent evaluation suite modeled after [WebArena](https://webarena.dev/) and [VisualWebArena](https://visualwebarena.github.io/).

The new suite should:
- Test multi-step, intent-driven tasks on a self-hosted local fixture site.
- Evaluate task completion by inspecting final page state (execution-based).
- Capture tool-call trajectories and side-panel UI rendering for debugging.
- Remain stable in CI without depending on external websites.

## Background

The current E2E test (`src/e2e/extension.e2e.ts`) only verifies the message plumbing:
1. Open a test page with a `#load-more` button.
2. Manually send a `browser_click` tool call through the service worker.
3. Open `sidepanel.html` directly and send a hard-coded user message.
4. Wait for `.completion-summary`.

This does not exercise realistic human behavior: there is no natural-language goal, no multi-step planning, no navigation, no form filling, and no robust success criteria. It also opens the side panel as a regular page rather than through Chrome's side-panel API.

WebArena-style benchmarks solve this by providing:
- **Self-hosted realistic websites** (e-commerce, forum, CMS, etc.).
- **Natural-language intents** that require multiple actions.
- **Execution-based success checks** (final DOM state, URL, data) rather than action-sequence matching.
- **Templated tasks** with variations to reduce overfitting.

## Design Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Playwright Test Runner                   │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Fixture Site │    │  Extension   │    │  Evaluator   │  │
│  │   (OneStop   │◄──►│  Side Panel  │◄──►│  (rules +    │  │
│  │     Shop)    │    │  + Native Host│    │   optional   │  │
│  └──────────────┘    └──────────────┘    │   LLM judge) │  │
│                                           └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

1. Playwright launches Chrome with the extension loaded.
2. A local HTTP server serves the `OneStopShop` fixture site.
3. For each task, the runner:
   - Resets fixture state (cart, orders).
   - Navigates the target tab to the task's `startUrl`.
   - Opens the side panel via `chrome.sidePanel.open()` on the target tab.
   - Sends the task intent as a user message through the side-panel input.
   - Waits for the agent to settle or a max timeout.
   - Captures the final page state, side-panel chat, and screenshots.
4. The evaluator checks success criteria defined per task.

## Fixture Site: OneStopShop

A minimal but realistic e-commerce site under `src/e2e/fixtures/onestopshop/`.

### Pages

| Path | Purpose |
|------|---------|
| `/` | Home with featured products and category links. |
| `/products` | Product grid with search, category filter, price sort. |
| `/product/:id` | Product detail with price, description, Add to Cart. |
| `/cart` | Cart summary, quantity controls, Proceed to Checkout. |
| `/checkout` | Shipping/payment form, Place Order. |
| `/order/:id` | Order confirmation with order number and summary. |

### Product Catalog (sample)

```json
[
  { "id": "p1", "name": "Wireless Headphones", "category": "audio", "price": 129.00, "stock": 10 },
  { "id": "p2", "name": "Mechanical Keyboard", "category": "office", "price": 89.00, "stock": 5 },
  { "id": "p3", "name": "USB-C Hub", "category": "accessories", "price": 49.00, "stock": 20 },
  { "id": "p4", "name": "Webcam 4K", "category": "audio", "price": 159.00, "stock": 8 },
  { "id": "p5", "name": "Monitor Arm", "category": "office", "price": 79.00, "stock": 0 }
]
```

### State Management

The site uses `localStorage` for cart and orders so the runner can reset state by clearing storage. Key structures:

- `onestopshop:cart` — array of `{ productId, quantity }`.
- `onestopshop:orders` — array of `{ orderId, items, shipping, total, status }`.

A reset endpoint (`window.__resetFixtureState()`) is exposed for the test runner.

## Task Definitions

Tasks are defined in `src/e2e/tasks/index.ts` as a typed array:

```ts
interface Task {
  id: string;
  intent: string;
  startUrl: string;
  maxDurationMs: number;
  maxSteps?: number;
  evaluate: (page: Page, chatState: ChatState) => Promise<TaskResult>;
}
```

### Initial Task Suite

| ID | Intent | Expected Outcome |
|----|--------|------------------|
| `search-add-to-cart` | "Search for wireless headphones and add them to your cart." | Cart contains `p1` with quantity 1. |
| `cheapest-in-category` | "Find the cheapest product in the audio category and add it to your cart." | Cart contains `p1` (cheapest audio item at $129; `p4` is $159). |
| `complete-checkout` | "Add one USB-C Hub to your cart and complete checkout using name 'Test User', address '123 Test St', card '4111 1111 1111 1111'." | An order is created in `localStorage`, confirmation page shows order number. |
| `out-of-stock-recovery` | "Try to add the Monitor Arm to your cart. If it is out of stock, add the Webcam 4K instead." | Cart contains `p4` and not `p5`. |

Tasks can be templated to produce variations (e.g., different products, addresses) by replacing placeholders in `intent` and `evaluate`.

## Test Orchestration

The runner in `src/e2e/extension.e2e.ts` performs the following for each task:

1. **Reset state**
   ```ts
   await page.goto(`${fixtureUrl}/products`);
   await page.evaluate(() => window.__resetFixtureState());
   ```

2. **Navigate to start URL**
   ```ts
   await page.goto(`${fixtureUrl}${task.startUrl}`);
   ```

3. **Open side panel on the target tab** (realistic user flow)
   ```ts
   const tabId = await worker.evaluate(async (expectedUrl: string) => {
     const tabs = await new Promise<chrome.tabs.Tab[]>((resolve) => chrome.tabs.query({}, resolve));
     const tab = tabs.find((t) => t.url === expectedUrl || t.url?.startsWith(expectedUrl));
     if (tab?.id) chrome.sidePanel.open({ tabId: tab.id });
     return tab?.id;
   }, page.url());
   assert(tabId, 'target tab not found');
   ```

4. **Send intent via side-panel UI**
   ```ts
   await sidePanelPage.locator('#input').fill(task.intent);
   await sidePanelPage.locator('#sendBtn').click();
   ```

5. **Wait for completion**
   - Poll the side-panel chat for `.completion-summary`.
   - Also poll native-host messages for `done`.
   - Apply `task.maxDurationMs` timeout.

6. **Capture artifacts**
   - Final screenshot of target page.
   - Final screenshot of side panel.
   - Serialized chat state (user/agent messages, tool calls, completion text).
   - Tool-call trajectory.

7. **Evaluate**
   - Call `task.evaluate(page, chatState)`.
   - Record `pass`, `fail`, or `partial`.

## Evaluation Strategy

### 1. Execution-Based Success (primary)

Each task defines a deterministic check against page state:

```ts
async function searchAddToCart(page, _chat) {
  const cart = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('onestopshop:cart') || '[]')
  );
  const ok = cart.length === 1 && cart[0].productId === 'p1' && cart[0].quantity === 1;
  return { success: ok, reason: ok ? undefined : `cart=${JSON.stringify(cart)}` };
}
```

This mirrors WebArena's execution-based evaluation and avoids brittle action-sequence matching.

### 2. Trajectory Checks (secondary)

Verify the agent used relevant tools, regardless of exact order:

```ts
const toolNames = chat.toolCalls.map(t => t.name);
const usedFind = toolNames.includes('browser_find_element');
const usedClick = toolNames.includes('browser_click');
```

Trajectory checks help distinguish between:
- A task that failed because of UI drift.
- A task that failed because the agent chose the wrong plan.

### 3. Visual Artifacts

Screenshots are saved to `e2e-screenshots/` for manual inspection and CI artifacts.

### 4. Optional LLM Judge (future)

For ambiguous tasks, an LLM judge can compare the final screenshot against the intent. This is out of scope for the first iteration but the evaluator interface should allow plug-in judges.

## File Structure

```
src/e2e/
├── extension.e2e.ts          # Test runner
├── setup-host.ts             # Native host setup (existing)
├── evaluator.ts              # Evaluation helpers and task runner
├── fixtures/
│   └── onestopshop/
│       ├── index.html
│       ├── products.html
│       ├── product.html
│       ├── cart.html
│       ├── checkout.html
│       ├── order.html
│       ├── styles.css
│       └── app.js            # Router, catalog, cart, checkout logic
└── tasks/
    └── index.ts              # Task definitions and evaluations
```

## Success Criteria for This Redesign

1. The E2E suite runs at least 4 distinct realistic tasks.
2. Each task is evaluated by final page state, not by expected action sequence.
3. The side panel is opened through `chrome.sidePanel.open()` on the target tab, not loaded as a standalone page.
4. A test report is printed with per-task pass/fail, completion summary, and failure reasons.
5. The suite passes in CI without relying on external websites.

## Out of Scope

- Multi-tab or cross-site tasks (for now; the fixture supports adding them later).
- LLM-based judge (execution-based checks are sufficient for the first iteration).
- Performance benchmarking (step count / latency metrics can be added later).
- Mobile viewport testing.

## References

- [WebArena: A Realistic Web Environment for Building Autonomous Agents](https://webarena.dev/)
- [VisualWebArena: Evaluating Multimodal Agents on Realistic Visual Web Tasks](https://visualwebarena.github.io/)
- [Mind2Web: Towards a Generalist Agent for the Web](https://github.com/OSU-NLP-Group/Mind2Web-2)
