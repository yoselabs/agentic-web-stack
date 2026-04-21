import { createFileRoute, redirect } from "@tanstack/react-router";
import { ResetPasswordPage } from "#/features/auth/reset-password-page";

export const Route = createFileRoute("/reset-password")({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/dashboard" });
  },
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const { token } = Route.useSearch();
  return <ResetPasswordPage token={token} />;
}
