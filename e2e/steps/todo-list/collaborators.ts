// Multi-user todo-list step defs. Each actor runs in its own Playwright
// BrowserContext. Module-level Maps scope state per scenario.

import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { SHARED_PASSWORD } from "../../fixtures/credentials.ts";
import { getMessageBody, waitForMailTo } from "../../helpers/mailpit.ts";
import { TEST_API_URL } from "../../test-env.ts";
import { waitForHydration } from "../../helpers/waits.ts";

const { Given, When, Then, Before, After } = createBdd();

export type Actor = {
  context: BrowserContext;
  page: Page;
  tabB?: Page; // populated only by multi-tab scenarios
  email: string;
  username: string;
  userId: string; // Better-Auth user id; populated after sign-up via fetchUserId
};

export const actors = new Map<string, Actor>();

// Track list IDs by display name so steps can deep-link pre-accept.
export const listIdByName = new Map<string, string>();

// Mailpit shared across workers; waitForMailTo filters by recipient, so
// no delete-all per scenario (would race with sibling pollers).
Before(async () => {
  actors.clear();
  listIdByName.clear();
});

After(async () => {
  for (const actor of actors.values()) {
    await actor.context.close().catch(() => {});
  }
  actors.clear();
  listIdByName.clear();
});

export function getActor(name: string): Actor {
  const actor = actors.get(name);
  if (!actor) {
    throw new Error(
      `Unknown actor "${name}". Register actors with a Given-signup step before use.`,
    );
  }
  return actor;
}

// Sign-up with an EXPLICIT username (decoupled from email prefix) so
// invite tests can target a stable username.
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

export async function spawnActor(
  browser: import("@playwright/test").Browser,
  name: string,
  email: string,
  username: string,
): Promise<Actor> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const actor: Actor = { context, page, email, username, userId: "" };
  actors.set(name, actor);
  return actor;
}

// Read the Better-Auth user id from /api/auth/get-session.
export async function fetchUserId(page: Page): Promise<string> {
  const res = await page.request.get(`${TEST_API_URL}/api/auth/get-session`);
  if (!res.ok()) {
    throw new Error(`get-session failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { user?: { id?: string } } | null;
  const id = body?.user?.id;
  if (!id) {
    throw new Error(
      `get-session returned no user.id. Body: ${JSON.stringify(body)}`,
    );
  }
  return id;
}

// Count held Web Locks for leader-tab:<userId> (origin-scoped).
export async function heldLeaderLocksOn(
  page: Page,
  userId: string,
): Promise<number> {
  return page.evaluate(async (uid) => {
    const snap = await navigator.locks.query();
    const name = `leader-tab:${uid}`;
    return (snap.held ?? []).filter((l) => l.name === name).length;
  }, userId);
}

// --- Given: actor registration ---

Given(
  "{string} is signed up and signed in as {string} with email {string}",
  async ({ browser }, name: string, username: string, email: string) => {
    const actor = await spawnActor(browser, name, email, username);
    await signUpWithUsername(actor.page, email, username);
    await signInOnPage(actor.page, email, SHARED_PASSWORD);
    actor.userId = await fetchUserId(actor.page);
  },
);

Given(
  "{string} is signed up with username {string} and email {string}",
  async ({ browser }, name: string, username: string, email: string) => {
    const actor = await spawnActor(browser, name, email, username);
    await signUpWithUsername(actor.page, email, username);
    // Fetch userId BEFORE clearing cookies — the signup auto-logs in.
    actor.userId = await fetchUserId(actor.page);
    // Intentionally no persistent sign-in — actor will sign in later when
    // opening the invite link or when a later step calls signInOnPage.
    await actor.page.context().clearCookies();
  },
);

// Create a list via the UI, then cache its id so later steps deep-link.
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

// Short-circuits invite/accept via tRPC HTTP — ~10× faster than UI.
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
    // Invitee must be signed in to accept (signup-only actors clear cookies).
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
    // Heading flips from "Loading..." once the list query resolves.
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
    // Autocomplete flow: type prefix → click the suggestion → Invite enabled.
    const input = dialog.getByPlaceholder("Search by username or name");
    await input.fill(invitee.username);
    const suggestion = dialog
      .getByRole("button", { name: new RegExp(`@${invitee.username}`) })
      .first();
    await suggestion.click();
    await dialog.getByRole("button", { name: "Invite", exact: true }).click();
    // Dialog closes on success (share-list-dialog.tsx onSuccess).
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
  "{string} opens {string} in two browser tabs",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, listName: string) => {
    const actor = getActor(name);
    const listId = listIdByName.get(listName);
    if (!listId) {
      throw new Error(`List "${listName}" has no known id.`);
    }
    const url = `/todo-lists/${listId}`;

    await actor.page.goto(url);
    await waitForHydration(actor.page);

    const tabB = await actor.context.newPage();
    await tabB.goto(url);
    await waitForHydration(tabB);

    actor.tabB = tabB;
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

// Realtime WS → invalidate → refetch path (budget ≥10s for retry backoff).
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
  "exactly one of {string}'s tabs holds the {string} Web Lock",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, _lockName: string) => {
    const actor = getActor(name);
    if (!actor.tabB) {
      throw new Error(
        `Actor "${name}" has no second tab. Call "opens X in two browser tabs" first.`,
      );
    }
    // Web Locks are origin-scoped: both tabs see the same snapshot.
    // Query one tab; expect exactly one held lock.
    await expect
      .poll(() => heldLeaderLocksOn(actor.page, actor.userId), {
        timeout: 2000,
        intervals: [100, 250, 500],
      })
      .toBe(1);
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

// Resolve a list ID from the actor's viewpoint via todoList.listAccessible.
export async function resolveListIdFor(
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
