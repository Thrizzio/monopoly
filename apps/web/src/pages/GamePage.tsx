import { useEffect, useState } from "react";
import { api } from "../api.js";
import { connectSocket } from "../socket.js";
import { Board } from "../components/Board.js";
import type { GameState } from "@monopolisting/shared";

function PropertyActions({ game, playerId, send }: { game: GameState | null; playerId: string; send: (event: string, action: object) => void }) {
  const [space, setSpace] = useState("1");
  if (!game) return null;
  const idx = Number(space);
  return (
    <div className="mt-3 rounded border p-3" aria-label="Property actions">
      <h2 className="font-semibold">Property actions</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor="space">Space</label>
        <input id="space" className="w-20 rounded border px-2 py-1" value={space} onChange={(e) => setSpace(e.target.value)} inputMode="numeric" />
        <button className="rounded border px-3 py-1" onClick={() => send("game:buildHouse", { kind: "buildHouse", space: idx })}>Build</button>
        <button className="rounded border px-3 py-1" onClick={() => send("game:sellBuilding", { kind: "sellBuilding", space: idx })}>Sell building</button>
        <button className="rounded border px-3 py-1" onClick={() => send("game:mortgageProperty", { kind: "mortgage", space: idx })}>Mortgage</button>
        <button className="rounded border px-3 py-1" onClick={() => send("game:unmortgageProperty", { kind: "unmortgage", space: idx })}>Unmortgage</button>
        <button className="rounded border px-3 py-1" onClick={() => send("game:placeBid", { kind: "placeBid", amount: 10 })}>Bid $10</button>
        <button className="rounded border px-3 py-1" onClick={() => send("game:endAuction", { kind: "endAuction" })}>End auction</button>
      </div>
      <p className="mt-1 text-xs text-stone-600">Builds and mortgages follow the even-building and full-group rules; the server validates everything.</p>
    </div>
  );
  void playerId;
}

function TradePanel({ game, playerId, members, send }: { game: GameState | null; playerId: string; members: { playerId: string; player: { nickname: string } }[]; send: (event: string, action: object) => void }) {
  const [to, setTo] = useState("");
  const [giveSpace, setGiveSpace] = useState("");
  const [wantSpace, setWantSpace] = useState("");
  if (!game) return null;
  const others = members.filter((m) => m.playerId !== playerId);
  const pending = (game.trades ?? []).filter((t) => t.status === "pending" && (t.to === playerId || t.from === playerId));
  return (
    <div className="mt-3 rounded border p-3" aria-label="Trading">
      <h2 className="font-semibold">Trading</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <select className="rounded border px-2 py-1" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Trade with">
          <option value="">With…</option>
          {others.map((m) => <option key={m.playerId} value={m.playerId}>{m.player.nickname}</option>)}
        </select>
        <input className="w-24 rounded border px-2 py-1" value={giveSpace} onChange={(e) => setGiveSpace(e.target.value)} placeholder="Give #" aria-label="Offer space" inputMode="numeric" />
        <input className="w-24 rounded border px-2 py-1" value={wantSpace} onChange={(e) => setWantSpace(e.target.value)} placeholder="Want #" aria-label="Request space" inputMode="numeric" />
        <button className="rounded bg-emerald-800 px-3 py-1 text-white" onClick={() => {
          if (!to) return;
          send("game:proposeTrade", { kind: "proposeTrade", trade: { to, offerCash: 0, requestCash: 0, offerSpaces: giveSpace === "" ? [] : [Number(giveSpace)], requestSpaces: wantSpace === "" ? [] : [Number(wantSpace)], offerJailCards: 0, requestJailCards: 0 } });
        }}>Propose</button>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {pending.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <span>{t.from === playerId ? "You offered" : "Offer from"} {members.find((m) => m.playerId === t.from)?.player.nickname}: gives [{t.offerSpaces.join(",")}] for [{t.requestSpaces.join(",")}]</span>
            {t.to === playerId && (
              <>
                <button className="rounded border px-2 py-0.5" onClick={() => send("game:acceptTrade", { kind: "acceptTrade", tradeId: t.id })}>Accept</button>
                <button className="rounded border px-2 py-0.5" onClick={() => send("game:rejectTrade", { kind: "rejectTrade", tradeId: t.id })}>Reject</button>
              </>
            )}
          </li>
        ))}
        {pending.length === 0 && <li className="text-stone-500">No pending trades.</li>}
      </ul>
      <p className="mt-1 text-xs text-stone-600">Both sides accept; the server revalidates ownership and funds at execution.</p>
    </div>
  );
}

interface Member { playerId: string; seatNumber: number; player: { nickname: string } }

export function GamePage({ roomCode, playerId, onLeave }: { roomCode: string; playerId: string; onLeave: () => void }) {
  const [room, setRoom] = useState<{ id: string; hostPlayerId: string; status: string; members: Member[] } | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [version, setVersion] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [chat, setChat] = useState<{ id: string; nickname: string; message: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const pushLog = (m: string) => setLog((l) => [...l.slice(-49), m]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const info = await api.roomInfo(roomCode);
        if (!alive) return;
        setRoom({ ...info.room, members: info.room.members });
        const snap = await api.gameSnapshot(roomCode);
        if (snap.game) {
          setGame(snap.game.currentState);
          setVersion(snap.game.stateVersion);
        }
        const hist = await api.chatHistory(roomCode);
        setChat(hist.messages);
        const s = connectSocket();
        await new Promise<void>((resolve) => {
          if (s.connected) resolve();
          else {
            s.once("connect", () => resolve());
            setTimeout(() => resolve(), 2000);
          }
        });
        s.emit("room:join", { roomId: info.room.id }, () => undefined);
        s.emit("room:rejoin", { roomId: info.room.id }, (r: { game?: { currentState: GameState; stateVersion: number }; chat?: typeof chat }) => {
          if (r?.game) {
            setGame(r.game.currentState);
            setVersion(r.game.stateVersion);
          }
          if (r?.chat) setChat(r.chat);
        });
        s.on("game:stateUpdated", (p: { state: GameState; stateVersion: number; events: { type: string }[] }) => {
          setGame(p.state);
          setVersion(p.stateVersion);
          for (const e of p.events ?? []) pushLog(e.type);
          // Keep seat/nickname list fresh when players join after we loaded.
          api.roomInfo(roomCode).then((i) => { if (alive) setRoom(i.room); }).catch(() => undefined);
        });
        s.on("game:actionRejected", (p: { error: string }) => setError(p.error));
        s.on("chat:messageReceived", (m: { id: string; nickname?: string; message: string; player?: { nickname: string } }) => {
          setChat((c) => [...c, { id: m.id ?? String(Date.now()), nickname: (m.nickname ?? m.player?.nickname ?? "Player"), message: m.message }]);
        });
        s.on("game:playerDisconnected", (p: { playerId: string }) => pushLog(`player disconnected: ${p.playerId.slice(0, 4)}`));
        s.on("game:playerReconnected", (p: { playerId: string }) => pushLog(`player reconnected: ${p.playerId.slice(0, 4)}`));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [roomCode]);

  const send = (event: string, action: object) => {
    setError("");
    const s = connectSocket();
    s.emit(event, { commandId: crypto.randomUUID(), roomId: room?.id, expectedVersion: version, action: { playerId, ...action } });
  };

  const positions: Record<string, number> = {};
  for (const p of game?.players ?? []) positions[p.id] = p.position;
  const owners: Record<number, string | null> = {};
  for (const [k, v] of Object.entries(game?.properties ?? {})) owners[Number(k)] = (v as { owner: string | null }).owner;
  const me = game?.players.find((p) => p.id === playerId);
  const isMyTurn = game?.currentPlayerId === playerId;

  return (
    <main className="mx-auto max-w-7xl gap-4 p-4 lg:grid lg:grid-cols-[1fr_300px]">
      <section>
        {game?.phase === "gameover" && game.winnerId && (
          <p role="status" className="mb-2 rounded bg-amber-200 px-3 py-2 font-semibold text-emerald-950">
            Game over — winner: {room?.members.find((m) => m.playerId === game.winnerId)?.player.nickname ?? game.winnerId.slice(0, 4)}
          </p>
        )}
        <header className="mb-2 flex items-center justify-between">
          <h1 className="text-xl font-bold text-emerald-950">Room {roomCode} {isMyTurn && <span className="ml-2 rounded bg-amber-400 px-2 py-0.5 text-sm">Your turn</span>}</h1>
          <button className="rounded border px-3 py-1" onClick={async () => { await api.leaveRoom(roomCode).catch(() => undefined); onLeave(); }}>Leave</button>
        </header>
        {game ? (
          <Board positions={positions} owners={owners} currentPlayerId={game.currentPlayerId} players={(room?.members ?? []).map((m) => ({ id: m.playerId, nickname: m.player.nickname }))} />
        ) : (
          <div className="rounded border p-6">
            <p>Waiting for host to start… Seats: {(room?.members ?? []).map((m) => m.player.nickname).join(", ")}</p>
            <div className="mt-3 flex gap-2">
              <button className="rounded bg-emerald-800 px-4 py-2 text-white" onClick={async () => { try { await api.startGame(roomCode); const s = await api.gameSnapshot(roomCode); setGame(s.game.currentState); setVersion(s.game.stateVersion); const i = await api.roomInfo(roomCode); setRoom(i.room); } catch (e) { setError((e as Error).message); } }}>Start game (host, 2–5 players)</button>
              <button className="rounded border px-4 py-2" onClick={async () => { const i = await api.roomInfo(roomCode); setRoom(i.room); }}>Refresh lobby</button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Player controls">
          <button className="rounded bg-emerald-800 px-3 py-2 text-white disabled:opacity-40" disabled={!game || !isMyTurn} onClick={() => send("game:rollDice", { kind: "roll" })}>Roll dice</button>
          <button className="rounded border px-3 py-2" disabled={!game || !isMyTurn} onClick={() => send("game:buyProperty", { kind: "buy" })}>Buy</button>
          <button className="rounded border px-3 py-2" disabled={!game || !isMyTurn} onClick={() => send("game:declineProperty", { kind: "decline" })}>Auction</button>
          <button className="rounded border px-3 py-2" disabled={!game || !isMyTurn} onClick={() => send("game:endTurn", { kind: "endTurn" })}>End turn</button>
          <button className="rounded border px-3 py-2" onClick={() => send("game:payJailFine", { kind: "payJailFine" })}>Pay jail $50</button>
          <button className="rounded border px-3 py-2" onClick={() => send("game:useJailCard", { kind: "useJailCard" })}>Use jail card</button>
          <button className="rounded border px-3 py-2" disabled={!game || !isMyTurn} onClick={() => send("game:attemptJailDoubles", { kind: "jailDoubles" })}>Try doubles</button>
        </div>
        <ul className="mt-3 max-h-32 overflow-auto rounded border bg-stone-50 p-2 text-xs" aria-label="Game events">
          {log.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
        <PropertyActions game={game} playerId={playerId} send={send} />
        <TradePanel game={game} playerId={playerId} members={room?.members ?? []} send={send} />
      </section>
      <aside className="mt-4 lg:mt-0">
        <section className="rounded border p-3" aria-label="Players">
          <h2 className="font-semibold">Players</h2>
          <ul className="mt-1 space-y-1 text-sm">
            {(game?.players ?? (room?.members ?? []).map((m) => ({ id: m.playerId, cash: 0, position: 0, inJail: false, bankrupt: false }))).map((p: { id: string; cash?: number; position?: number; inJail?: boolean; bankrupt?: boolean }) => {
              const nick = room?.members.find((m) => m.playerId === p.id)?.player.nickname ?? p.id.slice(0, 4);
              return <li key={p.id} className={p.id === game?.currentPlayerId ? "font-bold text-emerald-900" : ""}>{nick} — ${p.cash ?? "?"} @ {p.position ?? "?"} {p.inJail ? "(jail)" : ""} {p.bankrupt ? "(out)" : ""}</li>;
            })}
          </ul>
          {me && <p className="mt-2 text-xs text-stone-600">You: ${me.cash} at {me.position}{me.inJail ? " (in jail)" : ""}</p>}
        </section>
        <section className="mt-3 rounded border p-3" aria-label="Chat">
          <h2 className="font-semibold">Chat</h2>
          <ul className="mt-1 max-h-64 space-y-1 overflow-auto text-sm">
            {chat.map((m) => <li key={m.id}><strong>{m.nickname}:</strong> {m.message}</li>)}
          </ul>
          <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!draft.trim()) return; try { await api.sendChat(roomCode, draft); setDraft(""); } catch (err) { setError((err as Error).message); } }}>
            <input className="w-full rounded border px-2 py-1" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="Say something…" aria-label="Chat message" />
            <button className="rounded bg-emerald-800 px-3 py-1 text-white" type="submit">Send</button>
          </form>
        </section>
      </aside>
    </main>
  );
}
