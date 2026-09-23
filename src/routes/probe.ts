import { Hono } from "hono";
import type { HonoEnv } from "../types/hono";
const app = new Hono<HonoEnv>();
/**
 * Endpoint reachability probe.
 *
 * Hono dispatches `HEAD` requests as `GET` (see `hono/dist/hono-base.js`:
 * `if (method === "HEAD") { ... #dispatch(..., "GET") }`), so a POST-only
 * route such as `/v1/chat/completions` never matches a HEAD probe and the
 * request falls through to the 404 handler. Health checks, uptime monitors
 * and SDK preflights commonly issue `HEAD`, so we expose GET handlers for
 * those POST endpoints: GET answers with endpoint metadata and HEAD reuses
 * the same route to return an empty 200.
 *
 * These handlers intentionally do NOT require authentication or hit the
 * rate limiter — they are lightweight and only confirm the route exists.
 */
const PROBE_ENDPOINTS: { path: string; method: "POST" }[] = [
  { path: "/chat/completions", method: "POST" },
  { path: "/responses", method: "POST" },
  { path: "/images/generations", method: "POST" },
  { path: "/audio/speech", method: "POST" },
  { path: "/audio/transcriptions", method: "POST" },
  { path: "/audio/translations", method: "POST" },
  { path: "/messages", method: "POST" },
];
for (const endpoint of PROBE_ENDPOINTS) {
  app.get(endpoint.path, (c) => {
    c.header("Allow", `${endpoint.method}, GET, HEAD, OPTIONS`);
    return c.json({
      endpoint: `/v1${endpoint.path}`,
      method: endpoint.method,
      available: true,
    });
  });
}
export default app;
