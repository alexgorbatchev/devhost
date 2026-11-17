import { afterEach, expect, test } from "bun:test";

import {
  isRunningProcessState,
  signalTestProcessGroup,
  stopTestProcessGroup,
} from "../../../../test-support/stopTestProcessGroup";
import { startProcessGroup, stopProcessGroupFixtures, trackProcessGroup, waitForGroupMember } from "./helpers";

afterEach(stopProcessGroupFixtures);

test("treats a group whose only member exited but is not reaped yet as stopped", async () => {
  const { groupId } = await startProcessGroup("exit 0");
  await waitForGroupMember(groupId, (state) => state.startsWith("Z"));

  expect(signalTestProcessGroup(groupId, 0)).toBe(false);
  expect(signalTestProcessGroup(groupId, "SIGTERM")).toBe(false);
});

test("keeps a group with a running member live until that member exits", async () => {
  const { groupId } = await startProcessGroup("sleep 600");
  await waitForGroupMember(groupId, (state) => !state.startsWith("Z"));

  expect(signalTestProcessGroup(groupId, 0)).toBe(true);
  // The answer reflects the group after the signal, which may already have killed its member.
  signalTestProcessGroup(groupId, "SIGKILL");
  await waitForGroupMember(groupId, (state) => state.startsWith("Z"));
  expect(signalTestProcessGroup(groupId, 0)).toBe(false);
});

// Rows macOS `ps` printed for a native Vue host's process group while it shut down on a loaded machine: an exiting
// member and a zombie, both of which make kill(-group, 0) answer EPERM.
test("counts only members that neither exit nor wait to be reaped as running", () => {
  expect(["?Es", "Z", "Z+", "X"].map(isRunningProcessState)).toEqual([false, false, false, false]);
  expect(["Ss", "R+", "S", "I", "D", "T"].map(isRunningProcessState)).toEqual([true, true, true, true, true, true]);
});

test("stops a detached fixture and its process group", async () => {
  const child = Bun.spawn(["sleep", "600"], { detached: true, stdout: "ignore", stderr: "ignore" });
  trackProcessGroup(child.pid);

  await stopTestProcessGroup(child);

  expect(child.signalCode).toBe("SIGTERM");
  expect(signalTestProcessGroup(child.pid, 0)).toBe(false);
});
