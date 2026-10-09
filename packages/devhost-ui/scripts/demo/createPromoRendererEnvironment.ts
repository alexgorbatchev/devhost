export function createPromoRendererEnvironment(env: NodeJS.ProcessEnv, temporaryPath: string): NodeJS.ProcessEnv {
  return {
    ...env,
    // HyperFrames neither installs agent skills on this machine nor reports usage.
    HYPERFRAMES_SKIP_SKILLS: "1",
    HYPERFRAMES_NO_TELEMETRY: "1",
    TMPDIR: temporaryPath,
  };
}
