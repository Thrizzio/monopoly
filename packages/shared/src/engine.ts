import {
  BOARD,
  CHEST_DECK,
  CHANCE_DECK,
  GO_SALARY,
  INCOME_TAX,
  JAIL_FINE,
  LUXURY_TAX,
  RAILROAD_RENT,
  purchasable,
} from "./board.js";

export interface EnginePlayer {
  id: string;
  seat: number;
  position: number;
  cash: number;
  inJail: boolean;
  jailTurns: number;
  jailCards: number;
  bankrupt: boolean;
  doublesCount: number;
}

export interface PropertyState {
  owner: string | null;
  houses: number;
  hotel: boolean;
  mortgaged: boolean;
}

export type Phase = "roll" | "buy-or-auction" | "auction" | "end" | "gameover";

export interface TradeOffer {
  id: string;
  from: string;
  to: string;
  offerCash: number;
  requestCash: number;
  offerSpaces: number[];
  requestSpaces: number[];
  offerJailCards: number;
  requestJailCards: number;
  status: "pending" | "accepted" | "rejected";
}

export interface GameState {
  players: EnginePlayer[];
  properties: Record<number, PropertyState>;
  currentPlayerId: string;
  phase: Phase;
  pendingSpace: number | null;
  doublesCount: number;
  winnerId: string | null;
  housesRemaining: number;
  hotelsRemaining: number;
  chanceIndex: number;
  chestIndex: number;
  auction: { spaceIndex: number; bids: Record<string, number>; active: boolean } | null;
  trades: TradeOffer[];
}

export interface GameEvent {
  type: string;
  playerId?: string;
  payload?: Record<string, unknown>;
}

export type GameAction =
  | { kind: "roll"; playerId: string; d1: number; d2: number }
  | { kind: "buy"; playerId: string }
  | { kind: "decline"; playerId: string }
  | { kind: "placeBid"; playerId: string; amount: number }
  | { kind: "endAuction"; playerId: string }
  | { kind: "buildHouse"; playerId: string; space: number }
  | { kind: "sellBuilding"; playerId: string; space: number }
  | { kind: "mortgage"; playerId: string; space: number }
  | { kind: "unmortgage"; playerId: string; space: number }
  | { kind: "proposeTrade"; playerId: string; trade: Omit<TradeOffer, "id" | "status" | "from"> }
  | { kind: "acceptTrade"; playerId: string; tradeId: string }
  | { kind: "rejectTrade"; playerId: string; tradeId: string }
  | { kind: "payJailFine"; playerId: string }
  | { kind: "useJailCard"; playerId: string }
  | { kind: "jailDoubles"; playerId: string; d1: number; d2: number }
  | { kind: "endTurn"; playerId: string };

export interface GameResult {
  state: GameState;
  events: GameEvent[];
  error?: string;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function createInitialState(playerIds: string[]): GameState {
  const players: EnginePlayer[] = playerIds.map((id, i) => ({
    id,
    seat: i + 1,
    position: 0,
    cash: 1500,
    inJail: false,
    jailTurns: 0,
    jailCards: 0,
    bankrupt: false,
    doublesCount: 0,
  }));
  const properties: Record<number, PropertyState> = {};
  for (const s of BOARD) {
    if (purchasable(s)) properties[s.index] = { owner: null, houses: 0, hotel: false, mortgaged: false };
  }
  return {
    players,
    properties,
    currentPlayerId: playerIds[0],
    phase: "roll",
    pendingSpace: null,
    doublesCount: 0,
    winnerId: null,
    housesRemaining: 32,
    hotelsRemaining: 12,
    chanceIndex: 0,
    chestIndex: 0,
    auction: null,
    trades: [],
  };
}

const getPlayer = (s: GameState, id: string) => s.players.find((p) => p.id === id);
const alive = (s: GameState) => s.players.filter((p) => !p.bankrupt);

function groupMembers(color: string): number[] {
  return BOARD.filter((b) => b.color === color).map((b) => b.index);
}

export function ownsGroup(s: GameState, playerId: string, color: string): boolean {
  return groupMembers(color).every((i) => s.properties[i].owner === playerId);
}

function railroadsOwned(s: GameState, playerId: string): number {
  return BOARD.filter((b) => b.type === "railroad" && s.properties[b.index].owner === playerId).length;
}

function utilitiesOwned(s: GameState, playerId: string): number {
  return BOARD.filter((b) => b.type === "utility" && s.properties[b.index].owner === playerId).length;
}

export function rentFor(s: GameState, idx: number, diceSum: number): number {
  const space = BOARD[idx];
  const st = s.properties[idx];
  if (!st || !st.owner || st.mortgaged) return 0;
  if (space.type === "railroad") return RAILROAD_RENT[Math.max(0, railroadsOwned(s, st.owner) - 1)];
  if (space.type === "utility") return diceSum * (utilitiesOwned(s, st.owner) === 2 ? 10 : 4);
  if (space.type !== "property" || !space.rent) return 0;
  if (st.hotel) return space.rent[5];
  if (st.houses > 0) return space.rent[st.houses];
  if (space.color && ownsGroup(s, st.owner, space.color)) return space.rent[0] * 2;
  return space.rent[0];
}

function sendToJail(s: GameState, p: EnginePlayer, events: GameEvent[]) {
  p.position = 10;
  p.inJail = true;
  p.jailTurns = 0;
  p.doublesCount = 0;
  s.doublesCount = 0;
  s.phase = "end";
  events.push({ type: "sent-to-jail", playerId: p.id });
}

function payDebt(s: GameState, debtor: EnginePlayer, amount: number, creditorId: string | null, events: GameEvent[]): boolean {
  if (debtor.cash >= amount) {
    debtor.cash -= amount;
    if (creditorId) {
      const c = getPlayer(s, creditorId);
      if (c) c.cash += amount;
    }
    return true;
  }
  bankrupt(s, debtor, creditorId, events);
  return false;
}

function bankrupt(s: GameState, p: EnginePlayer, creditorId: string | null, events: GameEvent[]) {
  const remainder = p.cash;
  p.bankrupt = true;
  p.cash = 0;
  for (const st of Object.values(s.properties)) {
    if (st.owner === p.id) {
      if (creditorId) {
        st.owner = creditorId;
      } else {
        st.owner = null;
        st.houses = 0;
        st.hotel = false;
        st.mortgaged = false;
      }
      if (st.hotel || st.houses > 0) {
        if (creditorId) {
          s.housesRemaining += st.houses;
          if (st.hotel) s.hotelsRemaining += 1;
        }
        st.houses = 0;
        st.hotel = false;
        if (!creditorId) st.mortgaged = false;
      }
    }
  }
  if (creditorId) {
    const c = getPlayer(s, creditorId);
    if (c) {
      c.cash += remainder;
      c.jailCards += p.jailCards;
    }
  }
  p.jailCards = 0;
  events.push({ type: "bankrupt", playerId: p.id, payload: { creditorId } });
  const remaining = alive(s);
  if (remaining.length === 1) {
    s.winnerId = remaining[0].id;
    s.phase = "gameover";
    events.push({ type: "game-over", payload: { winnerId: s.winnerId } });
  }
}

function advance(s: GameState, p: EnginePlayer, steps: number, events: GameEvent[]) {
  const next = p.position + steps;
  if (next >= 40) {
    p.cash += GO_SALARY;
    events.push({ type: "passed-go", playerId: p.id, payload: { amount: GO_SALARY } });
  }
  p.position = next % 40;
}

function resolveLanding(s: GameState, p: EnginePlayer, diceSum: number, events: GameEvent[]) {
  const idx = p.position;
  const space = BOARD[idx];
  switch (space.type) {
    case "go":
    case "free-parking":
      s.phase = "end";
      break;
    case "jail":
      s.phase = "end";
      break;
    case "go-to-jail":
      sendToJail(s, p, events);
      break;
    case "income-tax":
      payDebt(s, p, INCOME_TAX, null, events);
      if (!p.bankrupt) {
        events.push({ type: "paid-tax", playerId: p.id, payload: { amount: INCOME_TAX } });
        s.phase = "end";
      }
      break;
    case "luxury-tax":
      payDebt(s, p, LUXURY_TAX, null, events);
      if (!p.bankrupt) {
        events.push({ type: "paid-tax", playerId: p.id, payload: { amount: LUXURY_TAX } });
        s.phase = "end";
      }
      break;
    case "chance":
    case "chest": {
      const isChance = space.type === "chance";
      const deck = isChance ? CHANCE_DECK : CHEST_DECK;
      const di = isChance ? s.chanceIndex % deck.length : s.chestIndex % deck.length;
      const card = deck[di];
      if (isChance) s.chanceIndex += 1;
      else s.chestIndex += 1;
      events.push({ type: "drew-card", playerId: p.id, payload: { cardId: card.id, summary: card.summary } });
      applyCard(s, p, card.effect, diceSum, events);
      break;
    }
    case "property":
    case "railroad":
    case "utility": {
      const st = s.properties[idx];
      if (!st.owner) {
        s.phase = "buy-or-auction";
        s.pendingSpace = idx;
        events.push({ type: "offer-purchase", playerId: p.id, payload: { space: idx, price: space.price } });
      } else if (st.owner !== p.id) {
        const rent = rentFor(s, idx, diceSum);
        if (rent > 0) {
          const ok = payDebt(s, p, rent, st.owner, events);
          events.push({ type: "paid-rent", playerId: p.id, payload: { space: idx, amount: rent, to: st.owner, bankrupt: !ok } });
        }
        if (!p.bankrupt) s.phase = "end";
      } else {
        s.phase = "end";
      }
      break;
    }
  }
}

function nearestFrom(pos: number, targets: number[]): number {
  let best = targets[0];
  let bestDist = 99;
  for (const t of targets) {
    const d = (t - pos + 40) % 40;
    if (d > 0 && d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

function applyCard(s: GameState, p: EnginePlayer, effect: { kind: string; to?: number; amount?: number; perHouse?: number; perHotel?: number; collectGo?: boolean }, diceSum: number, events: GameEvent[]) {
  switch (effect.kind) {
    case "advance-to": {
      const to = effect.to ?? 0;
      if (to === -3) {
        p.position = (p.position + 37) % 40;
        resolveLanding(s, p, diceSum, events);
        return;
      }
      if (effect.collectGo && to < p.position) {
        p.cash += GO_SALARY;
        events.push({ type: "passed-go", playerId: p.id, payload: { amount: GO_SALARY } });
      }
      if (to === 10 && effect.kind === "advance-to") {
        p.position = to;
        resolveLanding(s, p, diceSum, events);
        return;
      }
      p.position = to;
      resolveLanding(s, p, diceSum, events);
      return;
    }
    case "go-to-jail":
      sendToJail(s, p, events);
      return;
    case "cash": {
      const amt = effect.amount ?? 0;
      if (amt >= 0) {
        p.cash += amt;
        s.phase = "end";
      } else {
        const ok = payDebt(s, p, -amt, null, events);
        if (ok) s.phase = "end";
      }
      return;
    }
    case "jail-card":
      p.jailCards += 1;
      s.phase = "end";
      return;
    case "repairs": {
      let total = 0;
      for (const st of Object.values(s.properties)) {
        if (st.owner === p.id) {
          if (st.hotel) total += effect.perHotel ?? 0;
          else total += st.houses * (effect.perHouse ?? 0);
        }
      }
      if (total > 0) {
        const ok = payDebt(s, p, total, null, events);
        if (ok) s.phase = "end";
      } else s.phase = "end";
      return;
    }
    case "nearest-railroad": {
      const targets = BOARD.filter((b) => b.type === "railroad").map((b) => b.index);
      const dest = nearestFrom(p.position, targets);
      if (dest < p.position) {
        p.cash += GO_SALARY;
        events.push({ type: "passed-go", playerId: p.id, payload: { amount: GO_SALARY } });
      }
      p.position = dest;
      const st = s.properties[dest];
      if (!st.owner) {
        s.phase = "buy-or-auction";
        s.pendingSpace = dest;
      } else if (st.owner !== p.id) {
        let rent = rentFor(s, dest, diceSum) * 2;
        if (st.owner && railroadsOwned(s, st.owner) === 0) rent = 25 * 2;
        const ok = payDebt(s, p, rent, st.owner, events);
        events.push({ type: "paid-rent", playerId: p.id, payload: { space: dest, amount: rent, to: st.owner, cardDouble: true, bankrupt: !ok } });
        if (!p.bankrupt) s.phase = "end";
      } else s.phase = "end";
      return;
    }
    case "nearest-utility": {
      const targets = BOARD.filter((b) => b.type === "utility").map((b) => b.index);
      const dest = nearestFrom(p.position, targets);
      if (dest < p.position) {
        p.cash += GO_SALARY;
        events.push({ type: "passed-go", playerId: p.id, payload: { amount: GO_SALARY } });
      }
      p.position = dest;
      const st = s.properties[dest];
      if (!st.owner) {
        s.phase = "buy-or-auction";
        s.pendingSpace = dest;
      } else if (st.owner !== p.id) {
        const rent = diceSum * 10;
        const ok = payDebt(s, p, rent, st.owner, events);
        events.push({ type: "paid-rent", playerId: p.id, payload: { space: dest, amount: rent, to: st.owner, cardRate: true, bankrupt: !ok } });
        if (!p.bankrupt) s.phase = "end";
      } else s.phase = "end";
      return;
    }
  }
  s.phase = "end";
}

function nextAlive(s: GameState, fromId: string): EnginePlayer | null {
  const list = [...s.players].sort((a, b) => a.seat - b.seat);
  const living = list.filter((p) => !p.bankrupt);
  if (living.length <= 1) return living[0] ?? null;
  const idx = living.findIndex((p) => p.id === fromId);
  return living[(idx + 1) % living.length] ?? living[0];
}

function fail(state: GameState, error: string): GameResult {
  return { state, events: [], error };
}

export function processAction(prev: GameState, action: GameAction): GameResult {
  const s = clone(prev);
  const events: GameEvent[] = [];
  const p = getPlayer(s, action.playerId);
  if (!p) return fail(s, "unknown player");
  if (p.bankrupt) return fail(s, "player is bankrupt");
  if (s.phase === "gameover") return fail(s, "game over");
  if (s.currentPlayerId !== action.playerId && action.kind !== "placeBid" && action.kind !== "acceptTrade" && action.kind !== "rejectTrade") {
    return fail(s, "not your turn");
  }

  switch (action.kind) {
    case "roll": {
      if (s.phase !== "roll") return fail(s, "cannot roll now");
      if (p.inJail) return fail(s, "in jail: use jail action");
      const { d1, d2 } = action;
      if (d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6) return fail(s, "invalid dice");
      events.push({ type: "rolled", playerId: p.id, payload: { d1, d2 } });
      if (d1 === d2) {
        s.doublesCount += 1;
        p.doublesCount += 1;
        if (s.doublesCount >= 3) {
          sendToJail(s, p, events);
          return { state: s, events };
        }
      } else {
        s.doublesCount = 0;
        p.doublesCount = 0;
      }
      advance(s, p, d1 + d2, events);
      events.push({ type: "moved", playerId: p.id, payload: { position: p.position } });
      resolveLanding(s, p, d1 + d2, events);
      if (p.bankrupt) {
        const nxt = nextAlive(s, p.id);
        if (nxt && (s.phase as string) !== "gameover") {
          s.currentPlayerId = nxt.id;
          s.phase = "roll";
          s.doublesCount = 0;
        }
        return { state: s, events };
      }
      if ((s.phase as string) === "end" && d1 === d2 && !p.inJail) {
        s.phase = "roll";
        events.push({ type: "extra-roll", playerId: p.id });
      }
      return { state: s, events };
    }
    case "buy": {
      if (s.phase !== "buy-or-auction" || s.pendingSpace == null) return fail(s, "nothing to buy");
      const idx = s.pendingSpace;
      const space = BOARD[idx];
      const st = s.properties[idx];
      if (st.owner) return fail(s, "already owned");
      const price = space.price ?? 0;
      if (p.cash < price) return fail(s, "insufficient funds");
      p.cash -= price;
      st.owner = p.id;
      events.push({ type: "purchased", playerId: p.id, payload: { space: idx, price } });
      s.pendingSpace = null;
      s.phase = "end";
      return { state: s, events };
    }
    case "decline": {
      if (s.phase !== "buy-or-auction" || s.pendingSpace == null) return fail(s, "nothing to decline");
      s.auction = { spaceIndex: s.pendingSpace, bids: {}, active: true };
      s.phase = "auction";
      s.pendingSpace = null;
      events.push({ type: "auction-started", playerId: p.id, payload: { space: s.auction.spaceIndex } });
      return { state: s, events };
    }
    case "placeBid": {
      if (!s.auction?.active) return fail(s, "no active auction");
      if (action.amount < 1) return fail(s, "bid too low");
      if (p.cash < action.amount) return fail(s, "insufficient funds");
      s.auction.bids[p.id] = action.amount;
      events.push({ type: "bid-placed", playerId: p.id, payload: { amount: action.amount } });
      return { state: s, events };
    }
    case "endAuction": {
      if (!s.auction?.active) return fail(s, "no active auction");
      const entries = Object.entries(s.auction.bids).sort((a, b) => b[1] - a[1]);
      const idx = s.auction.spaceIndex;
      const space = BOARD[idx];
      if (entries.length === 0) {
        events.push({ type: "auction-ended", payload: { space: idx, winnerId: null } });
      } else {
        const [winnerId, amount] = entries[0];
        const w = getPlayer(s, winnerId);
        if (!w || w.bankrupt || w.cash < amount) return fail(s, "winning bid invalid");
        w.cash -= amount;
        s.properties[idx].owner = winnerId;
        events.push({ type: "auction-ended", payload: { space: idx, winnerId, amount, price: space.price } });
      }
      s.auction = null;
      s.phase = "end";
      return { state: s, events };
    }
    case "buildHouse": {
      const idx = action.space;
      const space = BOARD[idx];
      const st = s.properties[idx];
      if (!st || space.type !== "property" || !space.color) return fail(s, "cannot build here");
      if (st.owner !== p.id) return fail(s, "not owner");
      if (st.mortgaged || st.hotel) return fail(s, "cannot build now");
      if (!ownsGroup(s, p.id, space.color)) return fail(s, "need full color group");
      if (groupMembers(space.color).some((i) => s.properties[i].mortgaged)) return fail(s, "group mortgaged");
      if (st.houses >= 4) return fail(s, "already 4 houses; build hotel via 4 houses");
      const members = groupMembers(space.color);
      const min = Math.min(...members.map((i) => (s.properties[i].hotel ? 5 : s.properties[i].houses)));
      if (st.houses > min) return fail(s, "must build evenly");
      const cost = space.houseCost ?? 0;
      if (p.cash < cost) return fail(s, "insufficient funds");
      if (s.housesRemaining <= 0) return fail(s, "no houses left");
      if (st.houses === 4) {
        if (s.hotelsRemaining <= 0) return fail(s, "no hotels left");
        p.cash -= cost;
        st.houses = 0;
        st.hotel = true;
        s.housesRemaining += 4;
        s.hotelsRemaining -= 1;
        events.push({ type: "built-hotel", playerId: p.id, payload: { space: idx } });
      } else {
        p.cash -= cost;
        st.houses += 1;
        s.housesRemaining -= 1;
        events.push({ type: "built-house", playerId: p.id, payload: { space: idx, houses: st.houses } });
      }
      return { state: s, events };
    }
    case "sellBuilding": {
      const idx = action.space;
      const space = BOARD[idx];
      const st = s.properties[idx];
      if (!st || st.owner !== p.id) return fail(s, "not owner");
      const cost = Math.floor((space.houseCost ?? 0) / 2);
      if (st.hotel) {
        st.hotel = false;
        st.houses = 4;
        s.hotelsRemaining += 1;
        s.housesRemaining -= 4;
        p.cash += cost;
        events.push({ type: "sold-hotel", playerId: p.id, payload: { space: idx } });
      } else if (st.houses > 0) {
        const members = space.color ? groupMembers(space.color) : [idx];
        const max = Math.max(...members.map((i) => (s.properties[i].hotel ? 5 : s.properties[i].houses)));
        if (st.houses < max) return fail(s, "must sell evenly");
        st.houses -= 1;
        s.housesRemaining += 1;
        p.cash += cost;
        events.push({ type: "sold-house", playerId: p.id, payload: { space: idx, houses: st.houses } });
      } else return fail(s, "no buildings");
      return { state: s, events };
    }
    case "mortgage": {
      const idx = action.space;
      const st = s.properties[idx];
      const space = BOARD[idx];
      if (!st || st.owner !== p.id || st.mortgaged) return fail(s, "cannot mortgage");
      if (st.houses > 0 || st.hotel) return fail(s, "sell buildings first");
      if (space.color) {
        const members = groupMembers(space.color);
        if (members.some((i) => s.properties[i].owner === p.id && (s.properties[i].houses > 0 || s.properties[i].hotel))) {
          return fail(s, "sell group buildings first");
        }
      }
      st.mortgaged = true;
      p.cash += space.mortgage ?? 0;
      events.push({ type: "mortgaged", playerId: p.id, payload: { space: idx } });
      return { state: s, events };
    }
    case "unmortgage": {
      const idx = action.space;
      const st = s.properties[idx];
      const space = BOARD[idx];
      if (!st || st.owner !== p.id || !st.mortgaged) return fail(s, "not mortgaged");
      const cost = Math.ceil((space.mortgage ?? 0) * 1.1);
      if (p.cash < cost) return fail(s, "insufficient funds");
      p.cash -= cost;
      st.mortgaged = false;
      events.push({ type: "unmortgaged", playerId: p.id, payload: { space: idx, cost } });
      return { state: s, events };
    }
    case "proposeTrade": {
      const t = action.trade;
      if (!getPlayer(s, t.to) || getPlayer(s, t.to)?.bankrupt) return fail(s, "bad counterparty");
      for (const i of [...t.offerSpaces, ...t.requestSpaces]) {
        if (!s.properties[i]) return fail(s, "bad space");
      }
      for (const i of t.offerSpaces) {
        const st = s.properties[i];
        if (st.owner !== p.id || st.houses > 0 || st.hotel) return fail(s, "offer space unavailable");
      }
      const id = `t${Date.now()}${Math.floor(Math.random() * 1000)}`;
      s.trades.push({ id, from: p.id, ...t, status: "pending" });
      events.push({ type: "trade-proposed", playerId: p.id, payload: { tradeId: id, to: t.to } });
      return { state: s, events };
    }
    case "acceptTrade": {
      const tr = s.trades.find((x) => x.id === action.tradeId && x.status === "pending");
      if (!tr) return fail(s, "no such trade");
      if (tr.to !== p.id) return fail(s, "not your trade");
      const from = getPlayer(s, tr.from);
      if (!from || from.bankrupt) return fail(s, "proposer unavailable");
      if (from.cash < tr.offerCash || p.cash < tr.requestCash) return fail(s, "insufficient funds");
      if (from.jailCards < tr.offerJailCards || p.jailCards < tr.requestJailCards) return fail(s, "missing jail card");
      for (const i of tr.offerSpaces) if (s.properties[i].owner !== from.id) return fail(s, "offer changed");
      for (const i of tr.requestSpaces) if (s.properties[i].owner !== p.id) return fail(s, "request changed");
      from.cash -= tr.offerCash;
      p.cash += tr.offerCash;
      p.cash -= tr.requestCash;
      from.cash += tr.requestCash;
      for (const i of tr.offerSpaces) s.properties[i].owner = p.id;
      for (const i of tr.requestSpaces) s.properties[i].owner = from.id;
      from.jailCards -= tr.offerJailCards;
      p.jailCards += tr.offerJailCards;
      p.jailCards -= tr.requestJailCards;
      from.jailCards += tr.requestJailCards;
      tr.status = "accepted";
      events.push({ type: "trade-accepted", playerId: p.id, payload: { tradeId: tr.id } });
      return { state: s, events };
    }
    case "rejectTrade": {
      const tr = s.trades.find((x) => x.id === action.tradeId && x.status === "pending");
      if (!tr || tr.to !== p.id) return fail(s, "no such trade");
      tr.status = "rejected";
      events.push({ type: "trade-rejected", playerId: p.id, payload: { tradeId: tr.id } });
      return { state: s, events };
    }
    case "payJailFine": {
      if (!p.inJail) return fail(s, "not in jail");
      if (p.cash < JAIL_FINE) return fail(s, "insufficient funds");
      p.cash -= JAIL_FINE;
      p.inJail = false;
      p.jailTurns = 0;
      s.phase = "roll";
      s.doublesCount = 0;
      events.push({ type: "jail-release", playerId: p.id, payload: { method: "fine" } });
      return { state: s, events };
    }
    case "useJailCard": {
      if (!p.inJail || p.jailCards < 1) return fail(s, "no jail card");
      p.jailCards -= 1;
      p.inJail = false;
      p.jailTurns = 0;
      s.phase = "roll";
      events.push({ type: "jail-release", playerId: p.id, payload: { method: "card" } });
      return { state: s, events };
    }
    case "jailDoubles": {
      if (!p.inJail) return fail(s, "not in jail");
      const { d1, d2 } = action;
      if (d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6) return fail(s, "invalid dice");
      events.push({ type: "rolled", playerId: p.id, payload: { d1, d2, jail: true } });
      if (d1 === d2) {
        p.inJail = false;
        p.jailTurns = 0;
        s.doublesCount = 0;
        advance(s, p, d1 + d2, events);
        events.push({ type: "moved", playerId: p.id, payload: { position: p.position } });
        resolveLanding(s, p, d1 + d2, events);
        return { state: s, events };
      }
      p.jailTurns += 1;
      if (p.jailTurns >= 3) {
        if (p.cash < JAIL_FINE) {
          bankrupt(s, p, null, events);
        } else {
          p.cash -= JAIL_FINE;
          p.inJail = false;
          p.jailTurns = 0;
          advance(s, p, d1 + d2, events);
          resolveLanding(s, p, d1 + d2, events);
          events.push({ type: "jail-release", playerId: p.id, payload: { method: "forced-fine" } });
        }
        return { state: s, events };
      }
      s.phase = "end";
      events.push({ type: "jail-stay", playerId: p.id });
      return { state: s, events };
    }
    case "endTurn": {
      if (s.phase !== "end") return fail(s, "turn not complete");
      if (s.auction?.active) return fail(s, "auction in progress");
      const nxt = nextAlive(s, p.id);
      if (!nxt) return fail(s, "no players");
      s.currentPlayerId = nxt.id;
      s.phase = "roll";
      s.doublesCount = 0;
      events.push({ type: "turn-ended", playerId: p.id, payload: { next: nxt.id } });
      return { state: s, events };
    }
  }
}
