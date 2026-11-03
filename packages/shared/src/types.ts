export type RoomStatus = "WAITING" | "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
export type GameStatus = "IN_PROGRESS" | "COMPLETED" | "ABANDONED";

export interface PlayerProfile {
  id: string;
  nickname: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface RoomInfo {
  id: string;
  roomCode: string;
  hostPlayerId: string;
  status: RoomStatus;
}

export interface GameSnapshot {
  stateVersion: number;
  currentTurnPlayerId: string | null;
  status: GameStatus;
}

export interface HealthResponse {
  status: "ok";
  database: "connected" | "disconnected";
}
