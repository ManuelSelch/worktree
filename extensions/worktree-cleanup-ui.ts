import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CleanupCandidate, CleanupSelection } from "../src/cleanup.ts";

/** A looping standard menu works in terminal Pi and Pi Chat without custom UI. */
export async function openCleanupSelector(
  ctx: ExtensionCommandContext,
  candidates: CleanupCandidate[],
  primaryBranch: string | null,
): Promise<CleanupSelection[] | null> {
  if (!ctx.hasUI) return null;
  const eligible = candidates.filter(({ worktree, current }) => !worktree.primary && !current && !worktree.locked);
  if (eligible.length === 0) return [];

  const selected = new Set(eligible.filter(candidate => candidate.mergedIntoPrimary && !candidate.dirty));
  const review = "Review cleanup";
  const cancel = "Cancel cleanup";
  const labels = eligible.map(({ worktree, dirty, mergedIntoPrimary }) => {
    const status = worktree.branch
      ? mergedIntoPrimary ? `merged into ${primaryBranch ?? "primary"}` : "not merged; safe branch deletion may be refused"
      : "detached HEAD; no local branch to delete";
    return `${worktree.branch ?? worktree.head.slice(0, 8)} — ${worktree.path} — ${status} — ${
      dirty ? "WARNING: uncommitted changes will be lost if removed" : "clean"
    }`;
  });

  while (true) {
    const options = eligible.map((candidate, index) => `${selected.has(candidate) ? "[x]" : "[ ]"} ${labels[index]}`);
    const answer = await ctx.ui.select([
      `Worktree cleanup: ${selected.size}/${eligible.length} selected`,
      "Toggle worktrees, then choose Review cleanup.",
      "Selected worktrees will be removed and their local branches safely deleted.",
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
