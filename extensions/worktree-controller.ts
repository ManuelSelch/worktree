import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  assessRemoval,
  formatCompactWorktrees,
  formatWorktrees,
  isInside,
  resolveWorktree,
  type WorktreeInfo,
} from "../src/parse.ts";
import {
  createWorktree,
  deleteLocalBranch,
  isBranchMerged,
  isDirty,
  listWorktrees,
  mergeBranch,
  removeWorktree,
  repoToplevel,
} from "../src/git.ts";
import { runMerge, type MergeOutcome } from "../src/merge.ts";
import { runCleanup, type CleanupCandidate, type CleanupOutcome, type CleanupSelection, type CleanupProgress } from "../src/cleanup.ts";
import { withUiLock } from "../src/ui-lock.ts";

type UiContext = ExtensionContext;

export interface WorktreeController {
  requireRepo(ctx: UiContext): string;
  list(cwd: string): WorktreeInfo[];
  listText(ctx: UiContext): string;
  compactListText(ctx: UiContext): string;
  resolve(ctx: UiContext, target: string): WorktreeInfo | null;
  currentBranch(ctx: UiContext): string | null;
  create(ctx: UiContext, branch: string, base?: string, signal?: AbortSignal): ReturnType<typeof createWorktree>;
  merge(ctx: UiContext, branch: string, signal?: AbortSignal): Promise<MergeOutcome>;
  update(ctx: UiContext, signal?: AbortSignal): Promise<string>;
  remove(ctx: UiContext, targetName: string, signal?: AbortSignal): Promise<string>;
  cleanupCandidates(ctx: UiContext): CleanupCandidate[];
  cleanup(
    ctx: UiContext,
    selections: CleanupSelection[],
    approvedDirtyPaths: ReadonlySet<string>,
    signal?: AbortSignal,
    onProgress?: (progress: CleanupProgress) => void,
  ): Promise<CleanupOutcome>;
}

export function createWorktreeController(): WorktreeController {
  function requireRepo(ctx: UiContext): string {
    const top = repoToplevel(ctx.cwd);
    if (!top) throw new Error("Not inside a git repository.");
    return top;
  }

  function list(cwd: string): WorktreeInfo[] {
    return listWorktrees(cwd);
  }

  function dirtyPaths(worktrees: WorktreeInfo[]): Set<string> {
    return new Set(worktrees.filter((worktree) => isDirty(worktree.path)).map((worktree) => worktree.path));
  }

  function listText(ctx: UiContext): string {
    const worktrees = list(ctx.cwd);
    return formatWorktrees(worktrees, dirtyPaths(worktrees));
  }

  function compactListText(ctx: UiContext): string {
    const worktrees = list(ctx.cwd);
    return formatCompactWorktrees(worktrees, dirtyPaths(worktrees), ctx.cwd);
  }

  function resolve(ctx: UiContext, target: string): WorktreeInfo | null {
    return resolveWorktree(list(ctx.cwd), target);
  }

  function currentBranch(ctx: UiContext): string | null {
    const current = list(ctx.cwd).find((w) => isInside(ctx.cwd, w.path));
    return current?.branch ?? null;
  }

  function merge(ctx: UiContext, rawBranch: string, signal?: AbortSignal): Promise<MergeOutcome> {
    requireRepo(ctx);
    return runMerge(ctx.cwd, list(ctx.cwd), rawBranch, {
      hasUI: ctx.hasUI,
      isDirty,
      confirm: (title, message) => withUiLock(() => ctx.ui.confirm(title, message)),
      mergeBranch: (primaryPath, branch) => mergeBranch(primaryPath, branch, { signal }),
      removeWorktree: (cwd, path, force) => removeWorktree(cwd, path, force, { signal }),
    });
  }

  async function update(ctx: UiContext, signal?: AbortSignal): Promise<string> {
    requireRepo(ctx);
    const worktrees = list(ctx.cwd);
    const primary = worktrees.find((worktree) => worktree.primary);
    const current = worktrees.find((worktree) => isInside(ctx.cwd, worktree.path));
    if (!primary?.branch) throw new Error("Could not determine the primary branch.");
    if (!current?.branch || current.primary) {
      throw new Error("/worktree update must be run inside a named feature worktree.");
    }
    if (isDirty(current.path)) {
      throw new Error(`Worktree ${current.path} has uncommitted changes — commit or stash them first.`);
    }
    if (!ctx.hasUI) throw new Error("Updating needs the user's confirmation and no UI is available (fail-closed).");
    const approved = await withUiLock(() => ctx.ui.confirm(
      "Update worktree",
      `Merge primary branch "${primary.branch}" into "${current.branch}"?`,
    ));
    if (!approved) return "The user declined the update.";
    const result = await mergeBranch(current.path, primary.branch, { signal });
    if (!result.ok) throw new Error(result.message);
    return `Merged ${primary.branch} into ${current.branch}.`;
  }

  function cleanupCandidates(ctx: UiContext): CleanupCandidate[] {
    const worktrees = list(ctx.cwd);
    const primary = worktrees.find((worktree) => worktree.primary);
    return worktrees.map((worktree) => ({
      worktree,
      current: isInside(ctx.cwd, worktree.path),
      dirty: isDirty(worktree.path),
      mergedIntoPrimary: Boolean(
        worktree.branch && primary?.branch && isBranchMerged(primary.path, worktree.branch, primary.branch),
      ),
    }));
  }

  async function cleanup(
    ctx: UiContext,
    selections: CleanupSelection[],
    approvedDirtyPaths: ReadonlySet<string>,
    signal?: AbortSignal,
    onProgress?: (progress: CleanupProgress) => void,
  ): Promise<CleanupOutcome> {
    requireRepo(ctx);
    return runCleanup(ctx.cwd, selections, approvedDirtyPaths, {
      onProgress,
      listWorktrees: () => list(ctx.cwd),
      isDirty,
      removeWorktree: (path, force) => removeWorktree(ctx.cwd, path, force, { signal }),
      deleteBranch: (branch) => deleteLocalBranch(ctx.cwd, branch, { signal }),
    });
  }

  async function remove(ctx: UiContext, targetName: string, signal?: AbortSignal): Promise<string> {
    requireRepo(ctx);
    const target = resolve(ctx, targetName.trim());
    if (!target) throw new Error(`No worktree matches ${JSON.stringify(targetName)}. Use /worktree.`);

    const dirty = isDirty(target.path);
    const risk = assessRemoval(target, ctx.cwd, dirty);
    if (!risk.ok && !risk.confirmable) {
      throw new Error(`Refusing to remove ${target.path}: ${risk.reasons.join("; ")}.`);
    }
    if (!risk.ok && risk.confirmable) {
      if (!ctx.hasUI) {
        throw new Error(
          `Refusing to remove ${target.path}: ${risk.reasons.join("; ")} (no UI to confirm — fail-closed).`,
        );
      }
      const approved = await withUiLock(() => ctx.ui.confirm(
        "Remove dirty worktree",
        `${target.path} has uncommitted changes that will be LOST. Remove anyway?`,
      ));
      if (!approved) return "The user declined. Worktree kept.";
    }

    const result = await removeWorktree(ctx.cwd, target.path, dirty, { signal });
    if (!result.ok) throw new Error(result.output);
    return `Removed ${target.branch ?? target.path}. Branch kept.`;
  }

  async function create(ctx: UiContext, branch: string, base?: string, signal?: AbortSignal) {
    return createWorktree(ctx.cwd, branch, base, { signal });
  }

  return {
    requireRepo,
    list,
    listText,
    compactListText,
    resolve,
    currentBranch,
    create,
    merge,
    update,
    remove,
    cleanupCandidates,
    cleanup,
  };
}

