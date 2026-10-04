# Custom Worktree Extension Requirements

## 1. Overview

Customize the fork of `@pify/worktree` into a simple Pi worktree extension that can create, enter, inspect, leave, merge, and remove Git worktrees while preserving Pi's session conversation where possible.

The extension must support both persisted sessions and genuinely fresh/empty Pi sessions. A fresh session must not fail merely because there is no session file available to fork.

## 2. Goals

- Create a Git branch and worktree and automatically move the user into it.
- Enter an existing worktree from the current session.
- Return from a worktree to the primary checkout without merging.
- Merge the current or a named worktree branch into the primary branch.
- Remove a named worktree after a successful named merge while keeping its branch.
- Provide a `/worktree` command that lists worktrees clearly, with entries separated by newlines.
- Provide agent-callable tools for worktree inspection and Git operations.
- Preserve the existing safety model and test coverage from the upstream package.

## 3. Non-goals

- Do not implement tmux, terminal spawning, or background Pi processes.
- Do not automatically delete Git branches after removing worktrees.
- Do not bypass dirty-worktree, primary-worktree, locked-worktree, or current-session safety checks.
- Do not automatically resolve merge conflicts.
- Do not claim that an agent tool changed the active Pi session when only a user command can switch sessions.

## 4. User Commands

### 4.1 `/worktree`

List all Git worktrees for the current repository.

Each worktree must be rendered as its own block, with a newline between entries. The output must not join entries using commas or spaces.

Each entry should include:

- worktree path;
- branch name, or detached HEAD identifier;
- primary marker;
- current-session marker when applicable;
- dirty marker;
- locked marker;
- prunable marker.

Example:

```text
/Users/me/project
  main (primary)

/Users/me/.worktrees/project/feature-login
  feature-login (current, dirty)
```

The command should use the same formatter as the `worktree_list` agent tool.

### 4.2 `/worktree-create <name>`

Create a new branch and worktree and automatically enter it.

Requirements:

1. Verify that the current directory is inside a Git repository.
2. Validate `<name>` as a safe Git branch name.
3. Create the worktree below the configured worktree root, preserving the upstream naming convention.
4. Use the current checkout's HEAD as the default base.
5. Optionally preserve support for an explicit base ref if the command syntax can remain unambiguous.
6. Switch the Pi session into the new worktree.
7. If the current session has a persisted, non-empty session file, fork the conversation into the worktree.
8. If the current session is empty or has no usable session file, create a new session rooted in the worktree instead of calling `SessionManager.forkFrom`.
9. Record worktree/session metadata in the replacement session.
10. If session switching fails after worktree creation, report the worktree path and leave the worktree intact for manual entry.

Suggested usage:

```text
/worktree-create feature-login
```

### 4.3 `/worktree-enter <name>`

Enter an existing worktree by branch name, directory name, absolute path, or supported namespaced branch alias.

Requirements:

- Refuse when no matching worktree exists.
- Report that the session is already there when the target is the current worktree.
- Fork a persisted current conversation into the target worktree.
- Create a new session rooted in the target worktree when the current session is empty or unwritten.
- Store the parent session when a fork occurred.
- Do not modify Git state merely by entering a worktree.

### 4.4 `/worktree-exit`

Leave the current worktree and return to the primary checkout without merging or deleting the worktree.

Requirements:

- Refuse with a clear message when the session is not managed as a worktree session.
- Carry the current conversation back into the primary checkout when a persisted session is available.
- Support returning from a fresh worktree session by creating or switching to a fresh primary-rooted session when the Pi API permits it.
- Preserve the worktree and branch.
- Mark the returned session as no longer being inside a worktree.
- Do not discard uncommitted work in the worktree.

Primary use cases:

- pause unfinished work and continue on the primary checkout;
- review or compare the worktree later;
- leave before deciding whether to merge or remove it;
- keep the branch available for future work.

### 4.5 `/worktree-merge`

Merge the current worktree branch into the primary branch.

Requirements:

- Require the current session to be inside a non-primary worktree.
- Refuse if the current worktree or primary worktree has uncommitted changes.
- Merge from the primary worktree.
- Abort cleanly on conflicts and leave the primary checkout in its pre-merge state.
- Keep the current worktree because the active session is rooted there.
- Keep the branch.
- Explain that `/worktree-exit` must be used before removing the now-merged current worktree.

### 4.6 `/worktree-merge <name>`

Merge a named worktree branch into the primary branch and remove that named worktree while keeping the branch.

Requirements:

1. Resolve `<name>` using the same target resolution rules as enter/remove.
2. Refuse the primary worktree.
3. Refuse locked worktrees.
4. Refuse dirty worktrees unless an explicit, documented confirmation policy is added; the default policy is fail-safe refusal.
5. Refuse or safely special-case the currently active worktree because its directory cannot be removed while the session uses it.
6. Merge into the primary branch.
7. Abort cleanly on conflicts.
8. Remove the named worktree only after a successful merge.
9. Keep the branch after removing the worktree.

Expected result:

```text
Merged feature-login into main and removed its worktree. The branch was kept.
```

## 5. Agent Tools

The extension must expose tools for the agent in addition to user commands.

### 5.1 `worktree_list`

List all worktrees with the same newline-separated formatting used by `/worktree`.

### 5.2 `worktree_create`

Create a worktree and branch without pretending to switch the active agent session.

The result must include:

- absolute worktree path;
- branch name;
- base commit/ref;
- explicit instructions for `/worktree-enter <name>` or opening a separate Pi process.

### 5.3 `worktree_remove`

Remove a named worktree while keeping its branch.

Safety requirements from upstream must remain:

- never remove the primary worktree;
- never remove the worktree containing the active session;
- never remove a locked worktree;
- inspect dirty state before removal;
- require UI confirmation for dirty removal when confirmation is supported;
- fail closed when no UI is available.

### 5.4 `worktree_merge`

Merge a named worktree branch into the primary branch and remove the worktree after a successful merge.

The tool must return structured details including:

- target branch;
- whether the merge succeeded;
- whether the worktree was removed;
- whether the worktree was retained because it contains the active session.

The tool may support an optional branch parameter for current-branch merging, but the command-level behavior must remain clear and testable.

## 6. Session State

Reuse the upstream custom session entry mechanism rather than relying only on process memory.

The stored state should identify:

```ts
interface WorktreeSession {
  path: string;
  branch: string | null;
  primaryPath: string;
  primaryBranch: string | null;
  parentSession: string | null;
  created: boolean;
  enteredAt: number;
  left?: boolean;
}
```

`parentSession` must allow `null` for fresh-session entry.

A `left` marker must prevent a later `/worktree-exit` from returning repeatedly to a stale grandparent session.

## 7. Safety and Reliability

- Execute Git through argument-based `execFile` calls; never interpolate user input into shell commands.
- Validate branch names and base refs before passing them to Git.
- Preserve upstream cancellation and timeout behavior for slow Git operations.
- Do not remove a worktree before a merge has completed successfully.
- Ensure merge conflicts abort cleanly.
- Leave newly created worktrees intact when session switching fails, and report how to enter them manually.
- Preserve existing primary/current/locked/dirty worktree protections.
- Use the same target resolution rules across commands and tools.

## 8. Testing Requirements

Add or update unit and integration tests covering:

1. `/worktree` output separates entries with newlines.
2. `/worktree` and `worktree_list` use the same formatting.
3. Create and enter from a persisted session.
4. Create and enter from an empty session.
5. Enter an existing worktree from an empty session.
6. Enter refuses an unknown target.
7. Enter reports when already in the target worktree.
8. Exit carries a persisted conversation back to primary.
9. Exit preserves the worktree and branch.
10. Current-worktree merge merges but retains the current worktree.
11. Named merge merges and removes the named worktree.
12. Named merge keeps the branch.
13. Dirty worktrees are protected.
14. Primary and locked worktrees cannot be removed.
15. Merge conflicts abort without a half-merged state.
16. Session-switch failure does not silently remove a created worktree.
17. Agent tools return accurate paths, branch names, and operation status.

## 9. Documentation Requirements

Update `README.md` to document:

```text
/worktree
/worktree-create <name>
/worktree-enter <name>
/worktree-exit
/worktree-merge
/worktree-merge <name>
```

Document the difference between:

- entering from a persisted session, which carries the conversation;
- entering from an empty session, which creates a new session in the target;
- agent tools, which cannot themselves replace the user's active Pi session.

Document that merging the active worktree cannot remove its directory until the user exits it.

## 10. Implementation Breakdown

1. Introduce a shared fork-or-create session transition helper.
2. Extend session metadata for fresh sessions and primary checkout information.
3. Implement `/worktree-create <name>`.
4. Rename and adapt enter behavior as `/worktree-enter <name>`.
5. Preserve and adapt `/worktree-exit`.
6. Make `/worktree` the newline-separated list command.
7. Add no-argument current-branch merge behavior.
8. Add named merge-and-remove behavior.
9. Align agent tools with command behavior and result messages.
10. Add tests for session transitions, formatting, merge safety, and cleanup.
11. Update README and package documentation.

## 11. Open Technical Question

Before implementing the empty-session path, confirm the installed Pi SDK API for creating a new session rooted at a specified working directory. The implementation must use the supported session API rather than constructing session files manually.
