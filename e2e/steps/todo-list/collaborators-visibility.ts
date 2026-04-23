// Step definitions for the collaborators-list visibility feature.
// Owner row renders first with an "Owner" badge; collaborator rows
// render after with a "Collaborator" badge. The viewer's own row is
// suffixed with "(You)". Remove buttons appear only on peer rows when
// the viewer is the owner.

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { getActor } from "./collaborators.ts";

const { Then } = createBdd();

// Collaborator rows are <li aria-label={user.name}> rendered inside the
// CollaboratorList <ul>. Actors set name === username, so addressing a
// row by role+name yields the right one without needing a separate
// landmark for the section. The scenarios verify owner vs collaborator
// vs (You) markings by asserting the row is visible and contains the
// expected badge/suffix text.

function collaboratorRow(page: Page, username: string) {
  // exact: true — activity-feed <li>s carry aria-label containing the
  // same username in a longer sentence (e.g. "alice added alice").
  return page.getByRole("listitem", { name: username, exact: true });
}

Then(
  "the collaborators list shows {string} with an {string} badge and {string} suffix for {string}",
  async (
    // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
    {},
    username: string,
    badge: string,
    suffix: string,
    actorName: string,
  ) => {
    const actor = getActor(actorName);
    const row = collaboratorRow(actor.page, username);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(badge, { exact: true })).toBeVisible();
    await expect(row.getByText(suffix, { exact: true })).toBeVisible();
  },
);

Then(
  "the collaborators list shows {string} with an {string} badge for {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, username: string, badge: string, actorName: string) => {
    const actor = getActor(actorName);
    const row = collaboratorRow(actor.page, username);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(badge, { exact: true })).toBeVisible();
  },
);

Then(
  "the collaborators list shows {string} with a {string} badge for {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, username: string, badge: string, actorName: string) => {
    const actor = getActor(actorName);
    const row = collaboratorRow(actor.page, username);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(badge, { exact: true })).toBeVisible();
  },
);

Then(
  "the collaborators list shows {string} with a {string} badge and {string} suffix for {string}",
  async (
    // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
    {},
    username: string,
    badge: string,
    suffix: string,
    actorName: string,
  ) => {
    const actor = getActor(actorName);
    const row = collaboratorRow(actor.page, username);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(badge, { exact: true })).toBeVisible();
    await expect(row.getByText(suffix, { exact: true })).toBeVisible();
  },
);

Then(
  "no Remove button is shown on the owner row for {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string) => {
    const actor = getActor(actorName);
    // Owner row is the first listitem in the collaborator list; address
    // it by the owner's username via the shared helper. We rely on the
    // feature-level assertions above to prove the owner's username
    // appears on the owner row — here we only assert *no* Remove button
    // exists on *any* collaborator row of the owner. For visibility-only
    // scenarios the acting user IS the owner, so their listitem is the
    // owner row.
    const row = collaboratorRow(actor.page, actor.username);
    await expect(row.getByRole("button", { name: "Remove" })).toHaveCount(0);
  },
);

Then(
  "no Remove buttons are shown in the collaborators list for {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string) => {
    const actor = getActor(actorName);
    // Remove buttons only ever render in the Collaborators <ul>. The
    // list-detail page has no other "Remove" button, so the assertion
    // is deterministic when scoped to the page.
    await expect(
      actor.page.getByRole("button", { name: "Remove" }),
    ).toHaveCount(0);
  },
);
