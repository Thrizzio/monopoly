import { randomInt } from "node:crypto";
import { MAX_PLAYERS, MIN_PLAYERS } from "@monopolisting/shared";
import { getPrisma } from "./db.js";
import { createInitialState } from "@monopolisting/shared";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRoomCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export async function createRoom(hostPlayerId: string) {
  const prisma = getPrisma();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    try {
      const room = await prisma.room.create({
        data: { roomCode: code, hostPlayerId, status: "WAITING" },
      });
      await prisma.roomPlayer.create({ data: { roomId: room.id, playerId: hostPlayerId, seatNumber: 1 } });
      return room;
    } catch {
      continue;
    }
  }
  throw new Error("could not allocate room code");
}

export async function joinRoomByCode(roomCode: string, playerId: string) {
  const prisma = getPrisma();
  const room = await prisma.room.findUnique({ where: { roomCode }, include: { members: true } });
  if (!room) throw Object.assign(new Error("room not found"), { status: 404 });
  if (room.status !== "WAITING") throw Object.assign(new Error("game already started"), { status: 409 });
  if (room.members.some((m) => m.playerId === playerId)) return room;
  if (room.members.length >= MAX_PLAYERS) throw Object.assign(new Error("room full"), { status: 409 });
  const usedSeats = new Set(room.members.map((m) => m.seatNumber));
  let seat = 1;
  while (usedSeats.has(seat) && seat <= MAX_PLAYERS) seat += 1;
  await prisma.roomPlayer.create({ data: { roomId: room.id, playerId, seatNumber: seat } });
  return room;
}

export async function leaveRoom(roomId: string, playerId: string) {
  const prisma = getPrisma();
  const room = await prisma.room.findUnique({ where: { id: roomId }, include: { members: true } });
  if (!room) return;
  if (room.status !== "WAITING") {
    await prisma.roomPlayer.updateMany({ where: { roomId, playerId }, data: { isConnected: false } });
    return;
  }
  await prisma.roomPlayer.deleteMany({ where: { roomId, playerId } });
  const remaining = await prisma.roomPlayer.findMany({ where: { roomId }, orderBy: { seatNumber: "asc" } });
  if (remaining.length === 0) {
    await prisma.room.delete({ where: { id: roomId } });
    return;
  }
  if (room.hostPlayerId === playerId) {
    await prisma.room.update({ where: { id: roomId }, data: { hostPlayerId: remaining[0].playerId } });
  }
}

export async function startGame(roomId: string, playerId: string) {
  const prisma = getPrisma();
  const room = await prisma.room.findUnique({ where: { id: roomId }, include: { members: true } });
  if (!room) throw Object.assign(new Error("room not found"), { status: 404 });
  if (room.hostPlayerId !== playerId) throw Object.assign(new Error("only host can start"), { status: 403 });
  if (room.status !== "WAITING") throw Object.assign(new Error("already started"), { status: 409 });
  if (room.members.length < MIN_PLAYERS) throw Object.assign(new Error(`need at least ${MIN_PLAYERS} players`), { status: 409 });
  const ordered = [...room.members].sort((a, b) => a.seatNumber - b.seatNumber).map((m) => m.playerId);
  const initial = createInitialState(ordered);
  const game = await prisma.$transaction(async (tx) => {
    const g = await tx.game.create({
      data: {
        roomId,
        status: "IN_PROGRESS",
        currentTurnPlayerId: initial.currentPlayerId,
        currentState: initial as unknown as object,
        stateVersion: 0,
      },
    });
    await tx.room.update({ where: { id: roomId }, data: { status: "IN_PROGRESS" } });
    return g;
  });
  return game;
}

export async function getRoomSnapshot(roomCode: string, playerId: string) {
  const prisma = getPrisma();
  const room = await prisma.room.findUnique({
    where: { roomCode },
    include: { members: { include: { player: true }, orderBy: { seatNumber: "asc" } }, games: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!room) throw Object.assign(new Error("room not found"), { status: 404 });
  if (!room.members.some((m) => m.playerId === playerId)) throw Object.assign(new Error("not a member"), { status: 403 });
  return room;
}
