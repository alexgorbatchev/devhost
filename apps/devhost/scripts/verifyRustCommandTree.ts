import { resolve } from "node:path";

type CommandContract = { command: string; children: string[]; flags: string[] };
type HelpReceipt = { binary: string; command: string[]; stdout: string; stderr: string; exitCode: number };

export async function verifyRustCommandTree(oracle: string, candidate: string, output: string): Promise<void> {
  const receipts: HelpReceipt[] = [];
  async function inspect(binary: string): Promise<CommandContract[]> {
    const pending: string[][] = [[]];
    const contracts: CommandContract[] = [];
    for (const command of pending) {
      const child = Bun.spawn([binary, ...command, "--help"], {
        env: { ...process.env, AGENT: "1", NO_COLOR: "1", COLUMNS: "100" },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      receipts.push({ binary, command, stdout, stderr, exitCode });
      await Bun.write(output, JSON.stringify(receipts, null, 2));
      if (exitCode !== 0 || stderr || !stdout.startsWith("ALERT: Agents must read")) {
        throw new Error(`Invalid agent help for ${binary} ${command.join(" ")}; see ${output}`);
      }
      const sections = stdout.split(/^(?=\S)/m);
      const subcommands = sections.find((section) => section.startsWith("subcommands:")) ?? "";
      const flags = sections.find((section) => section.startsWith("flags:")) ?? "";
      const children = Array.from(subcommands.matchAll(/^  - ([\w-]+)/gm), (match) => match[1]!).sort();
      contracts.push({
        command: command.join(" "),
        children,
        flags: Array.from(flags.matchAll(/^  (?:(-\w), )?(--[\w-]+)/gm), (match) =>
          [match[1] ?? "", match[2]].join(","),
        ).sort(),
      });
      pending.push(...children.map((name) => [...command, name]));
    }
    return contracts.sort((left, right) => left.command.localeCompare(right.command));
  }
  const expected = await inspect(oracle);
  const actual = await inspect(candidate);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`Command or short/long flag availability differs; see ${output}`);
  }
  console.log(`Command and flag availability matches across ${expected.length} help entry points.`);
}

if (import.meta.main) {
  const [oracle, candidate, output] = Bun.argv.slice(2);
  if (!oracle || !candidate || !output) {
    throw new Error("Usage: verifyRustCommandTree.ts <Go oracle binary> <candidate binary> <receipt JSON>");
  }
  await verifyRustCommandTree(resolve(oracle), resolve(candidate), resolve(output));
}
