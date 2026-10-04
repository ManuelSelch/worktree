import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { validBaseRef, validBranchName } from "../src/parse.ts";
import { createWorktree } from "../src/git.ts";
import type { WorktreeController } from "./worktree-controller.ts";

export function registerWorktreeTools(pi: ExtensionAPI, controller: WorktreeController): void {
  pi.registerTool({
    name: "worktree_list",
    label: "List worktrees",
    promptSnippet: "Git worktrees for this repository, and their branches",
    description:
      "List the repository's git worktrees with branch, dirty/locked/prunable state, and which one " +
      "is primary. Use before creating, removing, or merging.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      controller.requireRepo(ctx);
      return { content: [{ type: "text", text: controller.listText(ctx) }], details: {} };
    },
  });

  pi.registerTool({
    name: "worktree_create",
    label: "Create worktree",
    promptSnippet: "Make an isolated git worktree to work in",
    description:
      "Create an isolated git worktree under ~/.worktrees/<repo>/ for parallel work that modifies " +
      "files. branch: a new branch (created from base, default HEAD) or an existing unoccupied local " +
      "branch. The main checkout stays untouched; report the returned path to the user so they can " +
      "open pi there.",
    parameters: Type.Object({
      branch: Type.String({ description: "Branch name (new or existing-unoccupied)" }),
      base: Type.Optional(Type.String({ description: "Base ref for a new branch (default HEAD)" })),
    }),
    async execute(_id, params: { branch: string; base?: string }, signal, _onUpdate, ctx) {
      controller.requireRepo(ctx);
      const branch = params.branch.trim();
      if (!validBranchName(branch)) throw new Error(`Invalid branch name ${JSON.stringify(params.branch)}.`);
      if (params.base !== undefined && !validBaseRef(params.base)) {
        throw new Error(`Invalid base ref ${JSON.stringify(params.base)}.`);
      }
      const result = await controller.create(ctx, branch, params.base?.trim(), signal);
      if (!result.ok) throw new Error(result.message);
      return {
        content: [{
          type: "text",
          text: [
            `Worktree ready at ${result.path} (${result.message} base: ${result.base}).`,
            `Your tools still point at the current checkout. The user can run /worktree enter ${branch} ` +
              `to bring this conversation into the worktree, or open it separately with: cd "${result.path}" && pi`,
            `When the work is done: worktree_merge branch="${branch}" merges it back and cleans up.`,
          ].join("\n"),
        }],
        details: { path: result.path, branch, createdBranch: result.createdBranch },
      };
    },
  });

  pi.registerTool({
    name: "worktree_remove",
    label: "Remove worktree",
    promptSnippet: "Remove a worktree, reporting anything uncommitted first",
    description:
      "Remove a worktree by branch name or path. Refuses the primary worktree, the one this session " +
      "runs in, and locked ones; uncommitted changes need the user's confirmation (denied when no UI). " +
      "The branch itself is kept.",
    parameters: Type.Object({
      target: Type.String({ description: "Branch name or worktree path" }),
    }),
    async execute(_id, params: { target: string }, signal, _onUpdate, ctx) {
      const target = controller.resolve(ctx, params.target.trim());
      if (!target) throw new Error(`No worktree matches ${JSON.stringify(params.target)}. Use worktree_list.`);
      const message = await controller.remove(ctx, params.target, signal);
      return { content: [{ type: "text", text: message }], details: { path: target.path } };
    },
  });

  pi.registerTool({
    name: "worktree_merge",
    label: "Merge worktree",
    promptSnippet: "Merge a worktree's branch back and clean it up",
    description:
      "Merge a named worktree branch, or the current worktree when branch is omitted, into the " +
      "primary worktree's current branch. The worktree is removed after a successful merge unless " +
      "the current session is using it.",
    parameters: Type.Object({
      branch: Type.Optional(Type.String({ description: "Branch to merge; defaults to the current worktree" })),
    }),
    async execute(_id, params: { branch?: string }, signal, _onUpdate, ctx) {
      const branch = params.branch?.trim() || controller.currentBranch(ctx);
      if (!branch) throw new Error("The current session is not inside a named worktree; provide a branch.");
      const result = await controller.merge(ctx, branch, signal);
      return {
        content: [{ type: "text", text: result.text }],
        details: { branch: result.branch, merged: result.merged, removed: result.removed },
      };
    },
  });
}
