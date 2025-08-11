// Simple in-memory token bucket per IP for prototype use only
// Not suitable for multi-instance deployments

type Bucket = { tokens: number; lastRefill: number };
const buckets = new Map<string, Bucket>();

const REFILL_MS = 60_000; // 1 minute
const TOKENS_PER_WINDOW = 30; // 30 requests/minute per IP

function getIp(req: Request): string {
  // Trust standard headers if present, fallback to remote addr (not available in edge runtime)
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  // As a last resort, bucket everyone together
  return "global";
}

export function rateLimitAllow(req: Request): boolean {
  const ip = getIp(req);
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket) {
    bucket = { tokens: TOKENS_PER_WINDOW, lastRefill: now };
    buckets.set(ip, bucket);
  }
  // Refill proportionally
  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    const refill = Math.floor((elapsed / REFILL_MS) * TOKENS_PER_WINDOW);
    if (refill > 0) {
      bucket.tokens = Math.min(TOKENS_PER_WINDOW, bucket.tokens + refill);
      bucket.lastRefill = now;
    }
  }
  if (bucket.tokens <= 0) return false;
  bucket.tokens -= 1;
  return true;
}


