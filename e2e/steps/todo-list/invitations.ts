// Step definitions for the invitation flow — autocomplete, no-match
// error, pending-invites on both the invitee dashboard and owner share
// dialog.  Reuses actor helpers from ./collaborators.ts.

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { SHARED_PASSWORD } from "../../fixtures/credentials.ts";
import { waitForHydration } from "../../helpers/waits.ts";
import { TEST_API_URL } from "../../test-env.ts";
import { getActor, listIdByName } from "./collaborators.ts";

const { Given, When, Then } = createBdd();

// --- Given: server-side invite shortcut ---

// Short-circuits the UI by POSTing tRPC inviteCollaborator as the owner.
// Faster and avoids the autocomplete debounce.
Given(
  "{string} has invited {string} to {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, inviterName: string, inviteeName: string, listName: string) => {
    const inviter = getActor(inviterName);
    const invitee = getActor(inviteeName);
    const listId = listIdByName.get(listName);
    if (!listId) {
      throw new Error(`List "${listName}" has no known id.`);
    }
    const res = await inviter.page.request.post(
      `${TEST_API_URL}/trpc/todoList.inviteCollaborator`,
      { data: { listId, username: invitee.username } },
    );
    if (!res.ok()) {
      throw new Error(
        `inviteCollaborator failed: ${res.status()} ${await res.text()}`,
      );
    }
  },
);

// --- When: owner opens the share dialog ---

When(
  "{string} opens the share dialog for {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, listName: string) => {
    const actor = getActor(actorName);
    const listId = listIdByName.get(listName);
    if (!listId) {
      throw new Error(`List "${listName}" has no known id.`);
    }
    if (!actor.page.url().includes(`/todo-lists/${listId}`)) {
      await actor.page.goto(`/todo-lists/${listId}`);
      await waitForHydration(actor.page);
    }
    await actor.page.getByRole("button", { name: "Share" }).click();
    await expect(actor.page.getByRole("dialog")).toBeVisible({
      timeout: 5000,
    });
  },
);

When(
  "{string} types {string} in the invite field",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, text: string) => {
    const actor = getActor(actorName);
    const dialog = actor.page.getByRole("dialog");
    await dialog.getByPlaceholder("Search by username or name").fill(text);
  },
);

When(
  "{string} signs in and opens the dashboard",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string) => {
    const actor = getActor(actorName);
    await actor.page.context().clearCookies();
    const res = await actor.page.request.post(
      `${TEST_API_URL}/api/auth/sign-in/email`,
      { data: { email: actor.email, password: SHARED_PASSWORD } },
    );
    if (!res.ok()) {
      throw new Error(`sign-in failed: ${res.status()} ${await res.text()}`);
    }
    await actor.page.goto("/dashboard");
    await waitForHydration(actor.page);
  },
);

When(
  "{string} revokes the invite for {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, inviteeUsername: string) => {
    const actor = getActor(actorName);
    const dialog = actor.page.getByRole("dialog");
    // Pending-invite rows are <li>s mentioning the invitee's username;
    // filter narrows by visible text (the username) without a raw selector.
    const row = dialog
      .getByRole("listitem")
      .filter({ hasText: inviteeUsername });
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toBeHidden({ timeout: 10_000 });
  },
);

// --- Then ---

Then(
  "{string} sees {string} in the invite suggestions",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, text: string) => {
    const actor = getActor(actorName);
    const dialog = actor.page.getByRole("dialog");
    // Suggestion buttons carry the matched text in their accessible name.
    // Role+text scoping is stable even if the surrounding DOM shifts.
    await expect(
      dialog.getByRole("button", { name: new RegExp(text) }),
    ).toBeVisible({ timeout: 5000 });
  },
);

Then(
  "{string} does not see {string} in the invite suggestions",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, text: string) => {
    const actor = getActor(actorName);
    const dialog = actor.page.getByRole("dialog");
    await expect(dialog.getByText(text, { exact: false })).toHaveCount(0);
  },
);

Then(
  "{string} sees {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, text: string) => {
    const actor = getActor(actorName);
    await expect
      .poll(
        () =>
          actor.page
            .getByText(text, { exact: false })
            .filter({ visible: true })
            .count(),
        { timeout: 5000 },
      )
      .toBeGreaterThanOrEqual(1);
  },
);

Then(
  "{string} sees {string} under pending invitations",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, listName: string) => {
    const actor = getActor(actorName);
    // PendingInvitesDashboard sets role="region" on the Card with the
    // heading as its accessible name so we can address it by name.
    const card = actor.page.getByRole("region", {
      name: "Pending invitations",
    });
    await expect(
      card.getByText(listName).filter({ visible: true }),
    ).toBeVisible({ timeout: 10_000 });
  },
);

Then(
  "{string} can Accept or Decline the invite",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string) => {
    const actor = getActor(actorName);
    // `toBeVisible` on a multi-match locator triggers strict-mode; assert
    // count ≥1 via expect.poll to accept "at least one" without picking.
    await expect
      .poll(() => actor.page.getByRole("button", { name: "Accept" }).count(), {
        timeout: 5000,
      })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(() => actor.page.getByRole("button", { name: "Decline" }).count(), {
        timeout: 5000,
      })
      .toBeGreaterThanOrEqual(1);
  },
);

Then(
  "{string} sees {string} in the pending invites section",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, username: string) => {
    const actor = getActor(actorName);
    const dialog = actor.page.getByRole("dialog");
    // The pending-invites <section> inside the dialog carries an
    // accessible name via its <h3>Pending invites</h3>. Address by role.
    const section = dialog.getByRole("region", { name: "Pending invites" });
    await expect(
      section.getByText(username).filter({ visible: true }),
    ).toBeVisible({ timeout: 10_000 });
  },
);

Then(
  "{string} does not see {string} in the pending invites section",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, username: string) => {
    const actor = getActor(actorName);
    const dialog = actor.page.getByRole("dialog");
    // The whole section vanishes when the last invite is revoked (the
    // component renders null on empty data). Accept either: section gone,
    // or section present but username absent.
    const section = dialog.getByRole("region", { name: "Pending invites" });
    const sectionCount = await section.count();
    if (sectionCount === 0) return;
    await expect(section.getByText(username)).toHaveCount(0);
  },
);
