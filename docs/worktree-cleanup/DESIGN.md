# Worktree cleanup checklist — Design

## Overview
Replace the per-worktree dialog sequence with one shared, checkbox-style selection menu using the existing `ctx.ui.select` API. Selecting an entry updates the same menu; an explicit Review action ends selection. No Pi, SDK, server, or Pi Chat changes are needed.

## Components
| Package/module | Component | Change | Responsibility |
|---|---|---|---|
| worktree | [openCleanupSelector](../../extensions/worktree-cleanup-ui.ts) | Changed | Own invocation-local selection state; format the shared menu and handle toggles |
| worktree | [CleanupCandidate](../../src/cleanup.ts) | Reused | Supply merge, dirty, current and protection information |
| worktree | [cleanup command](../../extensions/worktree-commands.ts) | Reused | Confirm the complete batch, including dirty-loss warnings |
| worktree | [runCleanup](../../src/cleanup.ts) | Reused | Revalidate safety, remove worktrees and safely delete explicitly selected branches |

## Runtime flow
1. The cleanup command gathers candidates as today.
2. The selector excludes primary, current and locked worktrees from actionable entries. It preselects worktree removal only for merged, clean candidates. No session or archive checks occur.
3. One menu lists every eligible worktree, with branch/HEAD, path, merge and dirty status. Each has one selection toggle. All selected entries use the same action: remove the worktree, then safely delete its local branch. Detached worktrees have no branch to delete.
4. Choosing a toggle redraws the complete menu; Review returns selections. Cancel or dismissal discards the batch. No eligible entries returns an empty selection without a dialog.
5. Existing final confirmation and execution remain unchanged.

## Contracts & API changes
| Provider → consumer | Current → proposed contract | Compatibility |
|---|---|---|
| Selector → command | Per-worktree action choices → one batch selection; every selected named branch has `deleteBranch: true` | Same `CleanupSelection[] | null` shape; cleanup no longer offers keep-branch choices |
| Extension → Pi UI | Standard single-choice dialogs → repeated standard selection menu | Existing API and RPC protocol unchanged |

## Decisions & Trade-offs
- Checkbox markers are text, not native checkbox controls. Activate an entry with Enter/click to toggle, then choose Review. Terminal Pi redraws the standard selector; Pi Chat already preserves a looping menu's modal, caret and filter across prompt handovers.
- Keep the menu title shape and option count stable while toggling to support Pi Chat's existing handover detection.
- This avoids a cross-project native multi-select feature. Retain existing file layout and dependencies; no unrelated architectural rewrite.
- Dirty worktrees remain unchecked initially and still require the explicit final loss confirmation. Remote branches are never deleted.
- There is no separate branch-deletion toggle. Git's safe `-d` check remains mandatory: if deletion is refused, retain the local branch and report the partial outcome. Ordinary `/worktree remove` continues to keep branches.

## Verification
- Replace per-worktree dialog tests with a shared test driver covering defaults, selection toggles, uniform remove-and-delete actions, detached entries, review, dismissal, cancellation, no eligible worktrees and protected candidates.
- Exercise terminal and RPC contexts with the same selector scenarios. Preserve command tests for final confirmation and dirty approval.
- Run the full existing test suite, TypeScript checking and diff checks. These checks are planned, not yet run.

## Open Questions
None.
