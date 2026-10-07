import { launchDemoBrowser } from "../../launchDemoBrowser";

const interrupted = Promise.withResolvers<void>();
process.once("SIGINT", () => interrupted.resolve());
const browser = await launchDemoBrowser(process.env);
console.log("ready");
try {
  await interrupted.promise;
  console.log("interrupted");
} finally {
  await browser.close();
  console.log(`closed:${!browser.isConnected()}`);
}
