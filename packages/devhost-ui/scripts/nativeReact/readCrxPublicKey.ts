import { createHash } from "node:crypto";

export interface ICrxPublicKey {
  // Base64 of the DER public key, the form a manifest's `key` field takes.
  publicKey: string;
  extensionId: string;
}

interface IVarint {
  value: number;
  // The offset just past the varint.
  next: number;
}

interface IProtobufField {
  field: number;
  value: Uint8Array;
}

// CrxFileHeader fields (components/crx_file/crx3.proto): RSA and ECDSA key proofs, and the signed header data.
const rsaProofField = 2;
const ecdsaProofField = 3;
const signedHeaderDataField = 10000;

function readVarint(bytes: Uint8Array, start: number): IVarint {
  let value = 0;
  let shift = 0;
  let offset = start;
  for (;;) {
    const byte = bytes[offset];
    if (byte === undefined) throw new Error("CRX3 header ends inside a varint.");
    value += (byte & 0x7f) * 2 ** shift;
    offset += 1;
    if ((byte & 0x80) === 0) return { value, next: offset };
    shift += 7;
  }
}

// Reads the length-delimited fields of one protobuf message, skipping varint and fixed-width ones.
function readLengthDelimitedFields(bytes: Uint8Array): IProtobufField[] {
  const fields: IProtobufField[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const { value: tag, next: afterTag } = readVarint(bytes, offset);
    const field = Math.floor(tag / 8);
    const wireType = tag % 8;
    if (wireType === 0) {
      offset = readVarint(bytes, afterTag).next;
    } else if (wireType === 1) {
      offset = afterTag + 8;
    } else if (wireType === 5) {
      offset = afterTag + 4;
    } else if (wireType === 2) {
      const { value: length, next: afterLength } = readVarint(bytes, afterTag);
      fields.push({ field, value: bytes.subarray(afterLength, afterLength + length) });
      offset = afterLength + length;
    } else {
      throw new Error(`CRX3 header has an unsupported protobuf wire type ${wireType}.`);
    }
  }
  return fields;
}

// Chrome writes an extension ID as the first 16 bytes of a SHA-256, one letter a-p per hexadecimal digit.
function toExtensionId(idBytes: Uint8Array): string {
  return [...Buffer.from(idBytes).toString("hex")]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join("");
}

// Reads, from a CRX3 file, the public key the extension's ID derives from. The Web Store also signs the file with its
// own key, so the extension's key is the proof whose SHA-256 matches the signed CRX ID.
export function readCrxPublicKey(crx: Uint8Array): ICrxPublicKey {
  const view = new DataView(crx.buffer, crx.byteOffset, crx.byteLength);
  if (crx.length < 12 || new TextDecoder().decode(crx.subarray(0, 4)) !== "Cr24" || view.getUint32(4, true) !== 3) {
    throw new Error("The file is not a CRX3 container.");
  }
  const header = readLengthDelimitedFields(crx.subarray(12, 12 + view.getUint32(8, true)));
  const signedData = header.find((entry) => entry.field === signedHeaderDataField);
  const crxId = signedData && readLengthDelimitedFields(signedData.value).find((entry) => entry.field === 1)?.value;
  if (crxId === undefined) throw new Error("The CRX3 header names no CRX ID.");

  for (const proof of header.filter((entry) => entry.field === rsaProofField || entry.field === ecdsaProofField)) {
    const publicKey = readLengthDelimitedFields(proof.value).find((entry) => entry.field === 1)?.value;
    if (publicKey === undefined) continue;
    const keyId = createHash("sha256").update(publicKey).digest().subarray(0, 16);
    if (Buffer.from(keyId).equals(Buffer.from(crxId))) {
      return { publicKey: Buffer.from(publicKey).toString("base64"), extensionId: toExtensionId(keyId) };
    }
  }
  throw new Error("No CRX3 key proof matches the CRX ID.");
}
