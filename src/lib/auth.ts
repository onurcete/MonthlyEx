export const AUTH_COOKIE = "monthlyex_auth";

export async function expectedAuthToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`monthlyex-v1:${password}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
