import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readCrxPublicKey } from "../readCrxPublicKey";

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return bytes;
}

function encodeBytesField(field: number, value: Uint8Array): number[] {
  return [...encodeVarint((field << 3) | 2), ...encodeVarint(value.length), ...value];
}

function extensionId(publicKey: Uint8Array): string {
  const hash = createHash("sha256").update(publicKey).digest().subarray(0, 16);
  return [...hash.toString("hex")].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("");
}

// A CRX3 file: magic, version 3, the header length, a CrxFileHeader, then the ZIP payload.
function createCrx(publisherKey: Uint8Array, extensionKey: Uint8Array): Uint8Array {
  const crxId = createHash("sha256").update(extensionKey).digest().subarray(0, 16);
  const proof = (key: Uint8Array): Uint8Array =>
    Uint8Array.from([...encodeBytesField(1, key), ...encodeBytesField(2, Uint8Array.of(9, 9))]);
  const header = Uint8Array.from([
    ...encodeBytesField(2, proof(publisherKey)),
    ...encodeBytesField(2, proof(extensionKey)),
    ...encodeBytesField(10000, Uint8Array.from(encodeBytesField(1, crxId))),
  ]);
  const prefix = new Uint8Array(12);
  prefix.set(new TextEncoder().encode("Cr24"));
  new DataView(prefix.buffer).setUint32(4, 3, true);
  new DataView(prefix.buffer).setUint32(8, header.length, true);
  return Uint8Array.from([...prefix, ...header, 0x50, 0x4b]);
}

test("reads the extension's own public key, the one its ID derives from, among the CRX3 key proofs", () => {
  const publisherKey = new TextEncoder().encode("web store publisher key");
  const extensionKey = new TextEncoder().encode("extension key");

  const result = readCrxPublicKey(createCrx(publisherKey, extensionKey));

  expect(result.publicKey).toEqual(Buffer.from(extensionKey).toString("base64"));
  expect(result.extensionId).toBe(extensionId(extensionKey));
});

test("rejects a file that is not a CRX3 container", () => {
  expect(() => readCrxPublicKey(new TextEncoder().encode("PK not a crx"))).toThrow("is not a CRX3 container");
});
