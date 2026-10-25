# Cleanup progress — Design

## Overview
Add a temporary plain-text widget above the message input while confirmed cleanup runs. Reuse Pi's string-array widget API, already forwarded by Pi Chat; no client, server or protocol changes are needed.

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| worktree | [runCleanup](../../src/cleanup.ts) | Changed | Emit optional progress events at validation, removal and branch-deletion boundaries |
| worktree | [controller.cleanup](../../extensions/worktree-controller.ts) | Changed | Forward the optional progress callback without adding UI to the executor |
| worktree | [cleanup command](../../extensions/worktree-commands.ts) | Changed | Start/stop progress around confirmed execution and preserve final summary |
| worktree | Proposed `extensions/worktree-cleanup-progress.ts` | New | Own one invocation's widget, elapsed-time refresh and disposal |

## Runtime flow
1. After final confirmation, the cleanup command starts the progress presenter with an initial Preparing message.
2. `runCleanup` emits the current unique item's ordinal, total, branch/path label and phase before checking, removing or deleting. Skipped and failed items advance to the next item normally.
3. The presenter updates one keyed `aboveEditor` widget immediately on each event and every second for elapsed batch time: `Cleanup 2/8 · Removing feature/login · 12s`.
4. A `finally` block clears the timer and widget on success or exception, before the existing summary/error notification. Session shutdown also disposes active presenters. A disposed presenter ignores late events.

## Contracts & API changes
- Add an optional callback to `CleanupDeps` and after the existing optional signal in `controller.cleanup`; existing callers remain valid.
- Proposed progress values: one-based item index, deduplicated total, display label, and phase (`checking`, `removing`, `deleting-branch`). Preparing has no item yet. Counters indicate items, not Git percentage or success count.
- Widget output uses `setWidget(key, string[], { placement: "aboveEditor" })`; clearing uses `undefined`. No persisted state or wire changes.
- Proposed UUID removal: the presenter uses the fixed key `worktree-cleanup` for updates and disposal. Only one cleanup runs at a time; no UUID, counter or overlap handling is needed. Progress text, timers and command behavior are unchanged.

## Decisions & Trade-offs
- Serial Git operations and all safety checks stay unchanged. No speedup or file-level percentage is promised.
- Existing synchronous Git checks can briefly delay timer refresh; the long-running removal/deletion calls are asynchronous.
- Keep branch names in progress, falling back to path only for detached/missing worktrees. Reuse the fixed widget key because only one cleanup runs at a time.
- The small presenter module isolates timer/resource lifecycle from Git logic and makes clock-based tests deterministic without new dependencies.

## Verification
- Executor tests cover phase ordering, deduplication, skips, failures and detached branches.
- Presenter tests use controlled time to verify initial display, elapsed updates, in-place widget changes, disposal and ignored late events. Assert the fixed `worktree-cleanup` key and replace overlapping-presenter coverage with sequential cleanup reuse.
- Command-driver tests in terminal/RPC contexts verify confirmation-before-widget, progress forwarding and cleanup on success, failure and shutdown. Run the full suite, typecheck and diff checks.

## Open Questions
None.
