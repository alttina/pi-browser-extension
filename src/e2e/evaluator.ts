import type { Page } from '@playwright/test';
import type { ChatState, Task, TaskMode, TaskResult } from './tasks/index.js';
import { selectIntent } from './tasks/index.js';

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

    let toolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];
    const historyEl = chat.querySelector('#tool-history');
    if (historyEl?.textContent) {
      try { toolCalls = JSON.parse(historyEl.textContent); }
      catch { toolCalls = []; }
    }

    const completion = chat.querySelector('.completion-summary')?.textContent || undefined;

    return { userMessages, assistantMessages, toolCalls, completion };
  });
}

export interface TaskRunner {
  targetPage: Page;
  sidePanelPage: Page;
  baseUrl: string;
  clearChat(): Promise<void>;
  /**
   * Ask the native host to dispose the current Pi AgentSession and start a
   * fresh one so the next task doesn't inherit prior turns' context.
   */
  newSession(): Promise<void>;
  sendIntent(intent: string): Promise<void>;
  waitForCompletion(options: { timeoutMs: number }): Promise<boolean>;
}

export interface TaskRunSummary {
  id: string;
  mode: TaskMode;
  intent: string;
  success: boolean;
  reason?: string;
  durationMs: number;
  timedOut: boolean;
  completion?: string;
  toolCallCount: number;
  uniqueTools: string[];
  toolTrajectory: string[];
  expectedTools: string[];
  missingExpectedTools: string[];
}

export interface RunTaskOptions {
  mode: TaskMode;
  /**
   * In smoke mode, `expectedTools` acts as a hard requirement — the pipeline
   * is expected to exercise exactly those tools. In natural mode it is
   * observational only, since agents may legitimately achieve the same final
   * state through a different plan.
   */
  enforceExpectedTools?: boolean;
}

export async function runTask(
  runner: TaskRunner,
  task: Task,
  options: RunTaskOptions,
): Promise<{ result: TaskResult; chat: ChatState; summary: TaskRunSummary }> {
  const mode = options.mode;
  const enforceExpectedTools = options.enforceExpectedTools ?? mode === 'smoke';
  const intent = selectIntent(task, mode);
  const start = Date.now();

  await runner.targetPage.goto(`${runner.baseUrl}${task.startUrl}`);
  await runner.targetPage.waitForFunction(() => typeof window.__resetFixtureState === 'function');
  await runner.targetPage.evaluate(() => window.__resetFixtureState());

  await runner.newSession();
  await runner.clearChat();
  await runner.sendIntent(intent);
  const completed = await runner.waitForCompletion({ timeoutMs: task.maxDurationMs });

  const chat = await captureChatState(runner.sidePanelPage);
  const durationMs = Date.now() - start;

  const toolTrajectory = chat.toolCalls.map((t) => t.name);
  const uniqueTools = Array.from(new Set(toolTrajectory));
  const expectedTools = task.expectedTools ?? [];
  const missingExpectedTools = expectedTools.filter((name) => !uniqueTools.includes(name));

  let result: TaskResult;
  if (!completed) {
    result = { success: false, reason: `Timeout after ${durationMs}ms` };
  } else {
    result = await task.evaluate(runner.targetPage, chat);
    if (result.success && enforceExpectedTools && missingExpectedTools.length > 0) {
      result = {
        success: false,
        reason: `State passed but required tools were not used: ${missingExpectedTools.join(', ')}`,
      };
    }
  }

  const summary: TaskRunSummary = {
    id: task.id,
    mode,
    intent,
    success: result.success,
    reason: result.reason,
    durationMs,
    timedOut: !completed,
    completion: chat.completion,
    toolCallCount: chat.toolCalls.length,
    uniqueTools,
    toolTrajectory,
    expectedTools,
    missingExpectedTools,
  };

  return { result, chat, summary };
}
