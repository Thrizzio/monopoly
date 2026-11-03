import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { nicknameSchema } from "@monopolisting/shared";
import { getPrisma } from "./db.js";

export const SESSION_COOKIE = "mp_session";
const SESSION_DAYS = 30;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createIdentity(nickname: string) {
  const name = nicknameSchema.parse(nickname);
  const prisma = getPrisma();
  const player = await prisma.player.create({ data: { nickname: name } });
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  const session = await prisma.session.create({
    data: { playerId: player.id, tokenHash: hashToken(token), expiresAt },
  });
  return { player, token, session, expiresAt };
}

export async function resolveSession(token: string | undefined) {
  if (!token) return null;
  const prisma = getPrisma();
  const hash = hashToken(token);
  const session = await prisma.session.findFirst({
    where: { tokenHash: hash, expiresAt: { gt: new Date() } },
    include: { player: true },
  });
  return session;
}

export interface AuthedRequest extends Request {
  playerId?: string;
  sessionId?: string;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE] ?? (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined);
  const session = await resolveSession(token);
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.playerId = session.playerId;
  req.sessionId = session.id;
  await getPrisma().player.update({ where: { id: session.playerId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  next();
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date, secure: boolean) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function sessionCookieOptions() {
  return { name: SESSION_COOKIE };
}

export async function refreshOrCreateIdentity(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const existing = await resolveSession(token);
  if (existing) {
    return res.json({ player: { id: existing.player.id, nickname: existing.player.nickname } });
  }
  const nickname = typeof req.body?.nickname === "string" ? req.body.nickname : `Player-${randomUUID().slice(0, 4)}`;
  const { player, token: raw, expiresAt } = await createIdentity(nickname);
  setSessionCookie(res, raw, expiresAt, process.env.NODE_ENV === "production");
  res.status(201).json({ player: { id: player.id, nickname: player.nickname } });
}
