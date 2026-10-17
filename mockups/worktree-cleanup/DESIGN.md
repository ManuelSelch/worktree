# Worktree cleanup mockup

- Goal: explore an interactive `/worktree cleanup` dialog for batch removal of selected worktrees and optional local branches.
- Revision: 1
- Platform: Pi terminal UI; this browser mockup approximates a TUI popup and does not validate terminal rendering.
- Interaction: rows are selected for worktree removal; each eligible row has a separate `Delete local branch` checkbox. `Select all eligible` selects all removable worktrees. `Review cleanup` summarizes the requested operations. `Cancel` changes nothing.
- Safety shown: primary/current/locked worktrees are disabled; dirty worktrees are visibly marked and surface an extra loss warning; unmerged branches use safe deletion and can be retained.
- Scope: fake repository data only. No Git operations. Review is a toast, not the production confirmation/operation flow.
- Open design question: Should branch deletion start checked for all eligible branches, or only for branches already merged into the primary branch? Revision 1 checks only merged branches by default.
- Review status: approved for implementation.
- Approval evidence: user said “looks good. implement it” for revision 1.
