import "dotenv/config";
import { expect, test } from "@playwright/test";
import { io, type Socket } from "socket.io-client";
import { PrismaClient } from "@prisma/client";
import type { EnginePlayer, GameState } from "@monopolisting/shared";

interface GameSnapshot {
  id: string;
  stateVersion: number;
  status: string;
  currentState: GameState;
}

const API = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:3000";

async function apiIdentity(nickname: string) {
  const res = await fetch(`${API}/api/identity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  const data = await res.json();
  return { player: data.player as { id: string }, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

async function apiAuthed(cookie: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(init?.headers ?? {}) },
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function connectPlayer(cookie: string): Socket {
  return io(API, { extraHeaders: { Cookie: cookie }, transports: ["websocket"] });
}

async function connectPair(aCookie: string, bCookie: string, roomId: string): Promise<[Socket, Socket]> {
  const sockA = connectPlayer(aCookie);
  const sockB = connectPlayer(bCookie);
  await new Promise<void>((resolve, reject) => {
    let n = 0;
    const timer = setTimeout(() => reject(new Error("socket connect timeout")), 15_000);
    const done = () => { if (++n === 2) { clearTimeout(timer); resolve(); } };
    sockA.on("connect", done);
    sockB.on("connect", done);
  });
  sockA.emit("room:join", { roomId });
  sockB.emit("room:join", { roomId });
  await new Promise((r) => setTimeout(r, 500));
  return [sockA, sockB];
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

async function newStartedGame(prefix: string) {
  const a = await apiIdentity(`${prefix}A`);
  const b = await apiIdentity(`${prefix}B`);
  const created = await apiAuthed(a.cookie, "/api/rooms", { method: "POST" });
  expect(created.status).toBe(201);
  const code = created.data.room.roomCode as string;
  const roomId = created.data.room.id as string;
  await apiAuthed(b.cookie, `/api/rooms/${code}/join`, { method: "POST" });
  const started = await apiAuthed(a.cookie, `/api/rooms/${code}/start`, { method: "POST" });
  expect(started.status).toBe(201);
  return { a, b, code, roomId };
}

async function gameState(cookie: string, code: string) {
  const snap = await apiAuthed(cookie, `/api/rooms/${code}/game`);
  return snap.data.game as GameSnapshot;
}

interface UpdatedPayload { state: GameState; stateVersion: number; duplicate?: boolean; commandId?: string }

function waitFor<T>(sock: Socket, event: string, commandId: string, timeoutMs = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${event} ${commandId}`));
    }, timeoutMs);
    const handler = (p: { commandId?: string }) => {
      // Broadcasts fan out to the whole room, so a waiter must only accept
      // the response carrying its own commandId and ignore the rest.
      if (p?.commandId !== commandId) return;
      cleanup();
      resolve(p as T);
    };
    function cleanup() {
      clearTimeout(timer);
      sock.off(event, handler);
    }
    sock.on(event, handler);
  });
}

async function sendOk(sock: Socket, roomId: string, commandId: string, expectedVersion: number, action: object): Promise<UpdatedPayload> {
  const updP = waitFor<UpdatedPayload>(sock, "game:stateUpdated", commandId);
  const rejP = waitFor<{ error: string }>(sock, "game:actionRejected", commandId);
  sock.emit("game:command", { commandId, roomId, expectedVersion, action });
  const winner = await Promise.race([
    updP.then((u) => ({ ok: true as const, value: u })),
    rejP.then((r) => ({ ok: false as const, value: r })),
  ]);
  if (!winner.ok) throw new Error(`command ${commandId} rejected: ${winner.value.error}`);
  return winner.value;
}

// Snapshots read via REST can briefly lag the write path on pooled
// connections, so poll until the expected version is visible.
async function awaitVersion(cookie: string, code: string, version: number): Promise<GameSnapshot> {
  let g: GameSnapshot | null = null;
  await expect.poll(async () => {
    g = await gameState(cookie, code);
    return g.stateVersion;
  }, { timeout: 15_000 }).toBe(version);
  return g;
}

test("auction, trade, mortgage and unmortgage through the authoritative path", async () => {
  const { a, b, code, roomId } = await newStartedGame("DeepAuct");
  const [sockA, sockB] = await connectPair(a.cookie, b.cookie, roomId);
  const t = Date.now();
  try {
    // A rolls 1+2 from GO onto Dock Street (3), an unowned property.
    // The broadcast payload carries the committed state, so assert on it
    // directly; REST snapshots are polled where they are needed.
    let r = await sendOk(sockA, roomId, `d-auct-roll-${t}`, 0, { kind: "roll", playerId: a.player.id, d1: 1, d2: 2 });
    expect(r.state.phase).toBe("buy-or-auction");

    // A declines -> auction; both bid; highest bidder wins.
    await sendOk(sockA, roomId, `d-auct-decline-${t}`, 1, { kind: "decline", playerId: a.player.id });
    await sendOk(sockA, roomId, `d-auct-bidA-${t}`, 2, { kind: "placeBid", playerId: a.player.id, amount: 10 });
    await sendOk(sockB, roomId, `d-auct-bidB-${t}`, 3, { kind: "placeBid", playerId: b.player.id, amount: 50 });
    r = await sendOk(sockA, roomId, `d-auct-end-${t}`, 4, { kind: "endAuction", playerId: a.player.id });
    expect(r.state.properties["3"].owner).toBe(b.player.id);

    // A ends turn so B (auction winner) can propose; B trades Dock Street to A; A accepts.
    await sendOk(sockA, roomId, `d-endA-${t}`, 5, { kind: "endTurn", playerId: a.player.id });
    r = await sendOk(sockB, roomId, `d-trade-prop-${t}`, 6, { kind: "proposeTrade", playerId: b.player.id, trade: { to: a.player.id, offerCash: 0, requestCash: 0, offerSpaces: [3], requestSpaces: [], offerJailCards: 0, requestJailCards: 0 } });
    const tradeId = r.state.trades.find((tr) => tr.status === "pending")?.id ?? "";
    expect(tradeId).toBeTruthy();
    r = await sendOk(sockA, roomId, `d-trade-acc-${t}`, 7, { kind: "acceptTrade", playerId: a.player.id, tradeId });
    expect(r.state.properties["3"].owner).toBe(a.player.id);

    // B rolls onto Dock Street (now A's) and pays rent, then ends turn; A
    // mortgages then unmortgages (principal + 10% interest).
    r = await sendOk(sockB, roomId, `d-rollB-${t}`, 8, { kind: "roll", playerId: b.player.id, d1: 1, d2: 2 });
    expect(r.state.players.find((p: EnginePlayer) => p.id === b.player.id)?.cash).toBe(1446);
    await sendOk(sockB, roomId, `d-endB-${t}`, 9, { kind: "endTurn", playerId: b.player.id });
    r = await sendOk(sockA, roomId, `d-mort-${t}`, 10, { kind: "mortgage", playerId: a.player.id, space: 3 });
    expect(r.state.properties["3"].mortgaged).toBe(true);
    const cashAfterMortgage = r.state.players.find((p: EnginePlayer) => p.id === a.player.id)?.cash ?? 0;
    r = await sendOk(sockA, roomId, `d-unmort-${t}`, 11, { kind: "unmortgage", playerId: a.player.id, space: 3 });
    expect(r.state.properties["3"].mortgaged).toBe(false);
    expect(r.state.players.find((p: EnginePlayer) => p.id === a.player.id)?.cash).toBe(cashAfterMortgage - 33);
    await awaitVersion(a.cookie, code, 12);
  } finally {
    sockA.disconnect();
    sockB.disconnect();
  }
});

test("triple doubles send the roller to jail; fine releases them", async () => {
  const { a, b, code, roomId } = await newStartedGame("DeepJail");
  const [sockA, sockB] = await connectPair(a.cookie, b.cookie, roomId);
  const t = Date.now();
  try {
    // (2,2): Income Tax. (3,3): Jail visiting. (4,4): third doubles -> Jail.
    await sendOk(sockA, roomId, `d-jail-0-${t}`, 0, { kind: "roll", playerId: a.player.id, d1: 2, d2: 2 });
    await sendOk(sockA, roomId, `d-jail-1-${t}`, 1, { kind: "roll", playerId: a.player.id, d1: 3, d2: 3 });
    let r = await sendOk(sockA, roomId, `d-jail-2-${t}`, 2, { kind: "roll", playerId: a.player.id, d1: 4, d2: 4 });
    expect(r.state.players.find((p: EnginePlayer) => p.id === a.player.id)?.inJail).toBe(true);

    // No jail card held: using one is rejected.
    await expect(sendOk(sockA, roomId, `d-jail-card-${t}`, 3, { kind: "useJailCard", playerId: a.player.id })).rejects.toThrow(/no jail card/);

    // Failed doubles keep them jailed; the fine releases them.
    r = await sendOk(sockA, roomId, `d-jail-dbl-${t}`, 3, { kind: "jailDoubles", playerId: a.player.id, d1: 1, d2: 2 });
    expect(r.state.players.find((p: EnginePlayer) => p.id === a.player.id)?.inJail).toBe(true);
    r = await sendOk(sockA, roomId, `d-jail-fine-${t}`, 4, { kind: "payJailFine", playerId: a.player.id });
    expect(r.state.players.find((p: EnginePlayer) => p.id === a.player.id)?.inJail).toBe(false);
    await awaitVersion(a.cookie, code, 5);
    void b;
  } finally {
    sockA.disconnect();
    sockB.disconnect();
  }
});

test("bankruptcy to a creditor ends the game and names the winner", async () => {
  const { a, b, code, roomId } = await newStartedGame("DeepBankr");
  const prisma = new PrismaClient();
  try {
    const g0 = await gameState(a.cookie, code);
    const st = g0.currentState;
    st.properties["39"].owner = a.player.id;
    const debtor = st.players.find((p: EnginePlayer) => p.id === b.player.id);
    debtor.cash = 5;
    debtor.position = 37;
    st.currentPlayerId = b.player.id;
    st.phase = "roll";
    await prisma.game.update({ where: { id: g0.id }, data: { currentState: st } });

    const [sockA, sockB] = await connectPair(a.cookie, b.cookie, roomId);
    try {
      const r = await sendOk(sockB, roomId, `d-bankr-${Date.now()}`, g0.stateVersion, { kind: "roll", playerId: b.player.id, d1: 1, d2: 1 });
      expect(r.state.players.find((p: EnginePlayer) => p.id === b.player.id)?.bankrupt).toBe(true);
      expect(r.state.phase).toBe("gameover");
      expect(r.state.winnerId).toBe(a.player.id);
      const g = await awaitVersion(a.cookie, code, g0.stateVersion + 1);
      expect(g.status).toBe("COMPLETED");
    } finally {
      sockA.disconnect();
      sockB.disconnect();
    }
  } finally {
    await prisma.$disconnect();
  }
});

test("concurrent duplicate commands apply once; stale versions are rejected", async () => {
  const { a, b, code, roomId } = await newStartedGame("DeepConc");
  const [sockA, sockB] = await connectPair(a.cookie, b.cookie, roomId);
  try {
    // Same commandId twice at once: row locking serializes the pair so exactly
    // one applies (the duplicate check runs after the version check, so the
    // loser is rejected as stale). Either way the state advances exactly once.
    const dupId = `d-conc-dup-${Date.now()}`;
    const updP = waitFor<{ duplicate: boolean; stateVersion: number }>(sockA, "game:stateUpdated", dupId);
    const rejP = waitFor<{ error: string }>(sockA, "game:actionRejected", dupId);
    sockA.emit("game:command", { commandId: dupId, roomId, expectedVersion: 0, action: { kind: "roll", playerId: a.player.id, d1: 1, d2: 2 } });
    sockA.emit("game:command", { commandId: dupId, roomId, expectedVersion: 0, action: { kind: "roll", playerId: a.player.id, d1: 1, d2: 2 } });
    const [u, r] = await Promise.all([updP, rejP]);
    expect(u.stateVersion).toBe(1);
    expect(r.error).toBeTruthy();
    const g = await gameState(a.cookie, code);
    expect(g.stateVersion).toBe(1);

    // A stale expectedVersion is rejected and changes nothing.
    const rej = once<{ error: string }>(sockB, "game:actionRejected");
    sockB.emit("game:command", { commandId: `d-conc-stale-${Date.now()}`, roomId, expectedVersion: 0, action: { kind: "endTurn", playerId: b.player.id } });
    await expect.poll(async () => (await rej).error, { timeout: 15_000 }).toBeTruthy();
    expect((await gameState(a.cookie, code)).stateVersion).toBe(1);
  } finally {
    sockA.disconnect();
    sockB.disconnect();
  }
});

test("play continues after all sockets reconnect (restart-safe persistence)", async () => {
  const { a, b, code, roomId } = await newStartedGame("DeepRejo");
  const [sockA, sockB] = await connectPair(a.cookie, b.cookie, roomId);
  await sendOk(sockA, roomId, `d-rejo-roll-${Date.now()}`, 0, { kind: "roll", playerId: a.player.id, d1: 1, d2: 2 });
  sockA.disconnect();
  sockB.disconnect();
  await new Promise((r) => setTimeout(r, 500));

  // Fresh sockets with no in-memory state recover everything from Postgres and keep playing.
  const [sockA2, sockB2] = await connectPair(a.cookie, b.cookie, roomId);
  try {
    const rj: Promise<{ game: { currentState: GameState; stateVersion: number } | null }> = new Promise((resolve) => {
      sockA2.emit("room:rejoin", { roomId }, (r: { game: { currentState: GameState; stateVersion: number } | null }) => resolve(r));
    });
    const recovered = await rj;
    expect(recovered.game?.stateVersion).toBe(1);
    // Decline the property offer from the recovered snapshot, proving continuity.
    await sendOk(sockA2, roomId, `d-rejo-decline-${Date.now()}`, 1, { kind: "decline", playerId: a.player.id });
    await awaitVersion(a.cookie, code, 2);
  } finally {
    sockA2.disconnect();
    sockB2.disconnect();
  }
});
