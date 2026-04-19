import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { getActor } from "./collaborators.ts";

const { When, Then } = createBdd();

// Drags the todo named `draggedTitle` so it lands above the todo named
// `targetTitle`. Uses Playwright's dragTo, which drives @dnd-kit's
// MouseSensor via pointer events. The MouseSensor's activationConstraint
// (distance: 8) is satisfied by dragTo's synthesized motion.
When(
  "{string} drags {string} above {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, draggedTitle: string, targetTitle: string) => {
    const actor = getActor(actorName);
    const dragged = actor.page.locator("li", { hasText: draggedTitle }).first();
    const target = actor.page.locator("li", { hasText: targetTitle }).first();
    await dragged.dragTo(target, {
      targetPosition: { x: 10, y: 5 },
    });
    await actor.page.waitForLoadState("networkidle");
  },
);

// Asserts that `firstTitle` renders before `secondTitle` in the active
// (non-completed) todo list for `actorName`, within `seconds`.
Then(
  "{string} appears before {string} for {string} within {int} second(s)",
  async (
    // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
    {},
    firstTitle: string,
    secondTitle: string,
    actorName: string,
    seconds: number,
  ) => {
    const actor = getActor(actorName);
    await expect
      .poll(
        async () => {
          const items = actor.page.locator('[data-testid="todo-row"]');
          const texts: string[] = [];
          const count = await items.count();
          for (let i = 0; i < count; i++) {
            texts.push(await items.nth(i).innerText());
          }
          const firstIdx = texts.findIndex((t) => t.includes(firstTitle));
          const secondIdx = texts.findIndex((t) => t.includes(secondTitle));
          if (firstIdx < 0 || secondIdx < 0) return false;
          return firstIdx < secondIdx;
        },
        { timeout: seconds * 1000, intervals: [200] },
      )
      .toBe(true);
  },
);
