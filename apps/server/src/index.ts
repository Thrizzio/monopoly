import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { checkDatabase } from "./db.js";
import { loadConfig } from "./config.js";
import { refreshOrCreateIdentity, requireAuth, setSessionCookie, createIdentity, type AuthedRequest } from "./auth.js";
import { createRoom, joinRoomByCode, leaveRoom, startGame, getRoomSnapshot } from "./rooms.js";
import { getGameSnapshot } from "./gameService.js";
import { listChat, sendChat } from "./chat.js";
import { attachSockets } from "./sockets.js";
import { nicknameSchema } from "@monopolisting/shared";

export function createApp() {
  const cfg = loadConfig();
  const app = express();
  app.use(cors({ origin: cfg.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get("/api/health", async (_req, res) => {
    const connected = await checkDatabase();
    res.json({ status: "ok", database: connected ? "connected" : "disconnected" });
  });

  app.post("/api/identity", (req, res) => void refreshOrCreateIdentity(req, res));
  app.patch("/api/identity/nickname", requireAuth, async (req: AuthedRequest, res) => {
    const parsed = nicknameSchema.safeParse(req.body?.nickname);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "bad nickname" });
      return;
    }
    const { getPrisma } = await import("./db.js");
    const player = await getPrisma().player.update({ where: { id: req.playerId! }, data: { nickname: parsed.data } });
    res.json({ player: { id: player.id, nickname: player.nickname } });
  });

  app.post("/api/rooms", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const room = await createRoom(req.playerId!);
      res.status(201).json({ room });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/rooms/:code/join", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const room = await joinRoomByCode(req.params.code.toUpperCase(), req.playerId!);
      res.json({ room });
    } catch (e) {
      res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/rooms/:code/leave", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { getPrisma } = await import("./db.js");
      const room = await getPrisma().room.findUnique({ where: { roomCode: req.params.code.toUpperCase() } });
      if (!room) {
        res.status(404).json({ error: "room not found" });
        return;
      }
      await leaveRoom(room.id, req.playerId!);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/rooms/:code", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const room = await getRoomSnapshot(req.params.code.toUpperCase(), req.playerId!);
      res.json({ room });
    } catch (e) {
      res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/rooms/:code/start", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { getPrisma } = await import("./db.js");
      const room = await getPrisma().room.findUnique({ where: { roomCode: req.params.code.toUpperCase() } });
      if (!room) {
        res.status(404).json({ error: "room not found" });
        return;
      }
      const game = await startGame(room.id, req.playerId!);
      res.status(201).json({ game });
    } catch (e) {
      res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/rooms/:code/game", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { getPrisma } = await import("./db.js");
      const room = await getPrisma().room.findUnique({ where: { roomCode: req.params.code.toUpperCase() } });
      if (!room) {
        res.status(404).json({ error: "room not found" });
        return;
      }
      const snapshot = await getGameSnapshot(room.id);
      res.json(snapshot ?? { game: null, events: [] });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/rooms/:code/chat", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { getPrisma } = await import("./db.js");
      const room = await getPrisma().room.findUnique({ where: { roomCode: req.params.code.toUpperCase() } });
      if (!room) {
        res.status(404).json({ error: "room not found" });
        return;
      }
      const messages = await listChat(room.id, req.playerId!, Number(req.query.limit ?? 50), req.query.cursor as string | undefined);
      res.json({ messages });
    } catch (e) {
      res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/rooms/:code/chat", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const { getPrisma } = await import("./db.js");
      const room = await getPrisma().room.findUnique({ where: { roomCode: req.params.code.toUpperCase() } });
      if (!room) {
        res.status(404).json({ error: "room not found" });
        return;
      }
      const saved = await sendChat(room.id, req.playerId!, String(req.body?.message ?? ""));
      const io = app.get("io") as Server | undefined;
      io?.to(`room:${room.id}`).emit("chat:messageReceived", saved);
      res.status(201).json({ message: saved });
    } catch (e) {
      res.status((e as { status?: number }).status ?? 500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/test/identity", async (req, res) => {
    if (process.env.NODE_ENV === "production") {
      res.status(404).json({ error: "not found" });
      return;
    }
    const nickname = String(req.body?.nickname ?? "TestPlayer");
    const { player, token, expiresAt } = await createIdentity(nickname);
    void setSessionCookie;
    void expiresAt;
    res.status(201).json({ playerId: player.id, token });
  });

  return app;
}

const port = Number(process.env.PORT ?? 3000);

if (process.env.VITEST == null) {
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`server listening on :${port}`);
  });
  const cfg = loadConfig();
  const io = new Server(server, { cors: { origin: cfg.CLIENT_ORIGIN, credentials: true } });
  app.set("io", io);
  attachSockets(io);
}
