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
  sendIntent(intent: string): Promise<void>;
  waitForCompletion(options: { timeoutMs: number }): Promise<boolean>;
}

export async function runTask(runner: TaskRunner, task: Task): Promise<{ result: TaskResult; chat: ChatState; durationMs: number }> {
  const start = Date.now();

  await runner.targetPage.goto(`${runner.baseUrl}${task.startUrl}`);
  await runner.targetPage.waitForFunction(() => typeof window.__resetFixtureState === 'function');
  await runner.targetPage.evaluate(() => window.__resetFixtureState());

  await runner.sendIntent(task.intent);
  const completed = await runner.waitForCompletion({ timeoutMs: task.maxDurationMs });

  const chat = await captureChatState(runner.sidePanelPage);
  const durationMs = Date.now() - start;

  if (!completed) {
    return { result: { success: false, reason: `Timeout after ${durationMs}ms` }, chat, durationMs };
  }

  const result = await task.evaluate(runner.targetPage, chat);

  if (result.success && task.requiredTools && task.requiredTools.length > 0) {
    const usedToolNames = new Set(chat.toolCalls.map((t) => t.name));
    const missing = task.requiredTools.filter((name) => !usedToolNames.has(name));
    if (missing.length > 0) {
      return {
        result: { success: false, reason: `State passed but required tools were not used: ${missing.join(', ')}` },
        chat,
        durationMs,
      };
    }
  }

  return { result, chat, durationMs };
}
