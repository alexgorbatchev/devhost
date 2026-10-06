export function createNativeBrowserDocumentID(crypto: Pick<Crypto, "getRandomValues">): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte: number): string => byte.toString(16).padStart(2, "0")).join("");
}
