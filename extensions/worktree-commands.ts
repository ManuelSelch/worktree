import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { enterWorktree, exitWorktree } from "./worktree-session.ts";
import type { WorktreeController } from "./worktree-controller.ts";
import { validBaseRef, validBranchName } from "../src/parse.ts";
import { pruneWorktrees } from "../src/git.ts";

const SUBCOMMANDS: AutocompleteItem[] = [
  { value: "create", label: "create — create and enter a worktree" },
  { value: "enter", label: "enter — enter an existing worktree" },
  { value: "exit", label: "exit — return to the primary checkout" },
  { value: "list", label: "list — show all worktrees" },
  { value: "merge", label: "merge — merge a worktree into the primary branch" },
  { value: "prune", label: "prune — remove stale worktree metadata" },
  { value: "remove", label: "remove — remove a worktree" },
];

function getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
  const trimmed = prefix.trimStart();
  const firstSpace = trimmed.search(/\s/);

  // Complete the subcommand while the first argument is being typed.
  if (firstSpace === -1) {
    const matches = SUBCOMMANDS.filter((item) => item.value.startsWith(trimmed));
    return matches.length > 0 ? matches : null;
  }

  return null;
}

export function registerWorktreeCommands(pi: ExtensionAPI, controller: WorktreeController): void {
  pi.registerCommand("worktree", {
    description: "Manage git worktrees; type /worktree for subcommand completion",
    getArgumentCompletions,
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const text = (args ?? "").trim();
      const route = (text.split(/\s+/)[0] ?? "").toLowerCase();
      const rest = text.slice(route.length).trim();
      try {
        controller.requireRepo(ctx);
        switch (route || "list") {
          case "list":
            ctx.ui.notify(controller.listText(ctx), "info");
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
            ctx.ui.notify(`Worktree ready: ${result.path}`, "info");
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
            if (!rest) return ctx.ui.notify("Usage: /worktree merge <branch>", "warning");
            const result = await controller.merge(ctx, rest);
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
