import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { enterWorktree, exitWorktree } from "./worktree-session.ts";
import type { WorktreeController } from "./worktree-controller.ts";
import { validBaseRef, validBranchName } from "../src/parse.ts";
import { pruneWorktrees } from "../src/git.ts";
import { completeWorktreeArguments } from "../src/completion.ts";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

function getArgumentCompletions(
  prefix: string,
  controller: WorktreeController,
  cwd: string,
): AutocompleteItem[] | null {
  // The command completion API currently supplies only the argument prefix,
  // not an ExtensionContext. The registered command keeps this cwd in sync
  // whenever it handles a command; process.cwd() covers the initial state.
  return completeWorktreeArguments(prefix, controller.list(cwd));
}

export function registerWorktreeCommands(pi: ExtensionAPI, controller: WorktreeController): void {
  let completionCwd = process.cwd();

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
