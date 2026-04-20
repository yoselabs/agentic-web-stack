import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@project/ui/components/card";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { SignUpForm } from "#/features/auth/sign-up-form";

export const Route = createFileRoute("/signup")({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/dashboard" });
  },
  component: SignUpPage,
});

function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Create Account</CardTitle>
          <CardDescription>
            Enter your details to create an account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm />

          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link
              to={"/forgot-password" as string}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Forgot password?
            </Link>
          </p>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              to="/login"
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Sign In
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
