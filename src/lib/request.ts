import "server-only";

// NextRequest.url can use the server's canonical hostname in development.
// Compare the browser origin to the actual HTTP Host header instead.
export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    return ["http:", "https:"].includes(source.protocol) && source.host === request.headers.get("host");
  } catch { return false; }
}
