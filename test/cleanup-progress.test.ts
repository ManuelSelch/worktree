import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { startCleanupProgress, type CleanupProgressClock } from "../extensions/worktree-cleanup-progress.ts";

function fixture() {
  let now = 1000;
  const ticks = new Set<() => void>();
  const writes: { key: string; lines: string[] | undefined; placement?: string }[] = [];
  const ui: Pick<ExtensionUIContext, "setWidget"> = {
    setWidget(key, content, options) {
      assert.ok(content === undefined || Array.isArray(content));
      writes.push({ key, lines: content, placement: options?.placement });
    },
  };
  const clock: CleanupProgressClock = {
    now: () => now,
    everySecond: tick => { ticks.add(tick); return () => { ticks.delete(tick); }; },
  };
  return { ui, clock, ticks, writes, advance(ms: number) { now += ms; for (const tick of ticks) tick(); } };
}

test("progress starts above the editor and refreshes elapsed batch time without new phase events", () => {
  const f = fixture();
  const progress = startCleanupProgress(f.ui, f.clock);
  try {
    assert.deepEqual(f.writes[0]?.lines, ["Cleanup · Preparing… · 0s"]);
    assert.equal(f.writes[0]?.placement, "aboveEditor");
    progress.update({ index: 2, total: 8, label: "feature/login", phase: "removing" });
    assert.deepEqual(f.writes.at(-1)?.lines, ["Cleanup 2/8 · Removing feature/login · 0s"]);
    f.advance(12900);
    assert.deepEqual(f.writes.at(-1)?.lines, ["Cleanup 2/8 · Removing feature/login · 12s"]);
    progress.update({ index: 2, total: 8, label: "feature/login", phase: "deleting-branch" });
    assert.deepEqual(f.writes.at(-1)?.lines, ["Cleanup 2/8 · Deleting branch feature/login · 12s"]);
    progress.update({ index: 3, total: 8, label: "next", phase: "checking" });
    assert.deepEqual(f.writes.at(-1)?.lines, ["Cleanup 3/8 · Checking next · 12s"]);
    assert.equal(new Set(f.writes.map(write => write.key)).size, 1);
  } finally { progress.dispose(); }
});

test("disposal clears the widget and timer once and ignores late events and ticks", () => {
  const f = fixture();
  const progress = startCleanupProgress(f.ui, f.clock);
  const lateTick = [...f.ticks][0]!;
  progress.dispose();
  assert.equal(f.ticks.size, 0);
  assert.equal(f.writes.at(-1)?.lines, undefined);
  const count = f.writes.length;
  progress.dispose();
  lateTick();
  f.advance(5000);
  progress.update({ index: 1, total: 1, label: "late", phase: "removing" });
  assert.equal(f.writes.length, count);
});

test("overlapping cleanup presenters cannot overwrite or clear each other", () => {
  const f = fixture();
  const first = startCleanupProgress(f.ui, f.clock);
  const second = startCleanupProgress(f.ui, f.clock);
  try {
    assert.notEqual(f.writes[0]?.key, f.writes[1]?.key);
    first.dispose();
    assert.equal(f.ticks.size, 1);
    f.advance(1000);
    assert.equal(f.writes.at(-1)?.key, f.writes[1]?.key);
    assert.deepEqual(f.writes.at(-1)?.lines, ["Cleanup · Preparing… · 1s"]);
  } finally { first.dispose(); second.dispose(); }
});
