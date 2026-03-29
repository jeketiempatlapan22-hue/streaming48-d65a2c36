// XOR-based encryption for embed IDs (YouTube, etc.)
// Key must match the one in VideoPlayer's decryptUrl
// Derived key — not stored as plain literal
const _a = [55, 33, 7, 9, 73, 28, 4, 60, 2, 3, 69, 27, 6, 67, 33, 7];
const _b = [29, 117, 59, 49, 49, 103, 53, 69, 83, 49, 55, 103, 49, 45, 115, 51];
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
