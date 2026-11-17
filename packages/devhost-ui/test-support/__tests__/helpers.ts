import assert from "node:assert/strict";

interface IProcessGroupFixture {
  groupId: number;
  owner: Bun.Subprocess<"ignore", "pipe", "inherit">;
}

type ProcessStateFilter = (state: string) => boolean;

const owners: Bun.Subprocess[] = [];
const groups: number[] = [];

/**
 * Starts a parent that forks a child into a process group of its own, then never reaps that child: once the child
 * exits it stays in its group as a zombie for as long as the parent runs.
 */
export async function startProcessGroup(childBody: string): Promise<IProcessGroupFixture> {
  const script = [
    'my $pid = fork() // die "fork: $!";',
    `if ($pid == 0) { setpgrp(0, 0) or die "setpgrp: $!"; ${childBody}; exit 0 }`,
    '$| = 1; print "$pid\\n"; sleep 600;',
  ].join(" ");
  const owner = Bun.spawn(["perl", "-e", script], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  owners.push(owner);
  let output = "";
  const decoder = new TextDecoder();
  for await (const chunk of owner.stdout) {
    output += decoder.decode(chunk, { stream: true });
    if (output.includes("\n")) break;
  }
  const groupId = Number(output.trim());
  assert(Number.isInteger(groupId) && groupId > 0, `fixture printed no process ID: "${output}"`);
  groups.push(groupId);
  return { groupId, owner };
}

/** Records a process group that `stopProcessGroupFixtures` kills. */
export function trackProcessGroup(groupId: number): void {
  groups.push(groupId);
}

/** Waits until the group's leader is in its process group with a state that `accept` takes. */
export async function waitForGroupMember(groupId: number, accept: ProcessStateFilter): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const row = Bun.spawnSync(["ps", "-o", "pgid=", "-o", "stat=", "-p", String(groupId)])
      .stdout.toString()
      .trim();
    const [pgid, state] = row.split(/\s+/);
    if (Number(pgid) === groupId && state !== undefined && accept(state)) return;
    assert(Date.now() < deadline, `Process ${groupId} never reached the expected state: "${row}"`);
    await Bun.sleep(25);
  }
}

/** Kills every fixture group and parent the test started, and waits for the parents. */
export async function stopProcessGroupFixtures(): Promise<void> {
  for (const groupId of groups.splice(0)) killGroup(groupId);
  for (const owner of owners.splice(0)) {
    owner.kill("SIGKILL");
    await owner.exited;
  }
}

function killGroup(groupId: number): void {
  try {
    process.kill(-groupId, "SIGKILL");
  } catch {
    // The group is already gone or holds only exited members.
  }
}
