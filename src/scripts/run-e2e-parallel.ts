/**
 * Run the WebArena-style E2E suite as three parallel groups of tasks. Each
 * group launches its own headed Chromium with its own tmp profile and its own
 * per-profile native messaging wrapper, so groups can run without shared
 * state (their Pi sessions are independent, their fixture servers listen on
 * separate ports, and each writes its own summary.json).
 *
 * Usage:
 *   node dist/scripts/run-e2e-parallel.js            # default: build then run
 *   node dist/scripts/run-e2e-parallel.js --no-build # skip the build step
 *
 * Env passthrough:
 *   E2E_MODE=natural|smoke  (default: natural)
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Groups tuned so wall-clock time is roughly balanced: heavy multi-step
// tasks are split across groups so no single group dominates.
const DEFAULT_GROUPS: string[][] = [
  ['search-add-to-cart', 'out-of-stock-recovery', 'devforum-search-open'],
  ['cheapest-in-category', 'taskflow-create-task', 'taskflow-edit-status'],
  ['complete-checkout', 'devforum-create-post'],
];

interface TaskSummary {
  id: string;
  success: boolean;
  durationMs: number;
  toolCallCount: number;
  toolTrajectory: string[];
  timedOut: boolean;
  completion?: string;
  reason?: string;
}

interface GroupRun {
  group: number;
  tasks: string[];
  exitCode: number | null;
  logDir?: string;
}

function label(i: number): string {
  return `[grp${i + 1}]`;
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => `${prefix} ${line}`)
    .join('\n');
}

function build(): Promise<void> {
  return new Promise((resolveP, reject) => {
    console.log('Building...');
    const b = spawn('npm', ['run', 'build'], { stdio: 'inherit' });
    b.on('close', (code) => {
      if (code === 0) resolveP();
      else reject(new Error(`build exited with code ${code}`));
    });
    b.on('error', (err) => reject(err));
  });
}

function runGroup(index: number, tasks: string[], mode: string): Promise<GroupRun> {
  return new Promise((resolveP) => {
    const tag = label(index);
    const env = { ...process.env, E2E_TASKS: tasks.join(','), E2E_MODE: mode };
    const child = spawn('node', ['dist/e2e/extension.e2e.js'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logDir: string | undefined;

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/Context logs: (\S+)/);
      if (match && !logDir) logDir = match[1];
      const prefixed = prefixLines(text, tag);
      if (prefixed) process.stdout.write(prefixed + '\n');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const prefixed = prefixLines(chunk.toString(), tag);
      if (prefixed) process.stderr.write(prefixed + '\n');
    });
    child.on('close', (code) => {
      resolveP({ group: index + 1, tasks, exitCode: code, logDir });
    });
    child.on('error', (err) => {
      console.error(`${tag} failed to spawn:`, err);
      resolveP({ group: index + 1, tasks, exitCode: -1, logDir });
    });
  });
}

interface Row {
  id: string;
  group: number;
  success: boolean;
  timedOut: boolean;
  toolCallCount: number;
  durationMs: number;
  trajectory: string;
  note: string;
}

function pad(s: string, n: number, alignRight = false): string {
  return alignRight ? s.padStart(n) : s.padEnd(n);
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return '';
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

function printCombinedTable(rows: Row[]): void {
  if (rows.length === 0) return;
  const widths = {
    task: Math.max(4, ...rows.map((r) => r.id.length)),
    status: Math.max(6, ...rows.map((r) => (r.success ? 4 : r.timedOut ? 7 : 4).toString().length)),
    grp: 3,
    tools: 5,
    ms: 6,
    trajectory: Math.max(10, ...rows.map((r) => r.trajectory.length)),
    note: Math.max(4, ...rows.map((r) => r.note.length)),
  };
  const header =
    pad('Task', widths.task) +
    '  ' +
    pad('Status', 7) +
    '  ' +
    pad('Grp', widths.grp, true) +
    '  ' +
    pad('Tools', widths.tools, true) +
    '  ' +
    pad('Ms', widths.ms, true) +
    '  ' +
    pad('Trajectory', widths.trajectory) +
    '  Note';
  const divider = '-'.repeat(header.length);
  console.log('\n' + header);
  console.log(divider);
  for (const r of rows) {
    const status = r.success ? 'PASS' : r.timedOut ? 'TIMEOUT' : 'FAIL';
    console.log(
      pad(r.id, widths.task) +
        '  ' +
        pad(status, 7) +
        '  ' +
        pad(String(r.group), widths.grp, true) +
        '  ' +
        pad(String(r.toolCallCount), widths.tools, true) +
        '  ' +
        pad(String(r.durationMs), widths.ms, true) +
        '  ' +
        pad(r.trajectory, widths.trajectory) +
        '  ' +
        r.note,
    );
  }
}

async function main(): Promise<void> {
  const skipBuild = process.argv.includes('--no-build');
  const mode = process.env.E2E_MODE || 'natural';

  if (!skipBuild) {
    await build();
  }

  console.log(`Running ${DEFAULT_GROUPS.length} parallel groups in ${mode} mode`);
  for (let i = 0; i < DEFAULT_GROUPS.length; i++) {
    console.log(`  ${label(i)} ${DEFAULT_GROUPS[i].join(', ')}`);
  }

  const startedAt = Date.now();
  const results = await Promise.all(
    DEFAULT_GROUPS.map((tasks, i) => runGroup(i, tasks, mode)),
  );
  const wallClockMs = Date.now() - startedAt;

  const rows: Row[] = [];
  for (const res of results) {
    if (!res.logDir) {
      console.error(`Group ${res.group} produced no logDir (exit ${res.exitCode})`);
      continue;
    }
    const summaryPath = join(res.logDir, 'summary.json');
    if (!existsSync(summaryPath)) {
      console.error(`Group ${res.group}: missing summary.json at ${summaryPath}`);
      continue;
    }
    const data = JSON.parse(readFileSync(summaryPath, 'utf-8')) as {
      tasks: TaskSummary[];
    };
    for (const t of data.tasks) {
      rows.push({
        id: t.id,
        group: res.group,
        success: t.success,
        timedOut: t.timedOut,
        toolCallCount: t.toolCallCount,
        durationMs: t.durationMs,
        trajectory: truncate(t.toolTrajectory.join(' → '), 60),
        note: truncate(t.reason || t.completion, 60),
      });
    }
  }

  const passed = rows.filter((r) => r.success).length;
  const total = rows.length;
  console.log(`\n=== Parallel summary: ${passed}/${total} passed in ${(wallClockMs / 1000).toFixed(1)}s wall-clock ===`);
  printCombinedTable(rows);

  process.exit(total > 0 && passed === total ? 0 : 1);
}

main().catch((err: Error) => {
  console.error('run-e2e-parallel failed:', err);
  process.exit(1);
});
