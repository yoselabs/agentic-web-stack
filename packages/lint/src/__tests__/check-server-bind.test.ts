// Unit test for the server-bind guard. Feeds a synthetic source string into
// `runServerBind` and asserts the match / no-match behaviour.

import { describe, expect, it } from "bun:test";
import { runServerBind } from "../check-server-bind.ts";

describe("runServerBind", () => {
  it("passes when serve() binds 0.0.0.0", () => {
    const src = `
      serve({
        fetch: app.fetch,
        port: 3001,
        hostname: "0.0.0.0",
      });
    `;
    expect(runServerBind(src)).toEqual([]);
  });

  it("fails when hostname is missing", () => {
    const src = `
      serve({
        fetch: app.fetch,
        port: 3001,
      });
    `;
    const errors = runServerBind(src, "apps/server/src/index.ts");
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/hostname:"0\.0\.0\.0"/);
    expect(errors[0]).toMatch(/host:"0\.0\.0\.0"/);
  });

  it("fails when hostname is loopback", () => {
    const src = `serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 3001 });`;
    expect(runServerBind(src).length).toBe(1);
  });

  it("passes when quoted with single quotes", () => {
    const src = `serve({ fetch: app.fetch, hostname: '0.0.0.0', port: 3001 });`;
    expect(runServerBind(src)).toEqual([]);
  });

  it("passes when @effect/platform-node binds host: 0.0.0.0", () => {
    const src = `NodeHttpServer.layer(() => createServer(), { port: 3001, host: "0.0.0.0" })`;
    expect(runServerBind(src)).toEqual([]);
  });
});
