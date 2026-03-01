const TEAM_A = 'teamA';
const TEAM_B = 'teamB';

export const MODES = {
  TRUMPS: 'trumps',
  FOLLOW_ME: 'followMe',
  SEVENS: 'sevens'
};

export const PHASES = {
  LOBBY: 'lobby',
  BIDDING: 'bidding',
  CHOOSE_MODE: 'chooseMode',
  CHOOSE_TRUMP: 'chooseTrump',
  PLAYING: 'playing',
  TRICK_PAUSE: 'trickPause',
  HAND_OVER: 'handOver'
};

export const CONFIG_DEFAULTS = {
  sevensBidThreshold: 42,
  roundsPerMark: 7,
  minBid: 30,
  maxBid: 42
};

export function tileId(a, b) {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return `${hi}-${lo}`;
}

export function normalizeTile(tile) {
  const a = Number(tile.a);
  const b = Number(tile.b);
  return {
    a,
    b,
    id: tileId(a, b)
  };
}

export function createDominoSet() {
  const out = [];
  for (let hi = 0; hi <= 6; hi += 1) {
    for (let lo = 0; lo <= hi; lo += 1) {
      out.push({ a: hi, b: lo, id: tileId(hi, lo) });
    }
  }
  return out;
}

export function cloneTile(tile) {
  return { a: tile.a, b: tile.b, id: tile.id };
}

export function copyHands(hands) {
  const next = {};
  for (const key of Object.keys(hands || {})) {
    next[key] = (hands[key] || []).map(cloneTile);
  }
  return next;
}

export function getTeam(seatIndex) {
  return seatIndex % 2 === 0 ? TEAM_A : TEAM_B;
}

export function otherTeam(team) {
  return team === TEAM_A ? TEAM_B : TEAM_A;
}

export function partnerOf(seatIndex) {
  return (seatIndex + 2) % 4;
}

export function seatsForTeam(team) {
  return team === TEAM_A ? [0, 2] : [1, 3];
}

export function nextSeat(seatIndex) {
  return (seatIndex + 1) % 4;
}

export function nextActiveSeat(activeSeats, currentSeat) {
  if (!Array.isArray(activeSeats) || activeSeats.length === 0) {
    return currentSeat;
  }
  const idx = activeSeats.indexOf(currentSeat);
  if (idx < 0) {
    return activeSeats[0];
  }
  return activeSeats[(idx + 1) % activeSeats.length];
}

export function buildShuffledDeck(rng = Math.random) {
  const deck = createDominoSet();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

export function dealHands(deck, seats = [0, 1, 2, 3], handSize = 7) {
  const hands = { 0: [], 1: [], 2: [], 3: [] };
  const order = [...seats];
  let cursor = 0;
  for (let round = 0; round < handSize; round += 1) {
    for (const seat of order) {
      hands[seat].push(deck[cursor]);
      cursor += 1;
    }
  }
  for (const seat of Object.keys(hands)) {
    hands[seat].sort((x, y) => {
      if (x.a !== y.a) return y.a - x.a;
      return y.b - x.b;
    });
  }
  return hands;
}

export function countTilePoints(tile) {
  const id = tile.id || tileId(tile.a, tile.b);
  if (id === '5-5' || id === '6-4') return 10;
  if (id === '5-0' || id === '4-1' || id === '3-2') return 5;
  return 0;
}

export function trickCountPoints(tiles) {
  return (tiles || []).reduce((sum, tile) => sum + countTilePoints(tile), 0);
}

export function computeChampsTeam(gameMarks) {
  const a = Number(gameMarks?.teamA || 0);
  const b = Number(gameMarks?.teamB || 0);
  if (Math.max(a, b) <= 0) return null;
  if (a === b) return null;
  return a > b ? TEAM_A : TEAM_B;
}

export function computeTargetThisHand(bidderSeat, bidValue) {
  const safeBid = Number.isFinite(Number(bidValue)) ? Number(bidValue) : 30;
  if (!Number.isInteger(bidderSeat)) {
    return { teamA: 0, teamB: 0 };
  }
  const bidderTeam = getTeam(bidderSeat);
  const defenderTeam = otherTeam(bidderTeam);
  const out = { teamA: 0, teamB: 0 };
  out[bidderTeam] = safeBid;
  out[defenderTeam] = 43 - safeBid;
  return out;
}

export function activeSeatsForMode(mode, bidderSeat) {
  if (mode !== MODES.SEVENS) {
    return [0, 1, 2, 3];
  }
  if (!Number.isInteger(bidderSeat)) {
    return [0, 1, 2, 3];
  }
  const partnerSeat = partnerOf(bidderSeat);
  return [0, 1, 2, 3].filter((seat) => seat !== partnerSeat);
}

export function isSevensEligible(bidValue, config = CONFIG_DEFAULTS) {
  return Number(bidValue) >= Number(config.sevensBidThreshold || CONFIG_DEFAULTS.sevensBidThreshold);
}

export function tileContainsSuit(tile, suit) {
  return tile.a === suit || tile.b === suit;
}

export function distanceToSeven(tile) {
  return Math.abs((tile.a + tile.b) - 7);
}

function rankInSuit(tile, suit) {
  if (!tileContainsSuit(tile, suit)) {
    return -1;
  }
  if (tile.a === tile.b && tile.a === suit) {
    return 100 + suit;
  }
  const other = tile.a === suit ? tile.b : tile.a;
  return 10 + other;
}

export function determineLedSuit(mode, leadTile, trumpSuit) {
  if (!leadTile) return null;
  if (mode === MODES.TRUMPS) {
    if (Number.isInteger(trumpSuit) && tileContainsSuit(leadTile, trumpSuit)) {
      return trumpSuit;
    }
    if (leadTile.a === leadTile.b) {
      return leadTile.a;
    }
    return Math.max(leadTile.a, leadTile.b);
  }
  if (mode === MODES.FOLLOW_ME) {
    return Math.max(leadTile.a, leadTile.b);
  }
  return null;
}

export function tileFollowsSuit(tile, suit, mode, trumpSuit) {
  if (suit == null) return true;
  if (mode === MODES.TRUMPS) {
    if (Number.isInteger(trumpSuit) && suit === trumpSuit) {
      return tileContainsSuit(tile, trumpSuit);
    }
    if (Number.isInteger(trumpSuit) && tileContainsSuit(tile, trumpSuit)) {
      return false;
    }
    return tileContainsSuit(tile, suit);
  }
  if (mode === MODES.FOLLOW_ME) {
    return tileContainsSuit(tile, suit);
  }
  return true;
}

export function computeLegalBids(state, seatIndex, config = CONFIG_DEFAULTS) {
  if (state.phase !== PHASES.BIDDING) return [];
  if (state.turnSeat !== seatIndex) return [];

  const bidHistory = Array.isArray(state.bidHistory) ? state.bidHistory : [];
  const highBid = bidHistory.reduce((max, entry) => {
    if (Number.isInteger(entry.bid) && entry.bid > max) return entry.bid;
    return max;
  }, 0);

  const legal = [null];
  const minBid = Math.max(Number(config.minBid || 30), highBid + 1);
  const maxBid = Number(config.maxBid || 42);
  for (let bid = minBid; bid <= maxBid; bid += 1) {
    legal.push(bid);
  }
  return legal;
}

export function computeLegalPlays(state, seatIndex) {
  const hand = state.hands?.[seatIndex] || [];
  if (state.phase !== PHASES.PLAYING) return [];
  if (state.turnSeat !== seatIndex) return [];
  if (hand.length === 0) return [];

  if (state.mode === MODES.SEVENS && seatIndex === state.bidderSeat) {
    let minDistance = Infinity;
    for (const tile of hand) {
      const d = distanceToSeven(tile);
      if (d < minDistance) minDistance = d;
    }
    return hand.filter((tile) => distanceToSeven(tile) === minDistance);
  }

  const trick = state.trick || [];
  if (trick.length === 0) {
    return [...hand];
  }

  if (state.mode === MODES.SEVENS) {
    return [...hand];
  }

  const ledSuit = determineLedSuit(state.mode, trick[0].tile, state.trumpSuit);
  const suitMatches = hand.filter((tile) => tileFollowsSuit(tile, ledSuit, state.mode, state.trumpSuit));
  return suitMatches.length > 0 ? suitMatches : [...hand];
}

export function findTileInHand(hand, tileOrId) {
  const id = typeof tileOrId === 'string' ? tileOrId : tileOrId?.id;
  if (!id) return -1;
  return hand.findIndex((tile) => tile.id === id);
}

export function resolveTrick(state, trickInput = state.trick || []) {
  const trick = trickInput.map((play) => ({ seatIndex: play.seatIndex, tile: normalizeTile(play.tile) }));
  if (trick.length === 0) {
    return {
      winnerSeat: null,
      points: 0,
      ledSuit: null,
      winningTile: null,
      trick
    };
  }

  if (state.mode === MODES.SEVENS) {
    const soloSeat = state.bidderSeat;
    const soloPlay = trick.find((play) => play.seatIndex === soloSeat) || trick[0];
    const sorted = [...trick].sort((a, b) => distanceToSeven(a.tile) - distanceToSeven(b.tile));
    const winner = sorted[0].seatIndex;
    return {
      winnerSeat: winner,
      points: 0,
      ledSuit: null,
      winningTile: cloneTile(sorted[0].tile),
      soloDistance: distanceToSeven(soloPlay.tile),
      trick
    };
  }

  const ledSuit = determineLedSuit(state.mode, trick[0].tile, state.trumpSuit);
  let contenders = [];
  let suitForRanking = ledSuit;

  if (state.mode === MODES.TRUMPS && Number.isInteger(state.trumpSuit)) {
    const trumps = trick.filter((play) => tileContainsSuit(play.tile, state.trumpSuit));
    if (trumps.length > 0) {
      contenders = trumps;
      suitForRanking = state.trumpSuit;
    } else {
      contenders = trick.filter((play) => tileFollowsSuit(play.tile, ledSuit, state.mode, state.trumpSuit));
    }
  } else {
    contenders = trick.filter((play) => tileContainsSuit(play.tile, ledSuit));
  }

  if (contenders.length === 0) {
    contenders = [trick[0]];
  }

  let winner = contenders[0];
  let bestRank = rankInSuit(winner.tile, suitForRanking);
  for (let i = 1; i < contenders.length; i += 1) {
    const rank = rankInSuit(contenders[i].tile, suitForRanking);
    if (rank > bestRank) {
      winner = contenders[i];
      bestRank = rank;
    }
  }

  return {
    winnerSeat: winner.seatIndex,
    points: trickCountPoints(trick.map((play) => play.tile)),
    ledSuit,
    winningTile: cloneTile(winner.tile),
    trick
  };
}

export function evaluateHandOutcome(state, config = CONFIG_DEFAULTS) {
  if (state.mode === MODES.SEVENS) {
    const winnerTeam = state.sevensResult?.winnerTeam || otherTeam(getTeam(state.bidderSeat));
    const bidderTeam = getTeam(state.bidderSeat);
    const defendingTeam = otherTeam(bidderTeam);
    const success = winnerTeam === bidderTeam;
    return {
      winnerTeam,
      bidderTeam,
      defendingTeam,
      success,
      reason: state.sevensResult?.reason || (success ? 'sevensSuccess' : 'sevensFailure')
    };
  }

  const bidderTeam = getTeam(state.bidderSeat);
  const defendingTeam = otherTeam(bidderTeam);
  const bidderPoints = Number(state.pointsThisHand?.[bidderTeam] || 0);
  const bidValue = Number(state.bidValue || 30);
  const success = bidderPoints >= bidValue;
  const winnerTeam = success ? bidderTeam : defendingTeam;

  return {
    winnerTeam,
    bidderTeam,
    defendingTeam,
    success,
    reason: success ? 'contractMade' : 'contractSet'
  };
}

export function updateRoundWinsAndMarks(roundWins, gameMarks, winnerTeam, config = CONFIG_DEFAULTS) {
  const nextRoundWins = {
    teamA: Number(roundWins?.teamA || 0),
    teamB: Number(roundWins?.teamB || 0)
  };
  const nextGameMarks = {
    teamA: Number(gameMarks?.teamA || 0),
    teamB: Number(gameMarks?.teamB || 0)
  };

  nextRoundWins[winnerTeam] += 1;

  const target = Number(config.roundsPerMark || CONFIG_DEFAULTS.roundsPerMark);
  if (nextRoundWins[winnerTeam] >= target) {
    nextGameMarks[winnerTeam] += 1;
    nextRoundWins.teamA = 0;
    nextRoundWins.teamB = 0;
  }

  return {
    roundWins: nextRoundWins,
    gameMarks: nextGameMarks,
    champsTeam: computeChampsTeam(nextGameMarks)
  };
}

export function makeBidSummary(bidHistory) {
  const bySeat = { 0: 'PASS', 1: 'PASS', 2: 'PASS', 3: 'PASS' };
  for (const entry of bidHistory || []) {
    if (entry.bid == null) {
      bySeat[entry.seatIndex] = 'PASS';
    } else {
      bySeat[entry.seatIndex] = String(entry.bid);
    }
  }
  return bySeat;
}

function computeHandShape(hand) {
  const suitCounts = [0, 0, 0, 0, 0, 0, 0];
  let doubles = 0;
  let countPoints = 0;
  for (const tile of hand) {
    suitCounts[tile.a] += 1;
    if (tile.b !== tile.a) suitCounts[tile.b] += 1;
    if (tile.a === tile.b) doubles += 1;
    countPoints += countTilePoints(tile);
  }
  return { suitCounts, doubles, countPoints };
}

function estimateTrumpSuitScore(hand, suit) {
  let score = 0;
  for (const tile of hand) {
    if (tileContainsSuit(tile, suit)) {
      score += 2;
      if (tile.a === tile.b && tile.a === suit) score += 2.5;
      if (tile.a !== tile.b) {
        const other = tile.a === suit ? tile.b : tile.a;
        score += other / 4;
      }
    }
    if (countTilePoints(tile) > 0 && tileContainsSuit(tile, suit)) {
      score += 1.2;
    }
  }
  return score;
}

function estimateFollowMeScore(hand) {
  const { suitCounts, doubles, countPoints } = computeHandShape(hand);
  const max = Math.max(...suitCounts);
  const min = Math.min(...suitCounts);
  const spread = max - min;
  return countPoints * 0.45 + doubles * 0.4 + (8 - spread);
}

function estimateSevensScore(hand) {
  let near = 0;
  let exact = 0;
  for (const tile of hand) {
    const d = distanceToSeven(tile);
    near += 7 - d;
    if (d === 0) exact += 1;
  }
  return near + exact * 2.25;
}

function recommendedBidFromHand(hand) {
  const { suitCounts, doubles, countPoints } = computeHandShape(hand);
  const trumpPeak = Math.max(...suitCounts);
  const strength = countPoints * 0.95 + doubles * 2.1 + trumpPeak * 1.35;
  const raw = 28 + Math.round(strength / 2.4);
  return Math.min(42, Math.max(30, raw));
}

function pickClosestBid(choices, target, rng) {
  const numeric = choices.filter((value) => Number.isInteger(value));
  if (!numeric.length) return null;
  let best = numeric[0];
  let bestDiff = Math.abs(best - target);
  for (let i = 1; i < numeric.length; i += 1) {
    const diff = Math.abs(numeric[i] - target);
    if (diff < bestDiff) {
      best = numeric[i];
      bestDiff = diff;
    }
  }
  if (numeric.length > 1 && rng() < 0.25) {
    const direction = rng() < 0.5 ? -1 : 1;
    const moved = best + direction;
    if (numeric.includes(moved)) return moved;
  }
  return best;
}

function chooseBid(state, seatIndex, level, rng, config) {
  const legal = computeLegalBids(state, seatIndex, config);
  if (!legal.length) return null;

  if (level <= 0) {
    return legal[Math.floor(rng() * legal.length)];
  }

  const hand = state.hands?.[seatIndex] || [];
  const recommended = recommendedBidFromHand(hand);
  const minLegalBid = legal.find((value) => Number.isInteger(value));

  if (!Number.isInteger(minLegalBid)) {
    return null;
  }

  if (recommended < minLegalBid) {
    if (level >= 3 && rng() < 0.12) {
      return minLegalBid;
    }
    return null;
  }

  if (level === 1) {
    const target = recommended + (rng() < 0.4 ? (rng() < 0.5 ? -1 : 1) : 0);
    return pickClosestBid(legal, target, rng);
  }

  if (level === 2) {
    const jitter = rng() < 0.2 ? 1 : 0;
    return pickClosestBid(legal, recommended - jitter, rng);
  }

  if (level >= 3) {
    const cautious = level === 3 ? 0 : 1;
    return pickClosestBid(legal, recommended - cautious, rng);
  }

  return null;
}

function chooseMode(state, seatIndex, level, rng, config) {
  const hand = state.hands?.[seatIndex] || [];
  const trumpScores = Array.from({ length: 7 }, (_, suit) => estimateTrumpSuitScore(hand, suit));
  const bestTrumpScore = Math.max(...trumpScores);
  const followScore = estimateFollowMeScore(hand);
  const sevensScore = estimateSevensScore(hand);
  const sevensAllowed = isSevensEligible(state.bidValue, config);

  if (level <= 0) {
    if (sevensAllowed && rng() < 0.03) return MODES.SEVENS;
    return rng() < 0.2 ? MODES.FOLLOW_ME : MODES.TRUMPS;
  }

  if (level === 1) {
    if (sevensAllowed && sevensScore > bestTrumpScore + 7 && rng() < 0.12) return MODES.SEVENS;
    return followScore > bestTrumpScore + 2 ? MODES.FOLLOW_ME : MODES.TRUMPS;
  }

  if (level === 2) {
    if (sevensAllowed && sevensScore > bestTrumpScore + 4 && sevensScore > followScore + 2) {
      return MODES.SEVENS;
    }
    return followScore >= bestTrumpScore - 1 ? MODES.FOLLOW_ME : MODES.TRUMPS;
  }

  if (sevensAllowed && sevensScore > bestTrumpScore + (level === 4 ? 6 : 4) && sevensScore > followScore + 2) {
    return MODES.SEVENS;
  }

  if (followScore > bestTrumpScore + (level === 4 ? 0.5 : 1.5)) {
    return MODES.FOLLOW_ME;
  }

  return MODES.TRUMPS;
}

function chooseTrump(hand) {
  let bestSuit = 0;
  let bestScore = -Infinity;
  for (let suit = 0; suit <= 6; suit += 1) {
    const score = estimateTrumpSuitScore(hand, suit);
    if (score > bestScore) {
      bestScore = score;
      bestSuit = suit;
    }
  }
  return bestSuit;
}

export function buildKnowledgeModel(state) {
  const activeSeats = state.activeSeats || [0, 1, 2, 3];
  const voids = {
    0: new Set(),
    1: new Set(),
    2: new Set(),
    3: new Set()
  };

  const inspectTrick = (record) => {
    if (!record || !Array.isArray(record.trick) || record.trick.length === 0) return;
    if (record.mode === MODES.SEVENS) return;
    const ledSuit = record.ledSuit ?? determineLedSuit(record.mode, record.trick[0].tile, record.trumpSuit);
    for (let i = 1; i < record.trick.length; i += 1) {
      const play = record.trick[i];
      if (!tileFollowsSuit(play.tile, ledSuit, record.mode, record.trumpSuit)) {
        voids[play.seatIndex].add(ledSuit);
      }
    }
  };

  for (const rec of state.trickHistory || []) {
    inspectTrick(rec);
  }

  if (Array.isArray(state.trick) && state.trick.length > 1 && state.mode !== MODES.SEVENS) {
    inspectTrick({
      trick: state.trick,
      mode: state.mode,
      trumpSuit: state.trumpSuit,
      ledSuit: determineLedSuit(state.mode, state.trick[0].tile, state.trumpSuit)
    });
  }

  const allTiles = createDominoSet();
  const used = new Set();
  for (const id of state.playedTileIds || []) {
    used.add(id);
  }
  for (const play of state.trick || []) {
    used.add(play.tile.id);
  }
  for (const hand of Object.values(state.hands || {})) {
    for (const tile of hand || []) {
      if (state.visibilitySeat != null && Number(state.visibilitySeat) !== Number(tile.ownerSeat)) {
        continue;
      }
    }
  }

  // `used` in shared CPU model means publicly known used tiles.
  for (const rec of state.trickHistory || []) {
    for (const play of rec.trick || []) {
      used.add(play.tile.id);
    }
  }

  return {
    activeSeats,
    voids,
    used
  };
}

function scoreImmediatePlay(state, seatIndex, tile, level) {
  const myTeam = getTeam(seatIndex);
  const partnerSeat = partnerOf(seatIndex);
  const trick = state.trick || [];
  const tilePoints = countTilePoints(tile);

  if (state.mode === MODES.SEVENS) {
    const d = distanceToSeven(tile);
    if (seatIndex === state.bidderSeat) {
      return (7 - d) * 3 + (tilePoints > 0 ? 0.1 : 0);
    }
    return (7 - d) * 2.2;
  }

  if (trick.length === 0) {
    let score = 0;
    if (state.mode === MODES.TRUMPS && Number.isInteger(state.trumpSuit) && tileContainsSuit(tile, state.trumpSuit)) {
      score += 2.5;
      if (state.bidderSeat != null && getTeam(state.bidderSeat) === myTeam) {
        score += 1.2;
      }
    }
    score -= tilePoints * 0.9;
    if (tile.a === tile.b) score += 0.8;
    return score;
  }

  const simulated = [...trick, { seatIndex, tile }];
  const trickResult = resolveTrick(
    {
      mode: state.mode,
      trumpSuit: state.trumpSuit,
      bidderSeat: state.bidderSeat
    },
    simulated
  );

  const winningTeam = trickResult.winnerSeat == null ? null : getTeam(trickResult.winnerSeat);
  const trickPoints = trickCountPoints(simulated.map((play) => play.tile));

  let score = 0;
  if (winningTeam === myTeam) {
    score += 4 + trickPoints * 0.55;
  } else {
    score -= 3 + tilePoints * 1.2;
  }

  if (winningTeam === getTeam(partnerSeat) && level >= 2) {
    score += tilePoints > 0 ? 0.8 : 1.2;
  }

  if (
    state.mode === MODES.TRUMPS
    && Number.isInteger(state.trumpSuit)
    && tileContainsSuit(tile, state.trumpSuit)
    && determineLedSuit(state.mode, trick[0].tile, state.trumpSuit) !== state.trumpSuit
  ) {
    score -= trickPoints >= 10 ? -1.5 : 1.4;
  }

  score -= (tile.a + tile.b) * 0.04;
  return score;
}

function removeTileFromHand(hand, tile) {
  const next = hand.slice();
  const idx = findTileInHand(next, tile.id);
  if (idx >= 0) next.splice(idx, 1);
  return next;
}

function shallowCloneStateForSim(state) {
  return {
    mode: state.mode,
    trumpSuit: state.trumpSuit,
    bidderSeat: state.bidderSeat,
    activeSeats: [...(state.activeSeats || [0, 1, 2, 3])],
    hands: copyHands(state.hands || {}),
    trick: (state.trick || []).map((play) => ({ seatIndex: play.seatIndex, tile: cloneTile(play.tile) })),
    pointsThisHand: {
      teamA: Number(state.pointsThisHand?.teamA || 0),
      teamB: Number(state.pointsThisHand?.teamB || 0)
    },
    turnSeat: state.turnSeat
  };
}

function assignUnknownHands(state, seatIndex, rng) {
  const sim = shallowCloneStateForSim(state);
  const activeSeats = sim.activeSeats;
  const ownHand = sim.hands[seatIndex] || [];

  const knownUsed = new Set();
  for (const rec of state.trickHistory || []) {
    for (const play of rec.trick || []) knownUsed.add(play.tile.id);
  }
  for (const play of sim.trick || []) knownUsed.add(play.tile.id);
  for (const tile of ownHand) knownUsed.add(tile.id);

  const deck = createDominoSet();
  const unknownPool = deck.filter((tile) => !knownUsed.has(tile.id));
  for (let i = unknownPool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = unknownPool[i];
    unknownPool[i] = unknownPool[j];
    unknownPool[j] = tmp;
  }

  const unknownSeats = activeSeats.filter((s) => s !== seatIndex);
  const needed = {};
  let totalNeeded = 0;
  for (const s of unknownSeats) {
    const need = (sim.hands[s] || []).length;
    needed[s] = need;
    totalNeeded += need;
    sim.hands[s] = [];
  }

  let cursor = 0;
  for (const s of unknownSeats) {
    const need = needed[s];
    sim.hands[s] = unknownPool.slice(cursor, cursor + need).map(cloneTile);
    cursor += need;
  }

  // If we had too few tiles because public info was over-constrained, keep prior hands.
  if (cursor < totalNeeded) {
    for (const s of unknownSeats) {
      sim.hands[s] = state.hands[s].map(cloneTile);
    }
  }

  return sim;
}

function simulateRandomFuture(state, seatIndex, firstTile, depth, rng) {
  const myTeam = getTeam(seatIndex);
  const sim = assignUnknownHands(state, seatIndex, rng);

  const firstIdx = findTileInHand(sim.hands[seatIndex], firstTile.id);
  if (firstIdx < 0) {
    return scoreImmediatePlay(state, seatIndex, firstTile, 3);
  }

  const playedTile = sim.hands[seatIndex][firstIdx];
  sim.hands[seatIndex].splice(firstIdx, 1);
  sim.trick.push({ seatIndex, tile: cloneTile(playedTile) });

  if (sim.trick.length < sim.activeSeats.length) {
    sim.turnSeat = nextActiveSeat(sim.activeSeats, seatIndex);
  }

  let plies = Math.max(1, depth * sim.activeSeats.length);
  while (plies > 0) {
    plies -= 1;

    if (sim.trick.length === sim.activeSeats.length) {
      const trickResult = resolveTrick(sim, sim.trick);
      if (sim.mode !== MODES.SEVENS) {
        const team = getTeam(trickResult.winnerSeat);
        sim.pointsThisHand[team] += trickResult.points;
      }
      sim.trick = [];
      sim.turnSeat = sim.mode === MODES.SEVENS ? sim.bidderSeat : trickResult.winnerSeat;
    }

    const seat = sim.turnSeat;
    if (seat == null) break;
    const hand = sim.hands[seat] || [];
    if (!hand.length) break;

    const legal = computeLegalPlays({
      ...sim,
      phase: PHASES.PLAYING,
      turnSeat: seat
    }, seat);
    if (!legal.length) break;

    let chosen;
    if (sim.mode === MODES.SEVENS) {
      chosen = legal[Math.floor(rng() * legal.length)];
      if (seat === sim.bidderSeat) {
        legal.sort((a, b) => distanceToSeven(a) - distanceToSeven(b));
        chosen = legal[0];
      }
    } else {
      chosen = legal[Math.floor(rng() * legal.length)];
    }

    const idx = findTileInHand(hand, chosen.id);
    if (idx < 0) break;
    const tile = hand[idx];
    hand.splice(idx, 1);
    sim.trick.push({ seatIndex: seat, tile: cloneTile(tile) });
    sim.turnSeat = nextActiveSeat(sim.activeSeats, seat);

    const everyoneEmpty = sim.activeSeats.every((s) => (sim.hands[s] || []).length === 0);
    if (everyoneEmpty && sim.trick.length === 0) break;
  }

  return Number(sim.pointsThisHand[myTeam] || 0) - Number(sim.pointsThisHand[otherTeam(myTeam)] || 0);
}

function choosePlay(state, seatIndex, level, rng) {
  const legal = computeLegalPlays(state, seatIndex);
  if (!legal.length) return null;

  if (level <= 0) {
    return legal[Math.floor(rng() * legal.length)];
  }

  if (state.mode === MODES.SEVENS) {
    if (seatIndex === state.bidderSeat) {
      legal.sort((a, b) => distanceToSeven(a) - distanceToSeven(b));
      return legal[0];
    }
    legal.sort((a, b) => distanceToSeven(a) - distanceToSeven(b));
    return level >= 2 ? legal[0] : legal[Math.min(legal.length - 1, Math.floor(rng() * 2))];
  }

  let bestTile = legal[0];
  let bestScore = -Infinity;

  for (const tile of legal) {
    let score = scoreImmediatePlay(state, seatIndex, tile, level);

    if (level >= 3) {
      const trials = level === 3 ? 24 : 64;
      const depth = level === 3 ? 3 : 6;
      let total = 0;
      for (let t = 0; t < trials; t += 1) {
        total += simulateRandomFuture(state, seatIndex, tile, depth, rng);
      }
      score += total / trials;
      if (level === 4) {
        // Slight risk control: avoid exposing count tiles unless expected value is clearly better.
        score -= countTilePoints(tile) * 0.2;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestTile = tile;
    }
  }

  return bestTile;
}

export function cpuDecide(state, seatIndex, level = 0, config = CONFIG_DEFAULTS, rng = Math.random) {
  const safeLevel = Math.max(0, Math.min(4, Number(level) || 0));

  if (state.phase === PHASES.BIDDING) {
    const bid = chooseBid(state, seatIndex, safeLevel, rng, config);
    return {
      type: 'submitBid',
      payload: { bid }
    };
  }

  if (state.phase === PHASES.CHOOSE_MODE && seatIndex === state.bidderSeat) {
    const mode = chooseMode(state, seatIndex, safeLevel, rng, config);
    return {
      type: 'chooseMode',
      payload: { mode }
    };
  }

  if (state.phase === PHASES.CHOOSE_TRUMP && seatIndex === state.bidderSeat) {
    const hand = state.hands?.[seatIndex] || [];
    const trumpSuit = chooseTrump(hand);
    return {
      type: 'chooseTrump',
      payload: { trumpSuit }
    };
  }

  if (state.phase === PHASES.PLAYING && seatIndex === state.turnSeat) {
    const tile = choosePlay(state, seatIndex, safeLevel, rng);
    if (!tile) return null;
    return {
      type: 'playTile',
      payload: { tileId: tile.id }
    };
  }

  return null;
}

export function forcedDealerBidState(state, config = CONFIG_DEFAULTS) {
  const bidderSeat = state.dealerSeat;
  const bidValue = Number(config.minBid || CONFIG_DEFAULTS.minBid);
  return {
    bidderSeat,
    bidValue,
    mode: MODES.TRUMPS,
    trumpSuit: null
  };
}

export function sevensRoundResult(state, trick = state.trick || []) {
  const soloSeat = state.bidderSeat;
  const opponents = (state.activeSeats || []).filter((seat) => seat !== soloSeat);
  const soloPlay = trick.find((play) => play.seatIndex === soloSeat);
  if (!soloPlay) {
    return {
      immediateLoss: true,
      strictSoloWin: false,
      soloDistance: Infinity,
      reason: 'soloMissingPlay'
    };
  }
  const soloDistance = distanceToSeven(soloPlay.tile);

  let immediateLoss = false;
  let strictSoloWin = true;

  for (const opp of opponents) {
    const play = trick.find((p) => p.seatIndex === opp);
    if (!play) continue;
    const d = distanceToSeven(play.tile);
    if (d < soloDistance) immediateLoss = true;
    if (d <= soloDistance) strictSoloWin = false;
  }

  return {
    immediateLoss,
    strictSoloWin,
    soloDistance,
    reason: immediateLoss ? 'opponentCloser' : strictSoloWin ? 'soloCloser' : 'tieDistance'
  };
}
