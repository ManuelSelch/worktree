import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createWorktreeController } from "../extensions/worktree-controller.ts";
import type { CleanupOutcome, CleanupProgress } from "../src/cleanup.ts";
import { branchExists } from "../src/git.ts";

class CleanupControllerDriver {
  private repo = realpathSync(mkdtempSync(join(tmpdir(), "pify-controller-progress-")));
  private feature = join(this.repo, "feature");
  private progress: CleanupProgress[] = [];
  private outcome?: CleanupOutcome;

  constructor() {
    try {
      this.git("init", "-b", "main");
      this.git("config", "user.email", "t@t.t");
      this.git("config", "user.name", "t");
      writeFileSync(join(this.repo, "file.txt"), "initial\n");
      this.git("add", ".");
      this.git("commit", "-m", "initial");
      this.git("worktree", "add", "-b", "feature", this.feature);
    } catch (error) { this.dispose(); throw error; }
  }

  private git(...args: string[]) {
    return execFileSync("git", args, { cwd: this.repo, encoding: "utf8", stdio: "pipe", windowsHide: true });
  }

  async removeFeature() {
    this.outcome = await createWorktreeController().cleanup(
      { cwd: this.repo } as ExtensionContext,
      [{ path: this.feature, deleteBranch: true }], new Set(), undefined,
      event => { this.progress.push(event); },
    );
  }

  reportsEveryPhaseAndRemovesFeature() {
    assert.deepEqual(this.progress, ["checking", "removing", "deleting-branch"].map(phase => ({
      index: 1, total: 1, label: "feature", phase,
    })));
    assert.equal(this.outcome?.results[0]?.removed, true);
    assert.equal(this.outcome?.results[0]?.branchDeleted, true);
    assert.equal(existsSync(this.feature), false);
    assert.equal(branchExists(this.repo, "feature"), false);
  }

  dispose() { rmSync(this.repo, { recursive: true, force: true }); }
}

test("controller forwards cleanup phases while removing a real worktree and branch", async t => {
  const cleanup = new CleanupControllerDriver();
  t.after(() => cleanup.dispose());
  await cleanup.removeFeature();
  cleanup.reportsEveryPhaseAndRemovesFeature();
});
