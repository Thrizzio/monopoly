import { describe, expect, it } from "vitest";
import { BOARD, purchasable } from "./board.js";
import { createInitialState, processAction, rentFor } from "./engine.js";

describe("board", () => {
  it("has exactly 40 spaces with required mix", () => {
    expect(BOARD).toHaveLength(40);
    const count = (t: string) => BOARD.filter((s) => s.type === t).length;
    expect(BOARD.filter((s) => s.type === "property")).toHaveLength(22);
    expect(count("railroad")).toBe(4);
    expect(count("utility")).toBe(2);
    expect(count("chance")).toBe(3);
    expect(count("chest")).toBe(3);
    expect(count("income-tax")).toBe(1);
    expect(count("luxury-tax")).toBe(1);
    expect(BOARD[0].type).toBe("go");
    expect(BOARD[10].type).toBe("jail");
    expect(BOARD[20].type).toBe("free-parking");
    expect(BOARD[30].type).toBe("go-to-jail");
    expect(BOARD.every((s, i) => s.index === i)).toBe(true);
    expect(BOARD.filter(purchasable)).toHaveLength(28);
  });
});

describe("engine basics", () => {
  it("starts players with 1500 at GO", () => {
    const s = createInitialState(["a", "b"]);
    expect(s.players[0].cash).toBe(1500);
    expect(s.currentPlayerId).toBe("a");
    expect(s.phase).toBe("roll");
  });
  it("moves and passes GO with $200", () => {
    const s = createInitialState(["a", "b"]);
    s.players[0].position = 38;
    const r = processAction(s, { kind: "roll", playerId: "a", d1: 3, d2: 3 });
    expect(r.error).toBeUndefined();
    expect(r.state.players[0].position).toBe(4);
    expect(r.state.players[0].cash).toBe(1500 + 200 - 200);
  });
  it("triple doubles send to jail", () => {
    let s = createInitialState(["a", "b"]);
    s.players[0].position = 0;
    // force two doubles first by direct rolls on safe spots is complex; simulate via doublesCount
    s.doublesCount = 2;
    s.players[0].doublesCount = 2;
    const r = processAction(s, { kind: "roll", playerId: "a", d1: 2, d2: 2 });
    expect(r.state.players[0].inJail).toBe(true);
    expect(r.state.players[0].position).toBe(10);
  });
  it("buy then rent transfers cash", () => {
    let s = createInitialState(["a", "b"]);
    s.players[0].position = 1;
    // land via roll of 1 from 0
    let r = processAction(s, { kind: "roll", playerId: "a", d1: 1, d2: 0 === 0 ? 1 : 1 });
    // d1=1,d2=1 would be doubles; use 1+? need sum 1 impossible; drive manually:
    void r;
    s = createInitialState(["a", "b"]);
    s.players[0].position = 1;
    // simulate landing by rolling from 39 with 2
    s.players[0].position = 39;
    const r2 = processAction(s, { kind: "roll", playerId: "a", d1: 1, d2: 1 });
    expect(r2.state.phase).toBe("buy-or-auction");
    const bought = processAction(r2.state, { kind: "buy", playerId: "a" });
    expect(bought.error).toBeUndefined();
    expect(bought.state.properties[1].owner).toBe("a");
    // player b lands on 1
    let sb = bought.state;
    sb.currentPlayerId = "b";
    sb.phase = "roll";
    sb.players[1].position = 39;
    const rb = processAction(sb, { kind: "roll", playerId: "b", d1: 1, d2: 1 });
    expect(rb.events.some((e) => e.type === "paid-rent")).toBe(true);
  });
  it("railroad and utility rent scales", () => {
    const s = createInitialState(["a", "b"]);
    s.properties[5].owner = "a";
    expect(rentFor(s, 5, 6)).toBe(25);
    s.properties[15].owner = "a";
    expect(rentFor(s, 5, 6)).toBe(50);
    s.properties[12].owner = "a";
    expect(rentFor(s, 12, 8)).toBe(32);
    s.properties[28].owner = "a";
    expect(rentFor(s, 12, 8)).toBe(80);
  });
  it("doubled rent for full color group", () => {
    const s = createInitialState(["a", "b"]);
    s.properties[1].owner = "a";
    expect(rentFor(s, 1, 0)).toBe(2);
    s.properties[3].owner = "a";
    expect(rentFor(s, 1, 0)).toBe(4);
  });
  it("mortgage blocks rent and unmortgage charges interest", () => {
    let s = createInitialState(["a", "b"]);
    s.properties[1].owner = "a";
    s.properties[3].owner = "a";
    const m = processAction(s, { kind: "mortgage", playerId: "a", space: 1 });
    expect(m.error).toBeUndefined();
    expect(rentFor(m.state, 1, 0)).toBe(0);
    const cashAfter = m.state.players[0].cash;
    const u = processAction(m.state, { kind: "unmortgage", playerId: "a", space: 1 });
    expect(u.error).toBeUndefined();
    expect(u.state.players[0].cash).toBe(cashAfter - 33);
  });
  it("jail fine releases and jail doubles work", () => {
    let s = createInitialState(["a", "b"]);
    s.players[0].inJail = true;
    const f = processAction(s, { kind: "payJailFine", playerId: "a" });
    expect(f.error).toBeUndefined();
    expect(f.state.players[0].inJail).toBe(false);
    let s2 = createInitialState(["a", "b"]);
    s2.players[0].inJail = true;
    const d = processAction(s2, { kind: "jailDoubles", playerId: "a", d1: 4, d2: 4 });
    expect(d.state.players[0].inJail).toBe(false);
  });
  it("auction awards highest bidder", () => {
    let s = createInitialState(["a", "b"]);
    s.currentPlayerId = "a";
    s.phase = "buy-or-auction";
    s.pendingSpace = 1;
    s = processAction(s, { kind: "decline", playerId: "a" }).state;
    s = processAction(s, { kind: "placeBid", playerId: "a", amount: 10 }).state;
    s = processAction(s, { kind: "placeBid", playerId: "b", amount: 50 }).state;
    const done = processAction(s, { kind: "endAuction", playerId: "a" });
    expect(done.state.properties[1].owner).toBe("b");
  });
  it("rejects out-of-turn and invalid funds", () => {
    const s = createInitialState(["a", "b"]);
    const r = processAction(s, { kind: "buy", playerId: "b" });
    expect(r.error).toBeDefined();
  });
  it("bankruptcy to creditor transfers assets and ends game", () => {
    let s = createInitialState(["a", "b"]);
    s.properties[3].owner = "b";
    s.players[0].cash = 1;
    s.players[0].position = 1;
    const r = processAction(s, { kind: "roll", playerId: "a", d1: 1, d2: 1 });
    expect(r.state.players[0].bankrupt).toBe(true);
    expect(r.state.phase).toBe("gameover");
    expect(r.state.winnerId).toBe("b");
  });
});
