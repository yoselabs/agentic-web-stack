import { describe, expect, it } from "bun:test";
import { abilityFor, asSubject } from "../index.js";

describe("abilityFor — admin rule", () => {
  it("grants AdminDashboard access to role=admin", () => {
    const ability = abilityFor({ id: "u1", role: "admin" });
    expect(ability.can("access", "AdminDashboard")).toBe(true);
  });

  it("denies AdminDashboard to role=user", () => {
    const ability = abilityFor({ id: "u1", role: "user" });
    expect(ability.can("access", "AdminDashboard")).toBe(false);
  });

  it("denies AdminDashboard to unauthenticated", () => {
    const ability = abilityFor(null);
    expect(ability.can("access", "AdminDashboard")).toBe(false);
  });
});

describe("abilityFor — todo rule", () => {
  it("allows owner to manage their TodoList (wrapped)", () => {
    const ability = abilityFor({ id: "u1", role: "user" });
    // biome-ignore lint/suspicious/noExplicitAny: asSubject return type is complex; test uses real row data
    const list = asSubject("TodoList", {
      id: "l1",
      userId: "u1",
      name: "mine",
      color: "#000",
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as any;
    expect(ability.can("update", list)).toBe(true);
  });

  it("denies non-owner", () => {
    const ability = abilityFor({ id: "u2", role: "user" });
    // biome-ignore lint/suspicious/noExplicitAny: asSubject return type is complex; test uses real row data
    const list = asSubject("TodoList", {
      id: "l1",
      userId: "u1",
      name: "mine",
      color: "#000",
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as any;
    expect(ability.can("update", list)).toBe(false);
  });

  it("denies plain objects (regression: asSubject wrapping required)", () => {
    // Without asSubject, CASL doesn't recognize the object as a TodoList subject.
    // It denies access even if the rule would match. This test documents the
    // requirement: always use asSubject() to wrap Prisma rows before checking abilities.
    // If this ever starts returning true, CASL changed behavior — investigate.
    const ability = abilityFor({ id: "u2", role: "user" });
    const plainRow = { id: "l1", userId: "u2", name: "x" };
    // biome-ignore lint/suspicious/noExplicitAny: testing subject-wrapping requirement
    expect(ability.can("update", plainRow as any)).toBe(false);
  });
});
