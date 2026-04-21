// Sign-up form. Owns its Zod schema, form state, and submit handler.
// Name and username are optional in the form — the submit handler
// derives them from the email local-part if blank, keeping the UI
// terse while still populating Better-Auth's required `username` and
// `name` fields (see packages/auth/src/index.ts additionalFields).

import { MIN_PASSWORD_LENGTH } from "@project/auth/constants";
import { Button } from "@project/ui/components/button";
import { Input } from "@project/ui/components/input";
import { Label } from "@project/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { signUp } from "#/features/auth/auth-client";

const signupSchema = z.object({
  email: z.email(),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Min ${MIN_PASSWORD_LENGTH} characters`),
  // Empty allowed — submit handler derives name/username from email.
  name: z.string(),
  username: z.string(),
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

export function SignUpForm() {
  const navigate = useNavigate();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: "", password: "", name: "", username: "" },
    validators: { onBlur: signupSchema, onSubmit: signupSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const result = await signUp.email({
        email: value.email,
        password: value.password,
        name: value.name || value.email.split("@")[0],
        username: value.username || value.email.split("@")[0],
      });
      if (result.error) {
        setFormError(result.error.message ?? "Sign up failed");
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
      <form.Field name="name">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Name</Label>
            <Input
              id={field.name}
              type="text"
              placeholder="Your name"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          </div>
        )}
      </form.Field>

      <form.Field name="username">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Username</Label>
            <Input
              id={field.name}
              type="text"
              placeholder="your_username"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          </div>
        )}
      </form.Field>

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
              placeholder={`Min ${MIN_PASSWORD_LENGTH} characters`}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
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
            Sign Up
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
