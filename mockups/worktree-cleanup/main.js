const worktrees = [
  { branch: "main", path: "~/code/orbit", primary: true },
  { branch: "feature/login-timeout", path: "~/.worktrees/orbit/feature-login-timeout", merged: true, selected: true, deleteBranch: true },
  { branch: "feature/export-csv", path: "~/.worktrees/orbit/feature-export-csv", merged: false, selected: true, deleteBranch: false },
  { branch: "fix/stale-cache", path: "~/.worktrees/orbit/fix-stale-cache", merged: true, dirty: true, selected: false, deleteBranch: true },
  { branch: "feature/new-dashboard", path: "~/.worktrees/orbit/feature-new-dashboard", current: true },
  { branch: "agent/review-worker", path: "~/.worktrees/orbit/agent-review-worker", locked: true },
];
const list = document.querySelector("#worktree-list");
const count = document.querySelector("#selection-count");
const reviewCount = document.querySelector("#review-count");
const reviewButton = document.querySelector("#review");
const warning = document.querySelector("#warning");
const eligible = () => worktrees.filter((w) => !w.current && !w.locked && !w.primary);

function render() {
  list.innerHTML = "";
  for (const [i, worktree] of worktrees.entries()) {
    const disabled = worktree.current || worktree.locked || worktree.primary;
    const row = document.createElement("div");
    row.className = `row${worktree.selected ? " selected" : ""}${disabled ? " disabled" : ""}${worktree.current ? " current" : ""}${worktree.locked ? " locked" : ""}${worktree.primary ? " primary-row" : ""}`;
    const mergedStatus = worktree.merged ? '<span class="badge merged">merged into main</span>' : worktree.branch ? '<span class="badge unmerged">not merged</span>' : "";
    const badges = [mergedStatus, worktree.dirty ? '<span class="badge dirty">uncommitted changes</span>' : "", worktree.current ? '<span class="badge current">active session</span>' : "", worktree.locked ? '<span class="badge locked">locked</span>' : "", worktree.primary ? '<span class="badge">primary</span>' : ""].filter(Boolean).join("");
    row.innerHTML = `<input class="check remove-check" type="checkbox" aria-label="Remove worktree ${worktree.branch}" ${worktree.selected ? "checked" : ""} ${disabled ? "disabled" : ""}><div class="details"><div class="branch-main">${worktree.branch ?? "(detached HEAD)"}</div><div class="path">${worktree.path}</div>${!disabled ? `<label class="branch-option"><input class="branch-check" type="checkbox" aria-label="Delete local branch ${worktree.branch}" ${worktree.deleteBranch ? "checked" : ""}><span>Delete local branch</span><span class="hint">${worktree.merged ? "· merged" : "· safe delete may refuse if unmerged"}</span></label>` : ""}</div><div class="badges">${badges}</div>${disabled ? `<div class="disabled-label">${worktree.current ? "Cannot remove the worktree running this session" : worktree.locked ? "Unlock this worktree before cleanup" : "Primary worktree is protected"}</div>` : ""}`;
    const removeCheck = row.querySelector(".remove-check");
    removeCheck?.addEventListener("change", () => { worktree.selected = removeCheck.checked; warning.hidden = true; render(); });
    const branchCheck = row.querySelector(".branch-check");
    branchCheck?.addEventListener("change", () => { worktree.deleteBranch = branchCheck.checked; render(); });
    list.append(row);
  }
  const selected = eligible().filter((w) => w.selected);
  count.textContent = `${selected.length} selected`;
  reviewCount.textContent = `(${selected.length})`;
  reviewButton.disabled = selected.length === 0;
}

document.querySelector("#select-all").addEventListener("click", () => {
  for (const w of eligible()) w.selected = true;
  warning.hidden = true;
  render();
});
document.querySelector("#cancel").addEventListener("click", () => toast("Cleanup cancelled — no worktrees changed."));
reviewButton.addEventListener("click", () => {
  const selected = eligible().filter((w) => w.selected);
  if (selected.some((w) => w.dirty)) {
    warning.hidden = false;
    warning.innerHTML = "<strong>Uncommitted changes will be lost.</strong> Dirty worktrees need a separate confirmation before removal. The branch will be kept if removal fails.";
    return;
  }
  const removing = selected.map((w) => `${w.branch}${w.deleteBranch ? " (delete local branch)" : " (keep branch)"}`).join(", ");
  toast(selected.length ? `Review step: ${removing}` : "Select at least one worktree.");
});
function toast(text) {
  const el = document.querySelector("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") document.querySelector("#cancel").click();
  if (event.key === "Enter" && event.target.tagName !== "BUTTON") reviewButton.click();
});
render();
