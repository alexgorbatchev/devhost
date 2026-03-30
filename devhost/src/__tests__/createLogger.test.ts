import { describe, expect, test } from "bun:test";

import { createLogger } from "../createLogger";

describe("createLogger", () => {
  test("prefixes info lines with the devhost label", () => {
    const infoCalls: unknown[][] = [];
    const logger = createLogger({
      errorSink(message: string): void {
        throw new Error(`unexpected error sink call: ${message}`);
      },
      infoSink(...arguments_: unknown[]): void {
        infoCalls.push(arguments_);
      },
    });

    logger.info("hello\nworld", { count: 1 });

    expect(infoCalls).toEqual([["[devhost] hello", { count: 1 }], ["[devhost] world"]]);
  });

  test("prefixes error lines with the devhost label", () => {
    const errorCalls: unknown[][] = [];
    const logger = createLogger({
      errorSink(...arguments_: unknown[]): void {
        errorCalls.push(arguments_);
      },
      infoSink(message: string): void {
        throw new Error(`unexpected info sink call: ${message}`);
      },
    });

    logger.error("failed: boom", 500, "extra");

    expect(errorCalls).toEqual([["[devhost] failed: boom", 500, "extra"]]);
  });

  test("supports overriding the label and falling back when it is blank", () => {
    const infoCalls: unknown[][] = [];
    const logger = createLogger({
      errorSink(message: string): void {
        throw new Error(`unexpected error sink call: ${message}`);
      },
      infoSink(...arguments_: unknown[]): void {
        infoCalls.push(arguments_);
      },
      label: "hello-stack",
    });

    logger.info("ready");
    logger.withLabel("").info("fallback");

    expect(infoCalls).toEqual([["[hello-stack] ready"], ["[devhost] fallback"]]);
  });
});
