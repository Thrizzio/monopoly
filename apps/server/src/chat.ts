import { chatMessageSchema } from "@monopolisting/shared";
import { getPrisma } from "./db.js";

const buckets = new Map<string, { count: number; resetAt: number }>();

export function chatRateLimit(playerId: string, limit = 8, windowMs = 10_000): boolean {
  const now = Date.now();
  const b = buckets.get(playerId);
  if (!b || now > b.resetAt) {
    buckets.set(playerId, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendChat(roomId: string, playerId: string, raw: string) {
  const message = chatMessageSchema.parse(raw);
  if (!chatRateLimit(playerId)) throw Object.assign(new Error("rate limited"), { status: 429 });
  const prisma = getPrisma();
  const membership = await prisma.roomPlayer.findUnique({ where: { roomId_playerId: { roomId, playerId } } });
  if (!membership) throw Object.assign(new Error("not a member"), { status: 403 });
  const saved = await prisma.chatMessage.create({ data: { roomId, playerId, message: escapeHtml(message) } });
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  return { ...saved, nickname: player?.nickname ?? "Player" };
}

export async function listChat(roomId: string, playerId: string, limit = 50, cursor?: string) {
  const prisma = getPrisma();
  const membership = await prisma.roomPlayer.findUnique({ where: { roomId_playerId: { roomId, playerId } } });
  if (!membership) throw Object.assign(new Error("not a member"), { status: 403 });
  const messages = await prisma.chatMessage.findMany({
    where: { roomId, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
    include: { player: true },
  });
  return messages.reverse().map((m) => ({ id: m.id, message: m.message, createdAt: m.createdAt, playerId: m.playerId, nickname: m.player.nickname }));
}
