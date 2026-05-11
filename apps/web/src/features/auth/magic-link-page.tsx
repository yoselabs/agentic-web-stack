// Magic-link sign-in page (Phase 4 capability #2). The user submits
// their email; Better-Auth's server-side magicLink plugin enqueues an
// email job (see packages/auth/src/index.ts → enqueueSendEmail), the
// worker (apps/worker/src/handlers/email.ts) drives the SMTP send,
// and the user clicks the verify URL out-of-band. This page only
// handles the request side — verification is owned by Better-Auth's
// /api/auth/magic-link/verify handler, which redirects to callbackURL
// on success.

import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";

export function MagicLinkPage(): React.ReactElement {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await authClient.signIn.magicLink({
      email,
      callbackURL: `${window.location.origin}/dashboard`,
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Could not send magic link");
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <main style={{ padding: "2rem", maxWidth: "420px", margin: "0 auto" }}>
        <h1>Check your email</h1>
        <p>
          {"We sent a sign-in link to "}
          <strong>{email}</strong>
          {". Click it to finish signing in. The link expires in 5 minutes."}
        </p>
        <p style={{ marginTop: "1.5rem" }}>
          <Link to="/sign-in">Back to sign in</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "420px", margin: "0 auto" }}>
      <h1>Sign in with link</h1>
      <p>
        {"We will email you a one-time link to sign in. No password needed."}
      </p>
      <form onSubmit={handleSubmit} aria-label="Request magic link">
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ display: "block", width: "100%" }}
          />
        </label>
        {error && (
          <p role="alert" style={{ color: "crimson" }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || email.length === 0}>
          {busy ? "Sending…" : "Send link"}
        </button>
      </form>
      <p style={{ marginTop: "1.5rem" }}>
        <Link to="/sign-in">Use password instead</Link>
      </p>
    </main>
  );
}
