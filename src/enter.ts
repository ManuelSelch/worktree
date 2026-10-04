/**
 * Entering a worktree without losing the conversation.
 *
 * Creating a worktree was only ever half the job: pi binds `read`, `edit`,
 * `bash` and `@` completion to the session's cwd, and a session cannot change
 * its own cwd. So until now this package could hand you a path and a
 * suggestion to open a second terminal — and everything you had discussed
 * stayed in the terminal you left.
 *
 * The way through is a replacement session: fork the current session file
 * into the worktree and switch to it. The conversation comes along, the tools
 * rebind, and the branch you were reading about is the branch you are now in.
 * (Mechanism from FradSer/pi-packages' utils, which found it first.)
 *
 * Pure helpers only — the switch itself needs the host and lives in the
 * extension.
 */

export const WORKTREE_SESSION_ENTRY = "pify-worktree-session";

export interface WorktreeSession {
  /** Absolute path of the worktree this session is rooted in. */
  path: string;
  branch: string | null;
  /** Primary checkout to return to and merge into. */
  primaryPath: string;
  primaryBranch: string | null;
  /** Session file we forked from, or null when a fresh session was created. */
  parentSession: string | null;
  /** True when entering created the worktree, so leaving may offer to remove it. */
  created: boolean;
  enteredAt: number;
  /**
   * Set on the entry appended by /worktree exit: this session has LEFT the
   * worktree (it forked the conversation back into the primary checkout).
   * readWorktreeSession treats a left state as "no worktree state" so a second
   * /worktree exit does not bounce again — an emptied entry cannot express this
   * because readWorktreeSession keys off a non-empty path.
   */
  left?: boolean;
}

export interface BranchEntryLike {
  type?: string;
  customType?: string;
  data?: unknown;
  [key: string]: unknown;
}

/** The worktree state this session was entered with, if any. */
export function readWorktreeSession(entries: readonly BranchEntryLike[]): WorktreeSession | null {
  let state: WorktreeSession | null = null;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== WORKTREE_SESSION_ENTRY) continue;
    const data = entry.data as Partial<WorktreeSession> | null;
    if (!data || typeof data.path !== "string" || !data.path) continue;
    // A "left" marker (written by /worktree exit) clears the state: this session
    // has already returned to the primary checkout, so it is no longer rooted in
    // a worktree. A later fresh enter appends its own non-left entry after it.
    if (data.left === true) {
      state = null;
      continue;
    }
    state = {
      path: data.path,
      branch: typeof data.branch === "string" ? data.branch : null,
      primaryPath: typeof data.primaryPath === "string" ? data.primaryPath : "",
      primaryBranch: typeof data.primaryBranch === "string" ? data.primaryBranch : null,
      parentSession: typeof data.parentSession === "string" ? data.parentSession : null,
      created: data.created === true,
      enteredAt: typeof data.enteredAt === "number" ? data.enteredAt : 0,
    };
  }
  return state;
}

export type EnterProblem =
  | { kind: "no-session"; message: string }
  | { kind: "unwritten"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "already-here"; message: string };

export interface EnterPlan {
  target: { path: string; branch: string | null };
  parentSession: string | null;
  mode: "fork" | "new";
}

/** What we know about the session we would be forking. */
export interface ParentSession {
  file: string | null;
  /**
   * Whether that file exists with entries in it. pi keeps a session in memory
   * until the first assistant message, so a brand-new session has a name on
   * disk and nothing behind it — and forking from it throws.
   */
  onDisk: boolean;
}

function samePath(a: string, b: string): boolean {
  return a.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase() ===
    b.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Decide how entering should happen before anything is switched. A persisted
 * session is forked; an empty or unwritten session is replaced with a new
 * session rooted in the target worktree.
 */
export function planEnter(
  cwd: string,
  parent: ParentSession,
  target: { path: string; branch: string | null } | null,
): EnterPlan | EnterProblem {
  if (!target) {
    return {
      kind: "not-found",
      message: "No worktree matches that. /worktree shows them; /worktree create <branch> makes one.",
    };
  }
  if (samePath(cwd, target.path)) {
    return { kind: "already-here", message: "This session is already rooted in that worktree." };
  }
  return {
    target,
    parentSession: parent.file && parent.onDisk ? parent.file : null,
    mode: parent.file && parent.onDisk ? "fork" : "new",
  };
}

export function enteredNote(session: WorktreeSession): string {
  const target = session.branch ?? session.path;
  return `Entered ${target}. Use /worktree exit to return.`;
}

export function exitNote(session: WorktreeSession): string {
  return session.created
    ? `Returned to primary. Worktree kept: ${session.branch ?? session.path}.`
    : "Returned to the primary checkout.";
}
