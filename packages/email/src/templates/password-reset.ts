// Template registry entry. Renders to { subject, html, text }.
// vars typing is the source of truth for what the caller of send() must pass.

export type PasswordResetVars = {
  userName: string;
  resetUrl: string;
};

export const passwordResetTemplate = {
  name: "password-reset",
  render(vars: PasswordResetVars) {
    return {
      subject: "Reset your password",
      html: `
        <p>Hi ${vars.userName},</p>
        <p>We received a request to reset your password. Click below to choose a new one:</p>
        <p><a href="${vars.resetUrl}">Reset password</a></p>
        <p>If you didn't request this, you can ignore this email.</p>
      `,
      text: `Hi ${vars.userName},\n\nReset your password: ${vars.resetUrl}\n\nIf you didn't request this, ignore this email.`,
    };
  },
} as const;
