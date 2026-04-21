import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginPage } from "#/features/auth/login-page";

export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/dashboard" });
  },
  component: LoginPage,
});
