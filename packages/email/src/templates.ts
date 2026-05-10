// Email body templates. Pure render functions returning the
// subject + html + text fields a SendEmailInput needs (minus the
// to/from envelope which the producer fills). Phase 4 capability #2.
//
// Kept as plain TS functions rather than JSX/Effect: rendering itself
// has no failure modes worth modeling, and the producers (Better-Auth
// callbacks, future invite flow) already run inside async/Effect
// context. If a future template needs i18n or async data fetch, lift
// it to `Effect<Rendered, RenderError, R>` at that point.

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

const escapeHtml = (raw: string): string =>
  raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export interface MagicLinkInput {
  readonly url: string;
}

export const renderMagicLink = ({ url }: MagicLinkInput): RenderedEmail => {
  const safeUrl = escapeHtml(url);
  return {
    subject: "Your sign-in link",
    html: `<p>Sign in by clicking the link below. It expires in 5 minutes.</p>
<p><a href="${safeUrl}">${safeUrl}</a></p>
<p>If you did not request this email, you can safely ignore it.</p>`,
    text: `Sign in by visiting this link (expires in 5 minutes):\n\n${url}\n\nIf you did not request this email, you can safely ignore it.`,
  };
};

export interface PasswordResetInput {
  readonly url: string;
  readonly username: string;
}

export const renderPasswordReset = ({
  url,
  username,
}: PasswordResetInput): RenderedEmail => {
  const safeUrl = escapeHtml(url);
  const safeUser = escapeHtml(username);
  return {
    subject: "Reset your password",
    html: `<p>Hi ${safeUser},</p>
<p>We received a request to reset your password. Click the link below to set a new one:</p>
<p><a href="${safeUrl}">${safeUrl}</a></p>
<p>If you did not request this, you can safely ignore this email.</p>`,
    text: `Hi ${username},\n\nWe received a request to reset your password. Visit this link to set a new one:\n\n${url}\n\nIf you did not request this, you can safely ignore this email.`,
  };
};

export interface InviteCollaboratorInput {
  readonly url: string;
  readonly inviterName: string;
  readonly resourceName: string;
}

export const renderInviteCollaborator = ({
  url,
  inviterName,
  resourceName,
}: InviteCollaboratorInput): RenderedEmail => {
  const safeUrl = escapeHtml(url);
  const safeInviter = escapeHtml(inviterName);
  const safeResource = escapeHtml(resourceName);
  return {
    subject: `${inviterName} invited you to collaborate on ${resourceName}`,
    html: `<p>${safeInviter} invited you to collaborate on <strong>${safeResource}</strong>.</p>
<p>Accept the invitation by clicking the link below:</p>
<p><a href="${safeUrl}">${safeUrl}</a></p>
<p>If you do not recognize this invitation, you can ignore this email.</p>`,
    text: `${inviterName} invited you to collaborate on ${resourceName}.\n\nAccept the invitation by visiting:\n\n${url}\n\nIf you do not recognize this invitation, you can ignore this email.`,
  };
};
