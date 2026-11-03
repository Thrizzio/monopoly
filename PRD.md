# Monopoly Online
## Technical Architecture & Implementation Specification

**Project type:** Private multiplayer browser game  
**Players:** Exactly 5 per game  
**Architecture:** Client-server, server-authoritative  
**Frontend:** React, TypeScript, Vite  
**Backend:** Node.js, Express, TypeScript  
**Real-time communication:** Socket.IO  
**Database:** PostgreSQL  
**ORM:** Prisma ORM  

---

# 1. Product Requirements

## 1.1 Core functionality

The application must support:

1. Creating multiplayer rooms.
2. Joining rooms using unique room codes.
3. Four-player games.
4. Anonymous persistent player identities.
5. A classic 40-space Monopoly board.
6. Standard Monopoly gameplay.
7. Real-time synchronization between all connected players.
8. Persistent room chat.
9. Game-state persistence.
10. Reconnection after browser refreshes, disconnections or temporary network failures.
11. Saving completed game records.

## 1.2 Explicit non-requirements

Do not implement:

- Google OAuth.
- Email authentication.
- Password-based accounts.
- Public matchmaking.
- Spectator mode in the initial release.
- AI opponents.
- In-game purchases.
- Payments.
- Voice or video chat.
- Multiple simultaneous games per player.

Keep the initial implementation focused.

---

# 2. System Architecture

Use a modular monolith.

The frontend and backend are separate applications within one repository. The backend owns game logic, room management, authentication, persistence and real-time communication.

The browser must never be trusted to calculate or authorize game outcomes.

## 2.1 High-level architecture

```text
                 INTERNET
                    |
                    v
             REACT FRONTEND
                    |
             HTTPS / WSS
                    |
                    v
          NODE.JS APPLICATION
          +---------------------+
          | Express REST API    |
          | Socket.IO Server    |
          +---------------------+
                    |
          +---------+----------+
          |         |          |
          v         v          v
       Identity   Room      Game Engine
       Service   Service   (Pure Logic)
          |         |          |
          +---------+----------+
                    |
                    v
               PostgreSQL
          +---------------------+
          | Players             |
          | Sessions            |
          | Rooms               |
          | Room Memberships    |
          | Games               |
          | Game Events         |
          | Chat Messages       |
          +---------------------+
```

## 2.2 Architectural principles

- The server is the single source of truth.
- All game actions are validated on the server.
- Game logic must be independent of React and Socket.IO.
- Database transactions protect important state changes.
- Socket.IO distributes updates, not game authority.
- Every important game transition is persisted.
- Disconnected players retain their seats.
- Reconnecting players receive the latest authoritative game state.

---

# 3. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React |
| Language | TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS |
| Backend | Node.js |
| HTTP server | Express |
| Real-time | Socket.IO |
| Database | PostgreSQL |
| ORM | Prisma ORM |
| Validation | Zod |
| Testing | Vitest |
| E2E testing | Playwright |
| Deployment | Vercel + Render |
| Database hosting | Neon |

Use npm workspaces or an equivalent monorepo setup.

Do not introduce additional frameworks without a concrete requirement.

---

# 4. Repository Structure

```text
monopoly-online/
|
+-- apps/
|   |
|   +-- web/
|   |   +-- src/
|   |       +-- components/
|   |       |   +-- board/
|   |       |   +-- players/
|   |       |   +-- chat/
|   |       |   +-- modals/
|   |       |   +-- controls/
|   |       |
|   |       +-- pages/
|   |       |   +-- HomePage.tsx
|   |       |   +-- LobbyPage.tsx
|   |       |   +-- GamePage.tsx
|   |       |
|   |       +-- hooks/
|   |       +-- stores/
|   |       +-- services/
|   |       +-- styles/
|   |       +-- types/
|   |
|   +-- server/
|       +-- src/
|           +-- api/
|           +-- auth/
|           +-- sockets/
|           +-- rooms/
|           +-- game/
|           |   +-- engine/
|           |   +-- rules/
|           |   +-- actions/
|           |   +-- cards/
|           |   +-- board/
|           |
|           +-- services/
|           +-- database/
|           +-- middleware/
|           +-- config/
|           +-- tests/
|
+-- packages/
|   +-- shared/
|       +-- types/
|       +-- schemas/
|       +-- constants/
|
+-- package.json
+-- README.md
+-- .env.example
```

The `shared` package contains common types, event contracts and validation schemas. It must not contain trusted game logic that clients can use to authorize actions.

---

# 5. Anonymous Player Identity

There is no traditional registration system.

Every browser receives an anonymous persistent identity.

## 5.1 First visit

1. The browser requests a player identity.
2. The backend generates a UUID for the player.
3. The backend generates a cryptographically secure random session token.
4. Only a hash of the session token is stored in the database.
5. The raw token is returned in an HttpOnly cookie.
6. The player selects a nickname.

Cookie configuration:

- HttpOnly: true
- Secure: true in production
- SameSite: Lax
- Path: /
- Expiration: 30 days, with session renewal on activity

Do not store authentication tokens in localStorage.

## 5.2 Returning visit

1. The browser automatically sends its cookie.
2. The server validates the session.
3. The server retrieves the associated player.
4. The player profile is restored.
5. The player can rejoin an existing room.

## 5.3 Player profile

Fields:

- ID
- Nickname
- Created timestamp
- Last seen timestamp
- Profile settings

Nicknames must be validated, trimmed and limited to 20 characters.

Do not expose session tokens or session hashes to clients.

---

# 6. Room Management

## 6.1 Room creation

A player clicks Create Room.

The backend:

1. Authenticates the player.
2. Generates a unique random room code.
3. Creates a room in the database.
4. Assigns the creator as host.
5. Assigns the creator seat number 1.
6. Returns the room code.

Room codes should be 6–8 characters, generated using a cryptographically secure random generator. Avoid ambiguous characters such as O, 0, I and 1.

## 6.2 Joining a room

A player enters a room code.

The server verifies:

- The room exists.
- The room is waiting for players.
- The room has an available seat.
- The player is not already occupying another seat.
- The room has not been closed.

Maximum capacity: 5 players.

When the fourth player joins, the lobby becomes ready.

## 6.3 Host privileges

The host can:

- Start the game.
- Remove players from a waiting lobby.
- Close the room before the game begins.

The host cannot arbitrarily modify money, properties, dice rolls or other game state.

## 6.4 Room lifecycle

```text
WAITING
   |
   | Four players and host starts
   v
IN_PROGRESS
   |
   +------> COMPLETED
   |
   +------> ABANDONED
```

A player disconnecting must not automatically destroy the room.

A room should remain recoverable while its game is in progress.

---

# 7. Monopoly Game Engine

This is the most important part of the application.

Create a standalone TypeScript game engine that has no dependency on React, Express, Socket.IO or prisma.

It should accept a current game state and a validated action, then return a new game state and a list of resulting events.

Example:

```ts
function processAction(
  state: GameState,
  action: GameAction
): GameResult
```

The function must be deterministic for a given state and action, except for randomness explicitly injected into dice and card-draw operations.

The engine must never mutate its input state.

## 7.1 Board configuration

Implement the standard 40-space board using a data-driven configuration.

Space categories:

- 22 properties
- 4 railroads
- 2 utilities
- 3 Chance spaces
- 3 Community Chest spaces
- 4 tax spaces
- GO
- Jail / Just Visiting
- Free Parking
- Go To Jail

Each space should contain:

- ID
- Board position
- Name
- Space type
- Purchase price, where applicable
- Base rent, where applicable
- Color group, where applicable
- Building prices, where applicable
- Mortgage value, where applicable

Store the board configuration separately from the engine.

## 7.2 Player state

Each player should have:

- Player ID
- Seat number
- Token
- Current board position
- Cash balance
- Owned properties
- Jail status
- Jail turns remaining
- Get Out of Jail Free cards
- Bankruptcy status
- Connection status

Starting cash: $1,500 per player.

Starting position: GO.

## 7.3 Property state

Each purchasable space should track:

- Owner
- Mortgage status
- House count
- Hotel status

The server calculates all rent.

The client only displays calculated values.

## 7.4 Turn state machine

A player's turn should follow an explicit state machine.

```text
TURN_START
    |
    v
ROLL_DICE
    |
    v
PROCESS_MOVEMENT
    |
    v
RESOLVE_LANDING
    |
    +---- Unowned property
    |          |
    |          v
    |      BUY OR AUCTION
    |
    +---- Owned property
    |          |
    |          v
    |       PAY RENT
    |
    +---- Chance / Chest
    |          |
    |          v
    |      DRAW CARD
    |
    +---- Other space
               |
               v
          RESOLVE EFFECT
               |
               v
          END TURN
```

A turn must not advance until all mandatory actions are completed.

## 7.5 Standard rules

Implement the following:

### Dice and movement

- Two six-sided dice.
- Movement based on the sum.
- Doubles grant another roll.
- Three consecutive doubles send the player to jail.
- Passing GO awards $200.
- Movement must correctly handle jail and card-based movement.

### Property purchases

- Unowned property can be purchased at its printed price.
- If the player declines, the property must go to auction.
- Auctions allow all non-bankrupt players to participate.
- The highest valid bidder wins.
- The server validates bids and available funds.

### Rent

- Rent is calculated from the property's current ownership and development state.
- Railroads use the number owned by the same player.
- Utilities use dice results and railroad-independent utility rules.
- A complete color group doubles unimproved property rent.
- Mortgaged properties do not collect rent.

### Buildings

- A player must own an entire color group.
- Houses must be built evenly.
- A maximum of four houses per property.
- Hotels replace four houses.
- Building availability must respect the finite bank supply.

### Jail

Players can:

- Pay the release fee.
- Use a Get Out of Jail Free card.
- Attempt doubles.

Implement the standard limits on jail turns and release.

### Chance and Community Chest

Implement the complete standard card sets as structured data.

Cards should have typed effects, not arbitrary executable JavaScript.

### Taxes and utilities

Implement standard board-space effects and payment calculations.

### Mortgages

- Players can mortgage eligible properties.
- Mortgaged properties do not collect rent.
- Repayment requires the mortgage principal and applicable interest.
- Buildings must be sold before properties in a color group can be mortgaged, according to standard rules.

### Bankruptcy

- Bankruptcy to another player transfers eligible assets to that creditor.
- Bankruptcy to the bank returns properties for auction.
- A bankrupt player is eliminated.
- The game ends when only one player remains solvent.

### Trading

Allow players to propose trades involving:

- Cash
- Unmortgaged properties
- Mortgaged properties
- Get Out of Jail Free cards

Both players must explicitly accept before the trade executes.

The server must revalidate the trade immediately before execution.

---

# 8. Game State and Persistence

Use PostgreSQL as the persistent source of truth.

## 8.1 Persistence strategy

Store:

1. A complete game-state snapshot.
2. An append-only game event history.
3. Chat messages.
4. Room and player membership information.

Use JSONB for game snapshots because the game state is a structured aggregate that changes as gameplay progresses.

Use relational tables for identities, rooms, memberships and messages.

## 8.2 Database schema

### players

- id: UUID primary key
- nickname: varchar(20)
- created_at: timestamp
- last_seen_at: timestamp

### sessions

- id: UUID primary key
- player_id: UUID foreign key
- token_hash: varchar
- expires_at: timestamp
- created_at: timestamp

### rooms

- id: UUID primary key
- room_code: varchar unique
- host_player_id: UUID
- status: enum
- created_at: timestamp
- updated_at: timestamp

### room_players

- room_id: UUID foreign key
- player_id: UUID foreign key
- seat_number: integer
- is_connected: boolean
- joined_at: timestamp

Unique constraints:

- Unique (room_id, player_id)
- Unique (room_id, seat_number)

### games

- id: UUID primary key
- room_id: UUID foreign key
- status: enum
- current_turn_player_id: UUID
- current_state: JSONB
- state_version: integer
- created_at: timestamp
- updated_at: timestamp
- completed_at: timestamp nullable

### game_events

- id: UUID primary key
- game_id: UUID foreign key
- sequence_number: integer
- actor_player_id: UUID nullable
- event_type: varchar
- payload: JSONB
- created_at: timestamp

Unique constraint: (game_id, sequence_number).

### chat_messages

- id: UUID primary key
- room_id: UUID foreign key
- player_id: UUID foreign key
- message: varchar(500)
- created_at: timestamp

## 8.3 Atomic game updates

Every game command must be processed in a database transaction.

1. Lock the relevant game row.
2. Retrieve the current state.
3. Verify the player's authority.
4. Validate the action.
5. Run the game engine.
6. Save the updated snapshot.
7. Increment the state version.
8. Append the resulting game events.
9. Commit the transaction.
10. Broadcast the new state to the room.

Never broadcast an update before the transaction commits.

Use database row locking or equivalent concurrency control to prevent simultaneous commands from corrupting game state.

---

# 9. Real-Time Communication

Use Socket.IO.

Each room maps to a Socket.IO room.

Example:

```ts
socket.join(`room:${roomId}`);
```

Only authenticated room members may subscribe to that room's private game updates.

## 9.1 Client-to-server events

### Room events

- room:create
- room:join
- room:leave
- room:start
- room:rejoin

### Game events

- game:rollDice
- game:buyProperty
- game:declineProperty
- game:placeBid
- game:buildHouse
- game:sellBuilding
- game:mortgageProperty
- game:unmortgageProperty
- game:proposeTrade
- game:acceptTrade
- game:rejectTrade
- game:payJailFine
- game:useJailCard
- game:attemptJailDoubles
- game:endTurn

### Chat events

- chat:send

## 9.2 Server-to-client events

- room:created
- room:updated
- room:playerJoined
- room:playerLeft
- game:started
- game:stateUpdated
- game:actionRejected
- game:playerDisconnected
- game:playerReconnected
- game:completed
- chat:messageReceived

## 9.3 Event payloads

Every game action should include:

```ts
interface GameCommand {
  commandId: string;
  roomId: string;
  expectedVersion: number;
  action: GameAction;
}
```

The server derives the player identity from the authenticated socket session.

Never accept a client-supplied player ID as proof of identity.

Use command IDs for idempotency so retries do not execute purchases, payments or trades twice.

## 9.4 Synchronization

The server broadcasts an authoritative state update after each successful game action.

Each update includes:

- State version
- Current turn
- Player positions
- Player balances
- Property ownership
- Pending action
- Relevant game events

Clients should ignore stale versions and request a fresh snapshot if they detect a version gap.

---

# 10. Chat System

Chat is available throughout the lobby and game.

Requirements:

- Persistent messages.
- Sender nickname.
- Timestamp.
- Real-time delivery.
- Maximum message length of 500 characters.
- Basic rate limiting.
- Server-side validation.
- HTML escaping or safe text rendering.

Chat messages must be scoped to a room.

A player must not be able to read messages from rooms they have not joined.

Load the latest 50 messages when a player enters a room. Support pagination for older messages.

Chat is independent of the game engine. A chat message must never modify game state.

---

# 11. Reconnection and Recovery

This is a core requirement, not a future enhancement.

## 11.1 Temporary disconnection

When a player disconnects:

1. Mark them as disconnected.
2. Keep their seat reserved.
3. Notify other players.
4. Do not automatically end their turn.
5. Keep the game running according to the turn rules.

Use a configurable reconnect grace period, initially 5 minutes.

## 11.2 Reconnection

When a player reconnects:

1. Validate their anonymous session.
2. Find their active room membership.
3. Rejoin the Socket.IO room.
4. Retrieve the latest game snapshot.
5. Send the snapshot and recent chat history.
6. Restore their player interface.

## 11.3 Server restart

The server must recover active games from PostgreSQL.

In-memory Socket.IO rooms are temporary transport state, not persistent game storage.

After restarting, players should be able to reconnect and continue the saved game.

---

# 12. Security and Reliability

The application is public, even though the games are intended for friends.

Implement:

- Secure random session tokens.
- Hashed session storage.
- HttpOnly cookies.
- Input validation with Zod.
- Rate limiting on room creation and joining.
- Chat rate limiting.
- Nickname validation.
- Room membership authorization.
- Server-side game validation.
- Protection against duplicate commands.
- Database transactions.
- Environment-variable-based secrets.
- HTTPS in production.
- Origin checks for Socket.IO connections.
- Safe rendering of chat messages.

A room code is an invitation identifier, not an authentication credential.

Never allow a user to manipulate money, dice, property ownership, player positions or turn order through client-side state.

---

# 13. Frontend Design Specification

Desktop-first, responsive implementation.

## 13.1 Home page

Components:

- Application logo and title.
- Nickname entry.
- Create Room button.
- Join Room button.
- Room code input.
- Player identity restoration.

## 13.2 Lobby

Components:

- Room code with copy action.
- Four player seats.
- Player nicknames.
- Connection indicators.
- Host indicator.
- Start Game button.
- Waiting-for-players status.

Only the host can start the game, and only when all four seats are occupied.

## 13.3 Game interface

Main layout:

```text
+-----------------------------------------------+
| Room Code              Current Turn           |
+------------------------------+----------------+
|                              |                |
|                              |   PLAYER LIST  |
|                              |                |
|       MONOPOLY BOARD         |----------------|
|                              |                |
|       40 BOARD SPACES        |      CHAT      |
|                              |                |
|                              |                |
+------------------------------+----------------+
|                                               |
|         CURRENT PLAYER CONTROLS               |
|                                               |
+-----------------------------------------------+
```

The board is the primary visual element.

The right sidebar contains player information and chat.

The bottom action area displays contextual controls based on the current game state.

## 13.4 Visual requirements

- Clear distinction between four player tokens.
- Visible property ownership indicators.
- Houses and hotels displayed on properties.
- Animated dice rolls.
- Token movement animations.
- Purchase and rent notifications.
- Trade modal.
- Auction interface.
- Jail interface.
- Bankruptcy confirmation.
- Clear indication of whose turn it is.

Do not allow animations to control or delay the actual game state.

The UI should always be able to reconstruct itself from the latest server snapshot.

---

# 14. API Specification

REST endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/identity | Create or restore identity |
| PATCH | /api/identity/nickname | Update nickname |
| POST | /api/rooms | Create room |
| POST | /api/rooms/:code/join | Join room |
| GET | /api/rooms/:code | Retrieve room information |
| GET | /api/rooms/:code/game | Retrieve game snapshot |
| GET | /api/rooms/:code/chat | Retrieve chat history |
| POST | /api/rooms/:code/leave | Leave room |

Game actions should use Socket.IO rather than REST.

The API must derive the current player from the authenticated session.

---

# 15. Deployment Architecture

Frontend:
- Deploy to Vercel.

Backend:
- Deploy to Render as a persistent Node.js web service.
- Use WebSocket support.
- Do not deploy Socket.IO through serverless functions.

Database:
- Use Neon PostgreSQL.
- Configure DATABASE_URL through environment variables.
- Run prisma migrations during deployment.

Environment variables:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=
SESSION_SECRET=
CLIENT_ORIGIN=
```

For the initial version, use one backend instance.

Do not add Redis or a Socket.IO cluster adapter until there is an actual need to scale horizontally.

---

# 16. Testing Requirements

The game engine must be tested independently.

## Unit tests

- Dice rolling.
- Movement.
- Passing GO.
- Doubles.
- Three consecutive doubles.
- Property purchases.
- Auction resolution.
- Rent calculations.
- Railroad rent.
- Utility rent.
- Jail.
- Chance cards.
- Community Chest cards.
- Building restrictions.
- Mortgages.
- Trading.
- Bankruptcy.
- Win conditions.

## Integration tests

- Create room.
- Join room.
- Reject a fifth player.
- Reject joining an active game as a new seat.
- Start game with four players.
- Reject unauthorized game actions.
- Prevent duplicate commands.
- Persist game state.
- Restore game after server restart.
- Restore player after reconnect.
- Preserve chat history.

## End-to-end tests

Use four independent browser contexts.

Test a complete game from room creation through completion.

Verify that all four browsers see consistent player positions, cash balances, properties and turns.

---

# 17. Implementation Milestones

## Phase 1: Project foundation
- Initialize monorepo.
- Configure React, Vite and Tailwind.
- Configure Express and TypeScript.
- Configure PostgreSQL and Prisma.
- Establish shared types and validation.

**Acceptance:** Frontend, backend and database run successfully.

## Phase 2: Identity and rooms
- Anonymous identities.
- Persistent sessions.
- Nicknames.
- Room creation.
- Room joining.
- Four-seat lobby.
- Host controls.

**Acceptance:** Four independent browsers can join the same room.

## Phase 3: Board and game engine
- Complete board configuration.
- Player state.
- Dice and movement.
- Property ownership.
- Rent.
- Purchases.
- Auctions.
- Jail.
- Cards.
- Buildings.
- Mortgages.
- Trading.
- Bankruptcy.

**Acceptance:** The game engine passes its rule tests without requiring the frontend.

## Phase 4: Multiplayer gameplay
- Socket.IO integration.
- Authoritative game commands.
- Real-time state synchronization.
- Turn management.
- Chat.

**Acceptance:** Four players can play together with consistent game state.

## Phase 5: Persistence and recovery
- Game snapshots.
- Event history.
- Persistent chat.
- Reconnection.
- Server restart recovery.

**Acceptance:** A game survives browser refreshes and backend restarts.

## Phase 6: UI and deployment
- Complete board interface.
- Animations.
- Contextual controls.
- Error handling.
- Responsive design.
- Production deployment.

**Acceptance:** Four friends can play a complete game through the deployed website.

---

# 18. Definition of Done

The project is complete when:

1. Four friends can access the public website.
2. Each can establish a persistent anonymous identity.
3. One can create a room and share a code.
4. The other three can join.
5. The host can start the game.
6. All four see the same board and game state.
7. Standard Monopoly actions work correctly.
8. Players can chat in real time.
9. All important game data persists.
10. Players can reconnect without losing their seats.
11. The server can restart without destroying active games.
12. A complete game can be played until one player wins.

**Priority:** Correct gameplay, persistence and synchronization before animations and visual polish.