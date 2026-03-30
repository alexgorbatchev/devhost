export async function readManifest(manifestPath: string): Promise<unknown> {
  try {
    const manifestText: string = await Bun.file(manifestPath).text();
    return Bun.TOML.parse(manifestText);
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${manifestPath}: ${message}`);
  }
}
