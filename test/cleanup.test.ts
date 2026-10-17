import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorktreeInfo } from "../src/parse.ts";
import { runCleanup, type CleanupSelection } from "../src/cleanup.ts";
import { branchExists, deleteLocalBranch, isBranchMerged } from "../src/git.ts";

function worktree(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path: "/repo/worktrees/feature",
    head: "abc123",
    branch: "feature",
    detached: false,
    locked: false,
    prunable: false,
    primary: false,
    ...overrides,
  };
}

function deps(overrides: Partial<Parameters<typeof runCleanup>[3]> = {}) {
  const calls: string[] = [];
  const current = [worktree({ path: "/repo", branch: "main", primary: true }), worktree()];
  return {
    calls,
    current,
    deps: {
      listWorktrees: () => current,
      isDirty: (_path: string) => false,
      removeWorktree: async (path: string, force: boolean) => {
        calls.push(`remove:${path}:${force}`);
        return { ok: true, output: "" };
      },
      deleteBranch: async (branch: string) => {
        calls.push(`branch-delete:${branch}`);
        return { ok: true, output: "" };
      },
      ...overrides,
    },
  };
}

const feature: CleanupSelection = { path: "/repo/worktrees/feature", deleteBranch: true };

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pify-cleanup-"));
  const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", windowsHide: true });
  run("init", "-b", "main");
  run("config", "user.email", "t@t.t");
  run("config", "user.name", "t");
  writeFileSync(join(dir, "file.txt"), "initial\n");
  run("add", ".");
  run("commit", "-m", "initial");
  return dir;
}

test("branch deletion detects merged branches and safely refuses unmerged branches", async () => {
  const repo = makeRepo();
  try {
    const run = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true });
    run("switch", "-c", "merged-feature");
    writeFileSync(join(repo, "merged.txt"), "merged\n");
    run("add", ".");
    run("commit", "-m", "feature change");
    run("switch", "main");
    run("merge", "--ff-only", "merged-feature");

    assert.equal(isBranchMerged(repo, "merged-feature", "main"), true);
    const deleted = await deleteLocalBranch(repo, "merged-feature");
    assert.equal(deleted.ok, true, deleted.output);
    assert.equal(branchExists(repo, "merged-feature"), false);

    run("switch", "-c", "unmerged-feature");
    writeFileSync(join(repo, "unmerged.txt"), "unmerged\n");
    run("add", ".");
    run("commit", "-m", "unmerged change");
    run("switch", "main");

    assert.equal(isBranchMerged(repo, "unmerged-feature", "main"), false);
    const refused = await deleteLocalBranch(repo, "unmerged-feature");
    assert.equal(refused.ok, false);
    assert.match(refused.output, /not fully merged/i);
    assert.equal(branchExists(repo, "unmerged-feature"), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("runCleanup removes the worktree before optionally deleting its local branch", async () => {
  const { calls, deps: cleanupDeps } = deps();
  const outcome = await runCleanup("/repo", [feature], new Set(), cleanupDeps);

  assert.deepEqual(calls, ["remove:/repo/worktrees/feature:false", "branch-delete:feature"]);
  assert.equal(outcome.results[0]?.removed, true);
  assert.equal(outcome.results[0]?.branchDeleted, true);
  assert.match(outcome.text, /feature.*local branch deleted/i);
});

test("runCleanup keeps the branch when worktree removal fails", async () => {
  const { calls, deps: cleanupDeps } = deps({
    removeWorktree: async () => { calls.push("remove-attempt"); return { ok: false, output: "busy" }; },
  });
  const outcome = await runCleanup("/repo", [feature], new Set(), cleanupDeps);

  assert.deepEqual(calls, ["remove-attempt"]);
  assert.equal(outcome.results[0]?.removed, false);
  assert.match(outcome.results[0]?.message ?? "", /busy/);
});

test("runCleanup keeps a branch when safe deletion refuses an unmerged branch", async () => {
  const { deps: cleanupDeps } = deps({
    deleteBranch: async () => ({ ok: false, output: "not fully merged" }),
  });
  const outcome = await runCleanup("/repo", [feature], new Set(), cleanupDeps);

  assert.equal(outcome.results[0]?.removed, true);
  assert.equal(outcome.results[0]?.branchDeleted, false);
  assert.match(outcome.results[0]?.message ?? "", /worktree removed.*branch kept.*not fully merged/i);
});

test("runCleanup never deletes a branch when the option is off or the worktree is detached", async () => {
  const { calls, deps: cleanupDeps } = deps();
  const outcome = await runCleanup("/repo", [{ path: feature.path, deleteBranch: false }], new Set(), cleanupDeps);
  assert.deepEqual(calls, ["remove:/repo/worktrees/feature:false"]);
  assert.equal(outcome.results[0]?.branchDeleted, false);

  const detachedDeps = deps();
  detachedDeps.current[1] = worktree({ branch: null, detached: true });
  const detached = await runCleanup("/repo", [feature], new Set(), detachedDeps.deps);
  assert.ok(!detachedDeps.calls.some((call) => call.startsWith("branch-delete:")));
  assert.equal(detached.results[0]?.removed, true);
});

test("runCleanup refuses primary, active, and locked worktrees even if selected", async () => {
  const primary = worktree({ path: "/repo", branch: "main", primary: true });
  const active = worktree({ path: "/repo/worktrees/feature" });
  const locked = worktree({ path: "/repo/worktrees/locked", branch: "locked", locked: true });
  const current = [primary, active, locked];
  const calls: string[] = [];
  const cleanupDeps = {
    listWorktrees: () => current,
    isDirty: () => false,
    removeWorktree: async (path: string) => { calls.push(`remove:${path}`); return { ok: true, output: "" }; },
    deleteBranch: async (branch: string) => { calls.push(`delete:${branch}`); return { ok: true, output: "" }; },
  };

  const outcome = await runCleanup("/repo/worktrees/feature/src", [
    { path: "/repo", deleteBranch: true },
    { path: active.path, deleteBranch: true },
    { path: locked.path, deleteBranch: true },
  ], new Set(), cleanupDeps);

  assert.deepEqual(calls, []);
  assert.equal(outcome.results.length, 3);
  assert.ok(outcome.results.every((result) => !result.removed));
});

test("runCleanup requires approval for dirty worktrees and forces removal only for approved paths", async () => {
  const { calls, deps: cleanupDeps } = deps({ isDirty: () => true });
  const declined = await runCleanup("/repo", [feature], new Set(), cleanupDeps);
  assert.deepEqual(calls, []);
  assert.match(declined.results[0]?.message ?? "", /dirty.*confirmation/i);

  const approved = await runCleanup("/repo", [feature], new Set([feature.path.toUpperCase()]), cleanupDeps);
  assert.equal(calls[0], `remove:${feature.path}:true`);
  assert.equal(approved.results[0]?.removed, true);
});

test("runCleanup re-resolves selected paths before each operation", async () => {
  const { calls, deps: cleanupDeps } = deps({ listWorktrees: () => [] });
  const outcome = await runCleanup("/repo", [feature], new Set(), cleanupDeps);
  assert.deepEqual(calls, []);
  assert.match(outcome.results[0]?.message ?? "", /no longer exists/i);
});
