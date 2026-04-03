import { createLogger } from "./createLogger";
import { runDevhost } from "./runDevhost";

const logger = createLogger({
  errorSink: console.error,
  infoSink: console.log,
});
const exitCode: number = await runDevhost(process.argv.slice(2), logger);

process.exit(exitCode);
