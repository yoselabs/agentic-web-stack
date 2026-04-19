// Step definitions for multi-user todo-list collaboration scenarios.
//
// Architectural decision: named actors ("alice", "bob") each run in a
// FRESH Playwright BrowserContext (incognito profile). This isolates
// their cookie jars so two sessions coexist in one scenario. The default
// `page` fixture is reused for single-user scenarios elsewhere; this
// file deliberately does NOT pipe through that fixture for action/assert
// steps (the actor name picks the target).
//
// Precedent: the admin-gate step file uses module-level state
// (lastAdminStatus/lastAdminBody) for scenario-scoped caching. Same
// pattern, scaled to a Map<actorName, Actor>.

import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { SHARED_PASSWORD } from "../../fixtures/credentials.ts";
import { getMessageBody, waitForMailTo } from "../../helpers/mailpit.ts";
import { TEST_API_URL } from "../../test-env.ts";
import { waitForHydration } from "../../waits.ts";

const { Given, When, Then, Before, After } = createBdd();

type Actor = {
  context: BrowserContext;
  page: Page;
  email: string;
  username: string;
};

const actors = new Map<string, Actor>();

// Track list IDs by display name so steps that need to navigate directly
// to a list can resolve the ID without going through the UI listing
// (which, for the collaborator, may not show the list before accept).
const listIdByName = new Map<string, string>();

Before(async () => {
  actors.clear();
  listIdByName.clear();
  // Mailpit is per-worktree (dynamic TEST_MAILPIT_HTTP_PORT) but shared
  // across parallel workers. Scenarios in this file assert on recipient
  // (waitForMailTo filters by `to:`), so stale mail addressed to other
  // actors is harmless. Per-scenario delete-all would race with a
  // sibling scenario polling for an email it just sent. Scenarios that
  // poll for mail account for staleness by content assertions
  // (toContain(listName)) — safe on reruns since list names are unique.
});

After(async () => {
  for (const actor of actors.values()) {
    await actor.context.close().catch(() => {});
  }
  actors.clear();
  listIdByName.clear();
});

function getActor(name: string): Actor {
  const actor = actors.get(name);
  if (!actor) {
    throw new Error(
      `Unknown actor "${name}". Register actors with a Given-signup step before use.`,
    );
  }
  return actor;
}

// Better-Auth sign-up with an EXPLICIT username. The shared
// createUserViaApi in auth-client.ts derives username from email.split("@")[0];
// the collaborator scenarios need stable usernames decoupled from the
// email prefix (invites target usernames, emails carry tokens).
async function signUpWithUsername(
  page: Page,
  email: string,
  username: string,
): Promise<void> {
  const res = await page.request.post(
    `${TEST_API_URL}/api/auth/sign-up/email`,
    {
      data: {
        email,
        password: SHARED_PASSWORD,
        name: username,
        username,
      },
      failOnStatusCode: false,
    },
  );
  if (res.ok()) return;
  if (res.status() === 422) return;
  const body = await res.text();
  if (/already\s*exists|user_already/i.test(body)) return;
  throw new Error(
    `signUpWithUsername(${email}) failed: ${res.status()} ${body}`,
  );
}

async function signInOnPage(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.context().clearCookies();
  const res = await page.request.post(
    `${TEST_API_URL}/api/auth/sign-in/email`,
    { data: { email, password } },
  );
  if (!res.ok()) {
    throw new Error(
      `signInOnPage(${email}) failed: ${res.status()} ${await res.text()}`,
    );
  }
}

async function spawnActor(
  browser: import("@playwright/test").Browser,
  name: string,
  email: string,
  username: string,
): Promise<Actor> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const actor: Actor = { context, page, email, username };
  actors.set(name, actor);
  return actor;
}

// --- Given: actor registration ---

Given(
  "{string} is signed up and signed in as {string} with email {string}",
  async ({ browser }, name: string, username: string, email: string) => {
    const actor = await spawnActor(browser, name, email, username);
    await signUpWithUsername(actor.page, email, username);
    await signInOnPage(actor.page, email, SHARED_PASSWORD);
  },
);

Given(
  "{string} is signed up with username {string} and email {string}",
  async ({ browser }, name: string, username: string, email: string) => {
    const actor = await spawnActor(browser, name, email, username);
    await signUpWithUsername(actor.page, email, username);
    // Intentionally no sign-in — actor will sign in later when opening
    // the invite link.
    await actor.page.context().clearCookies();
  },
);

// Create a list through the UI (exercises the form). The listId is
// cached via the tRPC list endpoint afterwards so later steps can
// deep-link without re-querying the UI.
Given(
  "{string} has a list named {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, listName: string) => {
    const actor = getActor(name);
    await actor.page.goto("/todo-lists");
    await waitForHydration(actor.page);
    await actor.page.getByPlaceholder("New list name...").fill(listName);
    await actor.page.getByRole("button", { name: "Create" }).click();
    await expect(actor.page.getByText(listName).first()).toBeVisible({
      timeout: 10_000,
    });
    const id = await resolveListIdFor(actor, listName);
    listIdByName.set(listName, id);
  },
);

// Short-circuits the invite/accept UI with two tRPC HTTP calls on the
// actors' own cookie-jar'd pages. Speeds the scenario up ~10× vs. a full
// UI round-trip and isolates this step from selector churn.
Given(
  "{string} is a collaborator on {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, listName: string) => {
    const owner = getActor("alice");
    const invitee = getActor(name);
    const listId = listIdByName.get(listName);
    if (!listId) {
      throw new Error(
        `List "${listName}" has no known id. Ensure it was created earlier.`,
      );
    }
    const inviteRes = await owner.page.request.post(
      `${TEST_API_URL}/trpc/todoList.inviteCollaborator`,
      {
        data: { listId, username: invitee.username },
      },
    );
    if (!inviteRes.ok()) {
      throw new Error(
        `inviteCollaborator failed: ${inviteRes.status()} ${await inviteRes.text()}`,
      );
    }
    const inviteBody = (await inviteRes.json()) as {
      result?: { data?: { token: string } };
    };
    const token = inviteBody.result?.data?.token;
    if (!token) {
      throw new Error(
        `inviteCollaborator response missing token: ${JSON.stringify(inviteBody)}`,
      );
    }
    // Invitee needs to be signed in to accept. For scenarios where bob
    // was created but not yet signed in (invite scenario's Background),
    // sign in here.
    await signInOnPage(invitee.page, invitee.email, SHARED_PASSWORD);
    const acceptRes = await invitee.page.request.post(
      `${TEST_API_URL}/trpc/todoList.acceptInvite`,
      {
        data: { token },
      },
    );
    if (!acceptRes.ok()) {
      throw new Error(
        `acceptInvite failed: ${acceptRes.status()} ${await acceptRes.text()}`,
      );
    }
  },
);

Given(
  "{string} has a todo {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, listName: string, todoTitle: string) => {
    const owner = getActor("alice");
    const listId = listIdByName.get(listName);
    if (!listId) {
      throw new Error(`List "${listName}" has no known id.`);
    }
    const res = await owner.page.request.post(
      `${TEST_API_URL}/trpc/todo.create`,
      { data: { todoListId: listId, title: todoTitle } },
    );
    if (!res.ok()) {
      throw new Error(
        `todo.create failed: ${res.status()} ${await res.text()}`,
      );
    }
  },
);

Given(
  "{string} has {string} open in a browser",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, listName: string) => {
    const actor = getActor(name);
    const listId = listIdByName.get(listName);
    if (!listId) {
      throw new Error(`List "${listName}" has no known id.`);
    }
    await actor.page.goto(`/todo-lists/${listId}`);
    await waitForHydration(actor.page);
    // Wait for the list query to resolve — heading flips from "Loading..."
    // to the list name.
    await expect(
      actor.page.getByRole("heading", { name: listName }),
    ).toBeVisible({ timeout: 10_000 });
  },
);

// --- When ---

When(
  "{string} invites {string} to {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, inviterName: string, inviteeName: string, listName: string) => {
    const inviter = getActor(inviterName);
    const invitee = getActor(inviteeName);
    const listId = listIdByName.get(listName);
    if (!listId) {
      throw new Error(`List "${listName}" has no known id.`);
    }
    await inviter.page.goto(`/todo-lists/${listId}`);
    await waitForHydration(inviter.page);
    await inviter.page.getByRole("button", { name: "Share" }).click();
    const dialog = inviter.page.getByRole("dialog");
    await dialog.getByPlaceholder("Username").fill(invitee.username);
    await dialog.getByRole("button", { name: "Invite" }).click();
    // Wait for the dialog to close (success path closes it, see
    // share-list-dialog.tsx's onSuccess).
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  },
);

When(
  "{string} signs in and opens the invite link",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string) => {
    const actor = getActor(name);
    // Look up the most recent mail to this actor; parse the /invites/TOKEN
    // link out of the HTML body.
    const msg = await waitForMailTo(actor.email);
    const body = await getMessageBody(msg.ID);
    const match = body.HTML.match(/href="([^"]*\/invites\/[^"]+)"/);
    if (!match) {
      throw new Error(
        `No invite link in email HTML for ${actor.email}: ${body.HTML.slice(0, 400)}`,
      );
    }
    // The email uses a RELATIVE path (/invites/TOKEN). Extract the path.
    const href = match[1];
    const path = href.startsWith("http") ? new URL(href).pathname : href;
    await signInOnPage(actor.page, actor.email, SHARED_PASSWORD);
    await actor.page.goto(path);
    await waitForHydration(actor.page);
    // acceptInvite runs, then navigates to /todo-lists/:id — wait for it.
    await actor.page.waitForURL(/\/todo-lists\/[^/]+/, { timeout: 10_000 });
  },
);

When(
  "{string} toggles the todo {string} to done",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, todoTitle: string) => {
    const actor = getActor(name);
    const row = actor.page.locator("li", { hasText: todoTitle }).first();
    const checkbox = row.getByRole("checkbox");
    await checkbox.click();
  },
);

When(
  "{string} removes {string} from {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, ownerName: string, targetName: string, _listName: string) => {
    const owner = getActor(ownerName);
    const target = getActor(targetName);
    // Owner must be on the list-detail page with the CollaboratorList
    // rendered. Navigate fresh (idempotent — if already there, no-op).
    const listId = listIdByName.get(_listName);
    if (!listId) throw new Error(`List "${_listName}" has no known id.`);
    if (!owner.page.url().includes(`/todo-lists/${listId}`)) {
      await owner.page.goto(`/todo-lists/${listId}`);
      await waitForHydration(owner.page);
    }
    const row = owner.page.locator("li", {
      hasText: `@${target.username}`,
    });
    await row.getByRole("button", { name: "Remove" }).click();
    // Wait for it to vanish — the mutation triggers invalidate +
    // re-fetch, and the realtime event further confirms removal.
    await expect(row).toBeHidden({ timeout: 10_000 });
  },
);

// --- Then ---

Then(
  "{string} receives an email with subject containing {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, substring: string) => {
    const actor = getActor(name);
    const msg = await waitForMailTo(actor.email);
    expect(msg.Subject).toContain(substring);
  },
);

Then(
  "{string} sees {string} in their sidebar",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, listName: string) => {
    const actor = getActor(name);
    // If the current page is not the lists index, navigate there.
    if (!actor.page.url().endsWith("/todo-lists")) {
      await actor.page.goto("/todo-lists");
      await waitForHydration(actor.page);
    }
    await expect(actor.page.getByText(listName).first()).toBeVisible({
      timeout: 10_000,
    });
  },
);

Then(
  "{string} sees the todo {string} marked done within {int} second(s)",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, todoTitle: string, seconds: number) => {
    const actor = getActor(name);
    const row = actor.page.locator("li", { hasText: todoTitle }).first();
    const checkbox = row.getByRole("checkbox");
    await expect(checkbox).toBeChecked({ timeout: seconds * 1000 });
  },
);

// Timeout note: realtime-dependent assertions need enough headroom for
// WS → invalidate → refetch → react-query retry backoff. React-query's
// default retry of 3× with exponential backoff means a 403 surfaces after
// ~7s (1s + 2s + 4s); the callee should budget ≥10s.
Then(
  "{string} sees {string} within {int} second(s)",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, text: string, seconds: number) => {
    const actor = getActor(name);
    await expect(
      actor.page.getByText(text, { exact: false }).first(),
    ).toBeVisible({ timeout: seconds * 1000 });
  },
);

Then(
  "reloading {string} as {string} shows the access-lost state",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, listName: string, name: string) => {
    const actor = getActor(name);
    const listId = listIdByName.get(listName);
    if (!listId) throw new Error(`List "${listName}" has no known id.`);
    await actor.page.goto(`/todo-lists/${listId}`);
    await waitForHydration(actor.page);
    await expect(
      actor.page.getByRole("heading", {
        name: "You no longer have access to this list",
      }),
    ).toBeVisible({ timeout: 10_000 });
  },
);

// --- Helpers ---

// Resolve a list's ID from the actor's viewpoint by calling
// todoList.listAccessible via the HTTP tRPC endpoint (cookie jar shared
// with the page context).
async function resolveListIdFor(
  actor: Actor,
  listName: string,
): Promise<string> {
  const res = await actor.page.request.get(
    `${TEST_API_URL}/trpc/todoList.listAccessible`,
  );
  if (!res.ok()) {
    throw new Error(
      `listAccessible failed: ${res.status()} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as {
    result?: { data?: Array<{ id: string; name: string }> };
  };
  const lists = body.result?.data ?? [];
  const found = lists.find((l) => l.name === listName);
  if (!found) {
    throw new Error(
      `List "${listName}" not found in listAccessible response: ${JSON.stringify(
        lists,
      )}`,
    );
  }
  return found.id;
}
