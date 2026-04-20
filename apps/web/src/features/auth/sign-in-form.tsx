// Sign-in form. Owns its Zod schema, form state, and submit handler.
// Callers render <SignInForm /> inside a route shell — the route
// handles beforeLoad redirects and layout wrapping.

import { Button } from "@project/ui/components/button";
import { Input } from "@project/ui/components/input";
import { Label } from "@project/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { signIn } from "#/features/auth/auth-client";

// Signin accepts any non-empty password — the server is authoritative
// on policy. Showing "min N characters" on signin is misleading because
// the account's existing password may have been set under different rules.
const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

function formatFieldError(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (typeof err === "object" && "message" in err) {
    const { message } = err as { message?: unknown };
    if (typeof message === "string") return message;
  }
  return String(err);
}

export function SignInForm() {
  const navigate = useNavigate();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: { onBlur: signinSchema, onSubmit: signinSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const result = await signIn.email({
        email: value.email,
        password: value.password,
      });
      if (result.error) {
        setFormError(result.error.message ?? "Sign in failed");
        return;
      }
      await router.invalidate();
      await navigate({ to: "/dashboard" });
    },
  });

  return (
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
                {formatFieldError(field.state.meta.errors[0])}
              </p>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="password">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Password</Label>
            <Input
              id={field.name}
              type="password"
              placeholder="Your password"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              required
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-sm text-destructive">
                {formatFieldError(field.state.meta.errors[0])}
              </p>
            )}
          </div>
        )}
      </form.Field>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            Sign In
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
