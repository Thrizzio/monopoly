import { describe, expect, it } from "vitest";
import { nicknameSchema, chatMessageSchema } from "./schemas.js";
import { STARTING_CASH, PASS_GO_AMOUNT } from "./constants.js";

describe("shared foundation", () => {
  it("validates nicknames", () => {
    expect(nicknameSchema.safeParse("Alice").success).toBe(true);
    expect(nicknameSchema.safeParse("  ").success).toBe(false);
    expect(nicknameSchema.safeParse("x".repeat(21)).success).toBe(false);
  });

  it("validates chat length", () => {
    expect(chatMessageSchema.safeParse("hello").success).toBe(true);
    expect(chatMessageSchema.safeParse("x".repeat(501)).success).toBe(false);
  });

  it("exposes PRD money constants", () => {
    expect(STARTING_CASH).toBe(1500);
    expect(PASS_GO_AMOUNT).toBe(200);
  });
});
