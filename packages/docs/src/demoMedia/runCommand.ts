export async function runCommand(command: string[]): Promise<string> {
  const subprocess = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [output, errors, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Command failed (${exitCode}): ${command.join(" ")}\n${errors.trim()}`);
  return output;
}
