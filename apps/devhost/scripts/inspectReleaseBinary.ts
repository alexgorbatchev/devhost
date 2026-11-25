interface IRustReleaseBinaryInspection {
  format: string;
  dependencies: string[];
  requirements: string;
}

async function inspect(command: string[]): Promise<string> {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [exitCode, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${command[0]} failed (${exitCode}): ${error}`);
  return output.trim();
}

export async function inspectRustReleaseBinary(
  binaryPath: string,
  target: string,
): Promise<IRustReleaseBinaryInspection> {
  const format = await inspect(["file", "-b", binaryPath]);
  const isArm = target.includes("arm64");
  if (!(isArm ? /aarch64|arm64/i : /x86-64|x86_64/i).test(format))
    throw new Error(`Wrong executable architecture for ${target}: ${format}`);
  if (target.startsWith("darwin")) {
    if (!format.includes("Mach-O")) throw new Error(`Expected Mach-O for ${target}: ${format}`);
    const dependencies = (await inspect(["otool", "-L", binaryPath]))
      .split("\n")
      .slice(1)
      .map((line) => line.trim());
    if (dependencies.some((line) => !line.startsWith("/usr/lib/") && !line.startsWith("/System/Library/")))
      throw new Error(`Non-system macOS dependency: ${dependencies.join(", ")}`);
    const requirements = await inspect(["otool", "-l", binaryPath]);
    const minimum = requirements.match(/\bminos\s+(\d+\.\d+(?:\.\d+)?)/)?.[1];
    if (minimum === undefined || Number(minimum.split(".")[0]) > 11)
      throw new Error(`Expected a macOS 11 deployment target, got ${minimum ?? "unknown"}.`);
    // Apple silicon requires an intact linker-created ad-hoc signature. Distribution does not promise notarization.
    await inspect(["codesign", "--verify", "--strict", binaryPath]);
    return { format, dependencies, requirements: `macOS ${minimum}; system libraries; ad-hoc signature verified` };
  }
  if (!format.includes("ELF")) throw new Error(`Expected ELF for ${target}: ${format}`);
  const dynamic = await inspect(["readelf", "-d", binaryPath]);
  const programHeaders = await inspect(["readelf", "-l", binaryPath]);
  const dependencies = [...dynamic.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)].map((match) => match[1] ?? "");
  if (target.endsWith("musl")) {
    if (dependencies.length || programHeaders.includes("INTERP"))
      throw new Error(`musl candidate must be static: ${dynamic}`);
    return { format, dependencies, requirements: "Static musl; no ELF interpreter or shared-library dependencies" };
  }
  const versions = await inspect(["readelf", "--version-info", binaryPath]);
  const glibc = [...versions.matchAll(/GLIBC_(\d+)\.(\d+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
  if (!glibc.length || glibc.some(([major = 0, minor = 0]) => major > 2 || (major === 2 && minor > 28)))
    throw new Error("GNU candidate exceeds the glibc 2.28 baseline or has no versioned glibc requirements.");
  if (
    dependencies.some(
      (name) =>
        ![
          "libc.so.6",
          "libm.so.6",
          "libdl.so.2",
          "libpthread.so.0",
          "librt.so.1",
          "libgcc_s.so.1",
          "ld-linux-x86-64.so.2",
          "ld-linux-aarch64.so.1",
        ].includes(name),
    )
  )
    throw new Error(`Unexpected GNU dependency: ${dependencies.join(", ")}`);
  return { format, dependencies, requirements: "glibc <= 2.28; requires the listed system libraries" };
}
