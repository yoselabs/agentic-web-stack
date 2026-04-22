// Step definitions for e2e/features/activity-feed/activity-feed.feature.
//
// Actors: each scenario uses two browser contexts (Alice + Bob) so a
// live-update assertion can observe Alice's DOM while Bob mutates. The
// Background phase registers both actors + a shared "Groceries" list
// via the tRPC HTTP transport (same pattern as collaborators.ts) —
// UI-driven signup would be 10-20× slower and we're not exercising the
// signup form here.
//
// Network tap: the "reconnect does not refetch" assertion relies on a
// per-actor request log + a timestamp captured at reconnect. Both are
// scoped to this file's module state and cleared in Before.
//
// Websocket severing: we drive page.context().setOffline(true/false).
// This tears down the in-flight WS (the tRPC client's retry loop will
// re-open it on setOffline(false)) and blocks HTTP fetches while offline,
// which matches the real "browser lost network" scenario the tracked()
// subscription was built for.

import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd, type DataTable } from "playwright-bdd";
import { SHARED_PASSWORD } from "../../fixtures/credentials.ts";
import { waitForHydration } from "../../helpers/waits.ts";
import { TEST_API_URL } from "../../test-env.ts";

const { Given, When, Then, Before, After } = createBdd();

type ActorState = {
  context: BrowserContext;
  page: Page;
  email: string;
  username: string; // lowercase login handle
  displayName: string; // capitalized name used in activity copy
  userId: string;
  // Network log for every http request this page made (used by the
  // "not refetched after reconnect" assertion).
  requestLog: { url: string; timestamp: number }[];
};

// Scenario-scoped state. Cleared in Before/After.
const actors = new Map<string, ActorState>();
const listIdByName = new Map<string, string>();
const reconnectTimestamps = new Map<string, number>();

function actorKey(name: string): string {
  return name.toLowerCase();
}

function getActor(name: string): ActorState {
  const actor = actors.get(actorKey(name));
  if (!actor) {
    throw new Error(
      `Unknown actor "${name}" — ensure Background "${name} has a todo list" or "${name} is a collaborator" ran first.`,
    );
  }
  return actor;
}

function getListId(name: string): string {
  const id = listIdByName.get(name);
  if (!id) {
    throw new Error(`List "${name}" is not registered in this scenario.`);
  }
  return id;
}

Before(async () => {
  actors.clear();
  listIdByName.clear();
  reconnectTimestamps.clear();
});

After(async () => {
  for (const actor of actors.values()) {
    await actor.context.close().catch(() => {});
  }
  actors.clear();
  listIdByName.clear();
  reconnectTimestamps.clear();
});

async function signUpDistinctName(
  page: Page,
  email: string,
  username: string,
  displayName: string,
): Promise<void> {
  const res = await page.request.post(
    `${TEST_API_URL}/api/auth/sign-up/email`,
    {
      data: {
        email,
        password: SHARED_PASSWORD,
        name: displayName,
        username,
      },
      failOnStatusCode: false,
    },
  );
  if (res.ok()) return;
  if (res.status() === 422) return;
  const body = await res.text();
  if (/already\s*exists|user_already/i.test(body)) return;
  throw new Error(`signUp(${email}) failed: ${res.status()} ${body}`);
}

async function signInOnPage(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  const res = await page.request.post(
    `${TEST_API_URL}/api/auth/sign-in/email`,
    { data: { email, password: SHARED_PASSWORD } },
  );
  if (!res.ok()) {
    throw new Error(
      `signIn(${email}) failed: ${res.status()} ${await res.text()}`,
    );
  }
}

async function fetchUserId(page: Page): Promise<string> {
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

// Register a fresh actor with its own browser context. We generate a
// unique email/username so Background can run before the scenario's
// explicit "a user X with email Y" step (which is treated as a no-op
// alias — see the step def below). The password is the shared test pw.
async function registerActor(
  browser: import("@playwright/test").Browser,
  displayName: string,
): Promise<ActorState> {
  const key = actorKey(displayName);
  const existing = actors.get(key);
  if (existing) return existing;

  // Short random suffix keeps emails unique across parallel workers and
  // across re-runs while the e2e DB is shared per-suite.
  const suffix = Math.random().toString(36).slice(2, 10);
  const username = `${key}-${suffix}`;
  const email = `${username}@activity-feed.test`;

  const context = await browser.newContext();
  const page = await context.newPage();

  const actor: ActorState = {
    context,
    page,
    email,
    username,
    displayName,
    userId: "",
    requestLog: [],
  };

  page.on("request", (req) => {
    actor.requestLog.push({ url: req.url(), timestamp: Date.now() });
  });

  await signUpDistinctName(page, email, username, displayName);
  await signInOnPage(page, email);
  actor.userId = await fetchUserId(page);
  actors.set(key, actor);
  return actor;
}

// --- Background / Given ---

// "Alice has a todo list "Groceries""
Given(
  "{word} has a todo list {string}",
  async ({ browser }, name: string, listName: string) => {
    const owner = await registerActor(browser, name);
    const res = await owner.page.request.post(
      `${TEST_API_URL}/trpc/todoList.create`,
      { data: { name: listName } },
    );
    if (!res.ok()) {
      throw new Error(
        `todoList.create failed: ${res.status()} ${await res.text()}`,
      );
    }
    const body = (await res.json()) as {
      result?: { data?: { id: string } };
    };
    const id = body.result?.data?.id;
    if (!id) {
      throw new Error(`todoList.create missing id: ${JSON.stringify(body)}`);
    }
    listIdByName.set(listName, id);
  },
);

// "Bob is a collaborator on "Groceries"" — unquoted actor name. Regex
// (rather than cucumber expression) so we don't collide with the existing
// `"{string}" is a collaborator on "{string}"` step in
// e2e/steps/todo-list/collaborators.ts — cucumber's `{word}` would match
// a quoted "bob" too because `{word}` is `\S+`.
Given(
  /^([A-Za-z][A-Za-z0-9_]*) is a collaborator on "([^"]+)"$/,
  async ({ browser }, name: string, listName: string) => {
    // The first registered actor in this scenario is the owner. Fall
    // back to "Alice" for readability if that's what was used above.
    const ownerKey = actors.has("alice")
      ? "alice"
      : ([...actors.keys()].find((k) => k !== actorKey(name)) ?? "alice");
    const owner = actors.get(ownerKey);
    if (!owner) {
      throw new Error(
        `No owner registered before "${name} is a collaborator on ${listName}".`,
      );
    }
    const invitee = await registerActor(browser, name);
    const listId = getListId(listName);

    const inviteRes = await owner.page.request.post(
      `${TEST_API_URL}/trpc/todoList.inviteCollaborator`,
      { data: { listId, username: invitee.username } },
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
        `inviteCollaborator missing token: ${JSON.stringify(inviteBody)}`,
      );
    }
    const acceptRes = await invitee.page.request.post(
      `${TEST_API_URL}/trpc/todoList.acceptInvite`,
      { data: { token } },
    );
    if (!acceptRes.ok()) {
      throw new Error(
        `acceptInvite failed: ${acceptRes.status()} ${await acceptRes.text()}`,
      );
    }
  },
);

// "a user "Alice" with email "alice-live@example.com"" — alias for the
// Background-registered actor. The email in the Gherkin documents the
// scenario's intent; actual emails come from Background so Background
// can run first. This step is a no-op for already-registered actors.
Given(
  "a user {string} with email {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, _email: string) => {
    // Assert actor exists — catches accidental step order mistakes.
    getActor(name);
  },
);

// "Alice is signed in and viewing "Groceries""
Given(
  "{word} is signed in and viewing {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, listName: string) => {
    const actor = getActor(name);
    // Ensure session is fresh on this page (registerActor already signed
    // in, but a subsequent actor creation may have cleared cookies).
    await signInOnPage(actor.page, actor.email);
    const id = getListId(listName);
    await actor.page.goto(`/todo-lists/${id}`);
    await waitForHydration(actor.page);
    await expect(
      actor.page.getByRole("heading", { name: listName }),
    ).toBeVisible({ timeout: 10_000 });
    // Wait for activity feed aside to hydrate so the WS subscription is
    // open before mutations fire (otherwise the tracked stream's
    // lastEventId is null on first subscribe and replay is ambiguous).
    await expect(actor.page.getByTestId("activity-feed")).toBeVisible({
      timeout: 10_000,
    });
  },
);

// "Bob is signed in in a second browser and viewing "Groceries"" —
// same as above, just phrased to flag the multi-context pattern in the
// Gherkin. Actor already has its own context (one per registered actor).
Given(
  "{word} is signed in in a second browser and viewing {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, listName: string) => {
    const actor = getActor(name);
    await signInOnPage(actor.page, actor.email);
    const id = getListId(listName);
    await actor.page.goto(`/todo-lists/${id}`);
    await waitForHydration(actor.page);
    await expect(
      actor.page.getByRole("heading", { name: listName }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(actor.page.getByTestId("activity-feed")).toBeVisible({
      timeout: 10_000,
    });
  },
);

// --- When ---

When(
  "{word} adds a todo {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, title: string) => {
    const actor = getActor(name);
    await actor.page.getByPlaceholder("Add a todo...").fill(title);
    await actor.page.getByRole("button", { name: "Add" }).click();
    await expect(
      actor.page.locator("li", { hasText: title }).first(),
    ).toBeVisible({ timeout: 5000 });
  },
);

When(
  "{word} checks the todo {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, title: string) => {
    const actor = getActor(name);
    const row = actor.page.locator("li", { hasText: title }).first();
    await row.getByRole("checkbox").click();
    await expect(row.getByRole("checkbox")).toBeChecked({ timeout: 5000 });
  },
);

When(
  "{word} removes {word} from the list",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, ownerName: string, targetName: string) => {
    const owner = getActor(ownerName);
    const target = getActor(targetName);
    const row = owner.page.locator("li", {
      hasText: `@${target.username}`,
    });
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(row).toBeHidden({ timeout: 10_000 });
  },
);

When(
  "{word}'s websocket is severed",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string) => {
    const actor = getActor(name);
    // Going offline tears down in-flight sockets AND blocks outgoing
    // fetches, matching "the user dropped network" more accurately than
    // a targeted WS close.
    await actor.context.setOffline(true);
  },
);

When(
  "{word}'s websocket reconnects",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string) => {
    const actor = getActor(name);
    // Wait for the next websocket that opens after we go online — that
    // one is the reconnect. `page.waitForEvent("websocket")` fires on WS
    // construction; we then await its open.
    const wsPromise = actor.page.waitForEvent("websocket", {
      timeout: 10_000,
    });
    await actor.context.setOffline(false);
    const ws = await wsPromise;
    // Capture the moment the reconnect's transport is established — the
    // "no refetch" assertion filters requests observed after this.
    reconnectTimestamps.set(actorKey(name), Date.now());
    // Wait for it to close (indicates full reconnect lifecycle saw
    // messages) OR to stay open. We don't need it closed; just confirm
    // the socket is live by observing it opened without an immediate
    // close. Playwright's WebSocket object doesn't expose an "open"
    // event — isClosed() suffices.
    // Give the server a beat to replay missed tracked() events.
    expect(ws.isClosed()).toBe(false);
  },
);

// --- Then ---

Then(
  "{word} sees an activity entry {string} within {int} seconds",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, text: string, seconds: number) => {
    const actor = getActor(name);
    await expect(
      actor.page.getByTestId("activity-feed").getByText(text, { exact: false }),
    ).toBeVisible({ timeout: seconds * 1000 });
  },
);

// Table form: ordered list of activity entries, oldest-first. The feed
// DOM is newest-first, so we reverse the DOM side before comparing.
Then(
  "within {int} seconds {word} sees activity entries in this order:",
  async (
    // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
    {},
    seconds: number,
    name: string,
    table: DataTable,
  ) => {
    const actor = getActor(name);
    const expected = table.raw().map((row: string[]) => row[0].trim());
    const feed = actor.page.getByTestId("activity-feed");

    // Wait until every expected entry is rendered somewhere in the feed.
    await expect
      .poll(
        async () => {
          const texts = await feed.locator("li").allTextContents();
          return expected.every((e) => texts.some((t) => t.includes(e)));
        },
        { timeout: seconds * 1000, intervals: [200, 500, 1000] },
      )
      .toBe(true);

    // Now assert order. DOM is newest-first; Gherkin table is
    // oldest-first. Filter DOM lines that match ANY expected entry, then
    // reverse to align with the table.
    const allTexts = (await feed.locator("li").allTextContents()).map((s) =>
      s.trim(),
    );
    const matching = allTexts.filter((t) =>
      expected.some((e) => t.includes(e)),
    );
    const oldestFirst = [...matching].reverse();
    for (let i = 0; i < expected.length; i++) {
      expect(
        oldestFirst[i],
        `activity entry #${i} (oldest-first) should contain "${expected[i]}"; got "${oldestFirst[i]}"`,
      ).toContain(expected[i]);
    }
  },
);

Then(
  "{word}'s todo query was not refetched during reconnect",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string) => {
    const actor = getActor(name);
    const ts = reconnectTimestamps.get(actorKey(name));
    expect(
      ts,
      `no reconnect timestamp for ${name} — did "${name}'s websocket reconnects" run?`,
    ).toBeDefined();
    // Let any post-reconnect refetch race finish flushing.
    await actor.page.waitForTimeout(1000);
    const since = actor.requestLog.filter(
      (r) => ts !== undefined && r.timestamp >= ts,
    );
    // The tRPC HTTP batch link bundles queries at /trpc/todo.list or
    // /trpc/todoList.get. The activity.list endpoint MAY be refetched
    // on resync, but the two todo queries must not be triggered by the
    // subscription's reconnect path.
    const todoRefetches = since.filter((r) => {
      const u = r.url;
      return (
        u.includes("/trpc/todo.list") ||
        u.includes("/trpc/todoList.get") ||
        // Batch form includes the procedure name after "?batch=1"
        /\/trpc\/[^?]*todo\.list/.test(u) ||
        /\/trpc\/[^?]*todoList\.get/.test(u)
      );
    });
    expect(
      todoRefetches,
      `unexpected todo refetch after reconnect: ${todoRefetches
        .map((r) => r.url)
        .join(", ")}`,
    ).toEqual([]);
  },
);

Then(
  "{word} does not see the activity entry {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, name: string, text: string) => {
    const actor = getActor(name);
    // Settle window — real-time propagation is expected to be <1s in the
    // memory-channel tests; 2s gives headroom without hiding regressions.
    await actor.page.waitForTimeout(2000);
    await expect(
      actor.page.getByTestId("activity-feed").getByText(text, { exact: false }),
    ).toHaveCount(0);
  },
);
