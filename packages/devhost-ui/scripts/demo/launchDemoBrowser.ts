import { chromium, type Browser } from "playwright";

export async function launchDemoBrowser(env: NodeJS.ProcessEnv): Promise<Browser> {
  // The recorder owns these signals so its finally block can stop the stack and remove routes.
  return await chromium.launch({ env, handleSIGINT: false, handleSIGTERM: false });
}
