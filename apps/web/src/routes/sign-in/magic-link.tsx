import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { MagicLinkPage } from "#/features/auth/magic-link-page";

const magicLinkSearchSchema = z.object({
  // Better-Auth's verify endpoint redirects here with `?error=expired`
  // when the token is invalid, expired, or already consumed.
  error: z.string().optional(),
});

export const Route = createFileRoute("/sign-in/magic-link")({
  validateSearch: magicLinkSearchSchema,
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/dashboard" });
  },
  component: MagicLinkPage,
});
