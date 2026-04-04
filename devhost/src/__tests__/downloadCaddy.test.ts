import { describe, expect, test, mock } from "bun:test";
import { downloadCaddy, type IDownloadCaddyDependencies } from "../downloadCaddy";
import type { IDevhostLogger } from "../createLogger";
import type { IManagedCaddyPaths } from "../caddyPaths";

type MockLabelMethod = (label: string) => IDevhostLogger;

const mockLogger: IDevhostLogger = {
  error: mock(),
  info: mock(),
  withLabel: mock(() => mockLogger) as unknown as MockLabelMethod,
};

function createMockDependencies(): IDownloadCaddyDependencies {
  return {
    chmod: mock(() => Promise.resolve()),
    fetch: mock(() =>
      Promise.resolve({
        arrayBuffer: (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(8)),
        ok: true,
      } as unknown as Response),
    ) as unknown as typeof fetch,
    mkdir: mock(() => Promise.resolve("")),
    paths: {
      caddyDirectoryPath: "/mock/caddy/dir",
    } as unknown as IManagedCaddyPaths,
    write: mock(() => Promise.resolve(8)),
  };
}

describe("downloadCaddy", () => {
  test("downloads caddy for darwin arm64", async () => {
    const dependencies = createMockDependencies();
    await downloadCaddy(mockLogger, "darwin", "arm64", dependencies);

    expect(dependencies.fetch).toHaveBeenCalledWith("https://caddyserver.com/api/download?os=darwin&arch=arm64");
    expect(dependencies.write).toHaveBeenCalled();
  });

  test("downloads caddy for linux x64", async () => {
    const dependencies = createMockDependencies();
    await downloadCaddy(mockLogger, "linux", "x64", dependencies);

    expect(dependencies.fetch).toHaveBeenCalledWith("https://caddyserver.com/api/download?os=linux&arch=amd64");
  });

  test("downloads caddy for windows arm", async () => {
    const dependencies = createMockDependencies();
    await downloadCaddy(mockLogger, "win32", "arm", dependencies);

    expect(dependencies.fetch).toHaveBeenCalledWith("https://caddyserver.com/api/download?os=windows&arch=arm");
  });

  test("throws error on unsupported OS", async () => {
    const dependencies = createMockDependencies();
    await expect(downloadCaddy(mockLogger, "freebsd", "x64", dependencies)).rejects.toThrow("Unsupported OS: freebsd");
  });

  test("throws error on unsupported Architecture", async () => {
    const dependencies = createMockDependencies();
    await expect(downloadCaddy(mockLogger, "darwin", "mips", dependencies)).rejects.toThrow(
      "Unsupported Architecture: mips",
    );
  });

  test("throws error if fetch fails", async () => {
    const dependencies = createMockDependencies();
    dependencies.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as unknown as Response),
    ) as unknown as typeof fetch;

    await expect(downloadCaddy(mockLogger, "darwin", "arm64", dependencies)).rejects.toThrow(
      "Failed to download Caddy: 404 Not Found",
    );
  });
});
