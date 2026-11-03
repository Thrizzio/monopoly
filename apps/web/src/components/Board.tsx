import { BOARD } from "@monopolisting/shared";

const TOKEN_COLORS = ["#b91c1c", "#1d4ed8", "#15803d", "#b45309", "#0e7490"];

function posToGrid(i: number): { row: number; col: number } {
  if (i <= 10) return { row: 11, col: 11 - i };
  if (i <= 20) return { row: 21 - i, col: 1 };
  if (i <= 30) return { row: 1, col: i - 19 };
  return { row: i - 29, col: 11 };
}

export function Board({ positions, owners, currentPlayerId, players }: {
  positions: Record<string, number>;
  owners: Record<number, string | null>;
  currentPlayerId: string | null;
  players: { id: string; nickname: string }[];
}) {
  const cells = BOARD.map((s) => {
    const { row, col } = posToGrid(s.index);
    const tokensHere = Object.entries(positions).filter(([, p]) => p === s.index);
    const owner = owners[s.index];
    const ownerPlayer = players.find((p) => p.id === owner);
    return (
      <div
        key={s.index}
        data-space={s.index}
        className="relative flex flex-col justify-between border border-emerald-900 bg-amber-50 p-1 text-[10px] leading-tight"
        style={{ gridRow: row, gridColumn: col, minHeight: 56 }}
        title={`${s.name}${s.price ? ` — $${s.price}` : ""}`}
      >
        {s.color && <span className="block h-2 w-full rounded-sm" style={{ background: colorHex(s.color) }} />}
        <span className="font-semibold text-emerald-950">{s.index}. {s.name}</span>
        {s.price && <span className="text-stone-700">${s.price}</span>}
        {ownerPlayer && <span className="truncate font-medium text-stone-800">◉ {ownerPlayer.nickname}</span>}
        {tokensHere.length > 0 && (
          <span className="flex gap-1">
            {tokensHere.map(([pid], k) => {
              const idx = players.findIndex((p) => p.id === pid);
              return (
                <span
                  key={pid + k}
                  data-token={pid}
                  className={`inline-block h-3 w-3 rounded-full border ${pid === currentPlayerId ? "ring-2 ring-amber-500" : "border-stone-700"}`}
                  style={{ background: TOKEN_COLORS[Math.max(0, idx) % TOKEN_COLORS.length] }}
                  title={players.find((p) => p.id === pid)?.nickname ?? pid}
                />
              );
            })}
          </span>
        )}
      </div>
    );
  });
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(11, minmax(0,1fr))", gridTemplateRows: "repeat(11, minmax(0,1fr))", gap: 2 }} aria-label="Monopoly board">
      <div className="flex flex-col items-center justify-center rounded bg-emerald-900 p-2 text-center text-amber-100" style={{ gridRow: "2 / 11", gridColumn: "2 / 11" }}>
        <span className="text-xl font-bold tracking-wide">MONOPOLY ONLINE</span>
        <span className="mt-1 text-xs text-amber-200">Original table artwork. Server-authoritative play.</span>
      </div>
      {cells}
    </div>
  );
}

function colorHex(color: string): string {
  const map: Record<string, string> = {
    brown: "#92400e",
    lightblue: "#7dd3fc",
    pink: "#f472b6",
    orange: "#fb923c",
    red: "#ef4444",
    yellow: "#facc15",
    green: "#22c55e",
    darkblue: "#1e3a8a",
  };
  return map[color] ?? "#a8a29e";
}
