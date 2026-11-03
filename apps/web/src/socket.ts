import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const url = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
    socket = io(url, { withCredentials: true, autoConnect: false });
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
}
