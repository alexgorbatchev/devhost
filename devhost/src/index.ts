import { runDevhost } from "./runDevhost";

const exitCode: number = await runDevhost(process.argv.slice(2));
process.exit(exitCode);
