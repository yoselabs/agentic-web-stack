// Template for collaborator invites. Consumed in Plan C when
// todoListService.inviteCollaborator enqueues the job.

export type InviteCollaboratorVars = {
  inviterName: string;
  listName: string;
  acceptUrl: string;
};

export const inviteCollaboratorTemplate = {
  name: "invite-collaborator",
  render(vars: InviteCollaboratorVars) {
    return {
      subject: `${vars.inviterName} invited you to "${vars.listName}"`,
      html: `
        <p>${vars.inviterName} invited you to collaborate on the list <strong>${vars.listName}</strong>.</p>
        <p><a href="${vars.acceptUrl}">Accept invite</a></p>
        <p>This link will expire in 7 days.</p>
      `,
      text: `${vars.inviterName} invited you to "${vars.listName}".\n\nAccept: ${vars.acceptUrl}\n\nExpires in 7 days.`,
    };
  },
} as const;
