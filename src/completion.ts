import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { WorktreeInfo } from "./parse.ts";

export const WORKTREE_SUBCOMMANDS: AutocompleteItem[] = [
  { value: "create", label: "create — create and enter a worktree" },
  { value: "enter", label: "enter — enter an existing worktree" },
  { value: "exit", label: "exit — return to the primary checkout" },
  { value: "list", label: "list — show all worktrees" },
  { value: "merge", label: "merge — merge the current or named worktree into the primary branch" },
  { value: "prune", label: "prune — remove stale worktree metadata" },
  { value: "remove", label: "remove — remove a worktree" },
];

/** Complete a worktree target using the branches currently checked out as worktrees. */
export function completeWorktreeArguments(prefix: string, worktrees: WorktreeInfo[]): AutocompleteItem[] | null {
  const trimmed = prefix.trimStart();
  const firstSpace = trimmed.search(/\s/);

  if (firstSpace === -1) {
    const matches = WORKTREE_SUBCOMMANDS.filter((item) => item.value.startsWith(trimmed));
    return matches.length > 0 ? matches : null;
  }

  const route = trimmed.slice(0, firstSpace).toLowerCase();
  if (!["enter", "merge", "remove"].includes(route)) return null;

  // There is only one target argument for these routes. Pi replaces the
  // current argument token with the selected item's value.
  const argument = trimmed.slice(firstSpace).trimStart();
  if (/\s/.test(argument)) return null;

  const matches = worktrees
    .filter((worktree) => worktree.branch?.startsWith(argument))
    .map((worktree) => ({ value: worktree.branch!, label: worktree.branch! }));
  return matches.length > 0 ? matches : null;
}
