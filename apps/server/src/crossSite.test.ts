import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { loadConfig } from "./config.js";
import { setSessionCookie } from "./auth.js";

const baseEnv = {
  DATABASE_URL: "postgres://dummy/dummy",
  SESSION_SECRET: "test-secret-123",
};

function mockRes() {
  return { cookie: vi.fn() } as unknown as Response;
}

describe("production cross-site session", () => {
  it("normalizes CLIENT_ORIGIN with a trailing slash", () => {
    const cfg = loadConfig({ ...baseEnv, CLIENT_ORIGIN: "https://monopoly-sable.vercel.app/" });
    expect(cfg.CLIENT_ORIGIN).toBe("https://monopoly-sable.vercel.app");
  });

  it("leaves a clean origin untouched", () => {
    const cfg = loadConfig({ ...baseEnv, CLIENT_ORIGIN: "https://monopoly-sable.vercel.app" });
    expect(cfg.CLIENT_ORIGIN).toBe("https://monopoly-sable.vercel.app");
  });

  it("sets SameSite=None on secure cross-site session cookies", () => {
    const res = mockRes();
    setSessionCookie(res, "tok", new Date(), true);
    expect(res.cookie).toHaveBeenCalledOnce();
    const options = (res.cookie as ReturnType<typeof vi.fn>).mock.calls[0][2] as {
      sameSite: string;
      secure: boolean;
      httpOnly: boolean;
    };
    expect(options.sameSite).toBe("none");
    expect(options.secure).toBe(true);
    expect(options.httpOnly).toBe(true);
  });

  it("keeps SameSite=Lax for local development", () => {
    const res = mockRes();
    setSessionCookie(res, "tok", new Date(), false);
    const options = (res.cookie as ReturnType<typeof vi.fn>).mock.calls[0][2] as { sameSite: string };
    expect(options.sameSite).toBe("lax");
  });
});
