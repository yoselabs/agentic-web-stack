import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { SHARED_PASSWORD } from "../../fixtures/credentials.ts";
import { waitForHydration } from "../../waits.ts";

const { Given: given, When: when, Then: then } = createBdd();

const stepsDir = dirname(fileURLToPath(import.meta.url));

let lastDownloadPath: string | null = null;

given("I have a todo {string}", async ({ page }, title: string) => {
  await page.getByPlaceholder("Add a todo...").fill(title);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.locator("li", { hasText: title }).first()).toBeVisible({
    timeout: 5000,
  });
});

when("I toggle the todo {string}", async ({ page }, title: string) => {
  const todoRow = page.locator("li", { hasText: title });
  await todoRow.getByRole("checkbox").click();
});

when("I delete the todo {string}", async ({ page }, title: string) => {
  const todoRow = page.locator("li", { hasText: title });
  await todoRow.getByRole("button", { name: "Delete" }).click();
  await todoRow.waitFor({ state: "detached", timeout: 5000 });
});

when("I sign out and sign in as {string}", async ({ page }, email: string) => {
  // Sign out — on mobile, open hamburger menu first
  const signOutBtn = page.getByRole("button", { name: "Sign Out" });
  if (!(await signOutBtn.isVisible())) {
    const hamburger = page.getByRole("button", { name: "Toggle menu" });
    if (await hamburger.isVisible()) {
      await hamburger.click();
      await signOutBtn.waitFor({ state: "visible", timeout: 3000 });
    }
  }
  await signOutBtn.click();
  await page.waitForURL("**/", { timeout: 5000 });

  // Sign up as new user
  await page.goto("/login");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Sign Up" }).click();
  await page.getByLabel("Name", { exact: true }).fill(email.split("@")[0]);
  await page.getByLabel("Username").fill(email.split("@")[0]);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SHARED_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 10000 });
});

then(
  "the todo {string} should be completed",
  async ({ page }, title: string) => {
    const todoRow = page.locator("li", { hasText: title });
    await expect(todoRow.getByRole("checkbox")).toBeChecked();
  },
);

then("I should not see {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text)).not.toBeVisible();
});

when(
  "I drag {string} above {string}",
  async ({ page }, source: string, target: string) => {
    const sourceItem = page.locator("li", { hasText: source });
    const targetItem = page.locator("li", { hasText: target });

    const targetBox = await targetItem.boundingBox();
    if (!targetBox) throw new Error(`Could not find target item "${target}"`);

    // Drag source to the top edge of target (above it)
    await sourceItem.dragTo(targetItem, {
      targetPosition: { x: targetBox.width / 2, y: 0 },
    });

    await page.waitForLoadState("networkidle");
  },
);

then(
  "{string} should appear before {string}",
  async ({ page }, first: string, second: string) => {
    // Scope to the todo rows — the list-detail page renders a
    // CollaboratorList <ul> before the todos <ul>, so `ul.first()` would
    // pick up collaborators instead of todos. `data-testid="todo-row"` is
    // set by SortableTodoItem on each active todo.
    const items = page.locator('[data-testid="todo-row"]');
    const texts: string[] = [];
    for (let i = 0; i < (await items.count()); i++) {
      const text = await items.nth(i).innerText();
      texts.push(text);
    }

    const firstIndex = texts.findIndex((t) => t.includes(first));
    const secondIndex = texts.findIndex((t) => t.includes(second));

    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeLessThan(secondIndex);
  },
);

when("I import todos from {string}", async ({ page }, filename: string) => {
  const filePath = resolve(stepsDir, `../../fixtures/${filename}`);
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(filePath);
  await page.waitForLoadState("networkidle");
});

when("I export todos", async ({ page }) => {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("Download failed — no file path");
  lastDownloadPath = path;
});

then(
  "the downloaded file should contain {string}",
  async ({ page: _page }, text: string) => {
    if (!lastDownloadPath)
      throw new Error("No download captured — run download step first");
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(lastDownloadPath, "utf-8");
    expect(content).toContain(text);
    lastDownloadPath = null;
  },
);
