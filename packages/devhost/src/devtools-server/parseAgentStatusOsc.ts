export type AgentSessionStatus = "working" | "finished";

export interface IParseAgentStatusOscResult {
  carryover: string;
  statuses: AgentSessionStatus[];
}

const oscPrefix: string = "\u001b]1337;SetAgentStatus=";
const belTerminator: string = "\u0007";
const stTerminator: string = "\u001b\\";

export function parseAgentStatusOsc(carryover: string, outputChunk: string): IParseAgentStatusOscResult {
  const combinedOutput: string = carryover + outputChunk;
  const statuses: AgentSessionStatus[] = [];
  let searchStartIndex: number = 0;

  while (searchStartIndex < combinedOutput.length) {
    const prefixIndex: number = combinedOutput.indexOf(oscPrefix, searchStartIndex);

    if (prefixIndex === -1) {
      const unmatchedSuffix: string = combinedOutput.slice(searchStartIndex);

      return {
        carryover: unmatchedSuffix.slice(-oscPrefix.length),
        statuses,
      };
    }

    const terminator = readOscTerminator(combinedOutput, prefixIndex + oscPrefix.length);

    if (terminator === null) {
      return {
        carryover: combinedOutput.slice(prefixIndex),
        statuses,
      };
    }

    const statusText: string = combinedOutput.slice(prefixIndex + oscPrefix.length, terminator.startIndex);

    if (isAgentSessionStatus(statusText)) {
      statuses.push(statusText);
    }

    searchStartIndex = terminator.endIndex;
  }

  return {
    carryover: combinedOutput.slice(searchStartIndex).slice(-oscPrefix.length),
    statuses,
  };
}

interface IOscTerminator {
  endIndex: number;
  startIndex: number;
}

function readOscTerminator(text: string, startIndex: number): IOscTerminator | null {
  const belIndex: number = text.indexOf(belTerminator, startIndex);
  const stIndex: number = text.indexOf(stTerminator, startIndex);

  if (belIndex === -1 && stIndex === -1) {
    return null;
  }

  if (belIndex !== -1 && (stIndex === -1 || belIndex < stIndex)) {
    return {
      endIndex: belIndex + belTerminator.length,
      startIndex: belIndex,
    };
  }

  return {
    endIndex: stIndex + stTerminator.length,
    startIndex: stIndex,
  };
}

function isAgentSessionStatus(value: string): value is AgentSessionStatus {
  return value === "working" || value === "finished";
}
