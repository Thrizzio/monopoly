import { describe, expect, it } from "vitest";
import { createApp } from "./index.js";

describe("server foundation", () => {
  it("creates an express app", () => {
    expect(createApp).toBeTypeOf("function");
  });
});
