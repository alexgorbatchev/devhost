import { join } from "node:path";

export function getFixturePath(...segments: string[]): string {
  return join(import.meta.dir, "fixtures", ...segments);
}

export async function readFixtureToml(...segments: string[]): Promise<unknown> {
  const fixturePath: string = getFixturePath(...segments);
  const fixtureText: string = await Bun.file(fixturePath).text();

  return Bun.TOML.parse(fixtureText);
}
