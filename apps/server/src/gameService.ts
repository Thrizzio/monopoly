import { randomInt } from "node:crypto";
import { getPrisma } from "./db.js";
import { processAction, type GameAction, type GameState } from "@monopolisting/shared";

export interface GameCommand {
  commandId: string;
  roomId: string;
  expectedVersion: number;
  action: GameAction;
}

function rollDice(): { d1: number; d2: number } {
  return { d1: randomInt(1, 7), d2: randomInt(1, 7) };
}

export async function applyCommand(playerId: string, cmd: GameCommand) {
  const prisma = getPrisma();
  const room = await prisma.room.findUnique({ where: { id: cmd.roomId }, include: { games: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!room) throw Object.assign(new Error("room not found"), { status: 404 });
  const membership = await prisma.roomPlayer.findUnique({ where: { roomId_playerId: { roomId: cmd.roomId, playerId } } });
  if (!membership) throw Object.assign(new Error("not a member"), { status: 403 });
  const game = room.games[0];
  if (!game) throw Object.assign(new Error("no game"), { status: 409 });

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM games WHERE id = ${game.id}::uuid FOR UPDATE`;
    const fresh = await tx.game.findUnique({ where: { id: game.id } });
    if (!fresh) throw new Error("game missing");
    if (fresh.stateVersion !== cmd.expectedVersion) {
      throw Object.assign(new Error("stale version"), { status: 409 });
    }
    const state = fresh.currentState as unknown as GameState;
    const seen: string[] = (state as unknown as { processedCommands?: string[] }).processedCommands ?? [];
    if (seen.includes(cmd.commandId)) {
      return { game: fresh, events: [], duplicate: true as const };
    }
    let action = cmd.action;
    if ((action as { kind: string }).kind === "roll" || (action as { kind: string }).kind === "jailDoubles") {
      const a = action as { kind: string; d1?: number; d2?: number; playerId: string };
      if (!a.d1 || !a.d2) {
        const dice = rollDice();
        action = { ...a, d1: dice.d1, d2: dice.d2 } as GameAction;
      }
    }
    const out = processAction(state, { ...(action as object), playerId } as GameAction);
    if (out.error) throw Object.assign(new Error(out.error), { status: 400 });
    const nextState = { ...out.state, processedCommands: [...seen.slice(-99), cmd.commandId] };
    const updated = await tx.game.update({
      where: { id: game.id },
      data: {
        currentState: nextState as unknown as object,
        stateVersion: { increment: 1 },
        currentTurnPlayerId: out.state.currentPlayerId,
        status: out.state.phase === "gameover" ? "COMPLETED" : "IN_PROGRESS",
        completedAt: out.state.phase === "gameover" ? new Date() : undefined,
      },
    });
    const baseSeq = await tx.gameEvent.count({ where: { gameId: game.id } });
    if (out.events.length > 0) {
      await tx.gameEvent.createMany({
        data: out.events.map((e, i) => ({
          gameId: game.id,
          sequenceNumber: baseSeq + i + 1,
          actorPlayerId: playerId,
          eventType: e.type,
          payload: { ...(e.payload ?? {}), commandId: cmd.commandId, playerId: e.playerId ?? playerId },
        })),
      });
    }
    if (out.state.phase === "gameover") {
      await tx.room.update({ where: { id: cmd.roomId }, data: { status: "COMPLETED" } }).catch(() => undefined);
    }
    return { game: updated, events: out.events, duplicate: false as const };
  });

  return result;
}

export async function getGameSnapshot(roomId: string) {
  const prisma = getPrisma();
  const game = await prisma.game.findFirst({ where: { roomId }, orderBy: { createdAt: "desc" } });
  if (!game) return null;
  const events = await prisma.gameEvent.findMany({ where: { gameId: game.id }, orderBy: { sequenceNumber: "desc" }, take: 50 });
  return { game, events: events.reverse() };
}
