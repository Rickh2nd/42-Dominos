import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const canvas = document.getElementById("scene");
const statusTextEl = document.getElementById("status-text");
const turnPillEl = document.getElementById("turn-pill");
const seatLabelsEl = document.getElementById("seat-labels");
const ruleBubbleEl = document.getElementById("rule-bubble");
const seatControlsEl = document.getElementById("seat-controls");
const bidControlsEl = document.getElementById("bid-controls");
const trumpControlsEl = document.getElementById("trump-controls");
const eventLogEl = document.getElementById("event-log");
const burnPileTeam1El = document.getElementById("burn-pile-team1");
const burnPileTeam2El = document.getElementById("burn-pile-team2");
const hudTeam1ScoreEl = document.getElementById("hud-team1-score");
const hudTeam2ScoreEl = document.getElementById("hud-team2-score");
const hudBidEl = document.getElementById("hud-bid");
const nameInputEl = document.getElementById("name-input");
const startGameBtn = document.getElementById("start-game-btn");
const restartBtn = document.getElementById("restart-btn");
const roomCodeInputEl = document.getElementById("room-code-input");
const hostRoomBtn = document.getElementById("host-room-btn");
const joinRoomBtn = document.getElementById("join-room-btn");
const copyRoomBtn = document.getElementById("copy-room-btn");
const roomMetaEl = document.getElementById("room-meta");
const modeSelectEl = document.getElementById("mode-select");
const gameWinsTargetLabelEl = document.getElementById("game-wins-target-label");

const state = {
  connected: false,
  clientId: null,
  server: null,
  prevServer: null,
  error: null,
  logs: [],
  playLogKeys: new Set(),
  pendingRoomCode: new URLSearchParams(location.search).get("room")?.toUpperCase() || null
};

const NAME_STORAGE_KEY = "t42_player_name";
const TEAM_BY_SEAT = [0, 1, 0, 1];
const NAMEPLATE_POS_PREFIX = "T42_NAMEPLATE_POS";
const MODE_STRAIGHT = "straight";
const MODE_FOLLOW_ME = "followMe";
const DEFAULT_MARKS_TO_WIN = 7;

const manualNameplatePositions = new Map();
let activeNameplateDrag = null;
const nameplateBidBySeat = new Map();
let nameplateTurnSeat = null;

const ruleBubbleState = {
  text: "",
  logicalSeat: null,
  expiresAt: 0
};

const AVATAR_VERSION = "20260226-human-v1";
const IS_DEV_BUILD = /localhost|127\.0\.0\.1/.test(location.hostname);
const AVATAR_CACHE_TOKEN = IS_DEV_BUILD ? String(Date.now()) : AVATAR_VERSION;
const ENABLE_EXTERNAL_MODELS = false;

const T42_RULES = window.T42_RULES || {};
T42_RULES.mode = T42_RULES.mode === MODE_FOLLOW_ME ? MODE_FOLLOW_ME : MODE_STRAIGHT;
T42_RULES.setMode = function setMode(mode) {
  const nextMode = mode === MODE_FOLLOW_ME ? MODE_FOLLOW_ME : MODE_STRAIGHT;
  T42_RULES.mode = nextMode;
  if (modeSelectEl && modeSelectEl.value !== nextMode) modeSelectEl.value = nextMode;
  send("setGameMode", { mode: nextMode });
  document.dispatchEvent(new CustomEvent("t42:modeChanged", { detail: { mode: nextMode } }));
};
T42_RULES.followMe = {
  ledSuit(leadTile) {
    if (!leadTile) return null;
    return Math.max(Number(leadTile.a) || 0, Number(leadTile.b) || 0);
  },
  tileInSuit(tile, suit) {
    return Number(tile?.a) === suit || Number(tile?.b) === suit;
  },
  suitRank(tile, suit) {
    const a = Number(tile?.a);
    const b = Number(tile?.b);
    if (a === suit && b === suit) return 100;
    if (a === suit) return b;
    if (b === suit) return a;
    return -Infinity;
  }
};
window.T42_RULES = T42_RULES;

let ws;
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener("open", () => {
    state.connected = true;
    pushLog("Connected to saloon table.");
    const enteredName = getEnteredName();
    if (enteredName) send("setName", { name: enteredName });
    renderUI();
    if (state.pendingRoomCode) {
      send("joinRoom", { roomCode: state.pendingRoomCode, name: enteredName });
    }
  });

  ws.addEventListener("close", () => {
    state.connected = false;
    state.server = null;
    pushLog("Disconnected. Reconnecting...");
    renderUI();
    setTimeout(connect, 1200);
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "welcome") {
      state.clientId = msg.clientId;
    } else if (msg.type === "state") {
      capturePlayLogs(state.server, msg);
      state.prevServer = state.server;
      state.server = msg;
      state.pendingRoomCode = msg.roomCode || state.pendingRoomCode;
      if (msg.roomCode) {
        roomCodeInputEl.value = msg.roomCode;
        updateRoomUrl(msg.roomCode);
      }
      if (msg.message) pushLog(msg.message, true);
      renderUI();
      try {
        renderTableFromState();
      } catch (err) {
        console.error("renderTableFromState failed", err);
        pushLog("Render error (see console).");
      }
    } else if (msg.type === "error") {
      state.error = msg.message;
      if (msg.message === "Room not found") {
        state.pendingRoomCode = null;
        updateRoomUrl(null);
      }
      pushLog(`Error: ${msg.message}`);
      renderUI();
    } else if (msg.type === "ruleBubble") {
      showRuleBubble(msg.seatIndex, msg.text, msg.ttlMs);
    }
  });
}

function send(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function sendAction(action) {
  send("action", { action });
}

function loadSavedName() {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveName(name) {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    // ignore storage failures
  }
}

function getEnteredName() {
  const typed = (nameInputEl.value || "").trim();
  const saved = (loadSavedName() || "").trim();
  const picked = typed || saved;
  return picked ? picked.slice(0, 24) : undefined;
}

function pushLog(text, dedupe = false) {
  if (!text) return;
  if (dedupe && state.logs[0] === text) return;
  state.logs.unshift(text);
  state.logs = state.logs.slice(0, 24);
}

function dominoText(tile) {
  return tile ? `[${tile.a}|${tile.b}]` : "[?,?]";
}

function tileCountValue(tile) {
  if (!tile) return 0;
  const a = tile.a;
  const b = tile.b;
  if ((a === 5 && b === 5) || (a === 4 && b === 6)) return 10;
  if ((a === 0 && b === 5) || (a === 1 && b === 4) || (a === 2 && b === 3)) return 5;
  return 0;
}

const BURN_PIP_PATTERN = {
  0: [],
  1: ["mc"],
  2: ["tl", "br"],
  3: ["tl", "mc", "br"],
  4: ["tl", "tr", "bl", "br"],
  5: ["tl", "tr", "mc", "bl", "br"],
  6: ["tl", "ml", "bl", "tr", "mr", "br"]
};

function appendBurnHalfPips(halfEl, value) {
  const pattern = BURN_PIP_PATTERN[value] || [];
  for (const pos of pattern) {
    const pip = document.createElement("span");
    pip.className = `burn-pip ${pos}`;
    halfEl.appendChild(pip);
  }
}

function makeBurnDominoElement(tile) {
  const val = tileCountValue(tile);
  const domino = document.createElement("div");
  domino.className = `burn-domino burn-tile trash-tile${val ? " count" : ""}`;
  domino.dataset.a = String(tile?.a ?? 0);
  domino.dataset.b = String(tile?.b ?? 0);
  domino.title = `${dominoText(tile)} • ${val} count points`;

  const top = document.createElement("div");
  top.className = "burn-half";
  appendBurnHalfPips(top, Number(tile?.a) || 0);

  const bottom = document.createElement("div");
  bottom.className = "burn-half";
  appendBurnHalfPips(bottom, Number(tile?.b) || 0);

  domino.appendChild(top);
  domino.appendChild(bottom);
  applyTrashTileEl(domino, tile);
  return domino;
}

function notePlayLog(key, text) {
  if (!key || state.playLogKeys.has(key)) return;
  state.playLogKeys.add(key);
  pushLog(text);
}

function capturePlayLogs(prev, next) {
  if (!next) return;
  const hand = next.handNumber ?? 0;
  if (!prev || prev.handNumber !== hand) state.playLogKeys.clear();

  const prevTrickLen = prev?.currentTrick?.length ?? 0;
  const nextTrickLen = next.currentTrick?.length ?? 0;
  if (nextTrickLen > prevTrickLen) {
    const trickIndex = next.trickHistory?.length ?? 0;
    for (let i = prevTrickLen; i < nextTrickLen; i += 1) {
      const play = next.currentTrick[i];
      if (!play) continue;
      notePlayLog(`${hand}:t${trickIndex}:p${i}`, `Seat ${play.seat + 1} played ${dominoText(play.tile)}`);
    }
  }

  const prevHistLen = prev?.trickHistory?.length ?? 0;
  const nextHistLen = next.trickHistory?.length ?? 0;
  if (nextHistLen > prevHistLen) {
    for (let t = prevHistLen; t < nextHistLen; t += 1) {
      const trick = next.trickHistory[t];
      if (!trick?.plays) continue;
      const alreadyLogged = t === prevHistLen ? prevTrickLen : 0;
      for (let i = alreadyLogged; i < trick.plays.length; i += 1) {
        const play = trick.plays[i];
        notePlayLog(`${hand}:t${t}:p${i}`, `Seat ${play.seat + 1} played ${dominoText(play.tile)}`);
      }
    }
  }
}

nameInputEl.value = loadSavedName();
nameInputEl.addEventListener("input", () => {
  saveName((nameInputEl.value || "").slice(0, 24));
});
nameInputEl.addEventListener("change", () => {
  const name = getEnteredName();
  if (!name) return;
  send("setName", { name });
});

startGameBtn.addEventListener("click", () => send("startMatch"));
restartBtn.addEventListener("click", () => send("restartMatch"));
hostRoomBtn.addEventListener("click", () => {
  send("createRoom", { name: getEnteredName() });
});
joinRoomBtn.addEventListener("click", () => {
  const code = roomCodeInputEl.value.trim().toUpperCase();
  if (!code) return;
  state.pendingRoomCode = code;
  send("joinRoom", { roomCode: code, name: getEnteredName() });
});
copyRoomBtn.addEventListener("click", async () => {
  const s = state.server;
  if (!s?.roomCode) return;
  const link = new URL(s.shareUrl || `/?room=${s.roomCode}`, location.origin).toString();
  try {
    await navigator.clipboard.writeText(link);
    pushLog(`Copied room link: ${s.roomCode}`);
  } catch {
    pushLog(`Room link: ${link}`);
  }
  renderUI();
});
modeSelectEl?.addEventListener("change", () => {
  window.T42_RULES?.setMode?.(modeSelectEl.value);
});

function getYourSeat() {
  return state.server?.yourSeat ?? null;
}

function toDisplaySeat(logicalSeat) {
  if (logicalSeat == null) return logicalSeat;
  const yourSeat = getYourSeat();
  if (yourSeat == null) return logicalSeat;
  return (logicalSeat - yourSeat + 4) % 4;
}

function toLogicalSeat(displaySeat) {
  const yourSeat = getYourSeat();
  if (yourSeat == null) return displaySeat;
  return (displaySeat + yourSeat) % 4;
}

function normalizeSeatToLogical(seatNumber, { preferOneBased = false } = {}) {
  const n = Number(seatNumber);
  if (!Number.isFinite(n)) return null;
  if (preferOneBased) {
    if (n >= 1 && n <= 4) return n - 1;
    if (n >= 0 && n <= 3) return n;
  } else {
    if (n >= 0 && n <= 3) return n;
    if (n >= 1 && n <= 4) return n - 1;
  }
  return null;
}

function bidValueToText(value) {
  if (value == null) return "";
  if (value === "pass") return "Pass";
  if (value === "mark") return "Mark";
  const n = Number(value);
  if (Number.isInteger(n)) return String(n);
  const text = String(value || "").trim();
  return text || "";
}

function shouldShowBidsForPhase(phase) {
  return phase === "bidding" || phase === "chooseTrump" || phase === "playing" || phase === "trickPause";
}

function syncNameplateStateFromServer(s) {
  if (!s) return;
  nameplateTurnSeat = Number.isInteger(s.turn) ? s.turn : null;
  nameplateBidBySeat.clear();
  if (!shouldShowBidsForPhase(s.phase)) return;
  for (let logicalSeat = 0; logicalSeat < 4; logicalSeat += 1) {
    const rawBid = s.bids?.[logicalSeat];
    const text = bidValueToText(rawBid);
    if (!text) continue;
    let out = text;
    if (s.gameMode === MODE_FOLLOW_ME && Number.isInteger(Number(rawBid))) {
      out = `${Number(rawBid)} • Follow Me`;
    }
    nameplateBidBySeat.set(logicalSeat, out);
  }
}

function applyNameplateDecorations() {
  const labels = seatLabelsEl.querySelectorAll(".seat-label");
  labels.forEach((el) => {
    const logicalSeat = Number(el.dataset.logicalSeat);
    const bid = nameplateBidBySeat.get(logicalSeat) || "";
    let badge = el.querySelector(".seat-bid-badge");
    if (bid) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "seat-bid-badge";
        el.appendChild(document.createElement("br"));
        el.appendChild(badge);
      }
      badge.textContent = `Bid: ${bid}`;
    } else if (badge) {
      const prior = badge.previousSibling;
      if (prior?.nodeName === "BR") prior.remove();
      badge.remove();
    }
    if (logicalSeat === nameplateTurnSeat) el.classList.add("t42-active-turn");
    else el.classList.remove("t42-active-turn");
  });
}

function trumpLabel(n) {
  return `${n}`;
}

function updateRoomUrl(code) {
  const url = new URL(location.href);
  if (code) {
    url.searchParams.set("room", code);
  } else {
    url.searchParams.delete("room");
  }
  history.replaceState(null, "", url);
}

function currentRoomCodeForStorage() {
  return String(state.server?.roomCode || state.pendingRoomCode || "DEFAULT").toUpperCase();
}

function nameplateStorageKey(logicalSeat) {
  return `${NAMEPLATE_POS_PREFIX}:${currentRoomCodeForStorage()}:SEAT${logicalSeat}`;
}

function loadSavedNameplatePos(logicalSeat) {
  try {
    const raw = localStorage.getItem(nameplateStorageKey(logicalSeat));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

function saveNameplatePos(logicalSeat, pos) {
  if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return;
  try {
    localStorage.setItem(nameplateStorageKey(logicalSeat), JSON.stringify({ x: pos.x, y: pos.y }));
  } catch {
    // ignore storage failures
  }
}

function getManualNameplatePos(logicalSeat) {
  const key = nameplateStorageKey(logicalSeat);
  if (manualNameplatePositions.has(key)) return manualNameplatePositions.get(key);
  const loaded = loadSavedNameplatePos(logicalSeat);
  if (loaded) manualNameplatePositions.set(key, loaded);
  return loaded;
}

function setManualNameplatePos(logicalSeat, pos) {
  const key = nameplateStorageKey(logicalSeat);
  if (!pos) {
    manualNameplatePositions.delete(key);
    return;
  }
  manualNameplatePositions.set(key, pos);
}

function clampNameplateToOverlay(x, y, width, height) {
  const rect = canvas.getBoundingClientRect();
  const burnGuard = Math.min(210, rect.width * 0.2);
  const minX = burnGuard;
  const maxX = rect.width - burnGuard;
  const plateLift = 26;
  const minY = 84 - plateLift;
  const maxY = rect.height - 110 - plateLift;
  return {
    x: THREE.MathUtils.clamp(x, minX, Math.max(minX, maxX)),
    y: THREE.MathUtils.clamp(y, minY, Math.max(minY, maxY))
  };
}

function ensureNameplateHandle(el) {
  if (el.querySelector(".t42-drag-handle")) return;
  const handle = document.createElement("span");
  handle.className = "t42-drag-handle";
  handle.title = "Drag label";
  el.appendChild(handle);
}

function startNameplateDrag(event, logicalSeat, el) {
  if (event.button != null && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  const rect = canvas.getBoundingClientRect();
  const currentLeft = parseFloat(el.style.left || "0");
  const currentTop = parseFloat(el.style.top || "0");

  activeNameplateDrag = {
    logicalSeat,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startLeft: Number.isFinite(currentLeft) ? currentLeft : rect.width * 0.5,
    startTop: Number.isFinite(currentTop) ? currentTop : rect.height * 0.5
  };
}

function onGlobalNameplateDragMove(event) {
  if (!activeNameplateDrag) return;
  const dx = event.clientX - activeNameplateDrag.startClientX;
  const dy = event.clientY - activeNameplateDrag.startClientY;
  const next = clampNameplateToOverlay(
    activeNameplateDrag.startLeft + dx,
    activeNameplateDrag.startTop + dy
  );
  setManualNameplatePos(activeNameplateDrag.logicalSeat, next);
  updateSeatLabelPositions();
}

function endGlobalNameplateDrag() {
  if (!activeNameplateDrag) return;
  const pos = getManualNameplatePos(activeNameplateDrag.logicalSeat);
  if (pos) saveNameplatePos(activeNameplateDrag.logicalSeat, pos);
  activeNameplateDrag = null;
}

function dockMarksPanel() {
  const side = document.getElementById("side-panel");
  const marks = document.getElementById("t42-marks-panel");
  if (!side || !marks) return;
  const firstDetails = side.querySelector("details.collapsible");
  if (!firstDetails || firstDetails === marks) return;
  if (firstDetails.nextElementSibling !== marks) {
    firstDetails.insertAdjacentElement("afterend", marks);
  }
}

function normalizeDominoTypos() {
  const root = document.getElementById("side-panel");
  if (!root) return;
  const pattern = /\bdomnio\b|\bdominio\b|\bdominoo\b|\bdominoes\b|\bdominos\b/gi;
  root.querySelectorAll("*").forEach((el) => {
    if (!el.childNodes?.length || el.children.length) return;
    const text = el.textContent;
    pattern.lastIndex = 0;
    if (!text || !pattern.test(text)) return;
    el.textContent = text
      .replace(/\bdomnio\b/gi, "Domino")
      .replace(/\bdominio\b/gi, "Domino")
      .replace(/\bdominoo\b/gi, "Domino")
      .replace(/\bdominoes\b/gi, "Domino")
      .replace(/\bdominos\b/gi, "Domino");
  });
}

function findMarksSection() {
  return (
    document.getElementById("t42-marks-panel") ||
    document.getElementById("marks-panel") ||
    document.getElementById("marks") ||
    document.querySelector(".marks-panel") ||
    document.querySelector(".marks")
  );
}

function findRoomSection() {
  return (
    document.querySelector("#side-panel details.collapsible") ||
    document.getElementById("room-panel") ||
    document.getElementById("room")
  );
}

function ensureMarksMount() {
  let section = findMarksSection();
  if (!section) {
    const roomSection = findRoomSection();
    if (!roomSection) return null;
    section = document.createElement("details");
    section.id = "t42-marks-panel";
    section.className = "panel-block collapsible";
    section.open = true;
    section.innerHTML = `
      <summary><h2>Marks</h2><span class="condense-btn"></span></summary>
      <div class="collapse-body"></div>
    `;
    roomSection.insertAdjacentElement("afterend", section);
  }

  const existingTeam1 = section.querySelector("#t42-marks-team1");
  const existingTeam2 = section.querySelector("#t42-marks-team2");
  const ensureGameWins = () => {
    const hasGameWins = section.querySelector("#t42-gamewins-team1") && section.querySelector("#t42-gamewins-team2");
    if (hasGameWins) return;
    const body = section.querySelector(".collapse-body") || section;
    const sep = document.createElement("div");
    sep.className = "marks-sep";
    const caption = document.createElement("div");
    caption.className = "marks-sub gamewins-caption";
    caption.innerHTML = `Game Wins <span id="game-wins-target-label">(First to ${DEFAULT_MARKS_TO_WIN})</span>`;
    const grid = document.createElement("div");
    grid.className = "marks-grid gamewins-grid";
    grid.innerHTML = `
      <div>
        <div class="marks-sub">Team1</div>
        <div id="t42-gamewins-team1"></div>
      </div>
      <div class="marks-divider"></div>
      <div>
        <div class="marks-sub">Team2</div>
        <div id="t42-gamewins-team2"></div>
      </div>
    `;
    body.append(sep, caption, grid);
  };
  if (existingTeam1 && existingTeam2) {
    ensureGameWins();
    return section;
  }

  let mount = section.querySelector("#t42-marks-mount");
  if (!mount) {
    const body = section.querySelector(".collapse-body") || section;
    mount = document.createElement("div");
    mount.id = "t42-marks-mount";
    mount.className = "t42-marks-mounted";
    mount.innerHTML = `
      <div class="t42-marks-grid">
        <div>
          <div class="t42-marks-sub">Team1</div>
          <div id="t42-marks-team1"></div>
        </div>
        <div class="t42-marks-divider"></div>
        <div>
          <div class="t42-marks-sub">Team2</div>
          <div id="t42-marks-team2"></div>
        </div>
      </div>
    `;
    body.appendChild(mount);
  }
  ensureGameWins();
  return mount;
}

function bootMarksMount() {
  ensureMarksMount();
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    const mount = ensureMarksMount();
    const hasBoth = !!(mount?.querySelector("#t42-marks-team1") && mount?.querySelector("#t42-marks-team2"));
    if (hasBoth || tries >= 20) clearInterval(timer);
  }, 250);
}

function isCountTileBySum(a, b) {
  const s = (Number(a) || 0) + (Number(b) || 0);
  return s === 5 || s === 10;
}

function renderTally(container, n) {
  if (!container) return;
  const count = Math.max(0, Number(n) || 0);
  container.innerHTML = "";
  container.className = "tally-wrap";

  const fives = Math.floor(count / 5);
  const rem = count % 5;

  for (let i = 0; i < fives; i += 1) {
    const g = document.createElement("div");
    g.className = "tally-five";
    for (let b = 0; b < 4; b += 1) {
      const bar = document.createElement("div");
      bar.className = "bar";
      g.appendChild(bar);
    }
    const slash = document.createElement("div");
    slash.className = "slash";
    g.appendChild(slash);
    container.appendChild(g);
  }

  if (rem > 0) {
    const r = document.createElement("div");
    r.className = "tally-rem";
    for (let i = 0; i < rem; i += 1) {
      const bar = document.createElement("div");
      bar.className = "bar";
      r.appendChild(bar);
    }
    container.appendChild(r);
  }
}

function updateHUD({ team1Pts, team1Target, team2Pts, team2Target, bidValue, marks1, marks2 }) {
  if (hudTeam1ScoreEl) hudTeam1ScoreEl.textContent = `${team1Pts}/${team1Target}`;
  if (hudTeam2ScoreEl) hudTeam2ScoreEl.textContent = `${team2Pts}/${team2Target}`;
  if (hudBidEl) hudBidEl.textContent = `${bidValue}`;
  if (marks1 != null || marks2 != null) {
    updateMarks({ marks1, marks2 });
  }
}

function updateMarks({ marks1, marks2 }) {
  ensureMarksMount();
  const m1 = document.getElementById("t42-marks-team1");
  const m2 = document.getElementById("t42-marks-team2");
  const safe1 = Math.max(0, Number(marks1) || 0);
  const safe2 = Math.max(0, Number(marks2) || 0);
  renderTally(m1, safe1);
  renderTally(m2, safe2);
  updateGameWins({ wins1: safe1, wins2: safe2, target: state.server?.marksToWin ?? DEFAULT_MARKS_TO_WIN });
}

function updateGameWins({ wins1, wins2, target }) {
  const w1 = Math.max(0, Number(wins1) || 0);
  const w2 = Math.max(0, Number(wins2) || 0);
  const t = Number.isFinite(Number(target)) ? Number(target) : (state.server?.marksToWin ?? DEFAULT_MARKS_TO_WIN);
  const g1 = document.getElementById("t42-gamewins-team1");
  const g2 = document.getElementById("t42-gamewins-team2");
  renderTally(g1, w1);
  renderTally(g2, w2);
  if (gameWinsTargetLabelEl) gameWinsTargetLabelEl.textContent = `(First to ${t})`;
}

function applyTrashTileEl(tileEl, tile) {
  if (!tileEl || !tile) return;
  if (isCountTileBySum(tile.a, tile.b)) tileEl.classList.add("count-tile");
  else tileEl.classList.remove("count-tile");
}

function refreshBurnHighlights(rootSelector = document, tileSelector = ".burn-tile") {
  const root = rootSelector instanceof Element ? rootSelector : document;
  const tiles = root.querySelectorAll(tileSelector);
  tiles.forEach((node) => {
    const a = Number(node.getAttribute("data-a"));
    const b = Number(node.getAttribute("data-b"));
    applyTrashTileEl(node, { a, b });
  });
}

function moveWonTilesToBurnPile({ winningTeam, tiles }) {
  const targetPanel = winningTeam === "team2" ? burnPileTeam2El : burnPileTeam1El;
  if (!targetPanel) return;
  let wrap = targetPanel.querySelector(".burn-tiles");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "burn-tiles";
    targetPanel.appendChild(wrap);
  }
  if (!Array.isArray(tiles) || !tiles.length) return;
  for (const tile of tiles) {
    if (tile == null || tile.a == null || tile.b == null) continue;
    wrap.appendChild(makeBurnDominoElement(tile));
  }
  refreshBurnHighlights(targetPanel, ".burn-tile");
}

window.T42_UI = {
  updateHUD,
  updateMarks,
  setMarks: updateMarks,
  setGameWins: updateGameWins,
  setTurnBySeat(seatNumber) {
    const logical = normalizeSeatToLogical(seatNumber, { preferOneBased: true });
    if (logical == null) return;
    nameplateTurnSeat = logical;
    applyNameplateDecorations();
  },
  setBidBySeat(seatNumber, bidText) {
    const logical = normalizeSeatToLogical(seatNumber, { preferOneBased: true });
    if (logical == null) return;
    const text = String(bidText || "").trim();
    if (!text) nameplateBidBySeat.delete(logical);
    else nameplateBidBySeat.set(logical, text);
    applyNameplateDecorations();
  },
  clearAllBids() {
    nameplateBidBySeat.clear();
    applyNameplateDecorations();
  },
  isCountTile: isCountTileBySum,
  refreshBurnHighlights,
  moveWonTilesToBurnPile,
  applyTrashTileEl,
  refreshTrashHighlights: refreshBurnHighlights
};

function createRoundController() {
  const round = {
    team1Pts: 0,
    team2Pts: 0,
    team1Target: 13,
    team2Target: 30,
    marks1: 0,
    marks2: 0,
    bidValue: 0,
    roundEnded: false,
    freezeGameplay: true,
    _freezeInstalled: false,
    _blocker: null,
    _syncingFromServer: false,
    onRoundEnd: null,

    setTargets({ team1Target, team2Target }) {
      if (Number.isFinite(team1Target)) this.team1Target = Number(team1Target);
      if (Number.isFinite(team2Target)) this.team2Target = Number(team2Target);
      this._syncHUD();
      this._checkEnd();
    },

    setMarks({ marks1, marks2 }) {
      if (Number.isFinite(marks1)) this.marks1 = Number(marks1);
      if (Number.isFinite(marks2)) this.marks2 = Number(marks2);
      this._syncMarks();
    },

    setPoints({ team1Pts, team2Pts }) {
      if (this.roundEnded && !this._syncingFromServer) return;
      if (Number.isFinite(team1Pts)) this.team1Pts = Number(team1Pts);
      if (Number.isFinite(team2Pts)) this.team2Pts = Number(team2Pts);
      this._syncHUD();
      this._checkEnd();
    },

    addPoints(team, delta) {
      if (this.roundEnded) return;
      const d = Number(delta) || 0;
      if (team === "team1") this.team1Pts += d;
      else if (team === "team2") this.team2Pts += d;
      this._syncHUD();
      this._checkEnd();
    },

    resetRound({ team1Pts = 0, team2Pts = 0, keepMarks = true } = {}) {
      this.team1Pts = Number(team1Pts) || 0;
      this.team2Pts = Number(team2Pts) || 0;
      this.roundEnded = false;
      if (!keepMarks) {
        this.marks1 = 0;
        this.marks2 = 0;
      }
      this._unfreezeIfNeeded();
      this._syncHUD();
      this._syncMarks();
    },

    applyServerSnapshot({ team1Pts, team2Pts, team1Target, team2Target, bidValue, marks1, marks2, roundEnded }) {
      this._syncingFromServer = true;
      this.team1Pts = Number(team1Pts) || 0;
      this.team2Pts = Number(team2Pts) || 0;
      this.team1Target = Number(team1Target) || 13;
      this.team2Target = Number(team2Target) || 30;
      this.bidValue = Number(bidValue) || 0;
      this.marks1 = Number(marks1) || 0;
      this.marks2 = Number(marks2) || 0;
      this.roundEnded = !!roundEnded;
      if (this.roundEnded && this.freezeGameplay) this._freezeInputs();
      else this._unfreezeIfNeeded();
      this._syncHUD();
      this._syncMarks();
      this._syncingFromServer = false;
    },

    _checkEnd() {
      if (this._syncingFromServer) return;
      if (this.roundEnded) return;

      const t1Win = this.team1Pts >= this.team1Target;
      const t2Win = this.team2Pts >= this.team2Target;
      if (!t1Win && !t2Win) return;

      let winnerTeam = "team1";
      if (t1Win && !t2Win) winnerTeam = "team1";
      else if (t2Win && !t1Win) winnerTeam = "team2";
      else {
        const over1 = this.team1Pts - this.team1Target;
        const over2 = this.team2Pts - this.team2Target;
        winnerTeam = over2 > over1 ? "team2" : "team1";
      }

      this.roundEnded = true;
      if (winnerTeam === "team1") this.marks1 += 1;
      else this.marks2 += 1;

      if (this.freezeGameplay) this._freezeInputs();
      this._syncHUD();
      this._syncMarks();

      if (typeof this.onRoundEnd === "function") {
        try {
          this.onRoundEnd({
            winnerTeam,
            team1Pts: this.team1Pts,
            team2Pts: this.team2Pts,
            team1Target: this.team1Target,
            team2Target: this.team2Target,
            marks1: this.marks1,
            marks2: this.marks2
          });
        } catch (err) {
          console.error("T42_ROUND onRoundEnd error:", err);
        }
      }
    },

    _syncHUD() {
      window.T42_UI?.updateHUD?.({
        team1Pts: this.team1Pts,
        team1Target: this.team1Target,
        team2Pts: this.team2Pts,
        team2Target: this.team2Target,
        bidValue: this.bidValue
      });
    },

    _syncMarks() {
      window.T42_UI?.updateMarks?.({ marks1: this.marks1, marks2: this.marks2 });
    },

    _freezeInputs() {
      if (this._freezeInstalled) return;
      this._freezeInstalled = true;
      const blocker = (e) => {
        if (!this.roundEnded) return;
        const target = e.target;
        const allow = target &&
          (target.closest?.("#restart-btn, #start-game-btn, #host-room-btn, #join-room-btn") ||
           /restart|next|new hand|start|host|join/i.test(target.textContent || ""));
        if (allow) return;
        e.preventDefault();
        e.stopPropagation();
      };
      document.addEventListener("pointerdown", blocker, true);
      document.addEventListener("click", blocker, true);
      document.addEventListener("keydown", blocker, true);
      this._blocker = blocker;
    },

    _unfreezeIfNeeded() {
      if (!this._freezeInstalled || !this._blocker) return;
      document.removeEventListener("pointerdown", this._blocker, true);
      document.removeEventListener("click", this._blocker, true);
      document.removeEventListener("keydown", this._blocker, true);
      this._freezeInstalled = false;
      this._blocker = null;
    }
  };
  return round;
}

window.T42_ROUND = window.T42_ROUND || createRoundController();

function updateHudFromState(s) {
  const bid = Number.isInteger(s.highestBid) ? s.highestBid : 0;
  let team1Target = Number.isFinite(s?.teamTargets?.[0]) ? s.teamTargets[0] : 13;
  let team2Target = Number.isFinite(s?.teamTargets?.[1]) ? s.teamTargets[1] : 30;
  if (Number.isInteger(s.highestBid) && Number.isInteger(s.highestBidder) && (s.phase === "bidding" || s.phase === "chooseTrump")) {
    const biddingTeam = TEAM_BY_SEAT[s.highestBidder];
    const bidValue = Number(s.highestBid);
    const defendTarget = 43 - bidValue;
    if (biddingTeam === 0) {
      team1Target = bidValue;
      team2Target = defendTarget;
    } else {
      team2Target = bidValue;
      team1Target = defendTarget;
    }
  }

  const marks1 = Number.isFinite(s?.marks?.[0]) ? s.marks[0] : Math.floor((s.scores?.[0] ?? 0) / 42);
  const marks2 = Number.isFinite(s?.marks?.[1]) ? s.marks[1] : Math.floor((s.scores?.[1] ?? 0) / 42);
  const marksToWin = Number.isFinite(s?.marksToWin) ? s.marksToWin : DEFAULT_MARKS_TO_WIN;
  window.T42_ROUND?.applyServerSnapshot?.({
    team1Pts: s.handPoints?.[0] ?? 0,
    team2Pts: s.handPoints?.[1] ?? 0,
    team1Target,
    team2Target,
    bidValue: bid,
    marks1,
    marks2,
    roundEnded: s.phase === "handOver" || s.phase === "gameOver"
  });
  window.T42_UI?.setGameWins?.({ wins1: marks1, wins2: marks2, target: marksToWin });
}

function renderUI() {
  const s = state.server;
  dockMarksPanel();
  ensureMarksMount();
  normalizeDominoTypos();
  statusTextEl.textContent = s?.message || (state.connected ? "Host or join a room to start." : "Connecting...");

  if (!s) {
    turnPillEl.textContent = state.connected ? "No room joined" : "Offline";
    roomMetaEl.textContent = state.connected ? "Create a room to host, or enter a code to join a friend's table." : "Connecting to server...";
    startGameBtn.disabled = true;
    restartBtn.disabled = true;
    seatControlsEl.innerHTML = "";
    bidControlsEl.innerHTML = "";
    trumpControlsEl.innerHTML = "";
    seatLabelsEl.innerHTML = "";
    nameplateBidBySeat.clear();
    nameplateTurnSeat = null;
    burnPileTeam1El.innerHTML = "";
    burnPileTeam2El.innerHTML = "";
    if (window.T42_UI?.updateHUD) {
      window.T42_UI.updateHUD({
        team1Pts: 0,
        team1Target: 13,
        team2Pts: 0,
        team2Target: 30,
        bidValue: 0
      });
    }
    window.T42_UI?.updateMarks?.({ marks1: 0, marks2: 0 });
    window.T42_UI?.setGameWins?.({ wins1: 0, wins2: 0, target: DEFAULT_MARKS_TO_WIN });
    if (modeSelectEl) {
      modeSelectEl.value = MODE_STRAIGHT;
      modeSelectEl.disabled = true;
    }
    if (gameWinsTargetLabelEl) gameWinsTargetLabelEl.textContent = `(First to ${DEFAULT_MARKS_TO_WIN})`;
    T42_RULES.mode = MODE_STRAIGHT;
    window.T42_ROUND?.applyServerSnapshot?.({
      team1Pts: 0,
      team2Pts: 0,
      team1Target: 13,
      team2Target: 30,
      bidValue: 0,
      marks1: 0,
      marks2: 0,
      roundEnded: false
    });
    hideRuleBubble();
    renderLog();
    return;
  }

  const mode = s.gameMode === MODE_FOLLOW_ME ? MODE_FOLLOW_ME : MODE_STRAIGHT;
  T42_RULES.mode = mode;
  if (modeSelectEl) {
    modeSelectEl.value = mode;
    modeSelectEl.disabled = !(s.isHost && (s.phase === "lobby" || s.phase === "handOver"));
  }
  if (gameWinsTargetLabelEl) {
    const target = Number.isFinite(s?.marksToWin) ? s.marksToWin : DEFAULT_MARKS_TO_WIN;
    gameWinsTargetLabelEl.textContent = `(First to ${target})`;
  }

  const modeLabel = mode === MODE_FOLLOW_ME ? "Follow Me" : "Straight";
  turnPillEl.textContent = s.turn != null
    ? `Turn: Seat ${s.turn + 1} | ${modeLabel} | Room ${s.roomCode}`
    : `Phase: ${s.phase} | ${modeLabel} | Room ${s.roomCode}`;
  roomMetaEl.innerHTML = `Room <strong>${s.roomCode}</strong> | ${s.isHost ? "Host" : "Guest"} | ${s.roomPlayerCount} online<br>Share code or use Copy Link.`;
  copyRoomBtn.disabled = !s.roomCode;
  startGameBtn.disabled = !(s.isHost && s.phase === "lobby");
  restartBtn.disabled = !s.isHost;
  const yourSeat = getYourSeat();
  if (yourSeat != null) {
    const myName = s.seats?.[yourSeat]?.name;
    if (myName && myName !== nameInputEl.value) {
      nameInputEl.value = myName;
      saveName(myName);
    }
  }

  renderSeatControls(s);
  updateHudFromState(s);
  renderBidControls(s);
  renderTrumpControls(s);
  renderBurnPiles(s);
  renderLog();
}

function hideRuleBubble() {
  ruleBubbleState.text = "";
  ruleBubbleState.logicalSeat = null;
  ruleBubbleState.expiresAt = 0;
  ruleBubbleEl.classList.remove("visible");
}

function showRuleBubble(logicalSeat, text, ttlMs = 2600) {
  if (!text) return;
  ruleBubbleState.text = String(text);
  ruleBubbleState.logicalSeat = Number.isInteger(logicalSeat) ? logicalSeat : 0;
  ruleBubbleState.expiresAt = performance.now() + Math.max(900, Number(ttlMs) || 2600);
  ruleBubbleEl.textContent = ruleBubbleState.text;
  ruleBubbleEl.classList.add("visible");
  updateRuleBubblePosition();
}

function renderSeatControls(s) {
  const yourSeat = getYourSeat();
  seatControlsEl.innerHTML = "";
  s.seats.forEach((seat) => {
    const row = document.createElement("div");
    row.className = "seat-row";

    const info = document.createElement("div");
    const me = yourSeat === seat.seatIndex ? " (You)" : "";
    info.innerHTML = `<span class="name">Seat ${seat.seatIndex + 1}: ${seat.name}${me}</span><span class="meta">${seat.kind === "bot" ? `CPU difficulty ${seat.difficulty}` : "Human online"}</span>`;
    row.appendChild(info);

    if (seat.kind === "bot") {
      const select = document.createElement("select");
      [1, 2, 3, 4, 5].forEach((d) => {
        const opt = document.createElement("option");
        opt.value = String(d);
        opt.textContent = `CPU ${d}`;
        if (seat.difficulty === d) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener("change", () => {
        send("setBotDifficulty", { seatIndex: seat.seatIndex, difficulty: Number(select.value) });
      });
      row.appendChild(select);
    } else {
      const spacer = document.createElement("div");
      row.appendChild(spacer);
    }

    const btn = document.createElement("button");
    if (yourSeat === seat.seatIndex) {
      btn.textContent = "Leave";
      btn.className = "warn";
      btn.onclick = () => send("leaveSeat");
    } else if (seat.kind === "bot") {
      btn.textContent = yourSeat == null ? "Take Seat" : "Switch";
      btn.className = "primary";
      btn.onclick = () => send("claimSeat", { seatIndex: seat.seatIndex, name: getEnteredName() });
    } else {
      btn.textContent = "Taken";
      btn.disabled = true;
    }
    row.appendChild(btn);

    seatControlsEl.appendChild(row);
  });
}

function renderBidControls(s) {
  bidControlsEl.innerHTML = "";
  const canBid = s.phase === "bidding" && s.bidTurn === s.yourSeat;
  const winningBid = Number.isInteger(s.highestBid) ? s.highestBid : null;
  const followMode = s.gameMode === MODE_FOLLOW_ME;

  const passBtn = document.createElement("button");
  passBtn.textContent = "Pass";
  passBtn.disabled = !canBid;
  passBtn.onclick = () => sendAction({ type: "bid", value: null });
  bidControlsEl.appendChild(passBtn);

  if (followMode) {
    const modeBtn = document.createElement("button");
    modeBtn.textContent = "Follow Me";
    modeBtn.classList.add("active-choice");
    modeBtn.disabled = true;
    bidControlsEl.appendChild(modeBtn);
  }

  const minBid = s.highestBid == null ? 30 : s.highestBid + 1;
  for (let bid = 30; bid <= 42; bid += 1) {
    const btn = document.createElement("button");
    btn.textContent = String(bid);
    if (winningBid === bid) btn.classList.add("active-choice");
    btn.disabled = !canBid || bid < minBid;
    btn.onclick = () => sendAction({ type: "bid", value: bid });
    bidControlsEl.appendChild(btn);
  }
}

function renderTrumpControls(s) {
  trumpControlsEl.innerHTML = "";
  if (s.gameMode === MODE_FOLLOW_ME) {
    const btn = document.createElement("button");
    btn.textContent = "Follow Me (No Trump)";
    btn.className = "active-choice";
    btn.disabled = true;
    trumpControlsEl.appendChild(btn);
    return;
  }
  const canChoose = s.phase === "chooseTrump" && s.highestBidder === s.yourSeat;
  for (let trump = 0; trump <= 6; trump += 1) {
    const btn = document.createElement("button");
    btn.textContent = trumpLabel(trump);
    if (s.trump === trump) btn.classList.add("active-choice");
    btn.disabled = !canChoose;
    btn.onclick = () => sendAction({ type: "chooseTrump", trump });
    trumpControlsEl.appendChild(btn);
  }
}

function renderLog() {
  eventLogEl.innerHTML = "";
  for (const entry of state.logs.slice(0, 12)) {
    const div = document.createElement("div");
    div.className = "log-entry";
    div.textContent = entry;
    eventLogEl.appendChild(div);
  }
}

function renderBurnPilePanel(el, teamIndex, s) {
  const tiles = Array.isArray(s?.wonTiles?.[teamIndex]) ? s.wonTiles[teamIndex] : [];
  const burnCountPoints = tiles.reduce((sum, tile) => sum + tileCountValue(tile), 0);
  const liveHandScore = s?.handPoints?.[teamIndex] ?? 0;
  el.innerHTML = "";

  const title = document.createElement("div");
  title.className = "burn-title";
  title.textContent = `Team ${teamIndex + 1} Burn Pile`;
  el.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "burn-meta";
  meta.textContent = `Tiles: ${tiles.length} | Count pts: ${burnCountPoints} | Hand: ${liveHandScore}`;
  el.appendChild(meta);

  const tilesWrap = document.createElement("div");
  tilesWrap.className = "burn-tiles";
  if (!tiles.length) {
    const empty = document.createElement("div");
    empty.className = "burn-empty";
    empty.textContent = "No tiles won yet";
    tilesWrap.appendChild(empty);
  } else {
    tiles.slice().reverse().forEach((tile) => {
      tilesWrap.appendChild(makeBurnDominoElement(tile));
    });
  }
  el.appendChild(tilesWrap);
}

function renderBurnPiles(s) {
  renderBurnPilePanel(burnPileTeam1El, 0, s);
  renderBurnPilePanel(burnPileTeam2El, 1, s);
  window.T42_UI?.refreshBurnHighlights?.(document, ".burn-tile");
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
if ("useLegacyLights" in renderer) renderer.useLegacyLights = false;
if ("physicallyCorrectLights" in renderer) renderer.physicallyCorrectLights = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x2a2017, 1);
const maxAnisotropy = Math.max(1, renderer.capabilities.getMaxAnisotropy?.() ?? 1);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();
let envMapTexture = null;
let envPMREMTarget = null;
let roomEnvFallbackTarget = null;

function countShadowCasters(root) {
  let count = 0;
  root.traverse((node) => {
    if (node.isMesh && node.castShadow) count += 1;
  });
  return count;
}

function logGraphicsDebug(label = "graphics-debug") {
  const lightCount = [];
  scene.traverse((obj) => {
    if (obj.isLight) lightCount.push({ type: obj.type, castShadow: !!obj.castShadow, intensity: obj.intensity ?? null });
  });
  console.log(`[${label}]`, {
    environment: !!scene.environment,
    background: scene.background?.isTexture ? "texture" : (scene.background?.getHexString?.() ?? null),
    toneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure,
    outputColorSpace: renderer.outputColorSpace,
    shadowMapEnabled: renderer.shadowMap.enabled,
    shadowType: renderer.shadowMap.type,
    lights: lightCount,
    shadowCasters: countShadowCasters(scene)
  });
}

window.__dominoGraphicsDebug = () => logGraphicsDebug("manual");

async function loadHDRIEnvironment() {
  if (!ENABLE_EXTERNAL_MODELS) return;
  try {
    const { RGBELoader } = await import("https://unpkg.com/three@0.160.0/examples/jsm/loaders/RGBELoader.js?module");
    const hdr = await new RGBELoader().loadAsync("/hdr/warm_interior_01.hdr");
    envPMREMTarget?.dispose?.();
    envPMREMTarget = pmremGenerator.fromEquirectangular(hdr);
    envMapTexture = envPMREMTarget.texture;
    scene.environment = envMapTexture;
    hdr.dispose();
    logGraphicsDebug("hdr-loaded");
  } catch {
    try {
      const { RoomEnvironment } = await import("https://unpkg.com/three@0.160.0/examples/jsm/environments/RoomEnvironment.js?module");
      roomEnvFallbackTarget?.dispose?.();
      roomEnvFallbackTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
      scene.environment = roomEnvFallbackTarget.texture;
      console.warn("HDRI missing; using RoomEnvironment IBL fallback");
      logGraphicsDebug("room-env-fallback");
    } catch {
      console.warn("HDRI environment not found at /hdr/warm_interior_01.hdr (using light-only fallback)");
      logGraphicsDebug("hdr-fallback");
    }
  }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2017);
scene.fog = new THREE.FogExp2(0x2f241b, 0.02);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 9.8, 9.6);
camera.lookAt(0, 0.8, 0);

const hemi = new THREE.HemisphereLight(0xa17f5f, 0x221a14, 0.38);
scene.add(hemi);

const warmSpot = new THREE.SpotLight(0xffc980, 90, 18, Math.PI * 0.33, 0.42, 1.35);
warmSpot.position.set(0.3, 7.8, 0.4);
warmSpot.target.position.set(0, 0.3, 0);
warmSpot.castShadow = true;
warmSpot.shadow.mapSize.set(1536, 1536);
warmSpot.shadow.bias = -0.00012;
warmSpot.shadow.radius = 4;
scene.add(warmSpot, warmSpot.target);

const sun = new THREE.DirectionalLight(0xc7c8d2, 0.22);
sun.position.set(-6, 8, -7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
sun.shadow.camera.near = 0.1;
sun.shadow.camera.far = 30;
scene.add(sun);

const rim1 = new THREE.PointLight(0xd39a5b, 1.2, 24);
rim1.position.set(-7, 2.5, -5);
const rim2 = new THREE.PointLight(0x8ca0c7, 0.45, 18);
rim2.position.set(6.5, 2.4, 6.5);
const fill = new THREE.PointLight(0xd4b38d, 0.6, 16);
fill.position.set(0, 2.2, 6.2);
scene.add(rim1, rim2, fill);

function makeCanvasTexture(width, height, drawFn, options = {}) {
  const { colorSpace = THREE.SRGBColorSpace } = options;
  const cvs = document.createElement("canvas");
  cvs.width = width;
  cvs.height = height;
  const ctx = cvs.getContext("2d");
  drawFn(ctx, width, height);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(12, maxAnisotropy);
  return tex;
}

function setMeshShadows(obj, cast = true, receive = true) {
  obj.traverse?.((node) => {
    if (node.isMesh) {
      node.castShadow = cast;
      node.receiveShadow = receive;
    }
  });
}

const tableWoodTex = makeCanvasTexture(1024, 1024, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#8c633f");
  g.addColorStop(0.5, "#6f4e33");
  g.addColorStop(1, "#5c402a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 28) {
    ctx.strokeStyle = `rgba(255,230,190,${0.012 + Math.random() * 0.02})`;
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(y * 0.02) * 4);
    ctx.bezierCurveTo(w * 0.25, y + 8, w * 0.75, y - 6, w, y + 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(45,28,18,0.04)";
    ctx.beginPath();
    ctx.moveTo(0, y + 10);
    ctx.bezierCurveTo(w * 0.3, y + 15, w * 0.6, y + 4, w, y + 12);
    ctx.stroke();
  }
  for (let i = 0; i < 220; i += 1) {
    ctx.strokeStyle = `rgba(35,20,12,${0.05 + Math.random() * 0.08})`;
    ctx.lineWidth = 1;
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() * 36 - 18), y + (Math.random() * 8 - 4));
    ctx.stroke();
  }
  for (let i = 0; i < 24; i += 1) {
    ctx.strokeStyle = "rgba(46,29,18,0.1)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 22, 0, Math.PI * 2);
    ctx.stroke();
  }
});
tableWoodTex.repeat.set(2, 2);

const tableBumpTex = makeCanvasTexture(1024, 1024, (ctx, w, h) => {
  ctx.fillStyle = "#7f7f7f";
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) {
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(y * 0.04) * 3);
    ctx.bezierCurveTo(w * 0.25, y - 5, w * 0.75, y + 7, w, y);
    ctx.stroke();
  }
  for (let i = 0; i < 320; i += 1) {
    const shade = 110 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1);
  }
}, { colorSpace: THREE.NoColorSpace });
tableBumpTex.repeat.set(2, 2);

const feltTex = makeCanvasTexture(1024, 1024, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w * 0.45, h * 0.45, 80, w * 0.5, h * 0.5, w * 0.65);
  g.addColorStop(0, "#5d815f");
  g.addColorStop(0.5, "#476a4c");
  g.addColorStop(1, "#35523c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(235,215,168,0.18)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.5, w * 0.34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(20,12,8,0.18)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.5, w * 0.29, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(224,202,154,0.08)";
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.42);
  ctx.lineTo(w * 0.54, h * 0.5);
  ctx.lineTo(w * 0.5, h * 0.58);
  ctx.lineTo(w * 0.46, h * 0.5);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 18000; i += 1) {
    const alpha = Math.random() * 0.08;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
});
feltTex.repeat.set(1.4, 1.4);

const feltBumpTex = makeCanvasTexture(512, 512, (ctx, w, h) => {
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 5000; i += 1) {
    const v = 120 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}, { colorSpace: THREE.NoColorSpace });
feltBumpTex.repeat.set(2, 2);

const wallWoodTex = makeCanvasTexture(512, 512, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#8c694b");
  g.addColorStop(1, "#6f523b");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i += 1) {
    const x = (i / 16) * w;
    ctx.fillStyle = i % 2 ? "rgba(40,26,17,0.07)" : "rgba(255,220,180,0.03)";
    ctx.fillRect(x, 0, w / 16, h);
    ctx.strokeStyle = "rgba(36,23,15,0.2)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 2, 0);
    ctx.lineTo(x + 2, h);
    ctx.stroke();
  }
  for (let i = 0; i < 24; i += 1) {
    ctx.strokeStyle = "rgba(54,34,22,0.14)";
    ctx.beginPath();
    const y = Math.random() * h;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.25, y - 10, w * 0.75, y + 12, w, y + 2);
    ctx.stroke();
  }
});
wallWoodTex.repeat.set(4, 2);

const floorBoardTex = makeCanvasTexture(1024, 1024, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#7a573d");
  g.addColorStop(1, "#5a3f2c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const boardW = 56;
  for (let x = 0; x < w; x += boardW) {
    ctx.fillStyle = ((x / boardW) % 2) ? "rgba(255,225,186,0.03)" : "rgba(24,14,8,0.06)";
    ctx.fillRect(x, 0, boardW, h);
    ctx.strokeStyle = "rgba(40,25,16,0.28)";
    ctx.strokeRect(x + 1, 0, boardW - 2, h);
    for (let y = 0; y < h; y += 120) {
      ctx.fillStyle = "rgba(36,21,13,0.18)";
      ctx.fillRect(x + 8 + Math.random() * (boardW - 16), y + 8 + Math.random() * 18, 3, 9);
    }
  }
});
floorBoardTex.repeat.set(1.15, 1.15);

const room = new THREE.Mesh(
  new THREE.BoxGeometry(26, 12, 26),
  new THREE.MeshStandardMaterial({ color: 0x7a5a41, map: wallWoodTex, roughness: 0.96, metalness: 0.01, side: THREE.BackSide })
);
room.position.y = 5.2;
room.receiveShadow = true;
scene.add(room);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(11, 48),
  new THREE.MeshStandardMaterial({ color: 0x6b4a33, map: floorBoardTex, roughness: 0.94, metalness: 0.02 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.85;
floor.receiveShadow = true;
scene.add(floor);

const tableContactShadow = new THREE.Mesh(
  new THREE.CircleGeometry(5.8, 48),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16 })
);
tableContactShadow.rotation.x = -Math.PI / 2;
tableContactShadow.position.y = -0.82;
scene.add(tableContactShadow);

const saloonSet = new THREE.Group();
scene.add(saloonSet);

const beamMat = new THREE.MeshStandardMaterial({ color: 0x5d402c, roughness: 0.85, metalness: 0.02 });
for (const x of [-9, -3, 3, 9]) {
  for (const z of [-10.8, 10.8]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.7, 0.5), beamMat);
    post.position.set(x, 2.0, z);
    saloonSet.add(post);
  }
}
for (const z of [-10.8, 10.8]) {
  const beam = new THREE.Mesh(new THREE.BoxGeometry(20.8, 0.42, 0.5), beamMat);
  beam.position.set(0, 4.92, z);
  saloonSet.add(beam);
}

function makePosterTexture(title, accent = "#9a553c") {
  return makeCanvasTexture(256, 384, (ctx, w, h) => {
    ctx.fillStyle = "#d7c39e";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#6e4a30";
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = accent;
    ctx.fillRect(18, 18, w - 36, 42);
    ctx.fillStyle = "#2a1b11";
    ctx.textAlign = "center";
    ctx.font = "bold 24px serif";
    ctx.fillText(title, w / 2, 46);
    ctx.font = "18px serif";
    ctx.fillText("SALOON", w / 2, 98);
    ctx.font = "15px serif";
    ctx.fillText("DOMINO TOURNAMENT", w / 2, 154);
    ctx.fillText("NO CHEATIN' / NO SHOOTIN'", w / 2, 183);
    ctx.fillStyle = "rgba(77,52,34,0.18)";
    for (let i = 0; i < 320; i += 1) ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    ctx.fillRect(28, 232, w - 56, 98);
  });
}

const posterMat1 = new THREE.MeshStandardMaterial({ map: makePosterTexture("WANTED", "#a14c36"), roughness: 0.95 });
const poster1 = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3), posterMat1);
poster1.position.set(-11.8, 3.1, -4.6);
poster1.rotation.y = Math.PI / 2;
saloonSet.add(poster1);

const posterMat2 = new THREE.MeshStandardMaterial({ map: makePosterTexture("WHISKEY", "#7a5f2b"), roughness: 0.95 });
const poster2 = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 3.05), posterMat2);
poster2.position.set(11.8, 3.15, 4.1);
poster2.rotation.y = -Math.PI / 2;
saloonSet.add(poster2);

for (const x of [-6.1, 6.1]) {
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.65, 0.18), beamMat);
  frame.position.set(x, 4.05, -11.85);
  saloonSet.add(frame);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 2.1),
    new THREE.MeshBasicMaterial({ color: 0xffe8b2, transparent: true, opacity: 0.6 })
  );
  glass.position.set(x, 4.05, -11.73);
  saloonSet.add(glass);
  const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.08, 0.07), beamMat);
  vBar.position.set(x, 4.05, -11.76);
  const hBar = new THREE.Mesh(new THREE.BoxGeometry(2.95, 0.1, 0.07), beamMat);
  hBar.position.set(x, 4.05, -11.76);
  saloonSet.add(vBar, hBar);
}

const overlayPanels = new THREE.Group();
scene.add(overlayPanels);
for (const z of [-12.35, 12.35]) {
  const p = new THREE.Mesh(
    new THREE.PlaneGeometry(18.5, 4.2),
    new THREE.MeshStandardMaterial({ color: 0x856044, transparent: true, opacity: 0.24, roughness: 0.95 })
  );
  p.position.set(0, 2.15, z);
  if (z > 0) p.rotation.y = Math.PI;
  overlayPanels.add(p);
}

const lightShafts = new THREE.Group();
scene.add(lightShafts);
for (const x of [-5.8, 6]) {
  const shaft = new THREE.Mesh(
    new THREE.PlaneGeometry(2.7, 8.0),
    new THREE.MeshBasicMaterial({ color: 0xffe7b0, transparent: true, opacity: 0.085, side: THREE.DoubleSide, depthWrite: false })
  );
  shaft.position.set(x, 3.1, -6.0);
  shaft.rotation.set(-0.55, 0, x < 0 ? 0.18 : -0.18);
  lightShafts.add(shaft);
}

const lanternGroup = new THREE.Group();
scene.add(lanternGroup);
const lanternMetal = new THREE.MeshStandardMaterial({ color: 0x433128, roughness: 0.7, metalness: 0.18 });
const lanternGlass = new THREE.MeshPhysicalMaterial({
  color: 0xffd79a,
  emissive: 0xffb25a,
  emissiveIntensity: 0.35,
  transmission: 0.25,
  transparent: true,
  opacity: 0.82,
  roughness: 0.15,
  metalness: 0
});
const lanternChain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.15, 8), lanternMetal);
lanternChain.position.set(0.3, 7.25, 0.4);
const lanternCap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.12, 14), lanternMetal);
lanternCap.position.set(0.3, 6.62, 0.4);
const lanternBody = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.42, 14), lanternGlass);
lanternBody.position.set(0.3, 6.38, 0.4);
const lanternBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.1, 14), lanternMetal);
lanternBottom.position.set(0.3, 6.15, 0.4);
lanternGroup.add(lanternChain, lanternCap, lanternBody, lanternBottom);

const cornerDepthGroup = new THREE.Group();
scene.add(cornerDepthGroup);
for (const [x, z, ry] of [[-11.7, -11.4, Math.PI / 4], [11.7, -11.4, -Math.PI / 4], [-11.7, 11.4, -Math.PI / 4], [11.7, 11.4, Math.PI / 4]]) {
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 5.4),
    new THREE.MeshBasicMaterial({ color: 0x120d0a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
  );
  card.position.set(x, 2.15, z);
  card.rotation.y = ry;
  cornerDepthGroup.add(card);
}
setMeshShadows(saloonSet, true, true);

const tableGroup = new THREE.Group();
scene.add(tableGroup);
const tableModelGroup = new THREE.Group();
scene.add(tableModelGroup);

const tableTop = new THREE.Mesh(
  new THREE.CylinderGeometry(4.42, 4.95, 0.42, 40),
  new THREE.MeshStandardMaterial({
    color: 0x7f573a,
    map: tableWoodTex,
    bumpMap: tableBumpTex,
    bumpScale: 0.036,
    roughness: 0.72,
    metalness: 0.03
  })
);
tableTop.position.y = 0.2;
tableTop.castShadow = true;
tableTop.receiveShadow = true;
tableGroup.add(tableTop);

const tableTopInlay = new THREE.Mesh(
  new THREE.RingGeometry(3.83, 4.18, 48),
  new THREE.MeshStandardMaterial({ color: 0x3f281c, roughness: 0.68, metalness: 0.08, transparent: true, opacity: 0.65 })
);
tableTopInlay.rotation.x = -Math.PI / 2;
tableTopInlay.position.y = 0.47;
tableGroup.add(tableTopInlay);

const tableUnderShadow = new THREE.Mesh(
  new THREE.CircleGeometry(4.1, 40),
  new THREE.MeshBasicMaterial({ color: 0x130d09, transparent: true, opacity: 0.24 })
);
tableUnderShadow.rotation.x = -Math.PI / 2;
tableUnderShadow.position.y = -0.02;
tableGroup.add(tableUnderShadow);

const tableLip = new THREE.Mesh(
  new THREE.TorusGeometry(4.3, 0.12, 12, 40),
  new THREE.MeshStandardMaterial({
    color: 0x5e3e2c,
    map: tableWoodTex,
    bumpMap: tableBumpTex,
    bumpScale: 0.018,
    roughness: 0.7,
    metalness: 0.06
  })
);
tableLip.rotation.x = Math.PI / 2;
tableLip.position.y = 0.48;
tableLip.castShadow = true;
tableLip.receiveShadow = true;
tableGroup.add(tableLip);

const felt = new THREE.Mesh(
  new THREE.CylinderGeometry(3.75, 3.75, 0.06, 32),
  new THREE.MeshStandardMaterial({
    color: 0x4d704f,
    map: feltTex,
    bumpMap: feltBumpTex,
    bumpScale: 0.015,
    roughness: 0.97,
    metalness: 0
  })
);
felt.position.y = 0.5;
felt.receiveShadow = true;
tableGroup.add(felt);

const tableLeg = new THREE.Mesh(
  new THREE.CylinderGeometry(0.42, 0.58, 1.45, 20),
  new THREE.MeshStandardMaterial({ color: 0x7a5134, roughness: 0.86, metalness: 0.02 })
);
tableLeg.position.y = -0.58;
tableLeg.castShadow = true;
tableLeg.receiveShadow = true;
tableGroup.add(tableLeg);

const tablePedestalFoot = new THREE.Mesh(
  new THREE.CylinderGeometry(1.05, 1.18, 0.14, 24),
  new THREE.MeshStandardMaterial({ color: 0x5a3b28, roughness: 0.82, metalness: 0.04 })
);
tablePedestalFoot.position.y = -1.3;
tableGroup.add(tablePedestalFoot);

const tableWoodMat = new THREE.MeshStandardMaterial({ color: 0x744d33, roughness: 0.86, metalness: 0.02 });
for (let i = 0; i < 4; i += 1) {
  const angle = i * (Math.PI / 2) + Math.PI / 4;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 1.42, 14), tableWoodMat);
  leg.position.set(Math.cos(angle) * 2.62, -0.44, Math.sin(angle) * 2.62);
  leg.rotation.z = 0.06 * Math.cos(angle * 2);
  leg.rotation.x = 0.06 * Math.sin(angle * 2);
  tableGroup.add(leg);
}
for (let i = 0; i < 4; i += 1) {
  const angle = i * (Math.PI / 2);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.18, 0.22), tableWoodMat);
  apron.position.set(Math.cos(angle) * 1.34, -0.03, Math.sin(angle) * 1.34);
  apron.rotation.y = -angle;
  tableGroup.add(apron);
}
const braceA = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 0.18), tableWoodMat);
braceA.position.set(0, -0.62, 0);
braceA.rotation.y = Math.PI / 4;
const braceB = braceA.clone();
braceB.rotation.y = -Math.PI / 4;
tableGroup.add(braceA, braceB);
setMeshShadows(tableGroup, true, true);

const playRing = new THREE.Mesh(
  new THREE.RingGeometry(1.2, 2.4, 48),
  new THREE.MeshBasicMaterial({ color: 0xb88a52, transparent: true, opacity: 0.12, side: THREE.DoubleSide })
);
playRing.rotation.x = -Math.PI / 2;
playRing.position.y = 0.53;
scene.add(playRing);

const avatarGroup = new THREE.Group();
scene.add(avatarGroup);
const chairGroup = new THREE.Group();
scene.add(chairGroup);
const handGroup = new THREE.Group();
scene.add(handGroup);
const oppHandGroup = new THREE.Group();
scene.add(oppHandGroup);
const trickGroup = new THREE.Group();
scene.add(trickGroup);
const indicatorsGroup = new THREE.Group();
scene.add(indicatorsGroup);

const seatWorldAnchors = [
  new THREE.Vector3(0, 1.6, 6.0),
  new THREE.Vector3(-6.4, 1.6, 0),
  new THREE.Vector3(0, 1.6, -6.0),
  new THREE.Vector3(6.4, 1.6, 0)
];
const seatLabelAnchors = [
  new THREE.Vector3(0, 2.05, 4.15),
  new THREE.Vector3(-4.4, 1.95, 0),
  new THREE.Vector3(0, 2.2, -4.15),
  new THREE.Vector3(4.4, 1.95, 0)
];
const trickSlots = [
  new THREE.Vector3(0, 0.66, 1.55),
  new THREE.Vector3(-1.55, 0.66, 0),
  new THREE.Vector3(0, 0.66, -1.55),
  new THREE.Vector3(1.55, 0.66, 0)
];

function makeChair(displaySeat) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a472f, roughness: 0.86, metalness: 0.02 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.92, metalness: 0.01 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 1.2), leather);
  seat.position.y = 0.06;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.15, 0.12), wood);
  back.position.set(0, 0.62, -0.54);
  g.add(back);
  const backPad = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.82, 0.07), leather);
  backPad.position.set(0, 0.62, -0.46);
  g.add(backPad);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 1.0), wood);
  armL.position.set(-0.66, 0.29, 0.0);
  const armR = armL.clone();
  armR.position.x = 0.66;
  g.add(armL, armR);
  for (const sx of [-0.55, 0.55]) {
    for (const sz of [-0.45, 0.45]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.1), wood);
      leg.position.set(sx, -0.35, sz);
      g.add(leg);
    }
  }
  const ring = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.08, 0.08), wood);
  ring.position.set(0, -0.18, 0.45);
  g.add(ring);

  const p = seatWorldAnchors[displaySeat];
  g.position.set(p.x, 0.08, p.z);
  g.rotation.y = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][displaySeat];
  return g;
}

function makeAvatar(displaySeat) {
  const g = new THREE.Group();
  const style = [
    { skin: 0xa07a5f, coat: 0x4a3529, shirt: 0x7a5a43, hat: 0x3a2b22, band: 0x7a442d, beard: 0x6b6259 },
    { skin: 0x8f694f, coat: 0x2f3d42, shirt: 0x615452, hat: 0x262729, band: 0x8a6a3b, beard: 0x5b5048 },
    { skin: 0x9a735a, coat: 0x5b3a2e, shirt: 0x74604f, hat: 0x3a3027, band: 0x6e2f28, beard: 0x64574d },
    { skin: 0x7e5d47, coat: 0x3d342f, shirt: 0x706456, hat: 0x2e2825, band: 0x6b512f, beard: 0x4f4942 }
  ][displaySeat % 4];

  const coatMat = new THREE.MeshStandardMaterial({ color: style.coat, roughness: 0.88, metalness: 0.02 });
  const clothTrim = new THREE.MeshStandardMaterial({ color: 0xb89368, roughness: 0.8, metalness: 0.04 });
  const skinMat = new THREE.MeshStandardMaterial({ color: style.skin, roughness: 0.8, metalness: 0.02 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.5, 6, 10), coatMat);
  torso.position.set(0, 1.0, -0.07);
  torso.rotation.x = -0.28;
  g.add(torso);

  const vest = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.32, 4, 8),
    new THREE.MeshStandardMaterial({ color: style.shirt, roughness: 0.85, metalness: 0.02 })
  );
  vest.position.set(0, 1.0, 0.17);
  vest.rotation.x = -0.28;
  g.add(vest);

  const lapelL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.05), clothTrim);
  lapelL.position.set(-0.14, 1.02, 0.28);
  lapelL.rotation.x = -0.35;
  lapelL.rotation.z = -0.2;
  const lapelR = lapelL.clone();
  lapelR.position.x = 0.14;
  lapelR.rotation.z = 0.2;
  g.add(lapelL, lapelR);

  const shirt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.17, 0.44, 12),
    new THREE.MeshStandardMaterial({ color: 0xd2c0a4, roughness: 0.84, metalness: 0.01 })
  );
  shirt.position.set(0, 1.14, 0.25);
  shirt.rotation.x = -0.35;
  g.add(shirt);

  const shoulders = new THREE.Mesh(
    new THREE.SphereGeometry(0.58, 16, 12),
    coatMat
  );
  shoulders.scale.set(1.2, 0.7, 1.05);
  shoulders.position.set(0, 1.2, -0.08);
  shoulders.rotation.x = -0.2;
  g.add(shoulders);

  for (const side of [-1, 1]) {
    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.34, 4, 8), coatMat);
    upperArm.position.set(side * 0.52, 1.02, 0.12);
    upperArm.rotation.z = side * (Math.PI / 2.6);
    upperArm.rotation.x = -0.6;
    g.add(upperArm);
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.28, 4, 8), coatMat);
    forearm.position.set(side * 0.64, 0.83, 0.42);
    forearm.rotation.z = side * (Math.PI / 2.2);
    forearm.rotation.x = -0.35;
    g.add(forearm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), skinMat);
    hand.scale.set(1, 0.7, 1);
    hand.position.set(side * 0.74, 0.72, 0.63);
    g.add(hand);
  }

  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 8, 22), clothTrim);
  belt.rotation.x = Math.PI / 2;
  belt.position.set(0, 0.7, 0.02);
  g.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.03), clothTrim);
  buckle.position.set(0, 0.69, 0.35);
  g.add(buckle);

  for (const side of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.32, 4, 8), coatMat);
    thigh.position.set(side * 0.22, 0.42, 0.22);
    thigh.rotation.x = Math.PI / 2.1;
    thigh.rotation.z = side * 0.1;
    g.add(thigh);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.26, 4, 8), coatMat);
    shin.position.set(side * 0.26, 0.18, 0.72);
    shin.rotation.x = 0.45;
    g.add(shin);
    const boot = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.11, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x2c221b, roughness: 0.82, metalness: 0.03 })
    );
    boot.position.set(side * 0.27, 0.02, 0.9);
    g.add(boot);
  }

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 24, 18),
    skinMat
  );
  head.scale.set(1.0, 1.06, 0.95);
  head.position.set(0, 1.73, 0.08);
  g.add(head);

  const cheekbones = new THREE.Mesh(
    new THREE.SphereGeometry(0.31, 18, 12),
    new THREE.MeshStandardMaterial({ color: style.skin, roughness: 0.83 })
  );
  cheekbones.scale.set(1.1, 0.62, 0.92);
  cheekbones.position.set(0, 1.64, 0.19);
  g.add(cheekbones);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.2, 10),
    new THREE.MeshStandardMaterial({ color: style.skin, roughness: 0.82 })
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.68, 0.44);
  g.add(nose);

  const brow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.2, 0.07, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a201a, roughness: 0.9 })
  );
  brow.rotation.z = Math.PI / 2;
  brow.position.set(0, 1.82, 0.38);
  g.add(brow);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x15100d, roughness: 0.6, metalness: 0.03 });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), eyeMat);
  eyeL.position.set(-0.095, 1.75, 0.4);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.095;
  g.add(eyeL, eyeR);

  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.03), new THREE.MeshStandardMaterial({ color: 0x1f1713, roughness: 0.9 }));
  browL.position.set(-0.1, 1.79, 0.43);
  browL.rotation.z = -0.12;
  const browR = browL.clone();
  browR.position.x = 0.1;
  browR.rotation.z = 0.12;
  g.add(browL, browR);

  const cheekL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: style.skin, roughness: 0.8 }));
  cheekL.scale.set(1.1, 0.8, 0.8);
  cheekL.position.set(-0.14, 1.63, 0.33);
  const cheekR = cheekL.clone();
  cheekR.position.x = 0.14;
  g.add(cheekL, cheekR);

  const mustache = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 0.05, 12),
    new THREE.MeshStandardMaterial({ color: style.beard, roughness: 0.92 })
  );
  mustache.scale.set(1.15, 0.45, 0.65);
  mustache.rotation.z = Math.PI / 2;
  mustache.position.set(0, 1.62, 0.36);
  g.add(mustache);

  if (displaySeat % 2 === 0) {
    const beard = new THREE.Mesh(
      new THREE.ConeGeometry(0.23, 0.36, 14),
      new THREE.MeshStandardMaterial({ color: style.beard, roughness: 0.94 })
    );
    beard.position.set(0, 1.48, 0.26);
    beard.scale.set(1.0, 1.0, 0.7);
    g.add(beard);
  } else {
    const stubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 16, 10),
      new THREE.MeshStandardMaterial({ color: style.beard, roughness: 0.95, transparent: true, opacity: 0.5 })
    );
    stubble.scale.set(1.1, 0.7, 0.75);
    stubble.position.set(0, 1.54, 0.23);
    g.add(stubble);
  }

  const ears = new THREE.Group();
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skinMat);
    ear.scale.set(0.7, 1, 0.6);
    ear.position.set(side * 0.31, 1.73, 0.09);
    ears.add(ear);
  }
  g.add(ears);

  const hatBrim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.56, 0.05, 22),
    new THREE.MeshStandardMaterial({ color: style.hat, roughness: 0.82, metalness: 0.02 })
  );
  hatBrim.scale.set(1.15, 1, 0.95);
  hatBrim.position.set(0, 2.0, 0.08);
  g.add(hatBrim);

  const hatTop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.31, 0.4, 0.4, 20),
    new THREE.MeshStandardMaterial({ color: style.hat, roughness: 0.82, metalness: 0.02 })
  );
  hatTop.scale.set(1.0, 1.0, 0.95);
  hatTop.position.set(0, 2.18, 0.08);
  g.add(hatTop);

  const hatBand = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.018, 8, 18),
    new THREE.MeshStandardMaterial({ color: style.band, roughness: 0.75, metalness: 0.05 })
  );
  hatBand.rotation.x = Math.PI / 2;
  hatBand.position.set(0, 2.08, 0.08);
  g.add(hatBand);

  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.17, 0.02, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xc4b08f, roughness: 0.8 })
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, 1.27, 0.17);
  g.add(collar);

  const pos = seatWorldAnchors[displaySeat];
  g.position.set(pos.x, 0.22, pos.z);
  g.userData.baseY = 0.22;
  g.scale.setScalar(1 + (displaySeat % 3) * 0.03);
  g.rotation.y = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][displaySeat];
  return g;
}

const chairMeshes = Array.from({ length: 4 }, (_, i) => {
  const c = makeChair(i);
  setMeshShadows(c, true, true);
  chairGroup.add(c);
  return c;
});

const avatarMeshes = Array.from({ length: 4 }, (_, i) => {
  const a = makeAvatar(i);
  a.userData.fallbackChildren = [...a.children];
  avatarGroup.add(a);
  return a;
});

const avatarMixers = [null, null, null, null];
const avatarModelStatus = { attempted: false, loadedAny: false };
let gltfLoader = null;
let skeletonUtilsModule = null;
let fbxLoader = null;

function appendAvatarVersion(url) {
  const u = new URL(url, location.origin);
  u.searchParams.set("v", AVATAR_CACHE_TOKEN);
  return u.toString();
}

function analyzeSceneGeometry(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);

  let triangleCount = 0;
  let meshCount = 0;
  const meshNames = [];
  root.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    meshCount += 1;
    if (meshNames.length < 3) meshNames.push(node.name || "(unnamed mesh)");
    const pos = node.geometry.attributes?.position;
    if (!pos) return;
    const indexCount = node.geometry.index?.count ?? 0;
    const tris = indexCount ? Math.floor(indexCount / 3) : Math.floor(pos.count / 3);
    triangleCount += tris;
  });

  return {
    size: { x: size.x, y: size.y, z: size.z },
    heightMeters: size.y,
    triangleCount,
    meshCount,
    meshNames
  };
}

function avatarQualityGate(metrics) {
  const reasons = [];
  if ((metrics.triangleCount ?? 0) < 8000) reasons.push(`triangleCount<8000 (${metrics.triangleCount})`);
  if ((metrics.heightMeters ?? 0) < 0.9 || (metrics.heightMeters ?? 0) > 2.4) {
    reasons.push(`height out of range (${metrics.heightMeters?.toFixed?.(3)}m)`);
  }
  if ((metrics.meshCount ?? 0) < 3) reasons.push(`meshCount<3 (${metrics.meshCount})`);
  return { ok: reasons.length === 0, reasons };
}

function normalizeAndSeatModel(modelRoot) {
  const box = new THREE.Box3().setFromObject(modelRoot);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const height = Math.max(0.001, size.y);
  const looksSeatedPose = height < 1.35;
  const targetHeight = looksSeatedPose ? 1.15 : 1.7;
  const scale = targetHeight / height;
  modelRoot.scale.setScalar(scale);

  const scaledBox = new THREE.Box3().setFromObject(modelRoot);
  const scaledCenter = new THREE.Vector3();
  const scaledSize = new THREE.Vector3();
  scaledBox.getCenter(scaledCenter);
  scaledBox.getSize(scaledSize);

  // Center at seat and place hips approximately on chair seat top.
  const hipApproxY = scaledBox.min.y + scaledSize.y * (looksSeatedPose ? 0.48 : 0.53);
  const seatHipTargetY = 0.63;
  modelRoot.position.set(-scaledCenter.x, seatHipTargetY - hipApproxY, -scaledCenter.z + 0.06);
}

function stylizeImportedAvatar(root) {
  const warned = [];
  const seenTextures = new Set();
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;

    if (node.geometry) {
      if (!node.geometry.attributes?.normal) warned.push(`missing normals on ${node.name || "(unnamed mesh)"}`);
      if (!node.geometry.attributes?.tangent) warned.push(`missing tangents on ${node.name || "(unnamed mesh)"}`);
    }

    if (Array.isArray(node.morphTargetInfluences)) {
      for (let i = 0; i < node.morphTargetInfluences.length; i += 1) {
        node.morphTargetInfluences[i] = 0;
      }
    }

    if (node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (mat.map) {
          mat.map.anisotropy = Math.min(16, maxAnisotropy);
          mat.map.colorSpace = THREE.SRGBColorSpace;
          mat.map.needsUpdate = true;
          seenTextures.add(mat.map);
        }
        if (mat.emissiveMap) {
          mat.emissiveMap.anisotropy = Math.min(16, maxAnisotropy);
          mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
          mat.emissiveMap.needsUpdate = true;
          seenTextures.add(mat.emissiveMap);
        }
        for (const key of ["normalMap", "roughnessMap", "metalnessMap", "aoMap", "bumpMap"]) {
          const tex = mat[key];
          if (!tex) continue;
          tex.anisotropy = Math.min(16, maxAnisotropy);
          tex.colorSpace = THREE.NoColorSpace;
          tex.needsUpdate = true;
          seenTextures.add(tex);
        }

        if ("roughness" in mat && mat.roughness != null) mat.roughness = THREE.MathUtils.clamp(mat.roughness, 0.25, 0.95);
        if ("metalness" in mat && mat.metalness != null) mat.metalness = THREE.MathUtils.clamp(mat.metalness, 0, 0.35);
        if ("envMapIntensity" in mat && mat.envMapIntensity != null) mat.envMapIntensity = 0.9;
        if ("normalScale" in mat && mat.normalMap && mat.normalScale) {
          mat.normalScale.multiplyScalar(0.9);
        }
        mat.needsUpdate = true;
      }
    }
  });
  if (warned.length) {
    console.warn("Avatar mesh quality warnings:", warned);
  }
  return { warnedCount: warned.length, texturesTouched: seenTextures.size };
}

function applyStaticSeatedPoseIfHumanoid(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y < 1.3) return false; // likely already seated or tiny

  let posed = false;
  root.traverse((node) => {
    if (!node.isSkinnedMesh || !node.skeleton?.bones?.length) return;
    for (const bone of node.skeleton.bones) {
      const n = bone.name.toLowerCase();
      if (/(left.*(upleg|thigh)|thigh.*left|l_thigh)/.test(n)) { bone.rotation.x = -1.35; posed = true; }
      else if (/(right.*(upleg|thigh)|thigh.*right|r_thigh)/.test(n)) { bone.rotation.x = -1.35; posed = true; }
      else if (/(left.*(leg|calf|shin)|calf.*left|l_calf)/.test(n)) { bone.rotation.x = 1.25; posed = true; }
      else if (/(right.*(leg|calf|shin)|calf.*right|r_calf)/.test(n)) { bone.rotation.x = 1.25; posed = true; }
      else if (/(spine|chest)/.test(n)) { bone.rotation.x += 0.14; posed = true; }
      else if (/(left.*upperarm|upperarm.*left|l_upperarm)/.test(n)) { bone.rotation.z = 0.4; bone.rotation.x = -0.7; posed = true; }
      else if (/(right.*upperarm|upperarm.*right|r_upperarm)/.test(n)) { bone.rotation.z = -0.4; bone.rotation.x = -0.7; posed = true; }
      else if (/(left.*forearm|lowerarm.*left|l_forearm)/.test(n)) { bone.rotation.x = -0.45; posed = true; }
      else if (/(right.*forearm|lowerarm.*right|r_forearm)/.test(n)) { bone.rotation.x = -0.45; posed = true; }
    }
    node.skeleton.calculateInverses?.();
  });
  root.updateMatrixWorld(true);
  return posed;
}

function playBestSeatedClip(displaySeat, modelRoot, animations = []) {
  if (!animations.length) return;
  const clip =
    animations.find((c) => /sit|seated/i.test(c.name)) ||
    animations.find((c) => /idle/i.test(c.name)) ||
    animations[0];
  if (!clip) return;
  const mixer = new THREE.AnimationMixer(modelRoot);
  const action = mixer.clipAction(clip);
  action.play();
  avatarMixers[displaySeat] = mixer;
}

function mountImportedAvatar(displaySeat, gltf) {
  const seatGroup = avatarMeshes[displaySeat];
  if (!seatGroup) return;
  avatarMixers[displaySeat] = null;
  if (seatGroup.userData.importedAvatar) {
    seatGroup.remove(seatGroup.userData.importedAvatar);
  }
  if (!skeletonUtilsModule?.clone) return;
  const imported = skeletonUtilsModule.clone(gltf.scene);
  const seatedPoseApplied = applyStaticSeatedPoseIfHumanoid(imported);
  const avatarTune = stylizeImportedAvatar(imported);
  normalizeAndSeatModel(imported);
  imported.rotation.y = Math.PI; // face toward table center from seat orientation
  seatGroup.userData.fallbackChildren?.forEach((c) => { c.visible = false; });
  seatGroup.add(imported);
  seatGroup.userData.importedAvatar = imported;
  avatarModelStatus.loadedAny = true;
  console.log(`Mounted avatar seat ${displaySeat + 1}`, {
    seatedPoseApplied,
    avatarTune
  });
}

async function tryLoadAvatarGLB(path) {
  if (!gltfLoader) return null;
  const url = appendAvatarVersion(path);
  try {
    const gltf = await gltfLoader.loadAsync(url);
    const metrics = analyzeSceneGeometry(gltf.scene);
    console.log("[AVATAR LOAD]", {
      url,
      bboxSizeMeters: {
        x: Number(metrics.size.x.toFixed(3)),
        y: Number(metrics.size.y.toFixed(3)),
        z: Number(metrics.size.z.toFixed(3))
      },
      heightMeters: Number(metrics.heightMeters.toFixed(3)),
      triangleCount: metrics.triangleCount,
      meshCount: metrics.meshCount,
      first3MeshNames: metrics.meshNames.slice(0, 3)
    });
    const gate = avatarQualityGate(metrics);
    if (!gate.ok) {
      console.warn("[AVATAR REJECTED: looks like placeholder/blob]", {
        url,
        reasons: gate.reasons,
        metrics
      });
      return null;
    }
    return { gltf, url, metrics };
  } catch (err) {
    console.warn("[AVATAR LOAD FAILED]", { url, error: String(err?.message || err) });
    return null;
  }
}

async function tryLoadAvatarFBX(path) {
  if (!fbxLoader) return null;
  const url = appendAvatarVersion(path);
  try {
    const scene = await fbxLoader.loadAsync(url);
    const metrics = analyzeSceneGeometry(scene);
    console.log("[AVATAR LOAD:FBX]", {
      url,
      bboxSizeMeters: {
        x: Number(metrics.size.x.toFixed(3)),
        y: Number(metrics.size.y.toFixed(3)),
        z: Number(metrics.size.z.toFixed(3))
      },
      heightMeters: Number(metrics.heightMeters.toFixed(3)),
      triangleCount: metrics.triangleCount,
      meshCount: metrics.meshCount,
      first3MeshNames: metrics.meshNames.slice(0, 3)
    });
    const gate = avatarQualityGate(metrics);
    if (!gate.ok) {
      console.warn("[AVATAR REJECTED: looks like placeholder/blob]", {
        url,
        reasons: gate.reasons,
        metrics
      });
      return null;
    }
    return { gltf: { scene, animations: scene.animations || [] }, url, metrics };
  } catch (err) {
    console.warn("[AVATAR LOAD FAILED]", { url, error: String(err?.message || err) });
    return null;
  }
}

async function loadAvatarModels() {
  if (!ENABLE_EXTERNAL_MODELS) return;
  avatarModelStatus.attempted = true;
  try {
    const [{ GLTFLoader }, skeletonUtils, { FBXLoader }] = await Promise.all([
      import("https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js?module"),
      import("https://unpkg.com/three@0.160.0/examples/jsm/utils/SkeletonUtils.js?module")
      ,
      import("https://unpkg.com/three@0.160.0/examples/jsm/loaders/FBXLoader.js?module")
    ]);
    gltfLoader = new GLTFLoader();
    fbxLoader = new FBXLoader();
    skeletonUtilsModule = skeletonUtils;
  } catch {
    pushLog("Avatar model loader failed to load. Using procedural avatars.");
    return;
  }

  for (let i = 0; i < 4; i += 1) {
    const candidates = [
      `/assets/avatars/seat${i + 1}.glb`,
      "/assets/avatars/cowboy.glb",
      "/assets/avatars/_humanoid_default.glb",
      "/assets/avatars/Sitting.fbx"
    ];
    let loaded = null;
    for (const candidate of candidates) {
      loaded = candidate.toLowerCase().endsWith(".fbx")
        ? await tryLoadAvatarFBX(candidate)
        : await tryLoadAvatarGLB(candidate);
      if (loaded) break;
    }
    if (loaded?.gltf) {
      mountImportedAvatar(i, loaded.gltf);
    } else {
      console.warn(`Seat ${i + 1} avatar fell back to procedural model (all GLBs rejected/missing).`);
    }
  }
  if (!avatarModelStatus.loadedAny) {
    pushLog("No avatar models found in /client/assets/avatars. Using procedural fallback.");
  } else {
    pushLog("Loaded avatar models.");
  }
}

function tuneImportedTableMaterials(root) {
  let meshCount = 0;
  root.traverse((node) => {
    if (!node.isMesh) return;
    meshCount += 1;
    node.castShadow = true;
    node.receiveShadow = true;
    const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.map) {
        mat.map.anisotropy = Math.min(16, maxAnisotropy);
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.needsUpdate = true;
      }
      if (mat.emissiveMap) {
        mat.emissiveMap.anisotropy = Math.min(16, maxAnisotropy);
        mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        mat.emissiveMap.needsUpdate = true;
      }
      for (const key of ["normalMap", "roughnessMap", "metalnessMap", "aoMap", "bumpMap"]) {
        const tex = mat[key];
        if (!tex) continue;
        tex.anisotropy = Math.min(16, maxAnisotropy);
        tex.colorSpace = THREE.NoColorSpace;
        tex.needsUpdate = true;
      }
      if ("roughness" in mat && mat.roughness != null) mat.roughness = THREE.MathUtils.clamp(mat.roughness, 0.25, 0.98);
      if ("metalness" in mat && mat.metalness != null) mat.metalness = THREE.MathUtils.clamp(mat.metalness, 0.0, 0.2);
      if ("envMapIntensity" in mat && mat.envMapIntensity != null) mat.envMapIntensity = 1.1;
      mat.needsUpdate = true;
    }
  });
  return meshCount;
}

function fitTableModelAtCenter(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const footprint = Math.max(size.x, size.z) || 1;
  const targetFootprint = 8.7; // match current gameplay layout radius
  const scale = targetFootprint / footprint;
  root.scale.setScalar(scale);

  const scaledBox = new THREE.Box3().setFromObject(root);
  const scaledCenter = new THREE.Vector3();
  scaledBox.getCenter(scaledCenter);
  const topY = scaledBox.max.y;
  const targetTopY = felt.position.y + 0.03; // keep domino/table interaction heights unchanged

  root.position.x += -scaledCenter.x;
  root.position.z += -scaledCenter.z;
  root.position.y += targetTopY - topY;
  root.rotation.y = Math.PI; // face front consistently
}

async function loadTableModel() {
  if (!ENABLE_EXTERNAL_MODELS) return;
  let manifest = null;
  try {
    const res = await fetch("/assets/models/table/manifest.json", { cache: "no-store" });
    if (res.ok) manifest = await res.json();
  } catch {}

  if (!gltfLoader) {
    try {
      const { GLTFLoader } = await import("https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js?module");
      gltfLoader = new GLTFLoader();
    } catch (err) {
      console.warn("Table loader unavailable (GLTFLoader import failed)", err);
      return;
    }
  }

  const candidates = [];
  if (manifest?.entry) candidates.push(`/assets/models/table/${manifest.entry}`);
  candidates.push(
    "/assets/models/table/scene.glb",
    "/assets/models/table/scene.gltf",
    "/assets/models/table/model.glb",
    "/assets/models/table/model.gltf",
    "/assets/models/table/table.glb",
    "/assets/models/table/table.gltf"
  );

  let loaded = null;
  let loadedUrl = null;
  for (const url of [...new Set(candidates)]) {
    try {
      loaded = await gltfLoader.loadAsync(url);
      loadedUrl = url;
      break;
    } catch {
      // continue
    }
  }

  if (!loaded) {
    console.warn("Table model load failed. Using procedural table fallback.");
    pushLog("Table model not found. Using procedural table.");
    return;
  }

  while (tableModelGroup.children.length) tableModelGroup.remove(tableModelGroup.children[0]);
  const tableRoot = loaded.scene;
  const meshCount = tuneImportedTableMaterials(tableRoot);
  fitTableModelAtCenter(tableRoot);
  tableModelGroup.add(tableRoot);
  // Keep the felt gameplay surface visible; only hide placeholder table structure when model loads.
  if (felt.parent === tableGroup) {
    tableGroup.remove(felt);
    scene.add(felt);
    felt.position.set(0, 0.5, 0);
  }
  for (const child of tableGroup.children) child.visible = false;
  pushLog("Loaded table model.");
  console.log("Loaded table model", { url: loadedUrl, meshCount, manifest });
  logGraphicsDebug("table-loaded");
}

const seatIndicators = Array.from({ length: 4 }, () => {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.03, 10, 24),
    new THREE.MeshBasicMaterial({ color: 0xf0c37c, transparent: true, opacity: 0 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.55;
  indicatorsGroup.add(mesh);
  return mesh;
});

seatIndicators[0].position.set(0, 0.55, 3.4);
seatIndicators[1].position.set(-3.4, 0.55, 0);
seatIndicators[2].position.set(0, 0.55, -3.4);
seatIndicators[3].position.set(3.4, 0.55, 0);

const smokeCount = 240;
const smokeGeom = new THREE.BufferGeometry();
const smokePositions = new Float32Array(smokeCount * 3);
const smokeSizes = new Float32Array(smokeCount);
for (let i = 0; i < smokeCount; i += 1) {
  smokePositions[i * 3 + 0] = (Math.random() - 0.5) * 14;
  smokePositions[i * 3 + 1] = Math.random() * 5 + 1;
  smokePositions[i * 3 + 2] = (Math.random() - 0.5) * 14;
  smokeSizes[i] = Math.random() * 0.8 + 0.2;
}
smokeGeom.setAttribute("position", new THREE.BufferAttribute(smokePositions, 3));
smokeGeom.setAttribute("size", new THREE.BufferAttribute(smokeSizes, 1));

const smokeMat = new THREE.PointsMaterial({
  color: 0x8f7f73,
  size: 0.28,
  transparent: true,
  opacity: 0.013,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});
const smoke = new THREE.Points(smokeGeom, smokeMat);
scene.add(smoke);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.62);
const dragPoint = new THREE.Vector3();

const handTileMeshes = new Map();
let tileMeshesByObject = new Map();
let dragging = null;

function pipDot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawPips(ctx, value, x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = w * 0.22;
  const dy = h * 0.22;
  const p = [
    [cx - dx, cy - dy], [cx, cy - dy], [cx + dx, cy - dy],
    [cx - dx, cy], [cx, cy], [cx + dx, cy],
    [cx - dx, cy + dy], [cx, cy + dy], [cx + dx, cy + dy]
  ];
  const map = {
    0: [],
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
  };
  for (const idx of map[value]) pipDot(ctx, p[idx][0], p[idx][1], 6);
}

const textureCache = new Map();
function dominoTextureKey(tile, opts) {
  return `${tile?.id || "back"}:${opts.faceUp ? 1 : 0}:${opts.highlight ? 1 : 0}:${opts.legal ? 1 : 0}`;
}

function makeDominoTexture(tile, opts = {}) {
  const key = dominoTextureKey(tile, opts);
  if (textureCache.has(key)) return textureCache.get(key);

  const cvs = document.createElement("canvas");
  cvs.width = 256;
  cvs.height = 128;
  const ctx = cvs.getContext("2d");

  if (opts.faceUp) {
    const grad = ctx.createLinearGradient(0, 0, 256, 128);
    grad.addColorStop(0, "#f7f0de");
    grad.addColorStop(1, "#eadfca");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 128);
    // Faux ivory grain/marbling for a carved antique look.
    ctx.strokeStyle = "rgba(124, 102, 76, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i += 1) {
      ctx.beginPath();
      ctx.moveTo(10, 18 + i * 18 + (i % 2 ? 4 : 0));
      ctx.bezierCurveTo(80, 10 + i * 14, 170, 30 + i * 12, 246, 14 + i * 17);
      ctx.stroke();
    }
    ctx.strokeStyle = opts.highlight ? "#ffd48b" : opts.legal ? "#ddaa62" : "#6f563c";
    ctx.lineWidth = opts.highlight ? 6 : 4;
    ctx.strokeRect(4, 4, 248, 120);
    ctx.strokeStyle = "#a18362";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(128, 10);
    ctx.lineTo(128, 118);
    ctx.stroke();
    ctx.fillStyle = "#17110d";
    drawPips(ctx, tile.a, 14, 10, 108, 108);
    drawPips(ctx, tile.b, 134, 10, 108, 108);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 256, 128);
    grad.addColorStop(0, "#6b4d35");
    grad.addColorStop(1, "#43301f");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = opts.highlight ? "#ddb072" : "#6e4d2e";
    ctx.lineWidth = 4;
    ctx.strokeRect(5, 5, 246, 118);
    ctx.fillStyle = "rgba(235, 198, 137, 0.13)";
    for (let i = 0; i < 14; i += 1) {
      ctx.fillRect(12 + i * 18, 10 + ((i % 2) * 6), 8, 108);
    }
  }

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(key, tex);
  return tex;
}

const dominoGeo = new THREE.BoxGeometry(1.18, 0.14, 0.6);
function makeDominoMesh(tile, { faceUp = true, legal = false, highlight = false } = {}) {
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3c, roughness: 0.55, metalness: 0.08 });
  const faceMat = new THREE.MeshStandardMaterial({
    map: makeDominoTexture(tile, { faceUp, legal, highlight }),
    roughness: 0.72,
    metalness: 0.03
  });
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z. Put faces on top/bottom so tiles lay flat.
  const mesh = new THREE.Mesh(dominoGeo, [edgeMat, edgeMat, faceMat, faceMat, edgeMat, edgeMat]);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 2;
  return mesh;
}

function clearGroup(group) {
  while (group.children.length) group.remove(group.children[0]);
}

function renderTableFromState() {
  const s = state.server;
  if (!s) return;

  syncNameplateStateFromServer(s);
  handTileMeshes.clear();
  tileMeshesByObject = new Map();
  clearGroup(handGroup);
  clearGroup(oppHandGroup);
  clearGroup(trickGroup);

  renderSeatLabels();
  renderAvatars();
  renderIndicators();

  const legalSet = new Set(s.legalPlays || []);
  const yourHand = Array.isArray(s.yourHand) ? s.yourHand : [];

  const spacing = 0.76;
  const totalWidth = Math.max(0, (yourHand.length - 1) * spacing);
  yourHand.forEach((tile, idx) => {
    const mesh = makeDominoMesh(tile, { faceUp: true, legal: legalSet.has(tile.id) });
    mesh.position.set(-totalWidth / 2 + idx * spacing, 0.65, 3.05 + Math.abs(idx - (yourHand.length - 1) / 2) * 0.05);
    mesh.rotation.y = Math.PI / 2 + 0.02 * (idx - yourHand.length / 2);
    mesh.userData = { tileId: tile.id, draggable: legalSet.has(tile.id), basePos: mesh.position.clone(), baseRotY: mesh.rotation.y };
    handGroup.add(mesh);
    handTileMeshes.set(tile.id, mesh);
    tileMeshesByObject.set(mesh, mesh);
  });

  for (let displaySeat = 1; displaySeat < 4; displaySeat += 1) {
    const logicalSeat = toLogicalSeat(displaySeat);
    const count = s.handCounts?.[logicalSeat] ?? 0;
    for (let i = 0; i < count; i += 1) {
      const back = makeDominoMesh({ id: `b-${logicalSeat}-${i}`, a: 0, b: 0 }, { faceUp: false });
      if (displaySeat === 2) {
        back.position.set((i - count / 2) * 0.14, 0.64 + i * 0.003, -3.0);
        back.rotation.y = Math.PI / 2;
      } else if (displaySeat === 1) {
        back.position.set(-3.0, 0.64 + i * 0.003, (i - count / 2) * 0.12);
        back.rotation.y = 0;
      } else {
        back.position.set(3.0, 0.64 + i * 0.003, (i - count / 2) * 0.12);
        back.rotation.y = 0;
      }
      oppHandGroup.add(back);
    }
  }

  const trick =
    (s.currentTrick && s.currentTrick.length)
      ? s.currentTrick
      : ((s.phase === "trickPause" || s.phase === "handOver" || s.phase === "gameOver") ? (s.lastTrickDisplay?.plays || []) : []);
  trick.forEach((play) => {
    const displaySeat = toDisplaySeat(play.seat);
    const pos = trickSlots[displaySeat];
    const mesh = makeDominoMesh(play.tile, { faceUp: true });
    mesh.position.copy(pos);
    mesh.rotation.y = [Math.PI / 2, 0, Math.PI / 2, 0][displaySeat] + (displaySeat % 2 ? 0.05 : -0.05);
    trickGroup.add(mesh);
  });
}

function renderAvatars() {
  const s = state.server;
  if (!s) return;
  for (let displaySeat = 0; displaySeat < 4; displaySeat += 1) {
    const logicalSeat = toLogicalSeat(displaySeat);
    const seat = s.seats?.[logicalSeat];
    const avatar = avatarMeshes[displaySeat];
    if (!seat) continue;
    avatar.visible = true;
    avatar.position.y = avatar.userData.baseY + 0.02 * Math.sin(performance.now() * 0.001 + displaySeat);
  }
}

function renderIndicators() {
  const s = state.server;
  if (!s) return;
  for (let displaySeat = 0; displaySeat < 4; displaySeat += 1) {
    const logicalSeat = toLogicalSeat(displaySeat);
    const indicator = seatIndicators[displaySeat];
    const isTurn = s.turn === logicalSeat;
    const isYou = s.yourSeat === logicalSeat;
    indicator.material.opacity = isTurn ? 0.14 : isYou ? 0.08 : 0.03;
    indicator.material.color.setHex(isTurn ? 0xc9954a : isYou ? 0x8e6639 : 0x503823);
  }
}

function renderSeatLabels() {
  const s = state.server;
  if (!s) return;
  seatLabelsEl.innerHTML = "";
  for (let displaySeat = 0; displaySeat < 4; displaySeat += 1) {
    const logicalSeat = toLogicalSeat(displaySeat);
    const seat = s.seats?.[logicalSeat];
    if (!seat) continue;
    const el = document.createElement("div");
    el.className = "seat-label";
    if (s.yourSeat === logicalSeat) el.classList.add("you");
    el.dataset.displaySeat = String(displaySeat);
    el.dataset.logicalSeat = String(logicalSeat);

    const nameText = document.createElement("span");
    nameText.textContent = seat.name;
    el.appendChild(nameText);
    el.appendChild(document.createElement("br"));

    const meta = document.createElement("span");
    meta.style.color = "#a58e74";
    meta.textContent = `Seat ${logicalSeat + 1} ${seat.kind === "bot" ? `| CPU ${seat.difficulty}` : "| Player"}`;
    el.appendChild(meta);

    ensureNameplateHandle(el);
    const handle = el.querySelector(".t42-drag-handle");
    if (handle && !handle.dataset.bound) {
      handle.dataset.bound = "1";
      handle.addEventListener("pointerdown", (event) => startNameplateDrag(event, logicalSeat, el));
    }
    seatLabelsEl.appendChild(el);
  }
  applyNameplateDecorations();
  updateSeatLabelPositions();
}

function updateSeatLabelPositions() {
  const labels = seatLabelsEl.querySelectorAll(".seat-label");
  const rect = canvas.getBoundingClientRect();
  const burnGuard = Math.min(210, rect.width * 0.2);
  const minX = burnGuard;
  const maxX = rect.width - burnGuard;
  const minY = 84;
  const maxY = rect.height - 110;
  const plateLift = 26;
  labels.forEach((el) => {
    const displaySeat = Number(el.dataset.displaySeat);
    const logicalSeat = Number(el.dataset.logicalSeat);
    const manual = Number.isInteger(logicalSeat) ? getManualNameplatePos(logicalSeat) : null;
    const p = seatLabelAnchors[displaySeat].clone().project(camera);
    const anchoredX = THREE.MathUtils.clamp((p.x * 0.5 + 0.5) * rect.width, minX, maxX);
    const anchoredY = THREE.MathUtils.clamp((-p.y * 0.5 + 0.5) * rect.height, minY, maxY) - plateLift;
    const x = manual ? THREE.MathUtils.clamp(manual.x, minX, maxX) : anchoredX;
    const y = manual ? THREE.MathUtils.clamp(manual.y, minY - plateLift, maxY - plateLift) : anchoredY;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });
  updateRuleBubblePosition();
}

function updateRuleBubblePosition() {
  if (!ruleBubbleState.text || ruleBubbleState.logicalSeat == null) return;
  const rect = canvas.getBoundingClientRect();
  const displaySeat = toDisplaySeat(ruleBubbleState.logicalSeat);
  const anchor = seatLabelAnchors[displaySeat]?.clone() || new THREE.Vector3(0, 2.8, 0);
  anchor.y += 0.7;
  const p = anchor.project(camera);
  const x = (p.x * 0.5 + 0.5) * rect.width;
  const y = (-p.y * 0.5 + 0.5) * rect.height;
  ruleBubbleEl.style.left = `${x}px`;
  ruleBubbleEl.style.top = `${y}px`;
}

function onPointerDown(event) {
  if (!state.server) return;
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects([...handTileMeshes.values()], false);
  if (!intersects.length) return;
  const mesh = intersects[0].object;
  if (!mesh.userData.draggable) return;

  dragging = {
    mesh,
    tileId: mesh.userData.tileId,
    started: false,
    pointerDownX: event.clientX,
    pointerDownY: event.clientY,
    startPos: mesh.position.clone()
  };
}

function onPointerMove(event) {
  onGlobalNameplateDragMove(event);
  if (!dragging) return;
  const dx = event.clientX - dragging.pointerDownX;
  const dy = event.clientY - dragging.pointerDownY;
  if (!dragging.started && Math.hypot(dx, dy) > 6) dragging.started = true;
  if (!dragging.started) return;

  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
    dragging.mesh.position.set(
      THREE.MathUtils.clamp(dragPoint.x, -3, 3),
      0.72,
      THREE.MathUtils.clamp(dragPoint.z, -0.1, 3.2)
    );
    dragging.mesh.rotation.y = 0;
  }
}

function onPointerUp(event) {
  endGlobalNameplateDrag();
  if (!dragging) return;
  const { mesh, tileId, started } = dragging;
  const pos = mesh.position;
  const droppedInPlayArea = Math.hypot(pos.x, pos.z) < 2.2 && pos.z < 2.35;
  const wasClick = !started && Math.hypot(event.clientX - dragging.pointerDownX, event.clientY - dragging.pointerDownY) < 6;

  if (droppedInPlayArea || wasClick) {
    sendAction({ type: "playTile", tileId });
  }

  dragging = null;
}

function setPointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

canvas.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);

function resize() {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  updateSeatLabelPositions();
}
window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "g" && event.shiftKey) {
    logGraphicsDebug("hotkey");
    pushLog("Graphics debug logged to console.");
  }
});

let t0 = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - t0) / 1000);
  t0 = now;

  for (const mixer of avatarMixers) {
    mixer?.update(dt);
  }

  const pos = smoke.geometry.attributes.position;
  for (let i = 0; i < smokeCount; i += 1) {
    let x = pos.array[i * 3 + 0];
    let y = pos.array[i * 3 + 1];
    let z = pos.array[i * 3 + 2];
    x += Math.sin(now * 0.0002 + i * 1.31) * dt * 0.15;
    z += Math.cos(now * 0.00018 + i * 0.91) * dt * 0.14;
    y += dt * (0.1 + (i % 7) * 0.005);
    if (y > 7.6) {
      y = 0.8;
      x = (Math.random() - 0.5) * 14;
      z = (Math.random() - 0.5) * 14;
    }
    pos.array[i * 3 + 0] = x;
    pos.array[i * 3 + 1] = y;
    pos.array[i * 3 + 2] = z;
  }
  pos.needsUpdate = true;

  playRing.material.opacity = 0.08 + (Math.sin(now * 0.0024) + 1) * 0.04;
  warmSpot.intensity = 90 + Math.sin(now * 0.004) * 4.5;

  if (!dragging) {
    for (const mesh of handTileMeshes.values()) {
      const target = mesh.userData.basePos;
      mesh.position.lerp(target, 0.18);
      mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, mesh.userData.baseRotY, 0.2);
    }
  }

  if (ruleBubbleState.expiresAt && now >= ruleBubbleState.expiresAt) {
    hideRuleBubble();
  }

  updateSeatLabelPositions();
  renderer.render(scene, camera);
}

function primeButtons() {
  bootMarksMount();
  renderBidControls({ phase: "lobby", yourSeat: null, highestBid: null });
  renderTrumpControls({ phase: "lobby", yourSeat: null });
  if (modeSelectEl) {
    modeSelectEl.value = MODE_STRAIGHT;
    modeSelectEl.disabled = true;
  }
}

primeButtons();
resize();
connect();
if (ENABLE_EXTERNAL_MODELS) {
  loadHDRIEnvironment();
  loadTableModel();
  loadAvatarModels();
} else {
  pushLog("External avatar/table model loading disabled (procedural mode).");
}
requestAnimationFrame(animate);
