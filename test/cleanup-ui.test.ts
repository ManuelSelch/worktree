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
    current: false, dirty: false, mergedIntoPrimary: true, ...overrides,
  };
}

/** Shared UI driver: scenarios use menu actions, never dialog option indexes. */
class CleanupDriver {
  prompts: { title: string; options: string[] }[] = [];
  confirmations: string[] = [];
  notifications: string[] = [];
  private actions: (string | undefined)[] = [];
  approve = true;
  ctx: ExtensionCommandContext;

  constructor(mode: "tui" | "rpc" = "rpc") {
    this.ctx = {
      cwd: "/repo", mode, hasUI: true,
      ui: {
        select: async (title: string, options: string[]) => {
          this.prompts.push({ title, options });
          const action = this.actions.shift();
          if (action === undefined) return undefined;
          const matches = options.filter(option => option.includes(action));
          assert.equal(matches.length, 1, `Expected one menu action matching ${action}`);
          return matches[0];
        },
        confirm: async (_title: string, message: string) => {
          this.confirmations.push(message);
          return this.approve;
        },
        notify: (message: string, type?: string) => {
          assert.notEqual(type, "error", message);
          this.notifications.push(message);
        },
        custom: () => { throw new Error("Cleanup must use standard dialogs in both modes"); },
      },
    } as unknown as ExtensionCommandContext;
  }

  choose(...actions: (string | undefined)[]) { this.actions.push(...actions); }
  select(candidates: CleanupCandidate[]) { return openCleanupSelector(this.ctx, candidates, "main"); }
  checked(branch: string, expected: boolean, prompt = 0) {
    const row = this.prompts[prompt]!.options.find(option => option.slice(4).startsWith(`${branch} —`));
    assert.ok(row, `Missing worktree ${branch}`);
    assert.ok(row.startsWith(expected ? "[x]" : "[ ]"), row);
  }
  async command(candidates: CleanupCandidate[], cleanup: WorktreeController["cleanup"]) {
    let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    const pi = {
      on: () => {},
      registerCommand: (_name: string, command: { handler: typeof handler }) => { handler = command.handler; },
    } as unknown as ExtensionAPI;
    const controller = { requireRepo: () => "/repo", cleanupCandidates: () => candidates, cleanup } as unknown as WorktreeController;
    registerWorktreeCommands(pi, controller);
    await handler("cleanup", this.ctx);
  }
}

for (const mode of ["tui", "rpc"] as const) {
  test(`${mode}: checklist preselects only merged clean worktrees`, async () => {
    const ui = new CleanupDriver(mode);
    ui.choose("Review cleanup");
    assert.deepEqual(await ui.select([
      candidate("merged"), candidate("dirty", { dirty: true }),
      candidate("unmerged", { mergedIntoPrimary: false }),
    ]), [{ path: "/repo/merged", deleteBranch: true }]);
    assert.equal(ui.prompts.length, 1);
    assert.doesNotMatch(ui.prompts[0]!.options.join("\n"), /\/repo\//);
    ui.checked("merged", true);
    ui.checked("dirty", false);
    ui.checked("unmerged", false);
    assert.match(ui.prompts[0]!.options.join("\n"), /merged into main/);
    assert.match(ui.prompts[0]!.options.join("\n"), /Uncommited changes/);
    assert.doesNotMatch(ui.prompts[0]!.options.join("\n"), /WARNING|will be lost/);
    assert.match(ui.prompts[0]!.options.join("\n"), /not merged/);
  });

  test(`${mode}: toggling keeps all entries in one menu with uniform remove-and-delete`, async () => {
    const ui = new CleanupDriver(mode);
    ui.choose("first", "second", "Review cleanup");
    assert.deepEqual(await ui.select([candidate("first"), candidate("second", { mergedIntoPrimary: false })]),
      [{ path: "/repo/second", deleteBranch: true }]);
    ui.checked("first", false, 1);
    ui.checked("second", true, 2);
    assert.equal(new Set(ui.prompts.map(prompt => prompt.options.length)).size, 1);
    const shape = (title: string) => title.replace(/[\d/]+/g, "");
    assert.equal(new Set(ui.prompts.map(prompt => shape(prompt.title))).size, 1);
  });
}

for (const cancel of [undefined, "Cancel cleanup"]) {
  test(`cancelling via ${cancel ?? "dismissal"} discards all toggles`, async () => {
    const ui = new CleanupDriver();
    ui.choose("first", cancel);
    assert.equal(await ui.select([candidate("first"), candidate("second")]), null);
  });
}

test("primary, current and locked worktrees are never offered or selected", async () => {
  const primary = candidate("main"); primary.worktree.primary = true;
  const locked = candidate("locked"); locked.worktree.locked = true;
  const ui = new CleanupDriver();
  ui.choose("Review cleanup");
  assert.deepEqual(await ui.select([primary, locked, candidate("active", { current: true }), candidate("feature")]),
    [{ path: "/repo/feature", deleteBranch: true }]);
  assert.equal(ui.prompts[0]!.options.length, 3);
  assert.doesNotMatch(ui.prompts[0]!.options.join("\n"), /\[[x ]\] (main|locked|active) —/);
});

test("detached worktrees can be selected without branch deletion", async () => {
  const detached = candidate("detached", { mergedIntoPrimary: false });
  detached.worktree.branch = null; detached.worktree.detached = true;
  const ui = new CleanupDriver();
  ui.choose("detached", "Review cleanup");
  assert.deepEqual(await ui.select([detached]), [{ path: "/repo/detached", deleteBranch: false }]);
  assert.match(ui.prompts[0]!.options[0]!, /abc123.*detached HEAD/);
});

test("no eligible worktrees skips the dialog", async () => {
  const ui = new CleanupDriver();
  assert.deepEqual(await ui.select([candidate("current", { current: true })]), []);
  assert.equal(ui.prompts.length, 0);
});

test("all worktrees can be deselected before review", async () => {
  const ui = new CleanupDriver();
  ui.choose("feature", "Review cleanup");
  assert.deepEqual(await ui.select([candidate("feature")]), []);
});

for (const scenario of ["cancel selection", "decline final confirmation", "no UI", "empty selection"] as const) {
  test(`cleanup never executes after ${scenario}`, async () => {
    const ui = new CleanupDriver();
    ui.choose(...(scenario === "cancel selection" ? [undefined] : scenario === "empty selection" ? ["feature", "Review cleanup"] : ["Review cleanup"]));
    if (scenario === "no UI") Object.assign(ui.ctx, { hasUI: false });
    if (scenario === "decline final confirmation") ui.approve = false;
    let executed = false;
    await ui.command([candidate("feature")], async () => { executed = true; throw new Error("must not execute"); });
    assert.equal(executed, false);
    assert.equal(ui.confirmations.length, scenario === "decline final confirmation" ? 1 : 0);
    if (scenario === "empty selection") assert.deepEqual(ui.notifications, ["No worktrees selected."]);
  });
}

test("RPC cleanup confirms selected dirty worktrees and branch deletion before execution", async () => {
  const ui = new CleanupDriver();
  ui.choose("feature", "Review cleanup");
  let executed: CleanupSelection[] | undefined;
  await ui.command([candidate("feature", { dirty: true })], async (_ctx, selected, approvedDirtyPaths) => {
    assert.equal(ui.confirmations.length, 1);
    assert.match(ui.confirmations[0]!, /uncommitted changes.*will be lost/s);
    assert.match(ui.confirmations[0]!, /delete local branch/);
    assert.ok(approvedDirtyPaths.has("/repo/feature"));
    executed = selected;
    return { text: "Cleanup finished", results: [] };
  });
  assert.deepEqual(executed, [{ path: "/repo/feature", deleteBranch: true }]);
  assert.deepEqual(ui.notifications, ["Cleanup finished"]);
});
