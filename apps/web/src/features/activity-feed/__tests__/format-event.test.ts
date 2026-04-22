import type { ActivityEventRecord } from "@project/api/domains/activity-feed/events";
import { describe, expect, it } from "vitest";
import { formatActivityEvent } from "../format-event";

// Build a record with only the fields formatActivityEvent reads. The
// rest of ActivityEventRecord (createdAt, actorId, todoListId, ...)
// isn't touched by the formatter, so casting keeps tests narrow.
function rec(
  payload: ActivityEventRecord["payload"],
  id = "evt-1",
): ActivityEventRecord {
  return { id, payload } as unknown as ActivityEventRecord;
}

describe("formatActivityEvent", () => {
  const actor = "Alice";

  it("formats todo-created", () => {
    expect(
      formatActivityEvent(
        rec({ kind: "todo-created", todoId: "t1", title: "Buy milk" }),
        actor,
      ),
    ).toBe("Alice added Buy milk");
  });

  it("formats todo-updated", () => {
    expect(
      formatActivityEvent(
        rec({ kind: "todo-updated", todoId: "t1", title: "Buy oat milk" }),
        actor,
      ),
    ).toBe("Alice renamed to Buy oat milk");
  });

  it("formats todo-completed", () => {
    expect(
      formatActivityEvent(
        rec({ kind: "todo-completed", todoId: "t1", title: "Buy milk" }),
        actor,
      ),
    ).toBe("Alice completed Buy milk");
  });

  it("formats todo-uncompleted", () => {
    expect(
      formatActivityEvent(
        rec({ kind: "todo-uncompleted", todoId: "t1", title: "Buy milk" }),
        actor,
      ),
    ).toBe("Alice reopened Buy milk");
  });

  it("formats todo-deleted", () => {
    expect(
      formatActivityEvent(
        rec({ kind: "todo-deleted", todoId: "t1", title: "Buy milk" }),
        actor,
      ),
    ).toBe("Alice deleted Buy milk");
  });

  it("formats list-renamed", () => {
    expect(
      formatActivityEvent(
        rec({ kind: "list-renamed", from: "Groceries", to: "Shopping" }),
        actor,
      ),
    ).toBe('Alice renamed list from "Groceries" to "Shopping"');
  });

  it("formats member-added", () => {
    expect(
      formatActivityEvent(
        rec({ kind: "member-added", memberId: "u2", memberName: "Bob" }),
        actor,
      ),
    ).toBe("Alice added Bob");
  });

  it("formats member-removed", () => {
    expect(
      formatActivityEvent(
        rec({ kind: "member-removed", memberId: "u2", memberName: "Bob" }),
        actor,
      ),
    ).toBe("Alice removed Bob");
  });
});
