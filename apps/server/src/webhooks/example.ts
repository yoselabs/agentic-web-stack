// Reference webhook route demonstrating the @project/rate-limit
// pattern for raw-HTTP endpoints that bypass tRPC.
//
// Rate-limits by client IP (60 req/min). In real webhook code this is
// where you'd verify HMAC signatures, parse the raw body, and fan out
// to a queue. We keep it minimal on purpose — this file is a template.

import { createRateLimiter } from "@project/rate-limit/factory";
import { getSharedRedis } from "@project/rate-limit/redis";
import { RateLimitError } from "@project/rate-limit/types";
import { Hono } from "hono";

const webhookLimiter = createRateLimiter({
  name: "webhook:example:ip",
  points: 60,
  duration: 60,
  redis: getSharedRedis(),
});

function clientIp(headers: Headers, fallback: string): string {
  // X-Forwarded-For lists proxies left-to-right; the originating
  // client is the first entry. Falls back to the socket remote addr
  // when running without a trusted proxy.
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return fallback;
}

export const exampleWebhookRouter = new Hono();

exampleWebhookRouter.post("/example", async (c) => {
  // Hono's context doesn't expose the raw socket address in a
  // portable way across adapters; for the template we just fall back
  // to a constant "unknown" when X-Forwarded-For is missing. Behind
  // Traefik / any reverse proxy the header is always present.
  const ip = clientIp(c.req.raw.headers, "unknown");
  try {
    await webhookLimiter.consume(ip);
  } catch (err) {
    if (err instanceof RateLimitError) {
      const retrySeconds = Math.ceil(err.retryAfterMs / 1000);
      return c.json(
        { error: "rate_limited", retryAfterMs: err.retryAfterMs },
        429,
        { "Retry-After": String(retrySeconds) },
      );
    }
    throw err;
  }

  // Real webhook code would verify a signature against c.req.raw.
  return c.json({ ok: true });
});
