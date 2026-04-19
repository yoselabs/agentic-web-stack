// Step definitions for the collaborators-list visibility feature.
// Owner row renders first with an "Owner" badge; collaborator rows
// render after with a "Collaborator" badge. The viewer's own row is
// suffixed with "(You)". Remove buttons appear only on peer rows when
// the viewer is the owner.

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { getActor } from "./collaborators.ts";

const { Then } = createBdd();

// Helper: locate the <ul> that holds collaborator rows. The list-detail
// page renders a <section><h2>Collaborators</h2><ul>...</ul></section>.
function collaboratorList(page: import("@playwright/test").Page) {
  return page
    .locator("section", {
      has: page.getByRole("heading", { name: "Collaborators" }),
    })
    .locator("ul")
    .first();
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
    const list = collaboratorList(actor.page);
    const row = list.locator("li", { hasText: username }).first();
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
    const list = collaboratorList(actor.page);
    const row = list.locator("li", { hasText: username }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(badge, { exact: true })).toBeVisible();
  },
);

Then(
  "the collaborators list shows {string} with a {string} badge for {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, username: string, badge: string, actorName: string) => {
    const actor = getActor(actorName);
    const list = collaboratorList(actor.page);
    const row = list.locator("li", { hasText: username }).first();
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
    const list = collaboratorList(actor.page);
    const row = list.locator("li", { hasText: username }).first();
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
    const list = collaboratorList(actor.page);
    // Owner row is the first <li>; assert it has no Remove button.
    const ownerRow = list.locator("li").first();
    await expect(ownerRow.getByRole("button", { name: "Remove" })).toHaveCount(
      0,
    );
  },
);

Then(
  "no Remove buttons are shown in the collaborators list for {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string) => {
    const actor = getActor(actorName);
    const list = collaboratorList(actor.page);
    await expect(list.getByRole("button", { name: "Remove" })).toHaveCount(0);
  },
);
