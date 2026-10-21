import { recordDemo } from "../../recordDemo";

try {
  await recordDemo(new AbortController().signal, "annotations");
} catch (error) {
  console.log(error instanceof Error ? error.message.split("\n")[0] : String(error));
}
