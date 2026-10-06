import type { ServiceLogEntry } from "../../../../shared/types";

export const fixture_ansiContrastEntries: ServiceLogEntry[] = [
  { id: 1, serviceName: "api", stream: "stdout", line: "\u001b[30mStandard black\u001b[0m" },
  { id: 2, serviceName: "api", stream: "stdout", line: "\u001b[97mBright white\u001b[0m" },
  { id: 3, serviceName: "api", stream: "stdout", line: "\u001b[38;5;232mIndexed dark\u001b[0m" },
  { id: 4, serviceName: "api", stream: "stdout", line: "\u001b[38;2;12;34;56mTruecolor dark\u001b[0m" },
  { id: 5, serviceName: "api", stream: "stdout", line: "\u001b[38;2;242;244;246mTruecolor light\u001b[0m" },
  {
    id: 6,
    serviceName: "api",
    stream: "stdout",
    line: "\u001b[38;2;128;128;128;48;2;128;128;128mSame-color pair\u001b[0m",
  },
  { id: 7, serviceName: "api", stream: "stdout", line: "\u001b[48;2;255;255;255mInherited on white\u001b[0m" },
  { id: 8, serviceName: "api", stream: "stdout", line: "\u001b[48;2;0;0;0mInherited on black\u001b[0m" },
  { id: 9, serviceName: "api", stream: "stdout", line: "\u001b[2mDim inherited\u001b[0m" },
  {
    id: 10,
    serviceName: "api",
    stream: "stdout",
    line: "\u001b[2;38;2;128;128;128;48;2;128;128;128mDim color pair\u001b[0m",
  },
  {
    id: 11,
    serviceName: "api",
    stream: "stdout",
    line: "\u001b[1;3;4;9;38;2;51;255;51;48;2;0;0;0mReadable decorated\u001b[0m",
  },
  {
    id: 12,
    serviceName: "api",
    stream: "stdout",
    line: "\u001b[38;2;255;0;0;48;2;255;255;0mSaturated pair\u001b[0m",
  },
];
