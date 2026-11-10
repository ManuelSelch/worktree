import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { registerWorktreeCommands } from "../extensions/worktree-commands.ts";
import type { WorktreeController } from "../extensions/worktree-controller.ts";
import type { CleanupCandidate } from "../src/cleanup.ts";

class CleanupPresentationDriver {
  private candidates: CleanupCandidate[] = [];
  private title = "";
  private rows: string[] = [];
  private confirmation = "";

  private candidate(branch: string | null, dirty = false, mergedIntoPrimary = false): CleanupCandidate {
    return {
      worktree: { path: `/repo/${branch ?? "detached"}`, branch, head: "abc12345", primary: false, locked: false, detached: branch === null, prunable: false },
      current: false, dirty, mergedIntoPrimary,
    };
  }

  async openUnmergedWorktrees(): Promise<void> {
    this.candidates = [this.candidate("first"), this.candidate("second")];
    await this.open();
  }

  async openMixedWorktrees(): Promise<void> {
    this.candidates = [this.candidate("first", false, true), this.candidate("unmerged"), this.candidate("dirty", true), this.candidate(null)];
    await this.open();
  }

  private async open(): Promise<void> {
    let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    const pi = { on: () => {}, registerCommand: (_name: string, command: { handler: typeof handler }) => { handler = command.handler; } } as unknown as ExtensionAPI;
    const controller = { requireRepo: () => "/repo", cleanupCandidates: () => this.candidates } as unknown as WorktreeController;
    registerWorktreeCommands(pi, controller);
    let selectedUnmerged = false;
    const ctx = {
      cwd: "/repo", hasUI: true,
      ui: {
        select: async (title: string, options: string[]) => {
          if (!this.rows.length) {
            this.title = title;
            this.rows = options;
          }
          if (this.candidates.some(candidate => candidate.worktree.branch === "unmerged") && !selectedUnmerged) {
            selectedUnmerged = true;
            return options.find(option => option.includes("unmerged"));
          }
          return "Review cleanup";
        },
        confirm: async (_title: string, message: string) => { this.confirmation = message; return false; },
        notify: () => {},
      },
    } as unknown as ExtensionCommandContext;
    await handler("cleanup", ctx);
  }

  async reviewSelection(): Promise<void> {
    assert.ok(this.confirmation, "Expected a review before cleanup");
  }

  shouldShowOneSharedUnmergedWarning(): void {
    assert.match(this.title, /not merged.*(?:refuse|refused)/i);
    assert.doesNotMatch(this.rows.join("\n"), /not merged|safe branch deletion/i);
  }

  shouldShowBranchNamesWithoutCleanLabels(): void {
    assert.ok(this.rows.some(row => row === "[ ] first" || row === "[x] first"));
    assert.doesNotMatch(this.rows.join("\n"), /\bclean\b/i);
  }

  shouldMarkUncommittedChangesAndDetachedWorktrees(): void {
    assert.match(this.rows.join("\n"), /dirty.*uncommitted changes/i);
    assert.match(this.rows.join("\n"), /abc12345.*detached HEAD/i);
  }

  shouldShowReviewDetails(details: string[]): void {
    for (const detail of details) assert.ok(this.confirmation.includes(detail), `Missing review detail: ${detail}`);
  }
}

let cleanup: CleanupPresentationDriver;

beforeEach(() => {
  cleanup = new CleanupPresentationDriver();
});

test("unmerged worktrees share one warning instead of repeating clean status", async () => {
  await cleanup.openUnmergedWorktrees();
  cleanup.shouldShowOneSharedUnmergedWarning();
  cleanup.shouldShowBranchNamesWithoutCleanLabels();
});

test("mixed worktrees identify exceptional statuses without changing cleanup consequences", async () => {
  await cleanup.openMixedWorktrees();
  cleanup.shouldShowBranchNamesWithoutCleanLabels();
  cleanup.shouldMarkUncommittedChangesAndDetachedWorktrees();
  await cleanup.reviewSelection();
  cleanup.shouldShowReviewDetails(["remove worktree", "delete local branch", "safe delete may keep it if unmerged"]);
});
