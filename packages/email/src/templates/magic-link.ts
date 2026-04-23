export type MagicLinkVars = {
  signInUrl: string;
};

export const magicLinkTemplate = {
  name: "magic-link",
  render(vars: MagicLinkVars) {
    return {
      subject: "Your sign-in link",
      html: `
        <p>Click the link below to sign in. It expires in 5 minutes and can only be used once.</p>
        <p><a href="${vars.signInUrl}">Sign in</a></p>
        <p>If you didn't request this, you can ignore this email.</p>
      `,
      text: `Sign in: ${vars.signInUrl}\n\nThe link expires in 5 minutes and can only be used once. If you didn't request this, ignore this email.`,
    };
  },
} as const;
