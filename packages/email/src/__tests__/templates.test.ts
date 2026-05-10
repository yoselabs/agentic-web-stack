import { describe, expect, it } from "bun:test";
import {
  renderInviteCollaborator,
  renderMagicLink,
  renderPasswordReset,
} from "../templates.ts";

describe("renderMagicLink", () => {
  it("includes the url in both html and text bodies", () => {
    const out = renderMagicLink({ url: "https://example.com/verify?t=abc" });
    expect(out.subject).toBe("Your sign-in link");
    expect(out.html).toContain("https://example.com/verify?t=abc");
    expect(out.text).toContain("https://example.com/verify?t=abc");
  });

  it("escapes html in the url", () => {
    const out = renderMagicLink({
      url: "https://example.com/?x=<script>alert(1)</script>",
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
  });
});

describe("renderPasswordReset", () => {
  it("greets the user by name and includes the url", () => {
    const out = renderPasswordReset({
      url: "https://example.com/reset?t=xyz",
      username: "alice",
    });
    expect(out.subject).toBe("Reset your password");
    expect(out.html).toContain("Hi alice");
    expect(out.html).toContain("https://example.com/reset?t=xyz");
    expect(out.text).toContain("Hi alice");
  });

  it("escapes html-injecting usernames", () => {
    const out = renderPasswordReset({
      url: "https://example.com/reset",
      username: "<b>evil</b>",
    });
    expect(out.html).not.toContain("<b>evil</b>");
    expect(out.html).toContain("&lt;b&gt;evil&lt;/b&gt;");
  });
});

describe("renderInviteCollaborator", () => {
  it("renders inviter, resource, and url", () => {
    const out = renderInviteCollaborator({
      url: "https://example.com/invite/abc",
      inviterName: "Bob",
      resourceName: "Q4 Roadmap",
    });
    expect(out.subject).toContain("Bob");
    expect(out.subject).toContain("Q4 Roadmap");
    expect(out.html).toContain("https://example.com/invite/abc");
    expect(out.text).toContain("Q4 Roadmap");
  });
});
