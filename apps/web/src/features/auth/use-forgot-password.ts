import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "./auth-client";

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email"),
});

export function useForgotPassword() {
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: "" },
    validators: { onChange: forgotPasswordSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      // Better-Auth client method: requestPasswordReset (maps to /request-password-reset)
      const result = await authClient.$fetch(
        "/request-password-reset" as string,
        {
          method: "POST",
          body: JSON.stringify({
            email: value.email,
            redirectTo: "/reset-password",
          }),
          headers: { "Content-Type": "application/json" },
        },
      );
      if (result.error) {
        setFormError(
          (result.error as { message?: string }).message ??
            "Failed to send reset email",
        );
        return;
      }
      setSubmitted(true);
    },
  });

  return { form, submitted, formError };
}
