import { join } from "node:path";

import { DESIGN_TOKENS } from "../src/constants";
import { createTokensCss } from "../src/createTokensCss";

const tokensCssPath = join(import.meta.dir, "..", "tokens.css");

await Bun.write(tokensCssPath, createTokensCss(DESIGN_TOKENS));
console.log(`Wrote ${tokensCssPath}`);
