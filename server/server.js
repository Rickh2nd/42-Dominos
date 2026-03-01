import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  CONFIG_DEFAULTS,
  MODES,
  PHASES,
  activeSeatsForMode,
  buildShuffledDeck,
  computeChampsTeam,
  computeLegalBids,
  computeLegalPlays,
  computeTargetThisHand,
  cpuDecide,
  dealHands,
  evaluateHandOutcome,
  findTileInHand,
  forcedDealerBidState,
  getTeam,
  makeBidSummary,
  nextActiveSeat,
  nextSeat,
  otherTeam,
  resolveTrick,
  sevensRoundResult,
  updateRoundWinsAndMarks
} from '../shared/fortyTwo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const app = express();
app.use(express.static(path.join(ROOT_DIR, 'client')));
app.use('/shared', express.static(path.join(ROOT_DIR, 'shared')));
app.use('/node_modules', express.static(path.join(ROOT_DIR, 'node_modules')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, now: Date.now() });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'client', 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();
const clients = new Map();
let clientCounter = 1;

const PORT = Number(process.env.PORT || 8080);

function makeClientId() {
  const id = `c${clientCounter}`;
  clientCounter += 1;
  return id;
}

function normalizeRoomId(raw) {
  if (!raw || typeof raw !== 'string') {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10) || Math.random().toString(36).slice(2, 8).toUpperCase();
}

function makeSeat(seatIndex) {
  return {
    seatIndex,
    occupantClientId: null,
    type: 'human',
    cpuLevel: 1,
    avatarId: null,
    name: `Seat ${seatIndex + 1}`
  };
}

function createRoom(roomId, hostClientId) {
  return {
    roomId,
    hostClientId,
    clientIds: new Set([hostClientId]),
    config: { ...CONFIG_DEFAULTS },
    seats: [0, 1, 2, 3].map(makeSeat),
    phase: PHASES.LOBBY,
    dealerSeat: 0,
    turnSeat: 0,
    bidderSeat: null,
    bidValue: null,
    mode: null,
    trumpSuit: null,
    contract: null,
    bidHistory: [],
    bidTurnIndex: 0,
    biddingOrder: [],
    activeSeats: [0, 1, 2, 3],
    trick: [],
    trickHistory: [],
    played: [],
    pointsThisHand: { teamA: 0, teamB: 0 },
    targetThisHand: { teamA: 0, teamB: 0 },
    roundWins: { teamA: 0, teamB: 0 },
    gameMarks: { teamA: 0, teamB: 0 },
    champsTeam: null,
    burnPiles: { teamA: [], teamB: [] },
    hands: { 0: [], 1: [], 2: [], 3: [] },
    handNumber: 0,
    sevensState: null,
    sevensResult: null,
    lastHandOutcome: null,
    pendingCpuTimer: null,
    trickPauseTimer: null,
    handOverTimer: null
  };
}

function send(ws, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function sendError(clientId, action, message) {
  const client = clients.get(clientId);
  if (!client) return;
  send(client.ws, {
    type: 'error',
    action,
    message
  });
}

function controlledSeatForClient(room, clientId) {
  return room.seats.filter((seat) => seat.occupantClientId === clientId).map((seat) => seat.seatIndex);
}

function roomPublicSnapshot(room, viewerClientId) {
  const handCounts = {
    0: room.hands[0]?.length || 0,
    1: room.hands[1]?.length || 0,
    2: room.hands[2]?.length || 0,
    3: room.hands[3]?.length || 0
  };

  const viewerSeats = controlledSeatForClient(room, viewerClientId);
  const hands = {};
  for (const seatIndex of viewerSeats) {
    const seat = room.seats[seatIndex];
    if (seat?.type === 'human') {
      hands[seatIndex] = (room.hands[seatIndex] || []).map((tile) => ({ ...tile }));
    }
  }

  return {
    roomId: room.roomId,
    hostClientId: room.hostClientId,
    localClientId: viewerClientId,
    seats: room.seats.map((seat) => ({ ...seat })),
    phase: room.phase,
    dealerSeat: room.dealerSeat,
    turnSeat: room.turnSeat,
    bidderSeat: room.bidderSeat,
    bidValue: room.bidValue,
    mode: room.mode,
    trumpSuit: room.trumpSuit,
    hands,
    handCounts,
    trick: room.trick.map((play) => ({
      seatIndex: play.seatIndex,
      tile: { ...play.tile }
    })),
    played: room.played.map((play) => ({
      seatIndex: play.seatIndex,
      tile: { ...play.tile }
    })),
    pointsThisHand: { ...room.pointsThisHand },
    targetThisHand: { ...room.targetThisHand },
    roundWins: { ...room.roundWins },
    gameMarks: { ...room.gameMarks },
    champsTeam: room.champsTeam,
    burnPiles: {
      teamA: room.burnPiles.teamA.map((tile) => ({ ...tile })),
      teamB: room.burnPiles.teamB.map((tile) => ({ ...tile }))
    },
    bidHistory: room.bidHistory.map((entry) => ({ ...entry })),
    bidBySeat: makeBidSummary(room.bidHistory),
    sevensState: room.sevensState ? { ...room.sevensState } : null,
    contract: room.contract ? { ...room.contract } : null,
    activeSeats: [...room.activeSeats],
    handNumber: room.handNumber,
    lastHandOutcome: room.lastHandOutcome ? { ...room.lastHandOutcome } : null
  };
}

function broadcastRoom(room) {
  for (const clientId of room.clientIds) {
    const client = clients.get(clientId);
    if (!client) continue;
    send(client.ws, {
      type: 'snapshot',
      room: roomPublicSnapshot(room, clientId)
    });
  }
}

function clearRoomTimers(room) {
  if (room.pendingCpuTimer) {
    clearTimeout(room.pendingCpuTimer);
    room.pendingCpuTimer = null;
  }
  if (room.trickPauseTimer) {
    clearTimeout(room.trickPauseTimer);
    room.trickPauseTimer = null;
  }
  if (room.handOverTimer) {
    clearTimeout(room.handOverTimer);
    room.handOverTimer = null;
  }
}

function seatByIndex(room, seatIndex) {
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 3) return null;
  return room.seats[seatIndex];
}

function canControlSeat(room, seatIndex, clientId, internal = false) {
  const seat = seatByIndex(room, seatIndex);
  if (!seat) return false;
  if (internal) return true;
  if (seat.type === 'human') {
    return seat.occupantClientId === clientId;
  }
  if (seat.type === 'cpu') {
    return room.hostClientId === clientId;
  }
  return false;
}

function actorSeatForAction(room, action) {
  if (action === 'submitBid' || action === 'playTile') {
    return room.turnSeat;
  }
  if (action === 'chooseMode' || action === 'chooseTrump') {
    return room.bidderSeat;
  }
  return null;
}

function ensureHost(room, clientId, action) {
  if (room.hostClientId !== clientId) {
    sendError(clientId, action, 'Only host can perform this action.');
    return false;
  }
  return true;
}

function handIsFinished(room) {
  if (room.mode === MODES.SEVENS && room.sevensResult) return true;
  return room.activeSeats.every((seat) => (room.hands[seat] || []).length === 0);
}

function prepareSeatsForGame(room) {
  for (const seat of room.seats) {
    if (seat.type === 'human' && !seat.occupantClientId) {
      seat.type = 'cpu';
      seat.cpuLevel = Number.isInteger(seat.cpuLevel) ? seat.cpuLevel : 1;
      if (!seat.name || seat.name.startsWith('Seat ')) {
        seat.name = `CPU ${seat.seatIndex + 1}`;
      }
    }

    if (seat.type === 'cpu') {
      seat.occupantClientId = null;
      seat.cpuLevel = Math.max(0, Math.min(4, Number(seat.cpuLevel) || 1));
      if (!seat.name || seat.name.startsWith('Seat ')) {
        seat.name = `CPU ${seat.seatIndex + 1}`;
      }
    }
  }
}

function startNewHand(room, { resetMarks = false } = {}) {
  clearRoomTimers(room);

  if (resetMarks) {
    room.roundWins = { teamA: 0, teamB: 0 };
    room.gameMarks = { teamA: 0, teamB: 0 };
    room.champsTeam = null;
    room.handNumber = 0;
  }

  prepareSeatsForGame(room);

  const deck = buildShuffledDeck();
  room.hands = dealHands(deck, [0, 1, 2, 3], 7);

  room.phase = PHASES.BIDDING;
  room.bidderSeat = null;
  room.bidValue = null;
  room.mode = null;
  room.trumpSuit = null;
  room.contract = null;
  room.bidHistory = [];
  room.trick = [];
  room.trickHistory = [];
  room.played = [];
  room.pointsThisHand = { teamA: 0, teamB: 0 };
  room.targetThisHand = { teamA: 0, teamB: 0 };
  room.burnPiles = { teamA: [], teamB: [] };
  room.activeSeats = [0, 1, 2, 3];
  room.sevensState = null;
  room.sevensResult = null;
  room.lastHandOutcome = null;

  const first = nextSeat(room.dealerSeat);
  room.biddingOrder = [first, nextSeat(first), nextSeat(nextSeat(first)), room.dealerSeat];
  room.bidTurnIndex = 0;
  room.turnSeat = room.biddingOrder[0];
  room.handNumber += 1;
}

function finalizeBidding(room) {
  const numericBids = room.bidHistory.filter((entry) => Number.isInteger(entry.bid));

  if (numericBids.length === 0) {
    const forced = forcedDealerBidState(room, room.config);
    room.bidderSeat = forced.bidderSeat;
    room.bidValue = forced.bidValue;
    room.mode = MODES.TRUMPS;
    room.trumpSuit = null;
    room.contract = {
      bidderSeat: room.bidderSeat,
      bidValue: room.bidValue,
      mode: MODES.TRUMPS,
      trumpSuit: null
    };
    room.targetThisHand = computeTargetThisHand(room.bidderSeat, room.bidValue);
    room.phase = PHASES.CHOOSE_TRUMP;
    room.turnSeat = room.bidderSeat;
    return;
  }

  numericBids.sort((a, b) => b.bid - a.bid);
  const top = numericBids[0];

  room.bidderSeat = top.seatIndex;
  room.bidValue = top.bid;
  room.mode = null;
  room.trumpSuit = null;
  room.contract = {
    bidderSeat: room.bidderSeat,
    bidValue: room.bidValue,
    mode: null,
    trumpSuit: null
  };
  room.targetThisHand = computeTargetThisHand(room.bidderSeat, room.bidValue);
  room.phase = PHASES.CHOOSE_MODE;
  room.turnSeat = room.bidderSeat;
}

function enterPlayingPhase(room) {
  room.activeSeats = activeSeatsForMode(room.mode, room.bidderSeat);
  room.trick = [];
  room.trickHistory = [];
  room.played = [];
  room.pointsThisHand = { teamA: 0, teamB: 0 };
  room.burnPiles = { teamA: [], teamB: [] };
  room.phase = PHASES.PLAYING;

  if (room.mode === MODES.SEVENS) {
    room.sevensState = {
      comparisons: 0,
      allStrictCloser: true,
      immediateLoss: false,
      soloSeat: room.bidderSeat
    };
    room.turnSeat = room.bidderSeat;
  } else {
    room.sevensState = null;
    room.turnSeat = room.bidderSeat;
  }

  room.contract = {
    bidderSeat: room.bidderSeat,
    bidValue: room.bidValue,
    mode: room.mode,
    trumpSuit: room.trumpSuit ?? null
  };
  room.targetThisHand = computeTargetThisHand(room.bidderSeat, room.bidValue);
}

function finishHand(room) {
  const outcome = evaluateHandOutcome(room, room.config);
  const nextScores = updateRoundWinsAndMarks(room.roundWins, room.gameMarks, outcome.winnerTeam, room.config);

  room.roundWins = nextScores.roundWins;
  room.gameMarks = nextScores.gameMarks;
  room.champsTeam = nextScores.champsTeam;
  room.lastHandOutcome = {
    ...outcome,
    at: Date.now()
  };
  room.phase = PHASES.HAND_OVER;

  room.handOverTimer = setTimeout(() => {
    room.handOverTimer = null;
    room.dealerSeat = nextSeat(room.dealerSeat);
    startNewHand(room, { resetMarks: false });
    broadcastRoom(room);
    scheduleCpuIfNeeded(room);
  }, 5000);
}

function enterTrickPause(room, handDone) {
  room.phase = PHASES.TRICK_PAUSE;
  room.trickPauseTimer = setTimeout(() => {
    room.trickPauseTimer = null;

    if (handDone) {
      finishHand(room);
      broadcastRoom(room);
      return;
    }

    room.trick = [];
    room.phase = PHASES.PLAYING;
    if (room.mode === MODES.SEVENS) {
      room.turnSeat = room.bidderSeat;
    }

    broadcastRoom(room);
    scheduleCpuIfNeeded(room);
  }, 2200);
}

function completeTrick(room) {
  if (room.mode === MODES.SEVENS) {
    room.trickHistory.push({
      trick: room.trick.map((play) => ({ seatIndex: play.seatIndex, tile: { ...play.tile } })),
      mode: room.mode,
      trumpSuit: room.trumpSuit,
      ledSuit: null,
      winnerSeat: null,
      points: 0
    });

    const round = sevensRoundResult(room, room.trick);

    room.sevensState.comparisons += 1;
    if (!round.strictSoloWin) {
      room.sevensState.allStrictCloser = false;
    }

    if (round.immediateLoss) {
      room.sevensState.immediateLoss = true;
      room.sevensResult = {
        winnerTeam: otherTeam(getTeam(room.bidderSeat)),
        reason: round.reason
      };
      enterTrickPause(room, true);
      return;
    }

    const soloHandEmpty = (room.hands[room.bidderSeat] || []).length === 0;
    if (soloHandEmpty || room.sevensState.comparisons >= 7) {
      const success = room.sevensState.allStrictCloser && room.sevensState.comparisons >= 7;
      room.sevensResult = {
        winnerTeam: success ? getTeam(room.bidderSeat) : otherTeam(getTeam(room.bidderSeat)),
        reason: success ? 'allSevenCloser' : 'notAllSevenCloser'
      };
      enterTrickPause(room, true);
      return;
    }

    room.turnSeat = room.bidderSeat;
    enterTrickPause(room, false);
    return;
  }

  const result = resolveTrick(room, room.trick);
  const winnerTeam = getTeam(result.winnerSeat);

  room.pointsThisHand[winnerTeam] += result.points;
  room.burnPiles[winnerTeam].push(...room.trick.map((play) => ({ ...play.tile })));
  room.turnSeat = result.winnerSeat;

  room.trickHistory.push({
    trick: room.trick.map((play) => ({ seatIndex: play.seatIndex, tile: { ...play.tile } })),
    mode: room.mode,
    trumpSuit: room.trumpSuit,
    ledSuit: result.ledSuit,
    winnerSeat: result.winnerSeat,
    points: result.points
  });

  enterTrickPause(room, handIsFinished(room));
}

function expectedActorSeat(room) {
  if (room.phase === PHASES.BIDDING || room.phase === PHASES.PLAYING) {
    return room.turnSeat;
  }
  if (room.phase === PHASES.CHOOSE_MODE || room.phase === PHASES.CHOOSE_TRUMP) {
    return room.bidderSeat;
  }
  return null;
}

function projectCpuState(room) {
  return {
    phase: room.phase,
    dealerSeat: room.dealerSeat,
    turnSeat: room.turnSeat,
    bidderSeat: room.bidderSeat,
    bidValue: room.bidValue,
    mode: room.mode,
    trumpSuit: room.trumpSuit,
    hands: room.hands,
    trick: room.trick,
    played: room.played,
    pointsThisHand: room.pointsThisHand,
    activeSeats: room.activeSeats,
    bidHistory: room.bidHistory,
    trickHistory: room.trickHistory
  };
}

function scheduleCpuIfNeeded(room) {
  if (![PHASES.BIDDING, PHASES.CHOOSE_MODE, PHASES.CHOOSE_TRUMP, PHASES.PLAYING].includes(room.phase)) {
    return;
  }

  const seatIndex = expectedActorSeat(room);
  if (!Number.isInteger(seatIndex)) return;

  const seat = seatByIndex(room, seatIndex);
  if (!seat || seat.type !== 'cpu') return;

  if (room.pendingCpuTimer) return;

  const delay = 300 + Math.floor(Math.random() * 600);
  room.pendingCpuTimer = setTimeout(() => {
    room.pendingCpuTimer = null;

    const activeSeat = expectedActorSeat(room);
    if (activeSeat !== seatIndex) return;
    const currentSeat = seatByIndex(room, seatIndex);
    if (!currentSeat || currentSeat.type !== 'cpu') return;

    const decision = cpuDecide(projectCpuState(room), seatIndex, currentSeat.cpuLevel || 0, room.config);
    if (!decision || !decision.type) return;

    handleRoomAction(room, null, decision.type, decision.payload || {}, { internal: true, forcedSeat: seatIndex });
  }, delay);
}

function removeClientFromRoom(clientId, reason = 'left') {
  const client = clients.get(clientId);
  if (!client?.roomId) return;
  const room = rooms.get(client.roomId);
  if (!room) {
    client.roomId = null;
    return;
  }

  room.clientIds.delete(clientId);

  for (const seat of room.seats) {
    if (seat.occupantClientId === clientId) {
      seat.occupantClientId = null;
      if (room.phase === PHASES.LOBBY) {
        seat.name = `Seat ${seat.seatIndex + 1}`;
      } else {
        seat.type = 'cpu';
        seat.cpuLevel = Math.max(1, seat.cpuLevel || 1);
        if (!seat.name || seat.name.startsWith('Seat ')) {
          seat.name = `CPU ${seat.seatIndex + 1}`;
        }
      }
    }
  }

  if (room.hostClientId === clientId) {
    const [nextHost] = room.clientIds;
    room.hostClientId = nextHost || null;
  }

  client.roomId = null;

  if (room.clientIds.size === 0) {
    clearRoomTimers(room);
    rooms.delete(room.roomId);
    return;
  }

  broadcastRoom(room);
  scheduleCpuIfNeeded(room);

  if (reason === 'disconnect') {
    for (const otherClientId of room.clientIds) {
      const other = clients.get(otherClientId);
      if (!other) continue;
      send(other.ws, {
        type: 'info',
        message: `Client ${clientId} disconnected.`
      });
    }
  }
}

function handleRoomAction(room, clientId, action, payload, options = {}) {
  const { internal = false, forcedSeat = null } = options;

  const reject = (message) => {
    if (!internal && clientId) {
      sendError(clientId, action, message);
    }
    return false;
  };

  if (['submitBid', 'chooseMode', 'chooseTrump', 'playTile'].includes(action)) {
    const actorSeat = forcedSeat ?? actorSeatForAction(room, action);
    if (!Number.isInteger(actorSeat)) {
      return reject('No active seat for this action right now.');
    }
    if (!canControlSeat(room, actorSeat, clientId, internal)) {
      return reject('You cannot control this seat for that action.');
    }
  }

  if (action === 'claimSeat') {
    if (room.phase !== PHASES.LOBBY) {
      return reject('Cannot claim seats after game has started.');
    }
    const seat = seatByIndex(room, Number(payload.seatIndex));
    if (!seat) return reject('Invalid seat index.');
    if (seat.occupantClientId) return reject('Seat already occupied.');

    seat.type = 'human';
    seat.occupantClientId = clientId;
    seat.name = (payload.name || `Player ${seat.seatIndex + 1}`).toString().slice(0, 24);
    broadcastRoom(room);
    return true;
  }

  if (action === 'releaseSeat') {
    if (room.phase !== PHASES.LOBBY) {
      return reject('Cannot release seats after game has started.');
    }
    const seat = seatByIndex(room, Number(payload.seatIndex));
    if (!seat) return reject('Invalid seat index.');

    const isOwner = seat.occupantClientId === clientId;
    const isHost = room.hostClientId === clientId;
    if (!isOwner && !isHost) {
      return reject('Only seat owner or host can release this seat.');
    }

    seat.occupantClientId = null;
    if (seat.type === 'human') {
      seat.name = `Seat ${seat.seatIndex + 1}`;
    }
    broadcastRoom(room);
    return true;
  }

  if (action === 'setSeatType') {
    if (room.phase !== PHASES.LOBBY) return reject('Seat types can only be changed in lobby.');
    if (!ensureHost(room, clientId, action)) return false;

    const seat = seatByIndex(room, Number(payload.seatIndex));
    if (!seat) return reject('Invalid seat index.');

    const nextType = payload.type === 'cpu' ? 'cpu' : 'human';
    seat.type = nextType;

    if (nextType === 'cpu') {
      seat.occupantClientId = null;
      seat.cpuLevel = Math.max(0, Math.min(4, Number(payload.cpuLevel) || seat.cpuLevel || 1));
      seat.name = (payload.name || seat.name || `CPU ${seat.seatIndex + 1}`).toString().slice(0, 24);
      if (!seat.name || seat.name.startsWith('Seat ')) {
        seat.name = `CPU ${seat.seatIndex + 1}`;
      }
    } else {
      seat.cpuLevel = Math.max(0, Math.min(4, Number(payload.cpuLevel) || seat.cpuLevel || 1));
      if (!seat.occupantClientId) {
        seat.name = `Seat ${seat.seatIndex + 1}`;
      }
    }

    broadcastRoom(room);
    return true;
  }

  if (action === 'setSeatAvatar') {
    const seat = seatByIndex(room, Number(payload.seatIndex));
    if (!seat) return reject('Invalid seat index.');

    if (seat.type === 'human') {
      if (seat.occupantClientId !== clientId) {
        return reject('Only the occupied human seat client can change this avatar.');
      }
    } else if (seat.type === 'cpu') {
      if (room.hostClientId !== clientId) {
        return reject('Only host can change CPU avatars.');
      }
    }

    seat.avatarId = typeof payload.avatarId === 'string' ? payload.avatarId.slice(0, 80) : null;
    broadcastRoom(room);
    return true;
  }

  if (action === 'startGame') {
    if (!ensureHost(room, clientId, action)) return false;
    if (room.phase !== PHASES.LOBBY) return reject('Game already started.');

    startNewHand(room, { resetMarks: true });
    broadcastRoom(room);
    scheduleCpuIfNeeded(room);
    return true;
  }

  if (action === 'restartGame') {
    if (!ensureHost(room, clientId, action)) return false;
    room.dealerSeat = 0;
    startNewHand(room, { resetMarks: true });
    broadcastRoom(room);
    scheduleCpuIfNeeded(room);
    return true;
  }

  if (action === 'submitBid') {
    if (room.phase !== PHASES.BIDDING) return reject('submitBid is only valid during bidding.');

    const seatIndex = forcedSeat ?? room.turnSeat;
    const legal = computeLegalBids(room, seatIndex, room.config);
    if (!legal.length) return reject('No legal bids for this seat now.');

    let bid = null;
    if (payload.bid != null && payload.bid !== 'pass') {
      bid = Number(payload.bid);
      if (!Number.isInteger(bid)) return reject('Bid must be integer or pass.');
    }

    if (!legal.includes(bid)) {
      return reject('Illegal bid.');
    }

    room.bidHistory.push({ seatIndex, bid, at: Date.now() });
    room.bidTurnIndex += 1;

    if (room.bidTurnIndex >= room.biddingOrder.length) {
      finalizeBidding(room);
    } else {
      room.turnSeat = room.biddingOrder[room.bidTurnIndex];
    }

    broadcastRoom(room);
    scheduleCpuIfNeeded(room);
    return true;
  }

  if (action === 'chooseMode') {
    if (room.phase !== PHASES.CHOOSE_MODE) return reject('chooseMode is only valid during chooseMode phase.');
    const seatIndex = forcedSeat ?? room.bidderSeat;
    if (seatIndex !== room.bidderSeat) return reject('Only bidder can choose mode.');

    const mode = payload.mode;
    if (![MODES.TRUMPS, MODES.FOLLOW_ME, MODES.SEVENS].includes(mode)) {
      return reject('Invalid mode.');
    }
    if (mode === MODES.SEVENS && Number(room.bidValue) < Number(room.config.sevensBidThreshold)) {
      return reject(`Sevens requires bid >= ${room.config.sevensBidThreshold}.`);
    }

    room.mode = mode;
    room.contract = {
      bidderSeat: room.bidderSeat,
      bidValue: room.bidValue,
      mode,
      trumpSuit: mode === MODES.TRUMPS ? null : null
    };

    if (mode === MODES.TRUMPS) {
      room.phase = PHASES.CHOOSE_TRUMP;
      room.turnSeat = room.bidderSeat;
    } else {
      room.trumpSuit = null;
      enterPlayingPhase(room);
    }

    broadcastRoom(room);
    scheduleCpuIfNeeded(room);
    return true;
  }

  if (action === 'chooseTrump') {
    if (room.phase !== PHASES.CHOOSE_TRUMP) return reject('chooseTrump is only valid during chooseTrump phase.');
    if (room.mode !== MODES.TRUMPS) return reject('Trump can only be selected when mode is trumps.');

    const seatIndex = forcedSeat ?? room.bidderSeat;
    if (seatIndex !== room.bidderSeat) return reject('Only bidder can choose trump.');

    const trumpSuit = Number(payload.trumpSuit);
    if (!Number.isInteger(trumpSuit) || trumpSuit < 0 || trumpSuit > 6) {
      return reject('Trump suit must be an integer 0..6.');
    }

    room.trumpSuit = trumpSuit;
    room.contract = {
      bidderSeat: room.bidderSeat,
      bidValue: room.bidValue,
      mode: room.mode,
      trumpSuit
    };

    enterPlayingPhase(room);
    broadcastRoom(room);
    scheduleCpuIfNeeded(room);
    return true;
  }

  if (action === 'playTile') {
    if (room.phase !== PHASES.PLAYING) return reject('playTile is only valid during playing phase.');

    const seatIndex = forcedSeat ?? room.turnSeat;
    if (seatIndex !== room.turnSeat) return reject('Not this seat\'s turn.');

    const hand = room.hands[seatIndex] || [];
    const tileId = payload.tileId;
    if (!tileId || typeof tileId !== 'string') return reject('tileId is required.');

    const legal = computeLegalPlays(room, seatIndex);
    const legalIds = new Set(legal.map((tile) => tile.id));
    if (!legalIds.has(tileId)) {
      return reject('Illegal play rejected by server rules.');
    }

    const idx = findTileInHand(hand, tileId);
    if (idx < 0) return reject('Tile not found in hand.');

    const [tile] = hand.splice(idx, 1);
    room.trick.push({ seatIndex, tile: { ...tile } });
    room.played.push({ seatIndex, tile: { ...tile } });

    if (room.trick.length < room.activeSeats.length) {
      room.turnSeat = nextActiveSeat(room.activeSeats, seatIndex);
      broadcastRoom(room);
      scheduleCpuIfNeeded(room);
      return true;
    }

    completeTrick(room);
    broadcastRoom(room);
    return true;
  }

  return reject('Unknown action.');
}

function handleAction(clientId, action, payload) {
  const client = clients.get(clientId);
  if (!client) return;

  if (action === 'createRoom') {
    if (client.roomId) {
      removeClientFromRoom(clientId, 'switch-room');
    }

    const roomId = normalizeRoomId(payload?.roomId);
    if (rooms.has(roomId)) {
      sendError(clientId, action, 'Room already exists.');
      return;
    }

    const room = createRoom(roomId, clientId);
    rooms.set(roomId, room);
    client.roomId = roomId;

    send(client.ws, {
      type: 'roomCreated',
      roomId
    });
    broadcastRoom(room);
    return;
  }

  if (action === 'joinRoom') {
    const roomId = normalizeRoomId(payload?.roomId);
    const room = rooms.get(roomId);
    if (!room) {
      sendError(clientId, action, 'Room not found.');
      return;
    }

    if (client.roomId && client.roomId !== roomId) {
      removeClientFromRoom(clientId, 'switch-room');
    }

    room.clientIds.add(clientId);
    client.roomId = roomId;
    broadcastRoom(room);
    return;
  }

  if (action === 'leaveRoom') {
    removeClientFromRoom(clientId, 'left');
    return;
  }

  const roomId = client.roomId;
  if (!roomId) {
    sendError(clientId, action, 'Join or create a room first.');
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    sendError(clientId, action, 'Room no longer exists.');
    client.roomId = null;
    return;
  }

  handleRoomAction(room, clientId, action, payload || {});
}

wss.on('connection', (ws) => {
  const clientId = makeClientId();
  clients.set(clientId, {
    clientId,
    ws,
    roomId: null
  });

  send(ws, {
    type: 'welcome',
    clientId,
    now: Date.now()
  });

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(String(raw));
    } catch {
      sendError(clientId, 'parse', 'Invalid JSON payload.');
      return;
    }

    const action = data?.action;
    if (!action || typeof action !== 'string') {
      sendError(clientId, 'unknown', 'Missing action.');
      return;
    }

    handleAction(clientId, action, data.payload || {});
  });

  ws.on('close', () => {
    removeClientFromRoom(clientId, 'disconnect');
    clients.delete(clientId);
  });
});

server.listen(PORT, () => {
  console.log(`Texas 42 server listening on http://localhost:${PORT}`);
});
