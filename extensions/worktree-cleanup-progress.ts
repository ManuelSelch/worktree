import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { CleanupProgress } from "../src/cleanup.ts";

export interface CleanupProgressClock {
  now(): number;
  everySecond(tick: () => void): () => void;
}

const clock: CleanupProgressClock = {
  now: () => performance.now(),
  everySecond(tick) {
    const timer = setInterval(tick, 1000);
    timer.unref();
    return () => clearInterval(timer);
  },
};

/** Cleanup runs one invocation at a time, so a fixed key is enough; dispose on completion or shutdown. */
export function startCleanupProgress(ui: Pick<ExtensionUIContext, "setWidget">, time = clock) {
  const key = "worktree-cleanup";
  const started = time.now();
  let current: CleanupProgress | undefined;
  let disposed = false;
  const phases = { checking: "Checking", removing: "Removing", "deleting-branch": "Deleting branch" };

  function render() {
    if (disposed) return;
    const elapsed = Math.max(0, Math.floor((time.now() - started) / 1000));
    const status = current
      ? `Cleanup ${current.index}/${current.total} · ${phases[current.phase]} ${current.label}`
      : "Cleanup · Preparing…";
    ui.setWidget(key, [`${status} · ${elapsed}s`], { placement: "aboveEditor" });
  }

  render();
  const stopTimer = time.everySecond(render);
  return {
    update(progress: CleanupProgress) {
      if (disposed) return;
      current = progress;
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopTimer();
      ui.setWidget(key, undefined);
    },
  };
}
