import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import {
  applyEngineAction,
  applySetGameMode,
  botChooseAction,
  createMatch,
  GAME_MODE_FOLLOW_ME,
  GAME_MODE_SEVENS,
  GAME_MODE_STRAIGHT,
  startNextHand,
  summarizeStateForSeat
} from "../shared/fortyTwo.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const clientDir = path.join(rootDir, "client");
const sharedDir = path.join(rootDir, "shared");

const PORT = Number(process.env.PORT || 8080);
const app = express();
app.use(express.static(clientDir));
app.use("/shared", express.static(sharedDir));
app.get("/", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Map();
const rooms = new Map();
let nextClientId = 1;

const RULE_BUBBLE_LINES = [
  "Hey, you can't do that.",
  "That move breaks table rules.",
  "I'm a Christian man, but that move ain't legal."
];

function makeBotName(seatIndex) {
  const names = ["Marshal Briggs", "Old Man Crow", "Harlan Pike", "Silas Boone"];
  return names[seatIndex] || `Bot ${seatIndex + 1}`;
}

function makeSeats() {
  return Array.from({ length: 4 }, (_, seatIndex) => ({
    seatIndex,
    kind: "bot",
    clientId: null,
    name: makeBotName(seatIndex),
    difficulty: 3
  }));
}

function send(ws, type, payload = {}) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function makeRoom(code, hostClientId) {
  const match = createMatch();
  match.phase = "lobby";
  match.message = "Room ready. Host can start the game.";
  return {
    code,
    hostClientId,
    match,
    seats: makeSeats(),
    clients: new Set(),
    botTimer: null,
    trickAdvanceTimer: null,
    handAdvanceTimer: null,
    createdAt: Date.now()
  };
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function roomSeatSummary(room) {
  return room.seats.map((s) => ({
    seatIndex: s.seatIndex,
    kind: s.kind,
    name: s.name,
    difficulty: s.kind === "bot" ? s.difficulty : undefined,
    connected: s.kind === "human"
  }));
}

function roomShareUrl(room) {
  return `/?room=${room.code}`;
}

function roomBroadcastState(room) {
  const summary = roomSeatSummary(room);
  for (const ws of room.clients) {
    const client = clients.get(ws);
    if (!client) continue;
    send(ws, "state", {
      ...summarizeStateForSeat(room.match, client.seatIndex, summary),
      roomCode: room.code,
      shareUrl: roomShareUrl(room),
      isHost: room.hostClientId === client.id,
      roomPlayerCount: room.clients.size
    });
  }
}

function randomRuleBubbleLine() {
  return RULE_BUBBLE_LINES[Math.floor(Math.random() * RULE_BUBBLE_LINES.length)];
}

function pickBubbleSeatIndex(offenderSeatIndex) {
  const seats = [0, 1, 2, 3];
  const options = Number.isInteger(offenderSeatIndex)
    ? seats.filter((s) => s !== offenderSeatIndex)
    : seats;
  const bag = options.length ? options : seats;
  return bag[Math.floor(Math.random() * bag.length)];
}

function broadcastRuleViolationBubble(room, offenderSeatIndex, errorMessage) {
  const seatIndex = pickBubbleSeatIndex(offenderSeatIndex);
  const text = randomRuleBubbleLine();
  for (const ws of room.clients) {
    send(ws, "ruleBubble", {
      seatIndex,
      text,
      ttlMs: 2600,
      reason: errorMessage
    });
  }
}

function currentActorSeat(room) {
  if (room.match.phase === "bidding") return room.match.bidTurn;
  if (room.match.phase === "chooseTrump") return room.match.highestBidder;
  if (room.match.phase === "playing") return room.match.turn;
  return null;
}

function sanitizeName(name, fallback = "Player") {
  const value = String(name || "").trim().slice(0, 24);
  return value || fallback;
}

function attachHumanToSeat(room, client, seatIndex, name) {
  const target = room.seats[seatIndex];
  if (!target) return { ok: false, error: "Invalid seat" };
  if (target.kind === "human" && target.clientId !== client.id) {
    return { ok: false, error: "Seat is already occupied" };
  }

  if (client.seatIndex != null && client.seatIndex !== seatIndex) {
    const oldSeat = room.seats[client.seatIndex];
    if (oldSeat) {
      oldSeat.kind = "bot";
      oldSeat.clientId = null;
      oldSeat.name = makeBotName(oldSeat.seatIndex);
    }
  }

  target.kind = "human";
  target.clientId = client.id;
  target.name = String(name || client.name || `Player ${client.id}`).slice(0, 24);
  client.name = target.name;
  client.seatIndex = seatIndex;
  return { ok: true };
}

function convertSeatToBot(room, seatIndex) {
  const seat = room.seats[seatIndex];
  if (!seat) return;
  seat.kind = "bot";
  seat.clientId = null;
  seat.name = makeBotName(seatIndex);
}

function maybeScheduleBotStep(room) {
  if (room.botTimer) clearTimeout(room.botTimer);
  if (room.trickAdvanceTimer) clearTimeout(room.trickAdvanceTimer);
  if (room.handAdvanceTimer) clearTimeout(room.handAdvanceTimer);
  room.botTimer = null;
  room.trickAdvanceTimer = null;
  room.handAdvanceTimer = null;

  if (room.clients.size === 0) return;

  if (room.match.phase === "trickPause") {
    room.trickAdvanceTimer = setTimeout(() => {
      applyEngineAction(room.match, 0, { type: "advanceTrick" });
      roomBroadcastState(room);
      maybeScheduleBotStep(room);
    }, 2200);
    return;
  }

  if (room.match.phase === "handOver") {
    room.handAdvanceTimer = setTimeout(() => {
      applyEngineAction(room.match, 0, { type: "advanceHand" });
      roomBroadcastState(room);
      maybeScheduleBotStep(room);
    }, 5000);
    return;
  }

  if (room.match.phase === "gameOver") return;

  const seatIndex = currentActorSeat(room);
  if (seatIndex == null) return;
  const seat = room.seats[seatIndex];
  if (!seat || seat.kind !== "bot") return;

  const phaseDelay =
    room.match.phase === "playing"
      ? 1150 + Math.floor(Math.random() * 1050)
      : 1450 + Math.floor(Math.random() * 1150);

  room.botTimer = setTimeout(() => {
    const action = botChooseAction(room.match, seatIndex, seat.difficulty);
    if (action) {
      applyEngineAction(room.match, seatIndex, action);
      roomBroadcastState(room);
    }
    maybeScheduleBotStep(room);
  }, phaseDelay);
}

function ensureHost(room) {
  if ([...room.clients].some((ws) => clients.get(ws)?.id === room.hostClientId)) return;
  const next = [...room.clients].map((ws) => clients.get(ws)).find(Boolean);
  room.hostClientId = next?.id ?? null;
}

function cleanupRoomIfEmpty(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  if (room.clients.size > 0) return;
  if (room.botTimer) clearTimeout(room.botTimer);
  if (room.trickAdvanceTimer) clearTimeout(room.trickAdvanceTimer);
  if (room.handAdvanceTimer) clearTimeout(room.handAdvanceTimer);
  rooms.delete(roomCode);
}

function leaveCurrentRoom(ws) {
  const client = clients.get(ws);
  if (!client || !client.roomCode) return;
  const room = rooms.get(client.roomCode);
  if (!room) {
    client.roomCode = null;
    client.seatIndex = null;
    return;
  }

  if (client.seatIndex != null) {
    convertSeatToBot(room, client.seatIndex);
  }
  room.clients.delete(ws);
  client.seatIndex = null;
  const oldRoomCode = client.roomCode;
  client.roomCode = null;
  ensureHost(room);
  roomBroadcastState(room);
  maybeScheduleBotStep(room);
  cleanupRoomIfEmpty(oldRoomCode);
}

function joinRoom(ws, roomCode, name) {
  const client = clients.get(ws);
  if (!client) return { ok: false, error: "Client missing" };

  const code = String(roomCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  if (!code) return { ok: false, error: "Room code is required" };
  const room = rooms.get(code);
  if (!room) return { ok: false, error: "Room not found" };

  leaveCurrentRoom(ws);
  if (name) client.name = String(name).slice(0, 24);
  client.roomCode = code;
  room.clients.add(ws);
  ensureHost(room);
  roomBroadcastState(room);
  maybeScheduleBotStep(room);
  return { ok: true, room };
}

function createAndJoinRoom(ws, name) {
  const client = clients.get(ws);
  if (!client) return { ok: false, error: "Client missing" };

  leaveCurrentRoom(ws);
  if (name) client.name = String(name).slice(0, 24);
  const code = generateRoomCode();
  const room = makeRoom(code, client.id);
  rooms.set(code, room);
  client.roomCode = code;
  client.seatIndex = null;
  room.clients.add(ws);
  roomBroadcastState(room);
  maybeScheduleBotStep(room);
  return { ok: true, room };
}

function roomForClient(ws) {
  const client = clients.get(ws);
  if (!client?.roomCode) return null;
  return rooms.get(client.roomCode) ?? null;
}

function handleClientAction(ws, msg) {
  const client = clients.get(ws);
  if (!client) return;

  if (msg.type === "setName") {
    client.name = sanitizeName(msg.name, client.name || `Player ${client.id}`);
    const room = roomForClient(ws);
    if (room && client.seatIndex != null) {
      const seat = room.seats[client.seatIndex];
      if (seat && seat.kind === "human" && seat.clientId === client.id) {
        seat.name = client.name;
      }
      roomBroadcastState(room);
    }
    return;
  }

  if (msg.type === "createRoom") {
    const result = createAndJoinRoom(ws, sanitizeName(msg.name, client.name || `Player ${client.id}`));
    if (!result.ok) send(ws, "error", { message: result.error });
    return;
  }

  if (msg.type === "joinRoom") {
    const result = joinRoom(ws, msg.roomCode, sanitizeName(msg.name, client.name || `Player ${client.id}`));
    if (!result.ok) send(ws, "error", { message: result.error });
    return;
  }

  const room = roomForClient(ws);
  if (!room) {
    send(ws, "error", { message: "Create or join a room first" });
    return;
  }

  if (msg.type === "claimSeat") {
    const seatIndex = Number(msg.seatIndex);
    const result = attachHumanToSeat(room, client, seatIndex, sanitizeName(msg.name, client.name || `Player ${client.id}`));
    if (!result.ok) send(ws, "error", { message: result.error });
    roomBroadcastState(room);
    maybeScheduleBotStep(room);
    return;
  }

  if (msg.type === "leaveSeat") {
    if (client.seatIndex != null) {
      convertSeatToBot(room, client.seatIndex);
      client.seatIndex = null;
      roomBroadcastState(room);
      maybeScheduleBotStep(room);
    }
    return;
  }

  if (msg.type === "setBotDifficulty") {
    const seatIndex = Number(msg.seatIndex);
    const diff = Math.max(1, Math.min(5, Number(msg.difficulty) || 3));
    const seat = room.seats[seatIndex];
    if (!seat || seat.kind !== "bot") {
      send(ws, "error", { message: "Seat is not a bot" });
      return;
    }
    seat.difficulty = diff;
    roomBroadcastState(room);
    maybeScheduleBotStep(room);
    return;
  }

  if (msg.type === "setGameMode") {
    if (room.hostClientId !== client.id) {
      send(ws, "error", { message: "Only the host can change game mode" });
      return;
    }
    const requested =
      msg.mode === GAME_MODE_FOLLOW_ME
        ? GAME_MODE_FOLLOW_ME
        : msg.mode === GAME_MODE_SEVENS
          ? GAME_MODE_SEVENS
          : GAME_MODE_STRAIGHT;
    const result = applySetGameMode(room.match, requested);
    if (!result.ok) {
      send(ws, "error", { message: result.error });
      return;
    }
    roomBroadcastState(room);
    maybeScheduleBotStep(room);
    return;
  }

  if (msg.type === "restartMatch") {
    if (room.hostClientId !== client.id) {
      send(ws, "error", { message: "Only the host can restart the match" });
      return;
    }
    room.match.roundWins = [0, 0];
    room.match.marks = [0, 0];
    room.match.scores = [0, 0];
    room.match.dealer = (room.match.dealer + 1) % 4;
    startNextHand(room.match);
    roomBroadcastState(room);
    maybeScheduleBotStep(room);
    return;
  }

  if (msg.type === "startMatch") {
    if (room.hostClientId !== client.id) {
      send(ws, "error", { message: "Only the host can start the match" });
      return;
    }
    if (room.match.phase !== "lobby") {
      send(ws, "error", { message: "Match already started" });
      return;
    }
    startNextHand(room.match);
    roomBroadcastState(room);
    maybeScheduleBotStep(room);
    return;
  }

  if (msg.type === "action") {
    if (client.seatIndex == null) {
      send(ws, "error", { message: "Claim a seat to play" });
      broadcastRuleViolationBubble(room, null, "Claim a seat to play");
      return;
    }
    const seat = room.seats[client.seatIndex];
    if (!seat || seat.kind !== "human" || seat.clientId !== client.id) {
      send(ws, "error", { message: "Seat ownership mismatch" });
      broadcastRuleViolationBubble(room, client.seatIndex, "Seat ownership mismatch");
      return;
    }
    const result = applyEngineAction(room.match, client.seatIndex, msg.action);
    if (!result.ok) {
      send(ws, "error", { message: result.error });
      broadcastRuleViolationBubble(room, client.seatIndex, result.error);
    }
    roomBroadcastState(room);
    maybeScheduleBotStep(room);
    return;
  }
}

wss.on("connection", (ws) => {
  const id = nextClientId++;
  const client = {
    id,
    name: `Player ${id}`,
    seatIndex: null,
    roomCode: null
  };
  clients.set(ws, client);
  send(ws, "welcome", { clientId: client.id });

  ws.on("message", (buf) => {
    try {
      const msg = JSON.parse(String(buf));
      handleClientAction(ws, msg);
    } catch {
      send(ws, "error", { message: "Bad message" });
    }
  });

  ws.on("close", () => {
    leaveCurrentRoom(ws);
    clients.delete(ws);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Domino 42 saloon server listening on 0.0.0.0:${PORT}`);
});
