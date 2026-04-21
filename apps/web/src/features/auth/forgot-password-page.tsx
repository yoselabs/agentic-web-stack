import { Button } from "@project/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@project/ui/components/card";
import { Input } from "@project/ui/components/input";
import { Label } from "@project/ui/components/label";
import { Link } from "@tanstack/react-router";
import { useForgotPassword } from "#/features/auth/use-forgot-password";

export function ForgotPasswordPage() {
  const { form, submitted, formError } = useForgotPassword();

  if (submitted) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Check your email</CardTitle>
            <CardDescription>
              If an account exists for that email, we sent a password reset
              link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-center text-sm text-muted-foreground">
              <Link
                to="/login"
                className="text-foreground underline underline-offset-4 hover:text-primary"
              >
                Back to sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Forgot password?</CardTitle>
          <CardDescription>
            Enter your email and we will send you a reset link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
            className="space-y-4"
          >
            <form.Field name="email">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Email</Label>
                  <Input
                    id={field.name}
                    type="email"
                    placeholder="you@example.com"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    required
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">
                      {String(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}

            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  Send reset link
                </Button>
              )}
            </form.Subscribe>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link
              to="/login"
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
