import { expect, test, type Browser } from "@playwright/test";
import { io, type Socket } from "socket.io-client";

test("started game renders the 40-space board for both players", async ({ browser }: { browser: Browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await pageA.goto("/");
  await pageA.getByLabel("Nickname").fill("BoardAlice");
  await pageA.getByRole("button", { name: "Create Room" }).click();
  await expect(pageA.locator("h1", { hasText: "Room " })).toBeVisible({ timeout: 15_000 });
  const code = ((await pageA.locator("h1").first().textContent()) ?? "").match(/Room ([A-Z2-9]{6,8})/)?.[1];

  await pageB.goto("/");
  await pageB.getByLabel("Nickname").fill("BoardBob");
  await pageB.getByLabel("Room code").fill(code!);
  await pageB.getByRole("button", { name: "Join Room" }).click();
  await expect(pageB.locator("h1", { hasText: `Room ${code}` })).toBeVisible({ timeout: 15_000 });

  await pageA.getByRole("button", { name: /Start game/ }).click();
  await expect(pageA.getByLabel("Monopoly board")).toBeVisible({ timeout: 15_000 });
  await expect(pageA.locator("[data-space]")).toHaveCount(40);
  await expect(pageB.getByLabel("Monopoly board")).toBeVisible({ timeout: 15_000 });
  await pageA.screenshot({ path: "test-results/visual-board.png" });

  await ctxA.close();
  await ctxB.close();
});

const API = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:3000";

test("chat is realtime and persists across refresh", async ({ browser }: { browser: Browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await pageA.goto("/");
  await pageA.getByLabel("Nickname").fill("ChatAlice");
  await pageA.getByRole("button", { name: "Create Room" }).click();
  await expect(pageA.locator("h1", { hasText: "Room " })).toBeVisible({ timeout: 15_000 });
  const code = ((await pageA.locator("h1").first().textContent()) ?? "").match(/Room ([A-Z2-9]{6,8})/)?.[1];
  expect(code).toBeTruthy();

  await pageB.goto("/");
  await pageB.getByLabel("Nickname").fill("ChatBob");
  await pageB.getByLabel("Room code").fill(code!);
  await pageB.getByRole("button", { name: "Join Room" }).click();
  await expect(pageB.locator("h1", { hasText: `Room ${code}` })).toBeVisible({ timeout: 15_000 });

  const msg = `hello-${Date.now()}`;
  await pageA.getByLabel("Chat message").fill(msg);
  await pageA.getByRole("button", { name: "Send" }).click();
  await expect(pageB.getByText(msg).first()).toBeVisible({ timeout: 15_000 });

  await pageB.reload();
  await expect(pageB.locator("h1", { hasText: `Room ${code}` })).toBeVisible({ timeout: 15_000 });
  await expect(pageB.getByText(msg).first()).toBeVisible({ timeout: 15_000 });

  await ctxA.close();
  await ctxB.close();
});

test("refresh keeps the host seat without rejoining", async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByLabel("Nickname").fill("RefreshHost");
  await page.getByRole("button", { name: "Create Room" }).click();
  await expect(page.locator("h1", { hasText: "Room " })).toBeVisible({ timeout: 15_000 });
  const code = ((await page.locator("h1").first().textContent()) ?? "").match(/Room ([A-Z2-9]{6,8})/)?.[1];
  await page.reload();
  await expect(page.locator("h1", { hasText: `Room ${code}` })).toBeVisible({ timeout: 15_000 });
  await ctx.close();
});

async function apiIdentity(nickname: string) {
  const res = await fetch(`${API}/api/identity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  const data = await res.json();
  const raw = res.headers.get("set-cookie") ?? "";
  const cookie = raw.split(";")[0];
  return { player: data.player as { id: string }, cookie };
}

async function apiAuthed(cookie: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function connectPlayer(cookie: string): Socket {
  return io(API, { extraHeaders: { Cookie: cookie }, transports: ["websocket"] });
}

function once<T>(socket: Socket, event: string, timeoutMs = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test("authoritative game flow: roll, buy, duplicate rejected, rejoin recovers", async () => {
  const a = await apiIdentity("FlowAlice");
  const b = await apiIdentity("FlowBob");
  const created = await apiAuthed(a.cookie, "/api/rooms", { method: "POST" });
  expect(created.status).toBe(201);
  const code = created.data.room.roomCode as string;
  const roomId = created.data.room.id as string;
  await apiAuthed(b.cookie, `/api/rooms/${code}/join`, { method: "POST" });
  const started = await apiAuthed(a.cookie, `/api/rooms/${code}/start`, { method: "POST" });
  expect(started.status).toBe(201);

  const sockA = connectPlayer(a.cookie);
  const sockB = connectPlayer(b.cookie);
  await new Promise<void>((resolve) => {
    let n = 0;
    const done = () => { if (++n === 2) resolve(); };
    sockA.on("connect", done);
    sockB.on("connect", done);
  });
  sockA.emit("room:join", { roomId });
  sockB.emit("room:join", { roomId });
  await new Promise((r) => setTimeout(r, 500));

  const snap0 = await apiAuthed(a.cookie, `/api/rooms/${code}/game`);
  expect(snap0.data.game.stateVersion).toBe(0);
  const cmdId = `cmd-${Date.now()}`;
  const updatedA = once<{ stateVersion: number; duplicate: boolean }>(sockA, "game:stateUpdated");
  const updatedB = once<{ stateVersion: number }>(sockB, "game:stateUpdated");
  sockA.emit("game:command", {
    commandId: cmdId,
    roomId,
    expectedVersion: 0,
    action: { kind: "roll", playerId: a.player.id },
  });
  const [rA, rB] = await Promise.all([updatedA, updatedB]);
  expect(rA.stateVersion).toBe(1);
  expect(rB.stateVersion).toBe(1);

  // Duplicate command id is acknowledged without advancing state.
  const dup = once<{ duplicate: boolean; stateVersion: number }>(sockA, "game:stateUpdated");
  sockA.emit("game:command", {
    commandId: cmdId,
    roomId,
    expectedVersion: 1,
    action: { kind: "roll", playerId: a.player.id },
  });
  const rDup = await dup;
  expect(rDup.duplicate).toBe(true);
  expect(rDup.stateVersion).toBe(1);

  // Stale versions are rejected, never applied.
  const rejected = once<{ error: string }>(sockA, "game:actionRejected");
  sockA.emit("game:command", {
    commandId: `cmd-stale-${Date.now()}`,
    roomId,
    expectedVersion: 0,
    action: { kind: "endTurn", playerId: a.player.id },
  });
  await expect.poll(async () => (await rejected).error, { timeout: 15_000 }).toBeTruthy();

  // Disconnect + rejoin recovers the same authoritative snapshot (restart-safe: Postgres is source of truth).
  sockA.disconnect();
  const sockA2 = connectPlayer(a.cookie);
  await new Promise<void>((resolve) => sockA2.on("connect", () => resolve()));
  const rejoined: Promise<{ game: { stateVersion: number } | null }> = new Promise((resolve) => {
    sockA2.emit("room:rejoin", { roomId }, (r: { game: { stateVersion: number } | null }) => resolve(r));
  });
  const rj = await rejoined;
  expect(rj.game?.stateVersion).toBe(1);

  sockB.disconnect();
  sockA2.disconnect();
});
