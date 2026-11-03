import { expect, test, type Browser } from "@playwright/test";

const API = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:3000";

async function apiIdentity(nickname: string) {
  const res = await fetch(`${API}/api/identity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  const data = await res.json();
  const cookie = res.headers.get("set-cookie") ?? "";
  return { player: data.player, cookie };
}

async function apiAuthed(cookie: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Monopoly Online" })).toBeVisible();
});

test("two independent players create and join the same room", async ({ browser }: { browser: Browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await pageA.goto("/");
  await pageA.getByLabel("Nickname").fill("AliceE2E");
  await pageA.getByRole("button", { name: "Create Room" }).click();
  await expect(pageA.locator("h1", { hasText: "Room " })).toBeVisible({ timeout: 15_000 });
  const header = (await pageA.locator("h1").first().textContent()) ?? "";
  const code = (header.match(/Room ([A-Z2-9]{6,8})/) ?? [])[1];
  expect(code).toBeTruthy();

  await pageB.goto("/");
  await pageB.getByLabel("Nickname").fill("BobE2E");
  await pageB.getByLabel("Room code").fill(code!);
  await pageB.getByRole("button", { name: "Join Room" }).click();
  await expect(pageB.locator("h1", { hasText: `Room ${code}` })).toBeVisible({ timeout: 15_000 });

  // both see each other in player list after refresh (poll: B's join may land just after A's fetch)
  await expect(async () => {
    await pageA.getByRole("button", { name: "Refresh lobby" }).click();
    await expect(pageA.getByText("BobE2E").first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await expect(pageA.getByText("AliceE2E").first()).toBeVisible();
  await ctxA.close();
  await ctxB.close();
});

test("sixth player is rejected and two can start", async () => {
  const players = [];
  for (let i = 0; i < 5; i++) {
    const id = await apiIdentity(`Sixth${i}`);
    players.push(id);
  }
  const host = players[0];
  const created = await apiAuthed(host.cookie, "/api/rooms", { method: "POST" });
  expect(created.status).toBe(201);
  const code = created.data.room.roomCode as string;
  for (let i = 1; i < 5; i++) {
    const j = await apiAuthed(players[i].cookie, `/api/rooms/${code}/join`, { method: "POST" });
    expect(j.status).toBe(200);
  }
  const sixth = await apiIdentity("Sixth6");
  const rej = await apiAuthed(sixth.cookie, `/api/rooms/${code}/join`, { method: "POST" });
  expect(rej.status).toBe(409);

  const started = await apiAuthed(host.cookie, `/api/rooms/${code}/start`, { method: "POST" });
  expect(started.status).toBe(201);
  const snap = await apiAuthed(host.cookie, `/api/rooms/${code}/game`);
  expect(snap.status).toBe(200);
  expect(snap.data.game.currentState.players).toHaveLength(5);
});
