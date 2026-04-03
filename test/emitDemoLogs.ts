const burstProbability: number = 0.28;
const longStderrProbability: number = 0.12;
const minimumDelayInMilliseconds: number = 45;
const maximumDelayInMilliseconds: number = 520;
const stderrProbability: number = 0.18;

const requestIds: string[] = ["req-17a", "req-20f", "req-42c", "req-5de", "req-91b"];
const serviceNames: string[] = ["hello", "api", "worker", "hmr", "vite"];
const stderrMessages: string[] = [
  "transient websocket backpressure detected",
  "simulated upstream timeout while proxying asset request",
  "retry budget exhausted for background sync job",
  "hot reload overlay lost a stale module reference",
  "simulated parser warning promoted to stderr",
  "worker heartbeat missed its expected interval",
];
const stdoutMessages: string[] = [
  "asset graph warmed",
  "route cache refreshed",
  "dependency prebundle reused from local cache",
  "background sync completed",
  "watcher scan completed",
  "incremental rebuild finished",
  "hot module accepted update",
  "request served from development cache",
  "manifest watcher observed no-op change",
  "proxy keepalive reused existing socket",
];

let sequenceNumber: number = 1;

function emitRandomLogBatch(): void {
  emitRandomLogEntry();

  if (Math.random() < burstProbability) {
    emitRandomLogEntry();
  }

  scheduleNextBatch();
}

function emitRandomLogEntry(): void {
  const serviceName: string = pickRandomItem(serviceNames, "service");
  const requestId: string = pickRandomItem(requestIds, "request id");
  const isStderr: boolean = Math.random() < stderrProbability;
  const durationInMilliseconds: number = randomInteger(8, 960);
  const message: string = isStderr
    ? createStderrMessage(serviceName, requestId, durationInMilliseconds)
    : pickRandomItem(stdoutMessages, "stdout message");
  const logLine: string = `[${serviceName}] ${message} requestId=${requestId} duration=${durationInMilliseconds}ms seq=${sequenceNumber}`;

  if (isStderr) {
    console.error(logLine);
  } else {
    console.log(logLine);
  }

  sequenceNumber += 1;
}

function createStderrMessage(serviceName: string, requestId: string, durationInMilliseconds: number): string {
  const baseMessage: string = pickRandomItem(stderrMessages, "stderr message");

  if (Math.random() >= longStderrProbability) {
    return baseMessage;
  }

  return (
    `${baseMessage}; context service=${serviceName} requestId=${requestId} duration=${durationInMilliseconds}ms phase=render; ` +
    `downstream cache=miss region=local-dev shard=${randomInteger(1, 4)} worker=${randomInteger(1, 8)}; ` +
    `recovery action=retryable escalation=none trace=demo-${sequenceNumber.toString().padStart(4, "0")}`
  );
}

function pickRandomItem(items: string[], label: string): string {
  const index: number = randomInteger(0, items.length - 1);
  const item: string | undefined = items.at(index);

  if (item === undefined) {
    throw new Error(`Missing ${label} at index ${index}`);
  }

  return item;
}

function randomInteger(minimum: number, maximum: number): number {
  return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

function scheduleNextBatch(): void {
  const delayInMilliseconds: number = randomInteger(minimumDelayInMilliseconds, maximumDelayInMilliseconds);

  setTimeout(emitRandomLogBatch, delayInMilliseconds);
}

emitRandomLogBatch();
