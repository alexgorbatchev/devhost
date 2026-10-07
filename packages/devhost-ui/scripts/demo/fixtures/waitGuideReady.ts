import assert from "node:assert/strict";

export async function waitGuideReady(): Promise<void> {
  const url = process.env.DEVHOST_DEMO_URL;
  const certificatePath = process.env.DEVHOST_DEMO_CERTIFICATE;
  assert(url && certificatePath);
  const certificate = await Bun.file(certificatePath).text();
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await fetch(url, { tls: { ca: certificate }, signal: AbortSignal.timeout(500) }).catch(() => null);
    if (response?.ok) {
      await response.body?.cancel();
      console.log("GUIDE_READY");
      return;
    }
    await response?.body?.cancel();
    await Bun.sleep(100);
  }
  throw new Error("The guide's real routed service did not become ready");
}

if (import.meta.main) await waitGuideReady();
