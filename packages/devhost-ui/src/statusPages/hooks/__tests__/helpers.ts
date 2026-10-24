import { vi } from "vitest";
import type { Mocked } from "vitest";
import type { IRecoveryClient, RecoveryState } from "../../types";

interface IRecoveryFixture {
  state: RecoveryState;
  client: Mocked<IRecoveryClient>;
}

export function createRecoveryFixture(): IRecoveryFixture {
  const state: RecoveryState = {
    stack: "shop",
    service: "web",
    phase: "failed",
    title: "web exited",
    message: "Exit code 1",
    address: "localhost:1234",
    canRestart: true,
    logs: ["failure"],
    repositories: [],
  };
  const client = {
    readStatus: vi.fn<IRecoveryClient["readStatus"]>(async () => state),
    readWorktrees: vi.fn<IRecoveryClient["readWorktrees"]>(async () => []),
    probe: vi.fn<IRecoveryClient["probe"]>(async () => false),
    restart: vi.fn<IRecoveryClient["restart"]>(async () => {}),
    switchWorktree: vi.fn<IRecoveryClient["switchWorktree"]>(async () => {}),
    reload: vi.fn<IRecoveryClient["reload"]>(),
  };
  return { state, client };
}
