const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `request failed: ${res.status}`);
  return data;
}

export const api = {
  ensureIdentity: (nickname: string) => req("/api/identity", { method: "POST", body: JSON.stringify({ nickname }) }),
  setNickname: (nickname: string) => req("/api/identity/nickname", { method: "PATCH", body: JSON.stringify({ nickname }) }),
  createRoom: () => req("/api/rooms", { method: "POST" }),
  joinRoom: (code: string) => req(`/api/rooms/${code}/join`, { method: "POST" }),
  roomInfo: (code: string) => req(`/api/rooms/${code}`),
  startGame: (code: string) => req(`/api/rooms/${code}/start`, { method: "POST" }),
  leaveRoom: (code: string) => req(`/api/rooms/${code}/leave`, { method: "POST" }),
  gameSnapshot: (code: string) => req(`/api/rooms/${code}/game`),
  chatHistory: (code: string) => req(`/api/rooms/${code}/chat`),
  sendChat: (code: string, message: string) => req(`/api/rooms/${code}/chat`, { method: "POST", body: JSON.stringify({ message }) }),
};
