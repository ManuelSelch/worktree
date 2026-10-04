import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  assessRemoval,
  formatWorktrees,
  isInside,
  resolveWorktree,
  type WorktreeInfo,
} from "../src/parse.ts";
import {
  createWorktree,
  isDirty,
  listWorktrees,
  mergeBranch,
  removeWorktree,
  repoToplevel,
} from "../src/git.ts";
import { runMerge, type MergeOutcome } from "../src/merge.ts";
import { withUiLock } from "../src/ui-lock.ts";

type UiContext = ExtensionContext;

export interface WorktreeController {
  requireRepo(ctx: UiContext): string;
  list(cwd: string): WorktreeInfo[];
  listText(ctx: UiContext): string;
  resolve(ctx: UiContext, target: string): WorktreeInfo | null;
  currentBranch(ctx: UiContext): string | null;
  create(ctx: UiContext, branch: string, base?: string, signal?: AbortSignal): ReturnType<typeof createWorktree>;
  merge(ctx: UiContext, branch: string, signal?: AbortSignal): Promise<MergeOutcome>;
  remove(ctx: UiContext, targetName: string, signal?: AbortSignal): Promise<string>;
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

  function listText(ctx: UiContext): string {
    const worktrees = list(ctx.cwd);
    const dirty = new Set(worktrees.filter((w) => isDirty(w.path)).map((w) => w.path));
    return formatWorktrees(worktrees, dirty);
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
    return `Removed worktree ${target.path}. Branch "${target.branch ?? "(detached)"}" was kept.`;
  }

  async function create(ctx: UiContext, branch: string, base?: string, signal?: AbortSignal) {
    return createWorktree(ctx.cwd, branch, base, { signal });
  }

  return { requireRepo, list, listText, resolve, currentBranch, create, merge, remove };
}

