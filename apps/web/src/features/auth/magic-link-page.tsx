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
import { Link, useSearch } from "@tanstack/react-router";
import { useMagicLink } from "#/features/auth/use-magic-link";

export function MagicLinkPage() {
  const { form, submitted, formError } = useMagicLink();
  // Better-Auth's verify endpoint redirects here with ?error=expired when
  // the token is invalid, expired, or already consumed. The same surface
  // serves as both request form and post-failure landing.
  const { error } = useSearch({ from: "/sign-in/magic-link" });

  if (submitted) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Check your email</CardTitle>
            <CardDescription>
              We sent you a sign-in link. It expires in 5 minutes and can only
              be used once.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-center text-muted-foreground text-sm">
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
          <CardTitle className="text-2xl">Sign in with a link</CardTitle>
          <CardDescription>
            Enter your email and we'll send you a one-time sign-in link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <p
              role="alert"
              className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-center text-destructive text-sm"
            >
              This sign-in link has expired or is invalid. Request a new one
              below.
            </p>
          )}

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
                    <p className="text-destructive text-sm">
                      {String(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            {formError && (
              <p className="text-destructive text-sm">{formError}</p>
            )}

            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  Send sign-in link
                </Button>
              )}
            </form.Subscribe>
          </form>

          <p className="mt-4 text-center text-muted-foreground text-sm">
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
