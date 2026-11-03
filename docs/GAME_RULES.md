# Classic Monopoly Rules (implementation baseline)

Source baseline: official Hasbro Classic Monopoly rulebook. Paraphrased here;
no card text, artwork, or board illustrations reproduced.

## Players, cash, win

- 2–5 players per game. Each starts with $1,500 at GO (position 0).
- Last solvent player wins. Bankruptcy eliminates a player.
- Bankruptcy to a creditor transfers cash, unmortgaged properties,
  mortgaged properties (mortgage stays, no immediate interest in this
  implementation), and Get-Out-of-Jail cards to that creditor.
- Bankruptcy to the bank returns properties to the bank unowned and
  unactioned; houses/hotels dissolve. Game continues until one remains.

## Turn order, dice, doubles

- Turn order follows seat number ascending, skipping bankrupt/eliminated
  players. `currentTurnPlayerId` advances only via `endTurn`.
- Two six-sided dice. Move forward by the sum, wrapping past GO.
- Passing or landing on GO awards $200.
- Doubles grant another roll in the same turn (`doublesCount`).
- Three consecutive doubles send the player directly to Jail
  (position 10, `inJail=true`), ending movement.
- Deterministic injected randomness: engine accepts explicit dice values;
  server uses `crypto.randomInt`. Clients never roll.

## Jail

- Spaces: Jail/Just Visiting (10, landing by dice = visiting), Go To Jail (30).
- Entering via Go To Jail, triple doubles, or card: position=10, `inJail=true`,
  `jailTurns=0`, turn ends.
- While jailed, on the player's turn they may, in order of choice:
  1. Pay $50 fine (`payJailFine`) and roll normally; or
  2. Use a Get-Out-of-Jail card (`useJailCard`); or
  3. Attempt doubles (`attemptJailDoubles` with injected dice):
     doubles free the player and move them; failure increments `jailTurns`.
- After 3 failed attempts the player must pay $50 and moves by the third roll
  (official rule). `jailTurns` resets on release.

## Board (40 spaces)

- GO (0), Jail/Just Visiting (10), Free Parking (20, no effect),
  Go To Jail (30).
- 22 color-group properties, 4 railroads, 2 utilities.
- 3 Chance (7, 22, 36), 3 Community Chest (2, 17, 33).
- 2 taxes: Income Tax (4, $200) and Luxury Tax (38, $100).
- Full layout, prices, rents, and colors live in `packages/shared/src/board.ts`.

## Purchases and auctions

- Unowned purchasable landing offers `buyProperty` at printed price,
  or `declineProperty` which opens an auction.
- Auctions accept `placeBid` from any non-bankrupt player; highest valid bid
  wins. Minimum bid $1; bids validated against funds at execution.
- Server validates ownership, funds, and turn authority.

## Rent

- Unimproved color-group property where owner holds the full group: 2x base.
- Houses/hotels use the property's rent table by building count.
- Railroads: 25 / 50 / 100 / 200 by count owned by same player.
- Utilities: dice roll x4 (one owned) or x10 (both owned). Card/Go-To-Jail
  moves still roll fresh dice for utility rent.
- Mortgaged properties collect no rent. Jail status does not block collection.

## Buildings

- Full color-group ownership required, no mortgaged member, even-building
  rule (max difference of 1 across the group), max 4 houses then hotel.
- Costs from board config. Finite bank: 32 houses, 12 hotels.
- `sellBuilding` returns half price; hotels break into 4 houses on sell-down.
- All members must be unmortgaged and buildings sold evenly before mortgage.

## Mortgages

- `mortgageProperty` pays owner the mortgage value; rent disabled.
- `unmortgageProperty` costs mortgage value + 10% interest (rounded up).
- Buildings must be sold first (evenly) before mortgaging a group member.

## Trading

- Propose cash + unmortgaged/mortgaged properties + jail cards.
- Both parties explicitly accept; server revalidates ownership/funds/cards
  immediately before execution. No forced trades.

## Cards

- 16 Chance + 16 Community Chest effects as typed data in `board.ts`.
- Effects: move (with GO credit), move-to-nearest (railroad/utility with
  rent rules), go-to-jail, get-out-of-jail (kept), cash in/out, per-house/hotel
  repair fees ($25/$100 Chance street repairs in this implementation),
  advance-to-GO. No copyrighted text reproduced; original summaries used.

## Edge cases

- Insufficient funds for debt: player may mortgage/sell/trade before paying;
  unresolved debt bankrupts them to the creditor or bank.
- Invalid actions rejected: out-of-turn, wrong phase, insufficient funds,
  unauthorized seat, stale `expectedVersion`.
- Disconnects keep seats; game continues. Reconnect restores snapshot.
- Animations never gate authoritative progression.
