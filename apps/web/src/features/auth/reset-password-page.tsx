import { MIN_PASSWORD_LENGTH } from "@project/auth/constants";
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
import { useResetPassword } from "#/features/auth/use-reset-password";

export function ResetPasswordPage({ token }: { token: string }) {
  const { form, formError } = useResetPassword(token);

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Invalid link</CardTitle>
            <CardDescription>
              This password reset link is missing a token.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-center text-sm text-muted-foreground">
              <Link
                to={"/forgot-password" as string}
                className="text-foreground underline underline-offset-4 hover:text-primary"
              >
                Request a new link
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
          <CardTitle className="text-2xl">Reset password</CardTitle>
          <CardDescription>Enter your new password below.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
            className="space-y-4"
          >
            <form.Field name="newPassword">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>New password</Label>
                  <Input
                    id={field.name}
                    type="password"
                    placeholder={`Min ${MIN_PASSWORD_LENGTH} characters`}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
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
                  Reset password
                </Button>
              )}
            </form.Subscribe>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
