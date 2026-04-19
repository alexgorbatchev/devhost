import { createLogger } from "./utils/createLogger";
import { runDevhost } from "./runDevhost";

async function main(): Promise<void> {
  const logger = createLogger({
    errorSink: console.error,
    infoSink: console.log,
  });
  const exitCode: number = await runDevhost(process.argv.slice(2), logger);

  process.exit(exitCode);
}

void main();
