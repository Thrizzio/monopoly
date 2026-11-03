import "dotenv/config";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { checkDatabase } from "./db.js";
import type { HealthResponse } from "@monopolisting/shared";

export function createApp() {
  const app = express();
  const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

  app.use(cors({ origin: clientOrigin }));
  app.use(express.json());

  app.get("/api/health", async (_req, res) => {
    const connected = await checkDatabase();
    const body: HealthResponse = {
      status: "ok",
      database: connected ? "connected" : "disconnected",
    };
    res.json(body);
  });

  return app;
}

const port = Number(process.env.PORT ?? 3000);

if (process.env.VITEST == null) {
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`server listening on :${port}`);
  });
  const io = new Server(server, {
    cors: { origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173" },
  });
  io.on("connection", (socket) => {
    socket.emit("server:hello", { ok: true });
  });
}
