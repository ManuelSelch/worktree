import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { openCleanupSelector } from "../extensions/worktree-cleanup-ui.ts";
import { registerWorktreeCommands } from "../extensions/worktree-commands.ts";
import type { WorktreeController } from "../extensions/worktree-controller.ts";
import type { CleanupCandidate, CleanupSelection } from "../src/cleanup.ts";

function candidate(branch: string, overrides: Partial<CleanupCandidate> = {}): CleanupCandidate {
  return {
    worktree: { path: `/repo/${branch}`, branch, head: "abc123", primary: false, locked: false, detached: false, prunable: false },
    current: false,
    dirty: false,
    mergedIntoPrimary: true,
    ...overrides,
  };
}

function context(answers: (number | undefined)[]) {
  const prompts: { title: string; options: string[] }[] = [];
  const notifications: string[] = [];
  const confirmations: string[] = [];
  const ctx = {
    cwd: "/repo",
    mode: "rpc",
    hasUI: true,
    ui: {
      select: async (title: string, options: string[]) => {
        prompts.push({ title, options });
        const index = answers.shift();
        return index === undefined ? undefined : options[index];
      },
      confirm: async (_title: string, message: string) => { confirmations.push(message); return true; },
      notify: (text: string) => { notifications.push(text); },
      custom: () => { throw new Error("custom UI must not be used"); },
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, prompts, confirmations, notifications };
}

test("standard cleanup dialogs collect skip, remove-only and branch-delete decisions in RPC mode", async () => {
  const { ctx, prompts } = context([0, 1, 2]);
  const result = await openCleanupSelector(ctx, [candidate("skip"), candidate("keep"), candidate("delete")], "main");
  assert.deepEqual(result, [
    { path: "/repo/keep", deleteBranch: false },
    { path: "/repo/delete", deleteBranch: true },
  ]);
  assert.match(prompts[0]!.title, /1\/3.*skip/s);
  assert.match(prompts[0]!.title, /\/repo\/skip/);
  assert.match(prompts[0]!.title, /merged into main/);
});

test("closing a cleanup dialog cancels the whole selection", async () => {
  const { ctx } = context([2, undefined]);
  assert.equal(await openCleanupSelector(ctx, [candidate("first"), candidate("second")], "main"), null);
});

test("explicit Cancel cleanup discards previously collected decisions", async () => {
  const { ctx } = context([1, 3]);
  assert.equal(await openCleanupSelector(ctx, [candidate("first"), candidate("second")], "main"), null);
});

test("protected worktrees are never offered for removal", async () => {
  const primary = candidate("main");
  primary.worktree.primary = true;
  const locked = candidate("locked");
  locked.worktree.locked = true;
  const { ctx, prompts } = context([1]);
  const result = await openCleanupSelector(ctx, [primary, candidate("active", { current: true }), locked, candidate("feature")], "main");
  assert.deepEqual(result, [{ path: "/repo/feature", deleteBranch: false }]);
  assert.equal(prompts.length, 1);
});

test("detached worktrees have no branch deletion option and show dirty and merge warnings", async () => {
  const detached = candidate("detached", { dirty: true });
  detached.worktree.branch = null;
  detached.worktree.detached = true;
  const { ctx, prompts } = context([1, 0]);
  const result = await openCleanupSelector(ctx, [detached, candidate("unmerged", { mergedIntoPrimary: false })], "main");
  assert.deepEqual(result, [{ path: "/repo/detached", deleteBranch: false }]);
  assert.ok(!prompts[0]!.options.some((option) => option.includes("delete local branch")));
  assert.match(prompts[0]!.title, /uncommitted changes/i);
  assert.match(prompts[1]!.title, /not merged/i);
});

for (const scenario of ["cancel selection", "decline final confirmation", "no UI"] as const) {
  test(`cleanup never executes after ${scenario}`, async () => {
    const { ctx } = context(scenario === "cancel selection" ? [undefined] : [2]);
    if (scenario === "no UI") Object.assign(ctx, { hasUI: false });
    ctx.ui.confirm = async () => false;
    let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    let executed = false;
    const pi = {
      on: () => {},
      registerCommand: (_name: string, command: { handler: typeof handler }) => { handler = command.handler; },
    } as unknown as ExtensionAPI;
    const controller = {
      requireRepo: () => "/repo",
      cleanupCandidates: () => [candidate("feature")],
      cleanup: async () => { executed = true; throw new Error("must not execute"); },
    } as unknown as WorktreeController;
    registerWorktreeCommands(pi, controller);
    await handler("cleanup", ctx);
    assert.equal(executed, false);
  });
}

test("RPC cleanup command selects and confirms before executing without the TUI guard", async () => {
  const { ctx, confirmations, notifications } = context([2]);
  let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  let executed: CleanupSelection[] | undefined;
  const pi = {
    on: () => {},
    registerCommand: (_name: string, command: { handler: typeof handler }) => { handler = command.handler; },
  } as unknown as ExtensionAPI;
  const controller = {
    requireRepo: () => "/repo",
    cleanupCandidates: () => [candidate("feature", { dirty: true })],
    cleanup: async (_ctx: ExtensionCommandContext, selected: CleanupSelection[], approvedDirtyPaths: Set<string>) => {
      assert.equal(confirmations.length, 1);
      assert.match(confirmations[0]!, /uncommitted changes.*will be lost/s);
      assert.ok(approvedDirtyPaths.has("/repo/feature"));
      executed = selected;
      return { text: "Cleanup finished", results: [{ removed: true }] };
    },
  } as unknown as WorktreeController;
  registerWorktreeCommands(pi, controller);
  await handler("cleanup", ctx);
  assert.deepEqual(executed, [{ path: "/repo/feature", deleteBranch: true }]);
  assert.deepEqual(notifications, ["Cleanup finished"]);
});
