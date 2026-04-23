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
    // placement-agnostic: getByRole("main") scopes below the activity
    // feed <aside>; getByTestId("todo-row") narrows to a sortable row.
    // Titles are unique per scenario — filter matches exactly one.
    const main = actor.page.getByRole("main");
    const dragged = main
      .getByTestId("todo-row")
      .filter({ hasText: draggedTitle });
    const target = main
      .getByTestId("todo-row")
      .filter({ hasText: targetTitle });
    await dragged.dragTo(target, {
      targetPosition: { x: 10, y: 5 },
    });
    // The subsequent Then-step polls DOM order until it matches —
    // natural wait; no networkidle (which also races WS keep-alive pings).
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
          // Positional assertion: this step proves `firstTitle` appears
          // before `secondTitle` in DOM order. Iterating by index is
          // inherent — `nth(i)` is the sanctioned escape.
          // placement-agnostic: todo-row testid is globally unique.
          const items = actor.page.getByTestId("todo-row");
          const texts: string[] = [];
          const count = await items.count();
          for (let i = 0; i < count; i++) {
            // eslint-disable-next-line playwright/no-nth-methods -- positional assertion: this step asserts DOM order of sortable rows
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
