import { createFileRoute, redirect } from "@tanstack/react-router";
import { MagicLinkPage } from "#/features/auth/magic-link-page";

export const Route = createFileRoute("/sign-in/magic-link")({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/dashboard" });
  },
  component: MagicLinkPage,
});
