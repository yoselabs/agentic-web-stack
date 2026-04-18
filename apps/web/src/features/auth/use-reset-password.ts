import { MIN_PASSWORD_LENGTH } from "@project/auth/constants";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "./auth-client";

const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    ),
});

export function useResetPassword(token: string) {
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { newPassword: "" },
    validators: { onChange: resetPasswordSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      const result = await authClient.resetPassword({
        newPassword: value.newPassword,
        token,
      });
      if (result.error) {
        setFormError(result.error.message ?? "Failed to reset password");
        return;
      }
      await navigate({ to: "/login" });
    },
  });

  return { form, formError };
}
