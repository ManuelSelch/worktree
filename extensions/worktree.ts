import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWorktreeController } from "./worktree-controller.ts";
import { registerWorktreeCommands } from "./worktree-commands.ts";
import { registerWorktreeTools } from "./worktree-tools.ts";

/** Register Git worktree commands and agent tools for Pi. */
export default function worktree(pi: ExtensionAPI): void {
  const controller = createWorktreeController();
  registerWorktreeCommands(pi, controller);
  registerWorktreeTools(pi, controller);
}
