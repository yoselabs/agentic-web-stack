import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "./auth-client";

const magicLinkSchema = z.object({
  email: z.email("Please enter a valid email"),
});

export function useMagicLink() {
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: "" },
    validators: { onChange: magicLinkSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      // Use $fetch instead of authClient.signIn.magicLink: the project
      // narrows authClient's type via `as unknown as AuthClient` (see
      // auth-client.ts) which strips the magic-link plugin's signIn
      // augmentation. The HTTP surface is stable and matches the
      // pattern in use-forgot-password.ts.
      // Absolute URLs: Better-Auth's verify endpoint issues a 302 to the
      // callbackURL. A relative path is resolved against BETTER_AUTH_URL
      // (the API host) and would land on the API server, not the web
      // app. window.location.origin pins the redirect to whichever web
      // host the user submitted from.
      const webOrigin = window.location.origin;
      const result = await authClient.$fetch("/sign-in/magic-link" as string, {
        method: "POST",
        body: JSON.stringify({
          email: value.email,
          // Success → /dashboard. Failure (expired, already-used,
          // invalid token) → request page with ?error=expired so we
          // can render the failure state without a separate route.
          callbackURL: `${webOrigin}/dashboard`,
          errorCallbackURL: `${webOrigin}/sign-in/magic-link?error=expired`,
        }),
        headers: { "Content-Type": "application/json" },
      });
      if (result.error) {
        setFormError(
          (result.error as { message?: string }).message ??
            "Failed to send sign-in link",
        );
        return;
      }
      setSubmitted(true);
    },
  });

  return { form, submitted, formError };
}
