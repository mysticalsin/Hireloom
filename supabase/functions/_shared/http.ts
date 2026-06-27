// Shared HTTP helpers for edge functions: origin-pinned CORS + error sanitization.
// Replaces the per-function `Access-Control-Allow-Origin: '*'` and raw error echoes.

const SITE = Deno.env.get('SITE_URL') ?? 'http://localhost:5173';
const EXTRA = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const ALLOWED = new Set<string>([SITE, 'http://localhost:5173', 'http://127.0.0.1:5173', ...EXTRA]);

export function corsHeaders(origin: string | null): Record<string, string> {
  // Echo the request Origin only if it's allowlisted; otherwise fall back to SITE.
  const allow = origin && ALLOWED.has(origin) ? origin : SITE;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function preflight(req: Request): Response {
  return new Response('ok', { headers: corsHeaders(req.headers.get('Origin')) });
}

export function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// Client gets a generic message + opaque request id; full detail is logged server-side only.
export function errorResponse(status: number, clientMsg: string, detail: unknown, origin: string | null): Response {
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}] ${clientMsg}`, detail instanceof Error ? detail.message : detail);
  return jsonResponse({ error: clientMsg, requestId }, status, origin);
}
