import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CleanupCandidate, CleanupSelection } from "../src/cleanup.ts";

/** A looping standard menu works in terminal Pi and Pi Chat without custom UI. */
export async function openCleanupSelector(
  ctx: ExtensionCommandContext,
  candidates: CleanupCandidate[],
  _primaryBranch: string | null,
): Promise<CleanupSelection[] | null> {
  if (!ctx.hasUI) return null;
  const eligible = candidates.filter(({ worktree, current }) => !worktree.primary && !current && !worktree.locked);
  if (eligible.length === 0) return [];

  const selected = new Set(eligible.filter(candidate => candidate.mergedIntoPrimary && !candidate.dirty));
  const review = "Review cleanup";
  const cancel = "Cancel cleanup";
  const hasUnmerged = eligible.some(({ worktree, mergedIntoPrimary }) => worktree.branch && !mergedIntoPrimary);
  const hasMerged = eligible.some(({ worktree, mergedIntoPrimary }) => worktree.branch && mergedIntoPrimary);
  const labels = eligible.map(({ worktree, dirty, mergedIntoPrimary }) => {
    const statuses = [
      !worktree.branch ? "detached HEAD; no local branch to delete" : hasMerged && hasUnmerged && !mergedIntoPrimary ? "unmerged" : null,
      dirty ? "Uncommitted changes" : null,
    ].filter(Boolean);
    return [worktree.branch ?? worktree.head.slice(0, 8), ...statuses].join(" — ");
  });

  while (true) {
    const options = eligible.map((candidate, index) => `${selected.has(candidate) ? "[x]" : "[ ]"} ${labels[index]}`);
    const answer = await ctx.ui.select([
      `Clean up worktrees: ${selected.size}/${eligible.length} selected`,
      ...(hasUnmerged ? ["Some branches are not merged. Git may refuse to delete them."] : []),
    ].join("\n"), [...options, review, cancel]);
    if (answer === undefined || answer === cancel) return null;
    if (answer === review) {
      return eligible.filter(candidate => selected.has(candidate)).map(({ worktree }) => ({
        path: worktree.path,
        deleteBranch: worktree.branch !== null,
      }));
    }
    const index = options.indexOf(answer);
    const candidate = eligible[index];
    if (!candidate) return null;
    if (selected.has(candidate)) selected.delete(candidate);
    else selected.add(candidate);
  }
}
