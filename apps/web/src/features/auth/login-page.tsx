import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@project/ui/components/card";
import { Link } from "@tanstack/react-router";
import { SignInForm } from "#/features/auth/sign-in-form";

export function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Sign In</CardTitle>
          <CardDescription>Enter your credentials to sign in</CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm />

          <p className="mt-4 text-center text-muted-foreground text-sm">
            <Link
              to={"/forgot-password" as string}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Forgot password?
            </Link>
          </p>

          <p className="mt-4 text-center text-muted-foreground text-sm">
            Don't have an account?{" "}
            <Link
              to="/signup"
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Sign Up
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
