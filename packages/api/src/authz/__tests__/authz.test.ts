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
  const sampleList = () => ({
    id: "l1",
    userId: "u1",
    name: "mine",
    color: "#000",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it("allows owner to manage their TodoList (wrapped)", () => {
    const ability = abilityFor({ id: "u1", role: "user" });
    const list = asSubject("TodoList", sampleList());
    expect(ability.can("update", list)).toBe(true);
  });

  it("denies non-owner", () => {
    const ability = abilityFor({ id: "u2", role: "user" });
    const list = asSubject("TodoList", sampleList());
    expect(ability.can("update", list)).toBe(false);
  });

  it("denies plain objects (regression: asSubject wrapping required)", () => {
    // Without asSubject, CASL falls back to class-level checks and can over-grant.
    // If this ever returns true, CASL changed behavior — investigate.
    const ability = abilityFor({ id: "u2", role: "user" });
    const plainRow = { id: "l1", userId: "u2", name: "x" };
    // @ts-expect-error — intentionally passing an unwrapped row to verify denial
    expect(ability.can("update", plainRow)).toBe(false);
  });
});
