# Pi Browser Agent

A Chrome extension that turns the browser into an agentic environment for [Pi](https://pi.dev/), the terminal-based coding agent by [Earendil](https://earendil.works/).

This project wires Pi's SDK into a browser extension side panel so you can give natural-language instructions like _"search for wireless headphones and add them to cart"_ and have Pi drive the active tab via native messaging.

## What it does

- **Side-panel chat**: talk to Pi in the Chrome side panel.
- **Browser tools**: the extension exposes tools such as `browser_click`, `browser_type`, `browser_navigate`, `browser_screenshot`, etc.
- **Native messaging host**: a Node.js host (`src/host/`) bridges the extension and Pi over stdin/stdout using Pi's RPC mode.
- **WebArena-style E2E fixtures**: three self-hosted test sites (e-commerce, task board, forum) are used to evaluate multi-step, intent-driven agent behavior.

## Tech stack

- TypeScript
- Chrome Extension Manifest V3
- Playwright (for E2E testing)
- Node.js native messaging host
- Pi SDK packages from Earendil

## Attribution / upstream sources

This project builds on top of the **Pi** ecosystem from **Earendil Works**:

- **Pi** – the terminal coding agent: https://pi.dev/ | https://earendil.works/
- **Pi SDK / `pi-coding-agent`** – programmatic agent sessions and RPC mode: https://github.com/earendil-works/pi/tree/main/packages/coding-agent
- **`pi-agent-core`** – low-level agent loop and tool abstractions: https://github.com/earendil-works/pi/tree/main/packages/agent
- **`pi-ai`** – model providers and completion API used by Pi: https://github.com/earendil-works/pi/tree/main/packages/ai
- **Pi Computer Use / Pi Browser Use** – these capabilities are provided by Pi's agent SDK and the browser-tool integration demonstrated in this repository.

The scoped npm packages used in this project are published by Earendil Works under the `@earendil-works` organization:

- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`

## Project structure

```
src/
├── extension/          # Chrome extension (manifest, side panel, settings, background)
├── host/               # Native messaging host that talks to Pi
├── e2e/                # Playwright E2E tests and fixture sites
│   ├── extension.e2e.ts
│   ├── evaluator.ts
│   ├── tasks/
│   └── fixtures/
│       ├── onestopshop/    # E-commerce fixture with fake CAPTCHA
│       ├── taskflow/       # Kanban task manager fixture
│       └── devforum/       # Forum fixture with login gate
├── scripts/            # Build/install helpers
└── tests/              # Unit tests
```

## Getting started

```bash
npm install
npm run build
npm run install:host   # install the native messaging host manifest
```

Load `dist/extension` as an unpacked extension in Chrome, then open the side panel on any tab.

## Running tests

```bash
# Unit tests
npm test

# Full WebArena-style E2E suite (launches Chrome + extension + Pi)
npm run test:e2e
```

The E2E suite currently runs **8 tasks** across the three fixture sites:

- `search-add-to-cart`
- `cheapest-in-category`
- `complete-checkout`
- `out-of-stock-recovery`
- `taskflow-create-task`
- `taskflow-edit-status`
- `devforum-search-open`
- `devforum-create-post`

## Security note

Before pushing to a public repository we removed the placeholder API key from the extension settings HTML. API keys are intended to be entered at runtime and stored in browser local storage / Pi's `auth.json`.

## License

This project is private and not licensed for public use unless otherwise specified.
