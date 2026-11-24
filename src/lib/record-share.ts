/**
 * Private links to a pet's medical record. The secret in the link is 24 random bytes (192 bits); only its SHA-256
 * hash is stored, so the database never holds a working link. Uses Web Crypto, which works on the server and edge.
 */

export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashShareToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
