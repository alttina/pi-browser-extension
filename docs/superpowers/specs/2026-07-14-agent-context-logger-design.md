# Agent Context Logger Design

## Goal
Give the development team visibility into exactly what the Pi Browser Agent sees and does at each step during E2E runs, without exposing any debug UI to end users.

## Scope
- Capture every message that enters or leaves the native host process.
- Persist screenshots as separate PNG files instead of inline base64.
- Produce one log directory per E2E run.
- No user-facing UI changes.

## Context Flow Today
1. Side panel / content script sends `user` or `tool_result` messages to the extension background.
2. Background forwards them over native messaging to `src/host/index.ts`.
3. The host's `AgentHost` calls the LLM and emits `assistant`, `tool_call`, `done`, or `error` messages.
4. Tool calls are executed by the content script; their `tool_result` messages flow back to the host.
5. Screenshots are returned inside `tool_result.result.screenshot` as base64 data URLs.

The agent's context at any step is the conversation history plus the most recent screenshot and tool results.

## Design

### 1. `ContextLogger` in the native host
Create `src/host/context-logger.ts`.

Behavior:
- Activated only when the environment variable `PI_BROWSER_AGENT_LOG_DIR` is set.
- Creates the directory if it does not exist.
- Writes a JSON Lines file at `$PI_BROWSER_AGENT_LOG_DIR/context.jsonl`.
- Each line is an object: `{ ts, direction: 'in' | 'out', type, payload }`.
- For `tool_result` entries containing a screenshot:
  - Decode the base64 PNG and write it as `screenshot-<n>.png`.
  - Replace the inline data URL in the payload with the filename string.
- Failures to write are caught and logged to stderr; they must never crash the host.

### 2. Hook into `src/host/index.ts`
- Instantiate `ContextLogger` at startup if `PI_BROWSER_AGENT_LOG_DIR` is present.
- Log every decoded incoming message as `direction: 'in'`.
- Log every outgoing message from `host.onMessage` and from the tool-call callback as `direction: 'out'`.

### 3. E2E integration
- `src/e2e/setup-host.ts` accepts an optional `logDir` parameter.
- When provided, it sets `PI_BROWSER_AGENT_LOG_DIR=<logDir>` in the generated host wrapper script.
- `src/e2e/extension.e2e.ts` creates a per-run log directory such as `e2e-context-logs/<timestamp>/` and passes it to `setupHost`.
- After the run, the directory contains `context.jsonl` and any screenshots.

## Success Criteria
- Running `npm run test:e2e` produces a new `e2e-context-logs/<timestamp>/` directory.
- `context.jsonl` contains one entry per native-messaging event.
- Screenshot entries reference saved PNG files rather than multi-megabyte base64 strings.
- The E2E suite still passes 8/8 tasks.

## Out of Scope
- Real-time UI in the side panel.
- Per-task log rotation (one file per E2E run is sufficient for the current debugging need).
- Log retention / cleanup automation.
