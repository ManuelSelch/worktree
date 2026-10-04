import {
  SessionManager,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { existsSync, statSync } from "node:fs";
import {
  WORKTREE_SESSION_ENTRY,
  enteredNote,
  exitNote,
  planEnter,
  readWorktreeSession,
  type WorktreeSession,
} from "../src/enter.ts";
import type { WorktreeController } from "./worktree-controller.ts";

export async function enterWorktree(
  controller: WorktreeController,
  ctx: ExtensionCommandContext,
  wanted: string,
  created = false,
): Promise<void> {
  controller.requireRepo(ctx);
  if (typeof ctx.switchSession !== "function") {
    ctx.ui.notify("This pi build cannot switch sessions, so worktree entry is unavailable.", "error");
    return;
  }

  const worktrees = controller.list(ctx.cwd);
  const primary = worktrees.find((w) => w.primary);
  const match = controller.resolve(ctx, wanted);
  const file = ctx.sessionManager.getSessionFile() ?? null;
  const plan = planEnter(
    ctx.cwd,
    { file, onDisk: Boolean(file && existsSync(file) && statSync(file).size > 0) },
    match ? { path: match.path, branch: match.branch } : null,
  );
  if ("kind" in plan) {
    ctx.ui.notify(plan.message, plan.kind === "already-here" ? "info" : "warning");
    return;
  }

  if (!primary) {
    ctx.ui.notify("The repository has no primary worktree.", "error");
    return;
  }

  const state: WorktreeSession = {
    path: plan.target.path,
    branch: plan.target.branch,
    primaryPath: primary.path,
    primaryBranch: primary.branch,
    parentSession: plan.parentSession,
    created,
    enteredAt: Date.now(),
  };

  try {
    const replacement = plan.mode === "fork"
      ? SessionManager.forkFrom(plan.parentSession!, state.path)
      : SessionManager.create(state.path);
    const replacementFileBeforeMetadata = replacement.getSessionFile();
    if (plan.mode === "fork" && !replacementFileBeforeMetadata) {
      throw new Error("the forked session has no file");
    }
    replacement.appendCustomEntry(WORKTREE_SESSION_ENTRY, state);
    const replacementFile = replacement.getSessionFile();
    if (!replacementFile) throw new Error("the replacement session has no file");
    const { cancelled } = await ctx.switchSession(replacementFile, {
      withSession: async (next) => {
        next.ui.notify(enteredNote(state), "info");
      },
    });
    if (cancelled) ctx.ui.notify("Staying put — the session switch was cancelled.", "info");
  } catch (err) {
    ctx.ui.notify(`Could not enter: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

export async function exitWorktree(
  controller: WorktreeController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const state = readWorktreeSession(ctx.sessionManager.getBranch() as never);
  if (!state) {
    ctx.ui.notify("This session was not entered with a worktree command.", "warning");
    return;
  }
  if (typeof ctx.switchSession !== "function") {
    ctx.ui.notify("This pi build cannot switch sessions, so /worktree exit is unavailable.", "error");
    return;
  }

  const currentFile = ctx.sessionManager.getSessionFile() ?? null;
  const primaryCwd = controller.list(ctx.cwd).find((w) => w.primary)?.path ?? null;

  if (!currentFile || !primaryCwd) {
    if (!state.parentSession || !existsSync(state.parentSession)) {
      ctx.ui.notify(
        "The session this was forked from is gone, so there is nowhere to go back to. This session stays in the worktree.",
        "warning",
      );
      return;
    }
    try {
      await ctx.switchSession(state.parentSession, {
        withSession: async (next) => next.ui.notify(exitNote(state), "info"),
      });
    } catch (err) {
      ctx.ui.notify(`Could not exit: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
    return;
  }

  try {
    const replacement = SessionManager.forkFrom(currentFile, primaryCwd);
    const replacementFile = replacement.getSessionFile();
    if (!replacementFile) throw new Error("the forked session has no file");
    replacement.appendCustomEntry(WORKTREE_SESSION_ENTRY, { ...state, left: true });
    const { cancelled } = await ctx.switchSession(replacementFile, {
      withSession: async (next) => next.ui.notify(exitNote(state), "info"),
    });
    if (cancelled) ctx.ui.notify("Staying put — the session switch was cancelled.", "info");
  } catch (err) {
    ctx.ui.notify(`Could not exit: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}

