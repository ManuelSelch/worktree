import { assessRemoval, normalizePath, type WorktreeInfo } from "./parse.ts";

export interface CleanupSelection {
  path: string;
  deleteBranch: boolean;
}

export interface CleanupCandidate {
  worktree: WorktreeInfo;
  current: boolean;
  dirty: boolean;
  mergedIntoPrimary: boolean;
}

export interface CleanupItemResult {
  path: string;
  branch: string | null;
  removed: boolean;
  branchDeleted: boolean;
  message: string;
}

export interface CleanupOutcome {
  text: string;
  results: CleanupItemResult[];
}

export interface CleanupProgress {
  index: number;
  total: number;
  label: string;
  phase: "checking" | "removing" | "deleting-branch";
}

export interface CleanupDeps {
  onProgress?(progress: CleanupProgress): void;
  listWorktrees(): WorktreeInfo[];
  isDirty(path: string): boolean;
  removeWorktree(path: string, force: boolean): Promise<{ ok: boolean; output: string }>;
  deleteBranch(branch: string): Promise<{ ok: boolean; output: string }>;
}

/** Remove selected worktrees serially, then optionally delete their local branches safely. */
export async function runCleanup(
  currentCwd: string,
  selections: CleanupSelection[],
  approvedDirtyPaths: ReadonlySet<string>,
  deps: CleanupDeps,
): Promise<CleanupOutcome> {
  if (selections.length === 0) return { text: "No worktrees selected.", results: [] };

  const approvedDirtyKeys = new Set([...approvedDirtyPaths].map(normalizePath));
  const total = new Set(selections.map(selection => normalizePath(selection.path))).size;
  const seen = new Set<string>();
  const results: CleanupItemResult[] = [];
  for (const selection of selections) {
    const key = normalizePath(selection.path);
    if (seen.has(key)) continue;
    seen.add(key);

    const target = deps.listWorktrees().find((worktree) => normalizePath(worktree.path) === key);
    const progress = { index: seen.size, total, label: target?.branch ?? selection.path };
    deps.onProgress?.({ ...progress, phase: "checking" });
    if (!target) {
      results.push({
        path: selection.path,
        branch: null,
        removed: false,
        branchDeleted: false,
        message: `Skipped ${selection.path}: the worktree no longer exists.`,
      });
      continue;
    }

    const dirty = deps.isDirty(target.path);
    const risk = assessRemoval(target, currentCwd, dirty);
    if (!risk.ok && (!risk.confirmable || !approvedDirtyKeys.has(key))) {
      const reason = risk.reasons.join("; ");
      const message = risk.confirmable && !approvedDirtyKeys.has(key)
        ? `Skipped ${target.branch ?? target.path}: worktree is dirty; uncommitted changes require explicit confirmation.`
        : `Skipped ${target.branch ?? target.path}: ${reason}.`;
      results.push({ path: target.path, branch: target.branch, removed: false, branchDeleted: false, message });
      continue;
    }

    deps.onProgress?.({ ...progress, phase: "removing" });
    const removal = await deps.removeWorktree(target.path, dirty);
    if (!removal.ok) {
      results.push({
        path: target.path,
        branch: target.branch,
        removed: false,
        branchDeleted: false,
        message: `Could not remove ${target.branch ?? target.path}: ${removal.output}.`,
      });
      continue;
    }

    if (selection.deleteBranch && target.branch) {
      deps.onProgress?.({ ...progress, phase: "deleting-branch" });
      const branchRemoval = await deps.deleteBranch(target.branch);
      if (branchRemoval.ok) {
        results.push({
          path: target.path,
          branch: target.branch,
          removed: true,
          branchDeleted: true,
          message: `Removed ${target.branch} worktree; local branch deleted.`,
        });
      } else {
        results.push({
          path: target.path,
          branch: target.branch,
          removed: true,
          branchDeleted: false,
          message: `Worktree removed for ${target.branch}; branch kept (${branchRemoval.output}).`,
        });
      }
      continue;
    }

    results.push({
      path: target.path,
      branch: target.branch,
      removed: true,
      branchDeleted: false,
      message: `Removed ${target.branch ?? target.path} worktree; branch kept.`,
    });
  }

  const removedCount = results.filter((result) => result.removed).length;
  const branchCount = results.filter((result) => result.branchDeleted).length;
  const summary = `Cleanup finished: removed ${removedCount} worktree${removedCount === 1 ? "" : "s"}` +
    (branchCount ? ` and deleted ${branchCount} local branch${branchCount === 1 ? "" : "es"}` : "") + ".";
  return { text: [summary, ...results.map((result) => `- ${result.message}`)].join("\n"), results };
}
