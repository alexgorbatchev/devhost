import { buildDevtoolsScript } from "./packages/devhost/src/devtools-server/buildDevtoolsScript.ts";
import { writeFileSync } from "fs";

buildDevtoolsScript().then((script) => {
  writeFileSync("packages/www/public/mock-devtools.js", script);
  console.log("built mock-devtools.js");
});
