# Rule Decisions and PRD Corrections

## PRD contradictions corrected (goal overrides PRD)

- Players: PRD says "Exactly 5", "Four-player games", "four seats",
  "fourth player joins becomes ready", "only host can start with four seats".
  Corrected to **2–5 players, min 2 to start, max 5** per goal §2.
  All lobbies, start checks, tests, and E2E use 2–5 (sixth rejected).
- Taxes: PRD §7.1 lists "4 tax spaces". Corrected to **2 tax spaces**
  (Income Tax $200, Luxury Tax $100) to total exactly 40 spaces.
- Board total stays 40: 22 properties + 4 railroads + 2 utilities +
  3 Chance + 3 Community Chest + 2 taxes + GO + Jail + Free Parking +
  Go To Jail = 40.
- Room lifecycle: PRD diagram "Four players and host starts" corrected to
  "min 2 players and host starts".

## Official-rules interpretations

- Starting cash $1,500; GO salary $200 (official classic amounts).
- Income Tax flat $200 (official 2023+ wording; classic 10%/$200 option
  simplified to flat $200 and documented in UI).
- Luxury Tax $100.
- Jail fine $50; 3 failed doubles then pay-and-move.
- Utility rent uses fresh dice on card/Go-To moves (x10 if both owned).
- Nearest-railroad card rent: 2x normal railroad rent for that trip.
- Street-repair fees: $25/house + $100/hotel (Chance), $40/house + $115/hotel
  (Community Chest) as standard-economy equivalents; documented in UI text.
- Mortgage interest 10% on repayment, rounded up.
- Bankruptcy to bank: properties return unowned; no immediate re-auction
  (auction happens on next landing decline or host-triggered future phase).
- No house rule: no Free Parking jackpot, no double-GO bonus, no loans.
- Dice authority: the backend rolls all dice with `crypto.randomInt` in
  production and ignores client-supplied values, so outcomes can never be
  chosen by a modified client. Client-supplied dice are honored only when
  `NODE_ENV` is not `production`, purely to keep automated tests
  deterministic; the engine itself always accepts injected dice for unit
  tests.

## Visual-asset policy

Original 2D board, tokens, icons, and card summaries only. No Hasbro text,
logos, artwork, or board illustrations reproduced.
