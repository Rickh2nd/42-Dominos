export const PIPS = [0, 1, 2, 3, 4, 5, 6];
export const TEAM_BY_SEAT = [0, 1, 0, 1];
export const MIN_BID = 30;
export const MAX_BID = 42;
export const MARKS_TO_WIN = 7;
export const GAME_MODE_STRAIGHT = "straight";
export const GAME_MODE_FOLLOW_ME = "followMe";

export function dominoId(a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `${lo}-${hi}`;
}

export function parseDominoId(id) {
  const [a, b] = id.split("-").map(Number);
  return { id, a, b };
}

export function makeDeck() {
  const deck = [];
  for (let a = 0; a <= 6; a += 1) {
    for (let b = a; b <= 6; b += 1) {
      deck.push({ id: dominoId(a, b), a, b });
    }
  }
  return deck;
}

export function shuffleInPlace(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function countValue(tile) {
  const a = tile.a;
  const b = tile.b;
  if ((a === 5 && b === 5) || (a === 4 && b === 6)) return 10;
  if ((a === 0 && b === 5) || (a === 1 && b === 4) || (a === 2 && b === 3)) return 5;
  return 0;
}

function tileHasSuit(tile, suit) {
  return tile.a === suit || tile.b === suit;
}

function isTrumpTile(tile, trump) {
  return trump != null && tileHasSuit(tile, trump);
}

function tileBelongsToSuit(tile, suit, trump, mode = GAME_MODE_STRAIGHT) {
  if (mode === GAME_MODE_FOLLOW_ME) return tileHasSuit(tile, suit);
  if (trump != null && suit === trump) return tileHasSuit(tile, suit);
  if (isTrumpTile(tile, trump)) return false;
  return tileHasSuit(tile, suit);
}

function effectiveSuit(tile, trump) {
  if (trump != null && tileHasSuit(tile, trump)) return trump;
  return Math.max(tile.a, tile.b);
}

function leadSuitFromLeadTile(tile, trump, mode = GAME_MODE_STRAIGHT) {
  if (mode === GAME_MODE_FOLLOW_ME) return Math.max(tile.a, tile.b);
  return effectiveSuit(tile, trump);
}

function suitRank(tile, suit, trump, mode = GAME_MODE_STRAIGHT) {
  if (mode === GAME_MODE_FOLLOW_ME) {
    if (!tileHasSuit(tile, suit)) return -Infinity;
    if (tile.a === tile.b && tile.a === suit) return 100;
    const other = tile.a === suit ? tile.b : tile.a;
    return other;
  }
  if (effectiveSuit(tile, trump) !== suit) return -Infinity;
  if (tile.a === tile.b && tile.a === suit) return 100;
  if (suit === trump) {
    const other = tile.a === suit ? tile.b : tile.a;
    return other;
  }
  const other = tile.a === suit ? tile.b : tile.a;
  return other;
}

function compareTilesForTrick(aTile, bTile, leadSuit, trump, mode = GAME_MODE_STRAIGHT) {
  if (mode === GAME_MODE_FOLLOW_ME) {
    const aFollows = tileHasSuit(aTile, leadSuit);
    const bFollows = tileHasSuit(bTile, leadSuit);
    if (aFollows && !bFollows) return 1;
    if (!aFollows && bFollows) return -1;
    if (!aFollows && !bFollows) return 0;
    const ar = suitRank(aTile, leadSuit, null, mode);
    const br = suitRank(bTile, leadSuit, null, mode);
    if (ar !== br) return ar > br ? 1 : -1;
    return 0;
  }

  const aSuit = effectiveSuit(aTile, trump);
  const bSuit = effectiveSuit(bTile, trump);
  const aIsTrump = trump != null && aSuit === trump;
  const bIsTrump = trump != null && bSuit === trump;

  if (aIsTrump && !bIsTrump) return 1;
  if (!aIsTrump && bIsTrump) return -1;

  const targetSuit = aIsTrump || bIsTrump ? trump : leadSuit;
  const aFollows = aSuit === targetSuit;
  const bFollows = bSuit === targetSuit;

  if (aFollows && !bFollows) return 1;
  if (!aFollows && bFollows) return -1;

  const ar = suitRank(aTile, targetSuit, trump, mode);
  const br = suitRank(bTile, targetSuit, trump, mode);
  if (ar !== br) return ar > br ? 1 : -1;
  return 0;
}

function legalTilesForSeat(state, seatIndex) {
  const hand = state.hands[seatIndex] ?? [];
  if (state.phase !== "playing") return [];
  if (state.turn !== seatIndex) return [];
  if (state.currentTrick.length === 0) return hand.slice();

  const leadSuit = state.currentTrickLeadSuit;
  const trump = state.gameMode === GAME_MODE_FOLLOW_ME ? null : state.trump;
  const matching = hand.filter((tile) => tileBelongsToSuit(tile, leadSuit, trump, state.gameMode));
  return matching.length ? matching : hand.slice();
}

function nextSeat(seat) {
  return (seat + 1) % 4;
}

function teamScoreFromWon(wonTricks, wonTiles) {
  return [0, 1].map((team) => {
    const trickPts = wonTricks[team] ?? 0;
    const tilePts = (wonTiles[team] ?? []).reduce((sum, tile) => sum + countValue(tile), 0);
    return trickPts + tilePts;
  });
}

function emptyHandState() {
  return {
    phase: "lobby",
    gameMode: GAME_MODE_STRAIGHT,
    marksToWin: MARKS_TO_WIN,
    dealer: 0,
    hands: [[], [], [], []],
    bids: [null, null, null, null],
    bidTurn: null,
    highestBid: null,
    highestBidder: null,
    trump: null,
    currentTrick: [],
    currentTrickLeadSuit: null,
    currentTrickLeaderSeat: null,
    trickHistory: [],
    lastTrickDisplay: null,
    wonTricks: [0, 0],
    wonTiles: [[], []],
    teamTargets: [13, 30],
    turn: null,
    handPoints: [0, 0],
    marks: [0, 0],
    scores: [0, 0],
    handNumber: 0,
    lastHandResult: null,
    winningTeam: null,
    message: "Waiting to start"
  };
}

export function createMatch() {
  return {
    ...emptyHandState(),
    seed: Math.floor(Math.random() * 1_000_000_000)
  };
}

export function startNextHand(state, rng = Math.random) {
  if (state.gameMode !== GAME_MODE_FOLLOW_ME) state.gameMode = GAME_MODE_STRAIGHT;
  if (!Number.isFinite(state.marksToWin)) state.marksToWin = MARKS_TO_WIN;
  const deck = shuffleInPlace(makeDeck(), rng);
  const hands = [[], [], [], []];
  for (let i = 0; i < 28; i += 1) {
    hands[i % 4].push(deck[i]);
  }
  for (const hand of hands) {
    hand.sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || Math.min(y.a, y.b) - Math.min(x.a, x.b));
  }

  state.handNumber += 1;
  state.phase = "bidding";
  state.hands = hands;
  state.bids = [null, null, null, null];
  state.bidTurn = nextSeat(state.dealer);
  state.highestBid = null;
  state.highestBidder = null;
  state.trump = null;
  state.currentTrick = [];
  state.currentTrickLeadSuit = null;
  state.currentTrickLeaderSeat = null;
  state.trickHistory = [];
  state.lastTrickDisplay = null;
  state.wonTricks = [0, 0];
  state.wonTiles = [[], []];
  state.teamTargets = [13, 30];
  state.turn = state.bidTurn;
  state.handPoints = [0, 0];
  state.lastHandResult = null;
  state.winningTeam = null;
  state.message = `Hand ${state.handNumber}: bidding`;
  return state;
}

function allBidsComplete(state) {
  return state.bids.every((b) => b !== null);
}

function enterPlayPhaseFromBid(state, trump = null) {
  state.trump = trump;
  state.phase = "playing";
  state.turn = state.highestBidder;
  state.bidTurn = null;
  state.currentTrick = [];
  state.currentTrickLeadSuit = null;
  state.currentTrickLeaderSeat = state.highestBidder;

  const bid = state.highestBid ?? MIN_BID;
  const biddingTeam = TEAM_BY_SEAT[state.highestBidder];
  const defendingTeam = 1 - biddingTeam;
  state.teamTargets = [0, 0];
  state.teamTargets[biddingTeam] = bid;
  state.teamTargets[defendingTeam] = 43 - bid;

  if (state.gameMode === GAME_MODE_FOLLOW_ME) {
    state.message = `Follow Me (no trump). Seat ${state.turn + 1} leads.`;
  } else {
    state.message = `Trump is ${trump}. Seat ${state.turn + 1} leads.`;
  }
}

function forceDealerBid(state) {
  state.highestBid = MIN_BID;
  state.highestBidder = state.dealer;
  state.bids[state.dealer] = MIN_BID;
  for (let i = 0; i < 4; i += 1) {
    if (state.bids[i] === null) state.bids[i] = "pass";
  }
  if (state.gameMode === GAME_MODE_FOLLOW_ME) {
    enterPlayPhaseFromBid(state, null);
    state.message = `Dealer forced to bid ${MIN_BID}. Follow Me (no trump). Seat ${state.turn + 1} leads.`;
  } else {
    state.phase = "chooseTrump";
    state.turn = state.highestBidder;
    state.bidTurn = null;
    state.message = `Dealer forced to bid ${MIN_BID}. Choose trump.`;
  }
}

export function applyBid(state, seatIndex, bidValue) {
  if (state.phase !== "bidding") return { ok: false, error: "Not in bidding phase" };
  if (state.bidTurn !== seatIndex) return { ok: false, error: "Not your turn to bid" };

  if (bidValue == null || bidValue === "pass") {
    state.bids[seatIndex] = "pass";
  } else {
    const bid = Number(bidValue);
    const minAllowed = state.highestBid == null ? MIN_BID : Math.min(MAX_BID, state.highestBid + 1);
    if (!Number.isInteger(bid) || bid < minAllowed || bid > MAX_BID) {
      return { ok: false, error: `Bid must be ${minAllowed}-${MAX_BID}` };
    }
    state.bids[seatIndex] = bid;
    state.highestBid = bid;
    state.highestBidder = seatIndex;
  }

  let next = nextSeat(seatIndex);
  while (state.bids[next] !== null && !allBidsComplete(state)) {
    next = nextSeat(next);
  }

  if (allBidsComplete(state)) {
    if (state.highestBidder == null) {
      forceDealerBid(state);
      return { ok: true };
    }
    if (state.gameMode === GAME_MODE_FOLLOW_ME) {
      enterPlayPhaseFromBid(state, null);
      state.message = `Seat ${state.highestBidder + 1} won bid ${state.highestBid}. Follow Me (no trump).`;
    } else {
      state.phase = "chooseTrump";
      state.turn = state.highestBidder;
      state.bidTurn = null;
      state.message = `Seat ${state.highestBidder + 1} won bid ${state.highestBid}. Choose trump.`;
    }
    return { ok: true };
  }

  state.bidTurn = next;
  state.turn = next;
  state.message = `Seat ${next + 1} to bid.`;
  return { ok: true };
}

export function applyChooseTrump(state, seatIndex, trump) {
  if (state.gameMode === GAME_MODE_FOLLOW_ME) {
    return { ok: false, error: "Follow Me mode uses no trump" };
  }
  if (state.phase !== "chooseTrump") return { ok: false, error: "Not choosing trump" };
  if (state.highestBidder !== seatIndex) return { ok: false, error: "Only winning bidder chooses trump" };
  const t = Number(trump);
  if (!Number.isInteger(t) || t < 0 || t > 6) return { ok: false, error: "Trump must be 0-6" };
  enterPlayPhaseFromBid(state, t);
  return { ok: true };
}

function finishHand(state, winnerTeam, reason = "target") {
  if (state.phase === "handOver" || state.phase === "gameOver") return;
  const bid = state.highestBid ?? MIN_BID;
  const bidder = state.highestBidder ?? state.dealer;
  const biddingTeam = TEAM_BY_SEAT[bidder];
  const made = winnerTeam === biddingTeam;

  state.lastHandResult = {
    bid,
    bidder,
    biddingTeam,
    winnerTeam,
    made,
    reason,
    handPoints: [...state.handPoints],
    teamTargets: [...state.teamTargets]
  };

  state.marks[winnerTeam] += 1;
  const marksToWin = Number.isFinite(state.marksToWin) ? state.marksToWin : MARKS_TO_WIN;
  if (state.marks[winnerTeam] >= marksToWin) {
    state.phase = "gameOver";
    state.winningTeam = winnerTeam;
    state.message = `Team ${winnerTeam + 1} wins the game ${state.marks[winnerTeam]}-${state.marks[1 - winnerTeam]} (first to ${marksToWin}).`;
    return;
  }

  state.phase = "handOver";
  state.message = `Team ${winnerTeam + 1} reached ${state.handPoints[winnerTeam]}/${state.teamTargets[winnerTeam]} and gets 1 mark.`;
  state.dealer = nextSeat(state.dealer);
}

function finishHandIfNeeded(state) {
  const totalWon = state.wonTricks[0] + state.wonTricks[1];
  const target0 = state.teamTargets?.[0] ?? 13;
  const target1 = state.teamTargets?.[1] ?? 30;
  const reached0 = state.handPoints[0] >= target0;
  const reached1 = state.handPoints[1] >= target1;

  if (!reached0 && !reached1 && totalWon < 7) return;

  let winnerTeam = 0;
  let reason = "target";
  if (reached0 && !reached1) {
    winnerTeam = 0;
  } else if (reached1 && !reached0) {
    winnerTeam = 1;
  } else if (reached0 && reached1) {
    const over0 = state.handPoints[0] - target0;
    const over1 = state.handPoints[1] - target1;
    winnerTeam = over1 > over0 ? 1 : 0;
  } else {
    reason = "fullHand";
    if (state.handPoints[1] > state.handPoints[0]) winnerTeam = 1;
    else if (state.handPoints[0] === state.handPoints[1]) {
      const bidder = state.highestBidder ?? state.dealer;
      winnerTeam = TEAM_BY_SEAT[bidder];
    }
  }

  finishHand(state, winnerTeam, reason);
}

export function applyPlayTile(state, seatIndex, tileId) {
  if (state.phase !== "playing") return { ok: false, error: "Not in play phase" };
  if (state.turn !== seatIndex) return { ok: false, error: "Not your turn" };

  const legal = legalTilesForSeat(state, seatIndex);
  const tile = legal.find((t) => t.id === tileId);
  if (!tile) return { ok: false, error: "Illegal tile" };

  state.hands[seatIndex] = state.hands[seatIndex].filter((t) => t.id !== tileId);
  state.currentTrick.push({ seat: seatIndex, tile });

  if (state.currentTrick.length === 1) {
    const trump = state.gameMode === GAME_MODE_FOLLOW_ME ? null : state.trump;
    state.currentTrickLeadSuit = leadSuitFromLeadTile(tile, trump, state.gameMode);
    state.currentTrickLeaderSeat = seatIndex;
  }

  if (state.currentTrick.length < 4) {
    state.turn = nextSeat(seatIndex);
    state.message = `Seat ${state.turn + 1} to play.`;
    return { ok: true };
  }

  let winner = state.currentTrick[0];
  const trump = state.gameMode === GAME_MODE_FOLLOW_ME ? null : state.trump;
  for (let i = 1; i < state.currentTrick.length; i += 1) {
    const candidate = state.currentTrick[i];
    if (compareTilesForTrick(candidate.tile, winner.tile, state.currentTrickLeadSuit, trump, state.gameMode) > 0) {
      winner = candidate;
    }
  }

  const winningTeam = TEAM_BY_SEAT[winner.seat];
  state.wonTricks[winningTeam] += 1;
  state.wonTiles[winningTeam].push(...state.currentTrick.map((x) => x.tile));
  state.handPoints = teamScoreFromWon(state.wonTricks, state.wonTiles);
  state.trickHistory.push({
    plays: state.currentTrick.map((x) => ({ seat: x.seat, tile: x.tile })),
    leadSuit: state.currentTrickLeadSuit,
    winnerSeat: winner.seat,
    winningTeam,
    trickPoints: 1 + state.currentTrick.reduce((s, x) => s + countValue(x.tile), 0)
  });
  state.lastTrickDisplay = {
    plays: state.currentTrick.map((x) => ({ seat: x.seat, tile: x.tile })),
    leadSuit: state.currentTrickLeadSuit,
    winnerSeat: winner.seat
  };

  state.currentTrick = [];
  state.currentTrickLeadSuit = null;
  state.currentTrickLeaderSeat = winner.seat;
  state.turn = winner.seat;
  state.message = `Seat ${winner.seat + 1} won the trick and leads.`;

  finishHandIfNeeded(state);
  if (state.phase === "playing") {
    state.phase = "trickPause";
  }
  return { ok: true };
}

export function advanceAfterTrick(state) {
  if (state.phase !== "trickPause") return { ok: false, error: "Trick not paused" };
  state.phase = "playing";
  state.message = `Seat ${state.turn + 1} to play.`;
  return { ok: true };
}

export function advanceAfterHand(state) {
  if (state.phase !== "handOver") return { ok: false, error: "Hand not over" };
  startNextHand(state);
  return { ok: true };
}

export function resetMatch(state) {
  const dealer = state.dealer ?? 0;
  const gameMode = state.gameMode || GAME_MODE_STRAIGHT;
  const marksToWin = Number.isFinite(state.marksToWin) ? state.marksToWin : MARKS_TO_WIN;
  Object.assign(state, createMatch());
  state.dealer = dealer;
  state.gameMode = gameMode;
  state.marksToWin = marksToWin;
  startNextHand(state);
  return state;
}

export function applySetGameMode(state, mode) {
  const nextMode = mode === GAME_MODE_FOLLOW_ME ? GAME_MODE_FOLLOW_ME : GAME_MODE_STRAIGHT;
  if (state.phase !== "lobby" && state.phase !== "handOver") {
    return { ok: false, error: "Game mode can only be changed between hands" };
  }
  state.gameMode = nextMode;
  state.trump = null;
  state.message =
    nextMode === GAME_MODE_FOLLOW_ME
      ? "Game mode set to Follow Me (no trump)."
      : "Game mode set to Straight (trump).";
  return { ok: true };
}

function estimateSuitStrength(hand, suit) {
  let score = 0;
  for (const tile of hand) {
    if (tileHasSuit(tile, suit)) {
      score += 2;
      if (tile.a === tile.b && tile.a === suit) score += 4;
      const other = tile.a === suit ? tile.b : tile.b === suit ? tile.a : -1;
      score += Math.max(0, other) * 0.75;
    }
    score += countValue(tile) * 0.35;
  }
  return score;
}

function chooseTrumpForBot(state, seatIndex, difficulty) {
  const hand = state.hands[seatIndex];
  const scored = PIPS.map((suit) => ({ suit, score: estimateSuitStrength(hand, suit) + Math.random() * (6 - difficulty) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].suit;
}

function chooseBidForBot(state, seatIndex, difficulty) {
  const hand = state.hands[seatIndex];
  const best = PIPS.map((suit) => estimateSuitStrength(hand, suit)).sort((a, b) => b - a)[0] ?? 0;
  const countPts = hand.reduce((s, t) => s + countValue(t), 0);
  const trumpDoubles = hand.filter((t) => t.a === t.b).length;
  const raw = 18 + best * 0.7 + countPts * 0.45 + trumpDoubles * 0.9 + difficulty * 0.75;
  let target = Math.round(Math.min(MAX_BID, Math.max(MIN_BID, raw)));
  const diffCap = [36, 38, 40, 41, 42][Math.max(0, Math.min(4, difficulty - 1))];
  target = Math.min(target, diffCap);
  if (difficulty <= 2) target -= Math.floor((3 - difficulty) * 2 + Math.random() * 3);
  if (difficulty === 3) target -= Math.floor(Math.random() * 2);
  if (difficulty === 1 && Math.random() < 0.55) return null;
  if (difficulty === 2 && Math.random() < 0.3) return null;
  if (difficulty === 3 && Math.random() < 0.18) return null;

  const minAllowed = state.highestBid == null ? MIN_BID : state.highestBid + 1;
  if (target < minAllowed) {
    if (difficulty >= 4 && Math.random() < 0.12 && minAllowed <= Math.min(MAX_BID, diffCap)) return minAllowed;
    return null;
  }
  return Math.min(diffCap, Math.max(minAllowed, target));
}

function choosePlayForBot(state, seatIndex, difficulty) {
  const legal = legalTilesForSeat(state, seatIndex);
  if (!legal.length) return null;
  if (difficulty === 1) return legal[Math.floor(Math.random() * legal.length)].id;

  const biddingTeam = state.highestBidder == null ? null : TEAM_BY_SEAT[state.highestBidder];
  const myTeam = TEAM_BY_SEAT[seatIndex];
  const contractPressure = biddingTeam === myTeam ? 1 : -1;

  const currentTrickValue = state.currentTrick.reduce((s, p) => s + countValue(p.tile), 0);
  const leadSuit = state.currentTrickLeadSuit;
  const mode = state.gameMode || GAME_MODE_STRAIGHT;
  const trump = mode === GAME_MODE_FOLLOW_ME ? null : state.trump;

  const scored = legal.map((tile) => {
    let score = 0;
    const isCount = countValue(tile);
    const eff = effectiveSuit(tile, trump);
    const isTrump = trump != null && eff === trump;

    if (state.currentTrick.length === 0) {
      score += difficulty >= 4 ? isCount * -0.5 : isCount * -0.2;
      score += isTrump ? (difficulty >= 4 ? 1 : 0.4) : 0;
      score += suitRank(tile, eff, trump, mode) * 0.15;
    } else {
      const hypothetical = [...state.currentTrick, { seat: seatIndex, tile }];
      let winner = hypothetical[0];
      for (let i = 1; i < hypothetical.length; i += 1) {
        if (compareTilesForTrick(hypothetical[i].tile, winner.tile, leadSuit, trump, mode) > 0) winner = hypothetical[i];
      }
      const wouldWin = winner.seat === seatIndex;
      score += wouldWin ? 3 : -1;
      score += wouldWin ? currentTrickValue * 0.7 * contractPressure : -isCount * 0.6 * contractPressure;
      if (difficulty >= 3 && !wouldWin) score -= suitRank(tile, eff, trump, mode) * 0.08;
      if (difficulty >= 5 && isTrump && currentTrickValue === 0) score -= 0.8;
    }

    score += (Math.random() - 0.5) * (6 - difficulty);
    return { tile, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].tile.id;
}

export function botChooseAction(state, seatIndex, difficulty = 3) {
  const diff = Math.max(1, Math.min(5, Number(difficulty) || 3));
  if (state.phase === "bidding" && state.bidTurn === seatIndex) {
    return { type: "bid", value: chooseBidForBot(state, seatIndex, diff) };
  }
  if (state.phase === "chooseTrump" && state.highestBidder === seatIndex) {
    return { type: "chooseTrump", trump: chooseTrumpForBot(state, seatIndex, diff) };
  }
  if (state.phase === "playing" && state.turn === seatIndex) {
    const tileId = choosePlayForBot(state, seatIndex, diff);
    return tileId ? { type: "playTile", tileId } : null;
  }
  if (state.phase === "trickPause") {
    return { type: "advanceTrick" };
  }
  if (state.phase === "handOver") {
    return { type: "advanceHand" };
  }
  if (state.phase === "lobby") {
    return { type: "start" };
  }
  return null;
}

export function getLegalPlays(state, seatIndex) {
  return legalTilesForSeat(state, seatIndex).map((t) => t.id);
}

export function summarizeStateForSeat(state, seatIndex, seats) {
  const yourSeat = seatIndex;
  const visibleHands = state.hands.map((hand, idx) =>
    idx === yourSeat ? hand : { hiddenCount: hand.length }
  );

  return {
    phase: state.phase,
    gameMode: state.gameMode,
    marksToWin: state.marksToWin,
    dealer: state.dealer,
    handNumber: state.handNumber,
    bids: state.bids,
    bidTurn: state.bidTurn,
    highestBid: state.highestBid,
    highestBidder: state.highestBidder,
    trump: state.trump,
    turn: state.turn,
    currentTrick: state.currentTrick,
    currentTrickLeadSuit: state.currentTrickLeadSuit,
    currentTrickLeaderSeat: state.currentTrickLeaderSeat,
    trickHistory: state.trickHistory.slice(-7),
    lastTrickDisplay: state.lastTrickDisplay,
    wonTricks: state.wonTricks,
    handPoints: state.handPoints,
    teamTargets: state.teamTargets,
    wonTiles: state.wonTiles,
    marks: state.marks,
    scores: state.scores,
    lastHandResult: state.lastHandResult,
    winningTeam: state.winningTeam,
    message: state.message,
    yourSeat,
    yourHand: yourSeat != null ? state.hands[yourSeat] : [],
    handCounts: state.hands.map((h) => h.length),
    legalPlays: yourSeat != null ? getLegalPlays(state, yourSeat) : [],
    seats,
    hiddenHands: visibleHands
  };
}

export function applyEngineAction(state, seatIndex, action) {
  if (!action || typeof action !== "object") return { ok: false, error: "Invalid action" };
  switch (action.type) {
    case "bid":
      return applyBid(state, seatIndex, action.value ?? null);
    case "chooseTrump":
      return applyChooseTrump(state, seatIndex, action.trump);
    case "playTile":
      return applyPlayTile(state, seatIndex, action.tileId);
    case "advanceTrick":
      return advanceAfterTrick(state);
    case "advanceHand":
      return advanceAfterHand(state);
    default:
      return { ok: false, error: `Unknown action ${action.type}` };
  }
}
