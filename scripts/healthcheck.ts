// Container healthcheck — probes an HTTP URL, exits 0 if 2xx-4xx, 1 otherwise.
// Used as the image-level HEALTHCHECK in Dockerfile. Each compose service
// passes its own URL via the HEALTHCHECK CMD arg (built from PORT +
// HEALTH_PATH env at container runtime via shell-form expansion).

const url = process.argv[2];
if (!url) {
  console.error("healthcheck: missing URL argument");
  process.exit(1);
}

try {
  const res = await fetch(url);
  // <500 accepts 2xx/3xx/4xx — "the server is responding to HTTP" is the
  // signal we want. A landing page returning 404 or an auth check returning
  // 401 still proves the process is alive. Only 5xx (server error) + network
  // errors should trip the check unhealthy.
  process.exit(res.status < 500 ? 0 : 1);
} catch {
  process.exit(1);
}
