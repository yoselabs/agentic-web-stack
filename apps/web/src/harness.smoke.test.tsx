import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithTRPC } from "../test/render";

/**
 * Smoke test: proves the Vitest + happy-dom + testing-library harness loads.
 * Documented by ADR-0003.
 *
 * @adr 0003
 */
describe("web test harness", () => {
  it("renders a trivial element via renderWithTRPC", () => {
    renderWithTRPC(<p>harness-ok</p>);
    expect(screen.getByText("harness-ok")).toBeInTheDocument();
  });

  it("accepts cache seeds without throwing", () => {
    const { queryClient } = renderWithTRPC(<p>seeded</p>, {
      seed: [{ queryKey: ["smoke", "key"], data: { hello: "world" } }],
    });
    expect(queryClient.getQueryData(["smoke", "key"])).toEqual({
      hello: "world",
    });
  });
});
