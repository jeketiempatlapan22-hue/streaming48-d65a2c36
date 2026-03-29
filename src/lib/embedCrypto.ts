// XOR-based encryption for embed IDs (YouTube, etc.)
// Key must match the one in VideoPlayer's decryptUrl
// Derived key — not stored as plain literal
const _a = [12,105,82,37,24,119,60,125,84,18,73,127,12,114,10,20];
const _b = [94,61,102,29,96,60,5,16,5,32,63,51,59,28,90,32];
const _k = _a.map((v, i) => v ^ _b[i]);

export function encryptEmbedId(plain: string): string {
  if (plain.startsWith("enc:")) return plain; // already encrypted
  const bytes = new TextEncoder().encode(plain);
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ _k[i % _k.length];
  }
  return "enc:" + btoa(String.fromCharCode(...result));
}

export function decryptEmbedId(encoded: string): string {
  if (!encoded.startsWith("enc:")) return encoded;
  const b64 = encoded.slice(4);
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const result = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ _k[i % _k.length];
  }
  return new TextDecoder().decode(result);
}
