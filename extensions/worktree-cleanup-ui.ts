import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, isKeyRelease, matchesKey, Text, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { initialCleanupRowState, type CleanupCandidate, type CleanupSelection } from "../src/cleanup.ts";

interface RowState extends CleanupSelection {
  selected: boolean;
}

export async function openCleanupSelector(
  ctx: ExtensionCommandContext,
  candidates: CleanupCandidate[],
  primaryBranch: string | null,
): Promise<CleanupSelection[] | null> {
  if (candidates.length === 0) return [];
  return ctx.ui.custom<CleanupSelection[] | null>(
    (tui, theme, _keybindings, done) => new CleanupSelector(tui, theme, candidates, primaryBranch, done),
    { overlay: true, overlayOptions: { anchor: "center", width: 94, maxHeight: 30 } },
  );
}

class CleanupSelector implements Component {
  private readonly body: Text;
  private readonly container: Container;
  private readonly rows: RowState[];
  private readonly candidates: CleanupCandidate[];
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly primaryBranch: string | null;
  private readonly done: (result: CleanupSelection[] | null) => void;
  private cursor = 0;
  private readonly maxVisible = 5;

  constructor(
    tui: TUI,
    theme: Theme,
    candidates: CleanupCandidate[],
    primaryBranch: string | null,
    done: (result: CleanupSelection[] | null) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.candidates = candidates;
    this.primaryBranch = primaryBranch;
    this.done = done;
    this.rows = candidates.map((candidate) => {
      const initial = initialCleanupRowState(candidate);
      return {
        path: candidate.worktree.path,
        deleteBranch: initial.deleteBranch,
        selected: initial.remove,
      };
    });
    this.body = new Text("", 1, 0);
    this.container = new Container();
    this.container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
    this.container.addChild(this.body);
    this.container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
  }

  render(width: number): string[] {
    const textWidth = Math.max(1, width - 4);
    const eligible = this.rows.filter((row, index) => this.isEligible(index));
    const selectedCount = eligible.filter((row) => row.selected).length;
    const start = Math.max(0, Math.min(this.cursor - Math.floor(this.maxVisible / 2), this.rows.length - this.maxVisible));
    const end = Math.min(this.rows.length, start + this.maxVisible);
    const lines = [
      this.theme.fg("accent", this.theme.bold("Clean up worktrees")),
      this.theme.fg("muted", "Select worktrees to remove; toggle local branch deletion separately."),
      this.theme.fg("dim", `Primary branch: ${this.primaryBranch ?? "unknown"} · ${selectedCount} selected`),
      "",
    ];

    if (start > 0) lines.push(this.theme.fg("dim", `  ↑ ${start} more worktrees`));
    for (let index = start; index < end; index++) {
      const candidate = this.candidateAt(index);
      const row = this.rows[index]!;
      const worktree = candidate.worktree;
      const eligibleRow = this.isEligible(index);
      const focus = index === this.cursor ? this.theme.fg("accent", "›") : " ";
      const marker = eligibleRow
        ? row.selected ? this.theme.fg("success", "[x]") : this.theme.fg("dim", "[ ]")
        : this.theme.fg("dim", "[-]");
      const branch = worktree.branch ?? `detached ${worktree.head.slice(0, 8)}`;
      const flags = [
        worktree.primary ? "primary" : "",
        candidate.current ? "active session" : "",
        worktree.locked ? "locked" : "",
        candidate.dirty ? "dirty · confirmation required" : "",
        worktree.branch && candidate.mergedIntoPrimary ? "merged" : worktree.branch ? "not merged" : "",
      ].filter(Boolean).join(" · ");
      const branchLine = truncateToWidth(`${focus} ${marker} ${branch}${flags ? `  ${flags}` : ""}`, textWidth, "…");
      lines.push(eligibleRow ? branchLine : this.theme.fg("dim", branchLine));
      lines.push(this.theme.fg("dim", truncateToWidth(`      ${worktree.path}`, textWidth, "…")));

      if (worktree.branch && eligibleRow) {
        const checked = row.deleteBranch ? this.theme.fg("success", "[x]") : this.theme.fg("dim", "[ ]");
        const mergeHint = candidate.mergedIntoPrimary
          ? `merged into ${this.primaryBranch ?? "primary"}`
          : "safe delete may refuse if unmerged";
        lines.push(this.theme.fg("muted", `      ${checked} delete local branch · ${mergeHint}`));
      } else if (!eligibleRow) {
        const reason = worktree.primary
          ? "Primary worktree is protected"
          : candidate.current
            ? "Cannot remove the worktree running this session"
            : "Unlock this worktree before cleanup";
        lines.push(this.theme.fg("dim", `      ${reason}`));
      }
      lines.push("");
    }
    if (end < this.rows.length) lines.push(this.theme.fg("dim", `  ↓ ${this.rows.length - end} more worktrees`));
    lines.push(this.theme.fg("dim", "↑/↓ move · Space remove · b toggle branch · a all · n none"));
    lines.push(this.theme.fg("dim", "Enter review cleanup · Esc cancel"));

    this.body.setText(lines.join("\n"));
    return this.container.render(width);
  }

  handleInput(data: string): void {
    if (isKeyRelease(data)) return;
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done(null);
    } else if (matchesKey(data, "up")) {
      this.cursor = (this.cursor - 1 + this.rows.length) % this.rows.length;
    } else if (matchesKey(data, "down")) {
      this.cursor = (this.cursor + 1) % this.rows.length;
    } else if (matchesKey(data, "space")) {
      if (this.isEligible(this.cursor)) this.rows[this.cursor]!.selected = !this.rows[this.cursor]!.selected;
    } else if (matchesKey(data, "b")) {
      const candidate = this.candidateAt(this.cursor);
      if (candidate.worktree.branch && this.isEligible(this.cursor)) {
        this.rows[this.cursor]!.deleteBranch = !this.rows[this.cursor]!.deleteBranch;
      }
    } else if (matchesKey(data, "a")) {
      this.rows.forEach((row, index) => { if (this.isEligible(index)) row.selected = true; });
    } else if (matchesKey(data, "n")) {
      this.rows.forEach((row, index) => { if (this.isEligible(index)) row.selected = false; });
    } else if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.done(this.rows.filter((row) => row.selected).map(({ path, deleteBranch }) => ({ path, deleteBranch })));
      return;
    }
    this.body.invalidate();
    this.tui.requestRender();
  }

  invalidate(): void {
    this.container.invalidate();
  }

  private isEligible(index: number): boolean {
    const candidate = this.candidateAt(index);
    return !candidate.worktree.primary && !candidate.current && !candidate.worktree.locked;
  }

  private candidateAt(index: number): CleanupCandidate {
    return this.candidates[index]!;
  }
}
