export function pipeSubprocessOutput(
  stream: ReadableStream<Uint8Array> | null,
  prefix: string,
  writer: (line: string) => void,
): Promise<void> {
  if (stream === null) {
    return Promise.resolve();
  }

  return pipeReadableStreamLines(stream, (line: string) => {
    writer(`${prefix}${line}`);
  });
}

async function pipeReadableStreamLines(
  stream: ReadableStream<Uint8Array>,
  writer: (line: string) => void,
): Promise<void> {
  const reader: ReadableStreamDefaultReader<string> = stream.pipeThrough(new TextDecoderStream()).getReader();
  let bufferedText: string = "";

  try {
    while (true) {
      const result: ReadableStreamReadResult<string> = await reader.read();

      if (result.done) {
        break;
      }

      bufferedText += result.value;
      bufferedText = flushCompleteLines(bufferedText, writer);
    }

    if (bufferedText.length > 0) {
      writer(bufferedText);
    }
  } finally {
    reader.releaseLock();
  }
}

function flushCompleteLines(bufferedText: string, writer: (line: string) => void): string {
  const normalizedText: string = bufferedText.replaceAll("\r\n", "\n");
  const lines: string[] = normalizedText.split("\n");
  const trailingFragment: string | undefined = lines.pop();

  for (const line of lines) {
    writer(line);
  }

  return trailingFragment ?? "";
}
