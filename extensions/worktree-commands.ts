import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { enterWorktree, exitWorktree } from "./worktree-session.ts";
import type { WorktreeController } from "./worktree-controller.ts";
import { validBaseRef, validBranchName } from "../src/parse.ts";
import { pruneWorktrees } from "../src/git.ts";

export function registerWorktreeCommands(pi: ExtensionAPI, controller: WorktreeController): void {
  pi.registerCommand("worktree-create", {
    description: "Create a branch and worktree, then enter it",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const branch = (args ?? "").trim();
      if (!branch) {
        ctx.ui.notify("Usage: /worktree-create <branch>", "warning");
        return;
      }
      if (!validBranchName(branch)) {
        ctx.ui.notify(`Invalid branch name "${branch}".`, "warning");
        return;
      }
      try {
        controller.requireRepo(ctx);
        await ctx.waitForIdle();
        const result = await controller.create(ctx, branch);
        if (!result.ok) {
          ctx.ui.notify(result.message, "error");
          return;
        }
        await enterWorktree(controller, ctx, branch, true);
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
    },
  });

  pi.registerCommand("worktree-enter", {
    description: "Enter an existing worktree",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const target = (args ?? "").trim();
      if (!target) {
        ctx.ui.notify("Usage: /worktree-enter <branch|path>", "warning");
        return;
      }
      await enterWorktree(controller, ctx, target);
    },
  });

  pi.registerCommand("worktree-exit", {
    description: "Return to the primary checkout without removing the worktree",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      await exitWorktree(controller, ctx);
    },
  });

  pi.registerCommand("worktree-merge", {
    description: "Merge the current or named worktree into the primary branch",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const requested = (args ?? "").trim();
      const branch = requested || controller.currentBranch(ctx);
      if (!branch) {
        ctx.ui.notify("This session is not inside a named worktree. Usage: /worktree-merge [name]", "warning");
        return;
      }
      try {
        const result = await controller.merge(ctx, branch);
        ctx.ui.notify(result.text, "info");
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
    },
  });

  // `/worktree` is the canonical list command. The routed forms remain as
  // compatibility aliases while the explicit commands are adopted.
  pi.registerCommand("worktree", {
    description:
      "Manage git worktrees: /worktree | create <branch> [base] [--enter] | enter <target> | exit | remove <target> | merge <branch> | prune",
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
            const enterAfter = words.includes("--enter");
            const [arg, base] = words.filter((w) => w !== "--enter");
            if (!arg) {
              ctx.ui.notify("Usage: /worktree create <branch> [base] [--enter]", "warning");
              return;
            }
            if (!validBranchName(arg)) {
              ctx.ui.notify(`Invalid branch name "${arg}".`, "warning");
              return;
            }
            if (base !== undefined && !validBaseRef(base)) {
              ctx.ui.notify(`Invalid base ref "${base}".`, "warning");
              return;
            }
            const result = await controller.create(ctx, arg, base);
            if (!result.ok) {
              ctx.ui.notify(result.message, "error");
              return;
            }
            if (enterAfter) {
              ctx.ui.notify(`Worktree ready: ${result.path}`, "info");
              await enterWorktree(controller, ctx, arg, true);
            } else {
              ctx.ui.notify(
                `Worktree ready: ${result.path}\n` +
                  `/worktree-enter ${arg} takes this conversation there, or open it separately with: cd "${result.path}" && pi`,
                "info",
              );
            }
            return;
          }
          case "enter":
            if (!rest) {
              ctx.ui.notify("Usage: /worktree enter <branch|path>", "warning");
              return;
            }
            await enterWorktree(controller, ctx, rest);
            return;
          case "exit":
            await exitWorktree(controller, ctx);
            return;
          case "merge": {
            if (!rest) {
              ctx.ui.notify("Usage: /worktree merge <branch>", "warning");
              return;
            }
            const result = await controller.merge(ctx, rest);
            ctx.ui.notify(result.text, "info");
            return;
          }
          case "remove": {
            if (!rest) {
              ctx.ui.notify("Usage: /worktree remove <branch|path>", "warning");
              return;
            }
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
              `Unknown route "${route}". Use /worktree, /worktree-create, /worktree-enter, /worktree-exit, or /worktree-merge.`,
              "warning",
            );
        }
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
    },
  });
}

