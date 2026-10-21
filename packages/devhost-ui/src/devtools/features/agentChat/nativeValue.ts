import { z } from "zod";
import type { ToolCallMessagePart } from "@assistant-ui/react";

export function isNativeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function nativeRecord(value: unknown): Record<string, unknown> {
  return isNativeRecord(value) ? value : {};
}
export function nativeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function nativeArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
export function nativeArgs(value: unknown): ToolCallMessagePart["args"] {
  const parsed = z.record(z.string(), z.json()).safeParse(value);
  return parsed.success ? parsed.data : {};
}
