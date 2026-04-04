export type LineWriterFunction = (line: string) => void;

export function pipeSubprocessOutput(
  stream: ReadableStream<Uint8Array> | null | undefined,
  prefix: string,
  writer: LineWriterFunction,
): Promise<void> {
  if (stream === null || stream === undefined) {
    return Promise.resolve();
  }

  return pipeReadableStreamLines(stream, (line: string) => {
    writer(`${prefix}${line}`);
  });
}

async function pipeReadableStreamLines(stream: ReadableStream<Uint8Array>, writer: LineWriterFunction): Promise<void> {
  const reader: ReadableStreamDefaultReader<Uint8Array> = stream.getReader();
  const textDecoder: TextDecoder = new TextDecoder();
  let bufferedText: string = "";

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      bufferedText += textDecoder.decode(result.value, { stream: true });
      bufferedText = flushCompleteLines(bufferedText, writer);
    }

    bufferedText += textDecoder.decode();

    if (bufferedText.length > 0) {
      writer(bufferedText);
    }
  } finally {
    reader.releaseLock();
  }
}

function flushCompleteLines(bufferedText: string, writer: LineWriterFunction): string {
  const normalizedText: string = bufferedText.replaceAll("\r\n", "\n");
  const lines: string[] = normalizedText.split("\n");
  const trailingFragment: string | undefined = lines.pop();

  for (const line of lines) {
    writer(line);
  }

  return trailingFragment ?? "";
}
