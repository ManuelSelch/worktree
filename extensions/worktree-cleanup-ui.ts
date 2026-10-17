import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CleanupCandidate, CleanupSelection } from "../src/cleanup.ts";

/** Standard dialogs work in both terminal Pi and Pi Chat; no custom terminal rendering. */
export async function openCleanupSelector(
  ctx: ExtensionCommandContext,
  candidates: CleanupCandidate[],
  primaryBranch: string | null,
): Promise<CleanupSelection[] | null> {
  if (!ctx.hasUI) return null;
  const eligible = candidates.filter(({ worktree, current }) => !worktree.primary && !current && !worktree.locked);
  const selected: CleanupSelection[] = [];
  const skip = "Skip";
  const remove = "Remove worktree; keep local branch";
  const removeAndDelete = "Remove worktree and delete local branch";
  const cancel = "Cancel cleanup";

  for (const [index, candidate] of eligible.entries()) {
    const { worktree, dirty, mergedIntoPrimary } = candidate;
    const status = [
      worktree.branch
        ? mergedIntoPrimary ? `merged into ${primaryBranch ?? "primary"}` : "not merged into primary; safe branch deletion may be refused"
        : "detached HEAD; no local branch to delete",
      dirty ? "WARNING: uncommitted changes will be lost if removed" : "clean",
    ].join("\n");
    const title = [
      `Worktree cleanup ${index + 1}/${eligible.length}: ${worktree.branch ?? worktree.head.slice(0, 8)}`,
      worktree.path,
      status,
    ].join("\n");
    const options = [skip, remove, ...(worktree.branch ? [removeAndDelete] : []), cancel];
    const answer = await ctx.ui.select(title, options);
    if (answer === undefined || answer === cancel) return null;
    if (answer === skip) continue;
    if (answer !== remove && answer !== removeAndDelete) return null;
    selected.push({ path: worktree.path, deleteBranch: answer === removeAndDelete });
  }
  return selected;
}
