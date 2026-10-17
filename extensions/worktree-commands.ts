import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { enterWorktree, exitWorktree } from "./worktree-session.ts";
import type { WorktreeController } from "./worktree-controller.ts";
import { validBaseRef, validBranchName } from "../src/parse.ts";
import { pruneWorktrees } from "../src/git.ts";
import { completeWorktreeArguments } from "../src/completion.ts";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { openCleanupSelector } from "./worktree-cleanup-ui.ts";
import { normalizePath } from "../src/parse.ts";
import { withUiLock } from "../src/ui-lock.ts";

function getArgumentCompletions(
  prefix: string,
  controller: WorktreeController,
  cwd: string,
): AutocompleteItem[] | null {
  return completeWorktreeArguments(prefix, controller.list(cwd));
}

export function registerWorktreeCommands(pi: ExtensionAPI, controller: WorktreeController): void {
  let completionCwd = "";
  pi.on("session_start", (_event, ctx) => {
    completionCwd = ctx.cwd;
  });

  pi.registerCommand("worktree", {
    description: "Manage git worktrees; type /worktree for subcommand completion",
    getArgumentCompletions: (prefix) => getArgumentCompletions(prefix, controller, completionCwd),
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      completionCwd = ctx.cwd;

      const text = (args ?? "").trim();
      const route = (text.split(/\s+/)[0] ?? "").toLowerCase();
      const rest = text.slice(route.length).trim();

      try {
        controller.requireRepo(ctx);
        switch (route || "list") {
          case "list":
            ctx.ui.notify(controller.compactListText(ctx), "info");
            return;
          case "create": {
            const words = rest.split(/\s+/).filter(Boolean);
            const positional = words;
            const [arg, base] = positional;

            if (!arg) return ctx.ui.notify("Usage: /worktree create <branch> [base]", "warning");
            if (positional.length > 2 || words.some((word) => word.startsWith("-")))
              return ctx.ui.notify("Usage: /worktree create <branch> [base]", "warning");
            if (!validBranchName(arg)) return ctx.ui.notify(`Invalid branch name "${arg}".`, "warning");
            if (base !== undefined && !validBaseRef(base))
              return ctx.ui.notify(`Invalid base ref "${base}".`, "warning");

            const result = await controller.create(ctx, arg, base);
            if (!result.ok) return ctx.ui.notify(result.message, "error");

            await enterWorktree(controller, ctx, arg, true);
            return;
          }
          case "enter":
            if (!rest) return ctx.ui.notify("Usage: /worktree enter <branch|path>", "warning");

            await enterWorktree(controller, ctx, rest);
            return;
          case "exit":
            await exitWorktree(controller, ctx);
            return;
          case "update":
            if (rest) return ctx.ui.notify("Usage: /worktree update", "warning");
            ctx.ui.notify(await controller.update(ctx), "info");
            return;
          case "merge": {
            const branch = rest || controller.currentBranch(ctx);
            if (!branch) {
              return ctx.ui.notify(
                "This session is not inside a named worktree. Usage: /worktree merge <branch>",
                "warning",
              );
            }

            const result = await controller.merge(ctx, branch);
            ctx.ui.notify(result.text, "info");
            return;
          }
          case "remove": {
            if (!rest) return ctx.ui.notify("Usage: /worktree remove <branch|path>", "warning");

            ctx.ui.notify(await controller.remove(ctx, rest), "info");
            return;
          }
          case "cleanup": {
            if (rest) return ctx.ui.notify("Usage: /worktree cleanup", "warning");

            const candidates = controller.cleanupCandidates(ctx);
            const primaryBranch = candidates.find((candidate) => candidate.worktree.primary)?.worktree.branch ?? null;
            const selected = await withUiLock(() => openCleanupSelector(ctx, candidates, primaryBranch));
            if (selected === null) return ctx.ui.notify("Cleanup cancelled.", "info");
            if (selected.length === 0) return ctx.ui.notify("No worktrees selected.", "info");

            const byPath = new Map(candidates.map((candidate) => [normalizePath(candidate.worktree.path), candidate]));
            const selectedCandidates = selected.flatMap((selection) => {
              const candidate = byPath.get(normalizePath(selection.path));
              return candidate ? [{ selection, candidate }] : [];
            });
            const dirty = selectedCandidates.filter(({ candidate }) => candidate.dirty);
            const summaryLines = selectedCandidates.map(({ selection, candidate }) => {
              const branch = candidate.worktree.branch;
              const action = selection.deleteBranch && branch
                ? `delete local branch${candidate.mergedIntoPrimary ? "" : " (safe delete may keep it if unmerged)"}`
                : "keep local branch";
              return `• ${branch ?? candidate.worktree.path}: remove worktree, ${action}`;
            });
            if (dirty.length > 0) {
              summaryLines.push(
                "",
                `WARNING: uncommitted changes in ${dirty.length} worktree${dirty.length === 1 ? "" : "s"} will be lost.`,
              );
            }
            summaryLines.push("Remote branches are never deleted.");
            const approved = await withUiLock(() => ctx.ui.confirm("Review worktree cleanup", summaryLines.join("\n")));
            if (!approved) return ctx.ui.notify("The user declined cleanup. Worktrees kept.", "info");

            const approvedDirtyPaths = new Set(dirty.map(({ candidate }) => candidate.worktree.path));
            const outcome = await controller.cleanup(ctx, selected, approvedDirtyPaths);
            ctx.ui.notify(outcome.text, outcome.results.every((result) => result.removed) ? "info" : "warning");
            return;
          }
          case "prune": {
            const result = pruneWorktrees(ctx.cwd);
            ctx.ui.notify(result.output || "Nothing to prune.", result.ok ? "info" : "error");
            return;
          }
          default:
            ctx.ui.notify(
              `Unknown subcommand "${route}". Type /worktree for available commands.`,
              "warning",
            );
        }
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
    },
  });
}
