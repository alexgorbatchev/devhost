import { fn } from "storybook/test";
import type { IRecoveryClient } from "../../types";
import { fixture_state } from "./fixtures";
import "../../statusPages.css";

export function createStoryClient(): IRecoveryClient {
  return {
    readStatus: fn(async () => fixture_state),
    readWorktrees: fn(async () => fixture_state.repositories),
    probe: fn(async () => false),
    restart: fn(async () => {}),
    switchWorktree: fn(async () => {}),
    reload: fn(),
  };
}
