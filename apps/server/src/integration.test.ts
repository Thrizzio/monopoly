import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "..", "..", ".env") });
dotenv.config({ path: path.join(here, "..", "..", "..", ".env") });
import { afterAll, describe, expect, it } from "vitest";
import { createIdentity } from "./auth.js";
import { createRoom, joinRoomByCode, startGame } from "./rooms.js";
import { applyCommand } from "./gameService.js";
import { sendChat, listChat } from "./chat.js";
import { getPrisma } from "./db.js";
import { randomUUID } from "node:crypto";

const ids: { players: string[]; rooms: string[] } = { players: [], rooms: [] };

async function mkPlayer(nick: string) {
  const r = await createIdentity(`${nick}-${randomUUID().slice(0, 4)}`);
  ids.players.push(r.player.id);
  return { player: r.player, token: r.token };
}

describe("backend integration (Neon, self-cleaning)", () => {
  it("creates room, joins 2 players, rejects 6th, starts, plays, chats, idempotent", async () => {
    const p1 = await mkPlayer("E2E-Alice");
    const p2 = await mkPlayer("E2E-Bob");
    const room = await createRoom(p1.player.id);
    ids.rooms.push(room.id);
    expect(room.roomCode).toMatch(/^[A-Z2-9]{6,8}$/);

    await joinRoomByCode(room.roomCode, p2.player.id);

    // fill to 5 then reject 6th
    const extras = [];
    for (let i = 0; i < 3; i++) {
      const p = await mkPlayer(`E2E-X${i}`);
      extras.push(p);
      await joinRoomByCode(room.roomCode, p.player.id);
    }
    const p6 = await mkPlayer("E2E-Sixth");
    await expect(joinRoomByCode(room.roomCode, p6.player.id)).rejects.toThrow(/room full/);

    const game = await startGame(room.id, p1.player.id);
    expect(game.roomId).toBe(room.id);

    const cmdId = randomUUID();
    const r1 = await applyCommand(p1.player.id, {
      commandId: cmdId,
      roomId: room.id,
      expectedVersion: 0,
      action: { kind: "roll", playerId: p1.player.id, d1: 1, d2: 2 } as never,
    });
    expect(r1.duplicate).toBe(false);
    const r2 = await applyCommand(p1.player.id, {
      commandId: cmdId,
      roomId: room.id,
      expectedVersion: 1,
      action: { kind: "roll", playerId: p1.player.id, d1: 1, d2: 2 } as never,
    });
    expect(r2.duplicate).toBe(true);

    const msg = await sendChat(room.id, p1.player.id, "hello <b>world</b>");
    expect(msg.message).not.toContain("<b>");
    const hist = await listChat(room.id, p2.player.id);
    expect(hist.some((m) => m.message.includes("hello"))).toBe(true);

    // stale version rejected
    await expect(applyCommand(p2.player.id, {
      commandId: randomUUID(),
      roomId: room.id,
      expectedVersion: 0,
      action: { kind: "endTurn", playerId: p2.player.id },
    })).rejects.toThrow();
  }, 60_000);

  afterAll(async () => {
    const prisma = getPrisma();
    for (const roomId of ids.rooms) {
      await prisma.chatMessage.deleteMany({ where: { roomId } }).catch(() => undefined);
      const games = await prisma.game.findMany({ where: { roomId } });
      for (const g of games) await prisma.gameEvent.deleteMany({ where: { gameId: g.id } }).catch(() => undefined);
      await prisma.game.deleteMany({ where: { roomId } }).catch(() => undefined);
      await prisma.roomPlayer.deleteMany({ where: { roomId } }).catch(() => undefined);
      await prisma.room.deleteMany({ where: { id: roomId } }).catch(() => undefined);
    }
    for (const pid of ids.players) {
      await prisma.session.deleteMany({ where: { playerId: pid } }).catch(() => undefined);
      await prisma.chatMessage.deleteMany({ where: { playerId: pid } }).catch(() => undefined);
      await prisma.roomPlayer.deleteMany({ where: { playerId: pid } }).catch(() => undefined);
      await prisma.player.deleteMany({ where: { id: pid } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });
});
