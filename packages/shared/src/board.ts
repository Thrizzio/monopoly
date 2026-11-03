export type SpaceType =
  | "go"
  | "property"
  | "railroad"
  | "utility"
  | "chance"
  | "chest"
  | "income-tax"
  | "luxury-tax"
  | "jail"
  | "free-parking"
  | "go-to-jail";

export interface BoardSpace {
  index: number;
  name: string;
  type: SpaceType;
  price?: number;
  rent?: number[];
  houseCost?: number;
  mortgage?: number;
  color?: string;
}

const prop = (
  index: number,
  name: string,
  color: string,
  price: number,
  rent: number[],
  houseCost: number,
): BoardSpace => ({
  index,
  name,
  type: "property",
  color,
  price,
  rent,
  houseCost,
  mortgage: Math.floor(price / 2),
});

const railroad = (index: number, name: string): BoardSpace => ({
  index,
  name,
  type: "railroad",
  price: 200,
  mortgage: 100,
});

const utility = (index: number, name: string): BoardSpace => ({
  index,
  name,
  type: "utility",
  price: 150,
  mortgage: 75,
});

export const BOARD: BoardSpace[] = [
  { index: 0, name: "Go", type: "go" },
  prop(1, "Harbor Lane", "brown", 60, [2, 10, 30, 90, 160, 250], 50),
  { index: 2, name: "Community Chest", type: "chest" },
  prop(3, "Dock Street", "brown", 60, [4, 20, 60, 180, 320, 450], 50),
  { index: 4, name: "Income Tax", type: "income-tax" },
  railroad(5, "North Line"),
  prop(6, "Willow Ave", "lightblue", 100, [6, 30, 90, 270, 400, 550], 50),
  { index: 7, name: "Chance", type: "chance" },
  prop(8, "Birch Ave", "lightblue", 100, [6, 30, 90, 270, 400, 550], 50),
  prop(9, "Cedar Ave", "lightblue", 120, [8, 40, 100, 300, 450, 600], 50),
  { index: 10, name: "Jail / Just Visiting", type: "jail" },
  prop(11, "Elm Row", "pink", 140, [10, 50, 150, 450, 625, 750], 100),
  utility(12, "Power Works"),
  prop(13, "Maple Row", "pink", 140, [10, 50, 150, 450, 625, 750], 100),
  prop(14, "Oak Row", "pink", 160, [12, 60, 180, 500, 700, 900], 100),
  railroad(15, "East Line"),
  prop(16, "Pine Way", "orange", 180, [14, 70, 200, 550, 750, 950], 100),
  { index: 17, name: "Community Chest", type: "chest" },
  prop(18, "Spruce Way", "orange", 180, [14, 70, 200, 550, 750, 950], 100),
  prop(19, "Aspen Way", "orange", 200, [16, 80, 220, 600, 800, 1000], 100),
  { index: 20, name: "Free Parking", type: "free-parking" },
  prop(21, "Coral Street", "red", 220, [18, 90, 250, 700, 875, 1050], 150),
  { index: 22, name: "Chance", type: "chance" },
  prop(23, "Pearl Street", "red", 220, [18, 90, 250, 700, 875, 1050], 150),
  prop(24, "Opal Street", "red", 240, [20, 100, 300, 750, 925, 1100], 150),
  railroad(25, "South Line"),
  prop(26, "Amber Square", "yellow", 260, [22, 110, 330, 800, 975, 1150], 150),
  prop(27, "Topaz Square", "yellow", 260, [22, 110, 330, 800, 975, 1150], 150),
  utility(28, "Water Works"),
  prop(29, "Jade Square", "yellow", 280, [24, 120, 360, 850, 1025, 1200], 150),
  { index: 30, name: "Go To Jail", type: "go-to-jail" },
  prop(31, "Ivory Hills", "green", 300, [26, 130, 390, 900, 1100, 1275], 200),
  prop(32, "Onyx Hills", "green", 300, [26, 130, 390, 900, 1100, 1275], 200),
  { index: 33, name: "Community Chest", type: "chest" },
  prop(34, "Quartz Hills", "green", 320, [28, 150, 450, 1000, 1200, 1400], 200),
  railroad(35, "West Line"),
  { index: 36, name: "Chance", type: "chance" },
  prop(37, "Summit Park", "darkblue", 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { index: 38, name: "Luxury Tax", type: "luxury-tax" },
  prop(39, "Beacon Park", "darkblue", 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

export const RAILROAD_RENT = [25, 50, 100, 200];
export const INCOME_TAX = 200;
export const LUXURY_TAX = 100;
export const JAIL_FINE = 50;
export const GO_SALARY = 200;

export type CardEffect =
  | { kind: "advance-to"; to: number; collectGo: boolean }
  | { kind: "go-to-jail" }
  | { kind: "cash"; amount: number }
  | { kind: "jail-card" }
  | { kind: "repairs"; perHouse: number; perHotel: number }
  | { kind: "nearest-railroad" }
  | { kind: "nearest-utility" };

export interface GameCard {
  id: string;
  summary: string;
  effect: CardEffect;
}

export const CHANCE_DECK: GameCard[] = [
  { id: "ch-advance-go", summary: "Advance to Go", effect: { kind: "advance-to", to: 0, collectGo: true } },
  { id: "ch-nearest-rail", summary: "Advance to nearest rail line", effect: { kind: "nearest-railroad" } },
  { id: "ch-nearest-util", summary: "Advance to nearest utility", effect: { kind: "nearest-utility" } },
  { id: "ch-jail", summary: "Go directly to Jail", effect: { kind: "go-to-jail" } },
  { id: "ch-jail-card", summary: "Get out of Jail free (kept)", effect: { kind: "jail-card" } },
  { id: "ch-bank-50", summary: "Bank pays you $50", effect: { kind: "cash", amount: 50 } },
  { id: "ch-pay-15", summary: "Pay $15", effect: { kind: "cash", amount: -15 } },
  { id: "ch-repairs", summary: "Street repairs due", effect: { kind: "repairs", perHouse: 25, perHotel: 100 } },
  { id: "ch-back-3", summary: "Go back 3 spaces", effect: { kind: "advance-to", to: -3, collectGo: false } },
  { id: "ch-illinois", summary: "Advance to Coral Street", effect: { kind: "advance-to", to: 21, collectGo: true } },
  { id: "ch-charles", summary: "Advance to Summit Park", effect: { kind: "advance-to", to: 37, collectGo: true } },
  { id: "ch-reading", summary: "Take a trip on the North Line", effect: { kind: "advance-to", to: 5, collectGo: true } },
  { id: "ch-dividend", summary: "Building loan matures: collect $150", effect: { kind: "cash", amount: 150 } },
  { id: "ch-chairman", summary: "Pay each player $50", effect: { kind: "cash", amount: -50 } },
  { id: "ch-speeding", summary: "Speeding fine $15", effect: { kind: "cash", amount: -15 } },
  { id: "ch-crossword", summary: "Crossword prize: collect $100", effect: { kind: "cash", amount: 100 } },
];

export const CHEST_DECK: GameCard[] = [
  { id: "cc-go", summary: "Advance to Go", effect: { kind: "advance-to", to: 0, collectGo: true } },
  { id: "cc-jail", summary: "Go directly to Jail", effect: { kind: "go-to-jail" } },
  { id: "cc-jail-card", summary: "Get out of Jail free (kept)", effect: { kind: "jail-card" } },
  { id: "cc-bank-200", summary: "Bank error in your favor: $200", effect: { kind: "cash", amount: 200 } },
  { id: "cc-bank-50", summary: "Collect $50", effect: { kind: "cash", amount: 50 } },
  { id: "cc-doctor", summary: "Doctor fee: pay $50", effect: { kind: "cash", amount: -50 } },
  { id: "cc-school", summary: "School fees: pay $50", effect: { kind: "cash", amount: -50 } },
  { id: "cc-hospital", summary: "Hospital fees: pay $100", effect: { kind: "cash", amount: -100 } },
  { id: "cc-repairs", summary: "Street repairs due", effect: { kind: "repairs", perHouse: 40, perHotel: 115 } },
  { id: "cc-holiday", summary: "Holiday fund matures: $100", effect: { kind: "cash", amount: 100 } },
  { id: "cc-insurance", summary: "Life insurance matures: $100", effect: { kind: "cash", amount: 100 } },
  { id: "cc-inherit", summary: "Inherit $100", effect: { kind: "cash", amount: 100 } },
  { id: "cc-sale", summary: "Sale of stock: $50", effect: { kind: "cash", amount: 50 } },
  { id: "cc-beauty", summary: "Beauty prize: $10", effect: { kind: "cash", amount: 10 } },
  { id: "cc-vote", summary: "Grand opera night: collect $50 from others", effect: { kind: "cash", amount: 50 } },
  { id: "cc-tax", summary: "Income tax refund: $20", effect: { kind: "cash", amount: 20 } },
];

export function purchasable(s: BoardSpace): boolean {
  return s.type === "property" || s.type === "railroad" || s.type === "utility";
}
