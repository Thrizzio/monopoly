import { useState } from "react";
import { api } from "./api.js";
import { GamePage } from "./pages/GamePage.js";

export default function App() {
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [inGame, setInGame] = useState(false);

  const ensure = async () => {
    const name = nickname.trim() || `Player-${Math.floor(Math.random() * 9000 + 1000)}`;
    const res = await api.ensureIdentity(name);
    setPlayerId(res.player.id);
    if (nickname.trim() && nickname.trim() !== res.player.nickname) {
      try {
        await api.setNickname(nickname.trim());
      } catch {
        // keep server-assigned nickname
      }
    }
    return res.player.id;
  };

  const create = async () => {
    try {
      setError("");
      await ensure();
      const res = await api.createRoom();
      setRoomCode(res.room.roomCode);
      setInGame(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const join = async () => {
    try {
      setError("");
      await ensure();
      await api.joinRoom(code.trim().toUpperCase());
      setRoomCode(code.trim().toUpperCase());
      setInGame(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (roomCode && playerId) {
    return <GamePage roomCode={roomCode} playerId={playerId} onLeave={() => { setRoomCode(null); setInGame(false); }} />;
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-3xl font-bold text-emerald-950">Monopoly Online</h1>
      <p className="mt-2 text-stone-700">Anonymous nicknames. 2–5 players. Server-authoritative.</p>
      <label className="mt-6 block text-sm font-medium" htmlFor="nickname">Nickname (max 20)</label>
      <input id="nickname" className="mt-1 w-full rounded border px-3 py-2" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={20} placeholder="e.g. HarborQueen" />
      <div className="mt-4 flex gap-2">
        <button className="rounded bg-emerald-800 px-4 py-2 text-white" onClick={create}>Create Room</button>
      </div>
      <label className="mt-6 block text-sm font-medium" htmlFor="code">Room code</label>
      <div className="mt-1 flex gap-2">
        <input id="code" className="w-full rounded border px-3 py-2 uppercase" value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} placeholder="ABC123" />
        <button className="rounded border px-4 py-2" onClick={join}>Join Room</button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </main>
  );
}
