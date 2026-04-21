import { createFileRoute, redirect } from "@tanstack/react-router";
import { ForgotPasswordPage } from "#/features/auth/forgot-password-page";

export const Route = createFileRoute("/forgot-password")({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/dashboard" });
  },
  component: ForgotPasswordPage,
});
