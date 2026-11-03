import { describe, expect, it } from "vitest";

describe("web foundation", () => {
  it("renders title", () => {
    expect("Monopoly Online").toContain("Monopoly");
  });
});
