# Model comparison for the WebArena-style E2E suite

Recorded 2026-07-15 with 8 natural-language tasks across three self-hosted
fixture sites (OneStopShop, TaskFlow, DevForum). All runs used the same
prompt (`BROWSER_SYSTEM_PROMPT` in `src/host/agent.ts`), the same tiered
timeouts (120 / 240 / 360 s by task complexity), the same fresh-Pi-session
protocol between tasks, and thinking level = `low`. Only the model changes
between runs.

## Task suite

| Task | Tier | Verifiable success |
|---|---|---|
| search-add-to-cart | simple | cart == `[{p1, 1}]` |
| cheapest-in-category | simple | cart == `[{p1, 1}]` |
| out-of-stock-recovery | simple | cart has p4 (Webcam 4K), not p5 |
| devforum-search-open | simple | URL contains `/post/post-2` |
| taskflow-create-task | medium | task exists in `taskflow:tasks` with status `todo` |
| taskflow-edit-status | medium | t2 status == `done` |
| complete-checkout | heavy | order created in `onestopshop:orders`, cart empty |
| devforum-create-post | heavy | new post in `devforum:posts` under `javascript`, author `tester` |

Intents are natural language ("Find a pair of wireless headphones and add
them to my cart"), not selector-level scripts. Agent must plan.

## Best pass counts observed

| Model | Best run | Wall clock | Notes |
|---|---|---|---|
| **qwen3.7-plus** | **6/8** | ~12 min | Consistent 4-6/8 across multiple runs |
| kimi-k2.7-code | 1/5 (limited comparison) | — | Better tool discipline, ~2× slower per turn |
| minimax-m3 | 4/8 | ~12 min | Extreme variance: 21 s wins vs 82-tool churn losses |

`opencode-go` is the provider proxy in all cases.

## qwen3.7-plus (recommended default)

Range across 4 runs: 2/8 to 6/8. High run-to-run variance but the highest
ceiling and the most balanced trajectory.

- Best trajectory (`taskflow-edit-status` PASS, 167 s / 16 tools):
  `screenshot → click → screenshot → click → screenshot → click → click →
   find_element → click → screenshot`
- Completion narration cites visible evidence when the Completeness Verifier
  in the prompt engages, e.g.
  > "I can verify from the screenshot that 'Set up CI pipeline' has been
  > moved from the 'IN PROGRESS' column to the 'DONE' column. Its status
  > badge now shows 'DONE'..."

Known failure modes:
- Persistently invents Playwright pseudo-classes (`:has-text`, `:contains`)
  and framework class names (`.card`, `.btn-danger`) despite explicit
  prompt-level bans. Mitigated at the tool boundary by
  `rejectPlaywrightPseudo()` in `src/extension/content.ts`.
- On `complete-checkout` it can walk in circles between cart and checkout
  pages without ever reaching the form fields (0 `browser_type` calls in
  26-tool runs).
- Occasional URL hallucination (`localhost:5173/login`) followed by an
  invented "server crashed" excuse when the tab lands on
  `ERR_CONNECTION_REFUSED`. Mitigated by rule 3 in the system prompt.

## kimi-k2.7-code (disciplined but slow)

Only tested standalone on the failing subset; not a full 8-task run. When
it works, its trajectories are cleaner than qwen's:
- More consistent screenshot-first behavior
- More frequent, appropriate `browser_find_element` before clicking
- Fewer invented selectors

But 12-15 s per tool round versus qwen's 6-8 s, so it exhausts budgets on
multi-step tasks. Passed `cheapest-in-category` (56 s / 4 tools) where
qwen sometimes fails; failed `complete-checkout` at 120 s with 6 real
tools because it verified every step.

## minimax-m3 (fast when winning, catastrophic when losing)

Tested at parity with qwen. 4/8 pass, but with the extremes the OSWorld
2.0 paper predicted:

**Fast wins:**
- `search-add-to-cart`: 21 s / 5 tools (qwen: 40-55 s)
- `out-of-stock-recovery`: 21 s / 4 tools

**Catastrophic churn:**
- `complete-checkout`: 82 tools in 360 s, dominated by 40+ repeated
  `browser_get_text` calls on the same DOM
- `devforum-create-post`: 58 tools ending with 8 consecutive
  `browser_navigate` calls — total loss of control

The paper (see below) directly names MiniMax M3 as the model with the
highest churn rate (24%) and zero-score rate (45%) among the four
foundation models it evaluated. Our observation is consistent even on a
much simpler workload: M3 either commits and wins fast or wavers and
burns everything.

## Related research: OSWorld 2.0

Yuan et al., ["OSWorld 2.0: Benchmarking Computer Use Agents on Long-Horizon
Real-World Tasks"](https://arxiv.org/abs/2606.29537), arxiv 2606.29537.

Directly relevant findings:

1. **Even Claude Opus 4.8 + max thinking + batched tool calls scores 20.6%
   on 108 realistic desktop workflows** (54.8% partial). GPT-5.5 plateaus
   near 13%. Our 6/8 (75%) on synthetic fixtures should not be over-read
   as a general capability claim — real tasks are much harder.
2. **Agents devote almost none of their budget to self-correction** — even
   the best models spend under 5% on recovery/repair. Our
   Recovery-from-failed-actions and Completeness-Verifier prompt sections
   are addressing the correct lever.
3. **"Guess rather than ask the user" is a top failure mode.** Our Rule 2
   forbids the agent from asking clarifying questions because there is no
   interactive user in E2E — for production this should be relaxed to
   allow `ask_user` on high-stakes ambiguity.
4. **MiniMax M3-specific finding.** From §4.1.1:
   > "MiniMax M3 also mixes the two modes but has the highest churn rate
   > among the four at 24%, leaving 45% of its runs at zero score. [...]
   > Committing to one consistent solution style produces fewer outright
   > failures, whereas wavering between programmatic and GUI styles is
   > itself a failure mode."
5. **Qwen 3.7-Plus is also in the paper** with 18% churn — behind Opus 4.7
   and GPT-5.5 but ahead of MiniMax M3. This matches what we saw
   empirically.

## Recommendation

Default `opencode-go / qwen3.7-plus` with `PI_THINKING_LEVEL=low` and the
tiered timeouts already in `tasks/index.ts`. Not because qwen is the best
model — Claude and GPT would obviously do better — but because among the
models available via the current provider, it has the highest ceiling and
the least destructive failure mode.

Switch to a stronger model when the provider list changes or when a task
matters enough to justify the token cost.

## Reproducing

```bash
# Default suite
npm run test:e2e:parallel

# Filter to specific tasks
E2E_TASKS=search-add-to-cart,out-of-stock-recovery \
  npm run test:e2e

# Compare against another model — temporarily edit ~/.pi/agent/settings.json:
#   "defaultModel": "kimi-k2.7-code"  (or minimax-m3, glm-5.2, etc.)
# Then run the suite and restore afterward.

# Available models on this workspace: `pi --list-models`
```

Each run writes a structured `summary.json` to `e2e-context-logs/<mode>-<ts>-<pid>/`
along with `context.jsonl` (full agent message trace) and screenshots.
