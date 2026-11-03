import type { Server, Socket } from "socket.io";
import cookie from "cookie";
import { resolveSession } from "./auth.js";
import { getPrisma } from "./db.js";
import { applyCommand } from "./gameService.js";
import { sendChat } from "./chat.js";
import type { GameAction } from "@monopolisting/shared";

interface AuthedSocket extends Socket {
  data: { playerId?: string };
}

function roomChannel(roomId: string) {
  return `room:${roomId}`;
}

export function attachSockets(io: Server) {
  io.use(async (socket: AuthedSocket, next) => {
    try {
      const header = socket.handshake.headers.cookie ?? "";
      const parsed = cookie.parse(header);
      const token = parsed.mp_session ?? (socket.handshake.auth?.token as string | undefined);
      const session = await resolveSession(token);
      if (!session) return next(new Error("unauthorized"));
      socket.data.playerId = session.playerId;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket: AuthedSocket) => {
    const playerId = socket.data.playerId!;

    socket.on("room:join", async ({ roomId }: { roomId: string }, ack?: (r: unknown) => void) => {
      try {
        const prisma = getPrisma();
        const membership = await prisma.roomPlayer.findUnique({ where: { roomId_playerId: { roomId, playerId } } });
        if (!membership) return ack?.({ error: "not a member" });
        await prisma.roomPlayer.update({ where: { roomId_playerId: { roomId, playerId } }, data: { isConnected: true } });
        await socket.join(roomChannel(roomId));
        const snapshot = await prisma.game.findFirst({ where: { roomId }, orderBy: { createdAt: "desc" } });
        socket.to(roomChannel(roomId)).emit("game:playerReconnected", { playerId, roomId });
        ack?.({ ok: true, stateVersion: snapshot?.stateVersion ?? 0 });
      } catch (e) {
        ack?.({ error: (e as Error).message });
      }
    });

    socket.on("room:rejoin", async ({ roomId }: { roomId: string }, ack?: (r: unknown) => void) => {
      try {
        const prisma = getPrisma();
        const membership = await prisma.roomPlayer.findUnique({ where: { roomId_playerId: { roomId, playerId } } });
        if (!membership) return ack?.({ error: "not a member" });
        await prisma.roomPlayer.update({ where: { roomId_playerId: { roomId, playerId } }, data: { isConnected: true } });
        await socket.join(roomChannel(roomId));
        const game = await prisma.game.findFirst({ where: { roomId }, orderBy: { createdAt: "desc" } });
        const chat = await prisma.chatMessage.findMany({ where: { roomId }, orderBy: { createdAt: "desc" }, take: 50, include: { player: true } });
        ack?.({ ok: true, game, chat: chat.reverse() });
      } catch (e) {
        ack?.({ error: (e as Error).message });
      }
    });

    const handleGame = async (payload: { commandId: string; roomId: string; expectedVersion: number; action: GameAction }, event: string) => {
      try {
        const res = await applyCommand(playerId, payload);
        const fresh = await getPrisma().game.findFirst({ where: { roomId: payload.roomId }, orderBy: { createdAt: "desc" } });
        io.to(roomChannel(payload.roomId)).emit("game:stateUpdated", {
          state: fresh?.currentState,
          stateVersion: fresh?.stateVersion,
          events: res.events,
          commandId: payload.commandId,
          duplicate: res.duplicate,
        });
      } catch (e) {
        socket.emit("game:actionRejected", { error: (e as Error).message, commandId: payload?.commandId, event });
      }
    };

    const gameEvents = ["game:rollDice", "game:buyProperty", "game:declineProperty", "game:placeBid", "game:endAuction", "game:buildHouse", "game:sellBuilding", "game:mortgageProperty", "game:unmortgageProperty", "game:proposeTrade", "game:acceptTrade", "game:rejectTrade", "game:payJailFine", "game:useJailCard", "game:attemptJailDoubles", "game:endTurn"];
    for (const ev of gameEvents) {
      socket.on(ev, (payload: { commandId: string; roomId: string; expectedVersion: number; action: GameAction }) => void handleGame(payload, ev));
    }
    socket.on("game:command", (payload: { commandId: string; roomId: string; expectedVersion: number; action: GameAction }) => void handleGame(payload, "game:command"));

    socket.on("chat:send", async ({ roomId, message }: { roomId: string; message: string }, ack?: (r: unknown) => void) => {
      try {
        const saved = await sendChat(roomId, playerId, message);
        io.to(roomChannel(roomId)).emit("chat:messageReceived", saved);
        ack?.({ ok: true, id: saved.id });
      } catch (e) {
        ack?.({ error: (e as Error).message });
      }
    });

    socket.on("disconnect", async () => {
      try {
        const prisma = getPrisma();
        const memberships = await prisma.roomPlayer.findMany({ where: { playerId } });
        for (const m of memberships) {
          await prisma.roomPlayer.update({ where: { roomId_playerId: { roomId: m.roomId, playerId } }, data: { isConnected: false } }).catch(() => undefined);
          socket.to(roomChannel(m.roomId)).emit("game:playerDisconnected", { playerId, roomId: m.roomId });
        }
      } catch {
        // ignore
      }
    });
  });
}
