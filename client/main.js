import * as THREE from '/node_modules/three/build/three.module.js';
import { GLTFLoader } from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from '/node_modules/three/examples/jsm/loaders/RGBELoader.js';
import { RoomEnvironment } from '/node_modules/three/examples/jsm/environments/RoomEnvironment.js';

const MODES = {
  TRUMPS: 'trumps',
  FOLLOW_ME: 'followMe',
  SEVENS: 'sevens'
};

const PHASES = {
  LOBBY: 'lobby',
  BIDDING: 'bidding',
  CHOOSE_MODE: 'chooseMode',
  CHOOSE_TRUMP: 'chooseTrump',
  PLAYING: 'playing',
  TRICK_PAUSE: 'trickPause',
  HAND_OVER: 'handOver'
};

const PLAY_PLANE_Y = 0.6;
const DOMINO_THICKNESS = 0.14;
const DOMINO_Y = PLAY_PLANE_Y + DOMINO_THICKNESS / 2;

const canvas = document.getElementById('gameCanvas');
const panel = document.getElementById('sidePanel');
const panelToggle = document.getElementById('panelToggle');
const closePanelBtn = document.getElementById('closePanelBtn');
const roomIdInput = document.getElementById('roomIdInput');
const roomStatus = document.getElementById('roomStatus');
const eventLog = document.getElementById('eventLog');
const seatControls = document.getElementById('seatControls');
const marksText = document.getElementById('marksText');
const hudBidValue = document.getElementById('hudBidValue');
const hudTrumpValue = document.getElementById('hudTrumpValue');

const sectionRoom = document.getElementById('section-room');
const sectionPlayers = document.getElementById('section-players');
const sectionGame = document.getElementById('section-game');
const sectionBidding = document.getElementById('section-bidding');
const sectionTrump = document.getElementById('section-trump');
const sectionMarks = document.getElementById('section-marks');

const bidButtonsWrap = document.getElementById('bidButtons');
const trumpButtonsWrap = document.getElementById('trumpButtons');
const modeButtonsWrap = document.getElementById('modeButtons');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.physicallyCorrectLights = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 9.8, 9.6);
camera.lookAt(0, 0.8, 0);

const visualsGroup = new THREE.Group();
visualsGroup.name = 'visualsGroup';
scene.add(visualsGroup);

const handGroup = new THREE.Group();
handGroup.name = 'handGroup';
scene.add(handGroup);

const oppHandGroup = new THREE.Group();
oppHandGroup.name = 'oppHandGroup';
scene.add(oppHandGroup);

const trickGroup = new THREE.Group();
trickGroup.name = 'trickGroup';
scene.add(trickGroup);

const burnGroupA = new THREE.Group();
const burnGroupB = new THREE.Group();
oppHandGroup.add(burnGroupA);
oppHandGroup.add(burnGroupB);

const seatAvatarGroup = [0, 1, 2, 3].map(() => {
  const g = new THREE.Group();
  visualsGroup.add(g);
  return g;
});

const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

const ambient = new THREE.HemisphereLight(0xfff4dd, 0x334e63, 0.52);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xfff2db, 1.18);
keyLight.position.set(4.8, 8.8, 3.2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 25;
keyLight.shadow.bias = -0.0002;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xa9c7ff, 0.28);
fillLight.position.set(-5, 5, -2);
scene.add(fillLight);

const tableMat = new THREE.MeshStandardMaterial({
  color: 0x6b3a16,
  roughness: 0.58,
  metalness: 0.09
});
const table = new THREE.Mesh(new THREE.CylinderGeometry(5.9, 5.9, 0.45, 64), tableMat);
table.receiveShadow = true;
table.castShadow = true;
table.position.set(0, PLAY_PLANE_Y - 0.28, 0);
visualsGroup.add(table);

const tableRim = new THREE.Mesh(
  new THREE.TorusGeometry(5.8, 0.08, 20, 120),
  new THREE.MeshStandardMaterial({ color: 0x1b0f08, roughness: 0.5, metalness: 0.2 })
);
tableRim.rotation.x = Math.PI / 2;
tableRim.position.y = PLAY_PLANE_Y - 0.06;
visualsGroup.add(tableRim);

const felt = new THREE.Mesh(
  new THREE.CylinderGeometry(5.45, 5.45, 0.04, 64),
  new THREE.MeshStandardMaterial({ color: 0x0f5c45, roughness: 0.93, metalness: 0.03 })
);
felt.position.y = PLAY_PLANE_Y - 0.02;
felt.receiveShadow = true;
visualsGroup.add(felt);

const debugPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 12),
  new THREE.MeshBasicMaterial({
    color: 0x60bdf5,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false
  })
);
debugPlane.rotation.x = -Math.PI / 2;
debugPlane.position.y = PLAY_PLANE_Y;
debugPlane.visible = false;
scene.add(debugPlane);

const axesHelper = new THREE.AxesHelper(3.5);
axesHelper.position.y = PLAY_PLANE_Y;
axesHelper.visible = false;
scene.add(axesHelper);

const dominoGeometry = new THREE.BoxGeometry(1.16, DOMINO_THICKNESS, 0.58);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const gltfLoader = new GLTFLoader();
const textureCache = new Map();
const avatarCatalog = [];
const avatarById = new Map();
const activeAvatarLoadToken = new Map();

let ws = null;
let localClientId = null;
let roomState = null;
let infoMessage = '';
let panelOpen = true;
let forceClosePanel = false;
let lastPhase = null;
let debugVisible = false;

function logMessage(text, timeoutMs = 2400) {
  eventLog.textContent = text;
  if (timeoutMs > 0) {
    const stamp = Date.now();
    logMessage.lastStamp = stamp;
    setTimeout(() => {
      if (logMessage.lastStamp === stamp) {
        eventLog.textContent = '';
      }
    }, timeoutMs);
  }
}

function tileId(tile) {
  const hi = Math.max(tile.a, tile.b);
  const lo = Math.min(tile.a, tile.b);
  return `${hi}-${lo}`;
}

function tileContainsSuit(tile, suit) {
  return tile.a === suit || tile.b === suit;
}

function countTilePoints(tile) {
  const id = tile.id || tileId(tile);
  if (id === '5-5' || id === '6-4') return 10;
  if (id === '5-0' || id === '4-1' || id === '3-2') return 5;
  return 0;
}

function teamForSeat(seat) {
  return seat % 2 === 0 ? 'teamA' : 'teamB';
}

function getLocalSeat() {
  if (!roomState || !localClientId) return null;
  const seat = roomState.seats.find((s) => s.occupantClientId === localClientId && s.type === 'human');
  return seat ? seat.seatIndex : null;
}

function getLocalControlledSeats() {
  if (!roomState || !localClientId) return [];
  return roomState.seats.filter((s) => s.occupantClientId === localClientId).map((s) => s.seatIndex);
}

function getCurrentHighBid() {
  if (!roomState?.bidHistory) return 0;
  return roomState.bidHistory.reduce((max, entry) => {
    if (Number.isInteger(entry.bid) && entry.bid > max) return entry.bid;
    return max;
  }, 0);
}

function localCanControlSeat(seatIndex) {
  if (!roomState || seatIndex == null) return false;
  const seat = roomState.seats[seatIndex];
  if (!seat) return false;
  if (seat.type === 'human') {
    return seat.occupantClientId === localClientId;
  }
  if (seat.type === 'cpu') {
    return roomState.hostClientId === localClientId;
  }
  return false;
}

function localIsBidder() {
  return roomState && roomState.bidderSeat != null && localCanControlSeat(roomState.bidderSeat);
}

function localTurnToBid() {
  return roomState && roomState.phase === PHASES.BIDDING && roomState.turnSeat != null && localCanControlSeat(roomState.turnSeat);
}

function isMyTurnToPlay() {
  return roomState && roomState.phase === PHASES.PLAYING && roomState.turnSeat != null && localCanControlSeat(roomState.turnSeat);
}

function currentTrumpLabel() {
  if (!roomState || !roomState.mode) return '-';
  if (roomState.mode === MODES.TRUMPS) {
    return roomState.trumpSuit == null ? '-' : String(roomState.trumpSuit);
  }
  if (roomState.mode === MODES.FOLLOW_ME) return 'FOLLOW';
  if (roomState.mode === MODES.SEVENS) return '7s';
  return '-';
}

function shouldAutoOpenPanel() {
  if (!roomState) return true;
  if (roomState.phase === PHASES.LOBBY) return true;
  if (localTurnToBid()) return true;
  if (roomState.phase === PHASES.CHOOSE_MODE && localIsBidder()) return true;
  if (roomState.phase === PHASES.CHOOSE_TRUMP && localIsBidder()) return true;
  return false;
}

function setPanelOpen(open) {
  panelOpen = open;
  panel.classList.toggle('closed', !open);
}

function updatePanelAutoBehavior() {
  if (!roomState) {
    setPanelOpen(true);
    return;
  }

  if (forceClosePanel) {
    setPanelOpen(false);
    forceClosePanel = false;
  }

  if (shouldAutoOpenPanel()) {
    setPanelOpen(true);
  }

  if (roomState.phase === PHASES.PLAYING && lastPhase !== PHASES.PLAYING) {
    setPanelOpen(false);
  }

  lastPhase = roomState.phase;
}

function showSections() {
  const show = {
    room: false,
    players: false,
    game: false,
    bidding: false,
    trump: false,
    marks: false
  };

  if (!roomState) {
    show.room = true;
  } else if (roomState.phase === PHASES.LOBBY) {
    show.players = true;
    show.game = true;
    show.room = true;
  } else if (roomState.phase === PHASES.BIDDING) {
    show.bidding = true;
  } else if (roomState.phase === PHASES.CHOOSE_MODE || roomState.phase === PHASES.CHOOSE_TRUMP) {
    show.trump = true;
  } else if (roomState.phase === PHASES.PLAYING) {
    show.marks = true;
    show.room = true;
  } else {
    show.marks = true;
    show.room = true;
  }

  sectionRoom.classList.toggle('hidden', !show.room);
  sectionPlayers.classList.toggle('hidden', !show.players);
  sectionGame.classList.toggle('hidden', !show.game);
  sectionBidding.classList.toggle('hidden', !show.bidding);
  sectionTrump.classList.toggle('hidden', !show.trump);
  sectionMarks.classList.toggle('hidden', !show.marks);
}

function drawPips(ctx, value, xCenter) {
  const layout = {
    0: [],
    1: [[0, 0]],
    2: [[-0.18, -0.2], [0.18, 0.2]],
    3: [[-0.18, -0.2], [0, 0], [0.18, 0.2]],
    4: [[-0.18, -0.2], [0.18, -0.2], [-0.18, 0.2], [0.18, 0.2]],
    5: [[-0.18, -0.2], [0.18, -0.2], [0, 0], [-0.18, 0.2], [0.18, 0.2]],
    6: [[-0.18, -0.22], [0.18, -0.22], [-0.18, 0], [0.18, 0], [-0.18, 0.22], [0.18, 0.22]]
  };

  const positions = layout[value] || [];
  for (const [x, y] of positions) {
    ctx.beginPath();
    ctx.arc(xCenter + x * 185, 128 + y * 205, 12, 0, Math.PI * 2);
    ctx.fill();
  }
}

function getDominoTexture(tile, options = {}) {
  const {
    faceUp = true,
    pipColor = '#111111',
    glowCount = false,
    magentaTrump = false
  } = options;
  const id = tile ? tile.id || tileId(tile) : 'back';
  const key = `${id}:${faceUp ? 'up' : 'down'}:${pipColor}:${glowCount ? 1 : 0}:${magentaTrump ? 1 : 0}`;
  if (textureCache.has(key)) return textureCache.get(key);

  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');

  if (!faceUp) {
    ctx.fillStyle = '#253342';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#4a5f73';
    ctx.lineWidth = 8;
    ctx.strokeRect(12, 12, c.width - 24, c.height - 24);
    ctx.fillStyle = '#3d5266';
    for (let i = 0; i < 12; i += 1) {
      ctx.beginPath();
      ctx.arc(40 + i * 40, 128 + (i % 2 === 0 ? -18 : 18), 6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = '#f6f0e6';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#1f1f1f';
    ctx.lineWidth = 9;
    ctx.strokeRect(8, 8, c.width - 16, c.height - 16);

    if (glowCount) {
      ctx.fillStyle = 'rgba(255, 214, 97, 0.35)';
      ctx.fillRect(0, 0, c.width, c.height);
    }

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(256, 12);
    ctx.lineTo(256, 244);
    ctx.stroke();

    ctx.fillStyle = magentaTrump ? '#cf3df6' : pipColor;
    drawPips(ctx, tile.a, 128);
    drawPips(ctx, tile.b, 384);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  textureCache.set(key, tex);
  return tex;
}

function createDominoMesh(tile, options = {}) {
  const {
    faceUp = true,
    scale = 1,
    glowCount = false,
    trumpSuit = null,
    useMagentaTrump = false
  } = options;

  const magentaTrump = useMagentaTrump && trumpSuit != null && tileContainsSuit(tile, trumpSuit);
  const topTexture = getDominoTexture(tile, {
    faceUp,
    pipColor: '#121212',
    glowCount,
    magentaTrump
  });
  const bottomTexture = getDominoTexture(tile, {
    faceUp: false,
    pipColor: '#111',
    glowCount: false,
    magentaTrump: false
  });

  const sideMat = new THREE.MeshStandardMaterial({ color: faceUp ? 0xf2ece1 : 0x2f3f4d, roughness: 0.9, metalness: 0.06 });
  const topMat = new THREE.MeshStandardMaterial({ map: topTexture, roughness: 0.78, metalness: 0.03 });
  const bottomMat = new THREE.MeshStandardMaterial({ map: bottomTexture, roughness: 0.9, metalness: 0.03 });

  const mats = [sideMat, sideMat, topMat, bottomMat, sideMat, sideMat];
  const mesh = new THREE.Mesh(dominoGeometry, mats);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.scale.setScalar(scale);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.userData = {
    tileId: tile.id || tileId(tile),
    seatIndex: null,
    clickable: false
  };

  return mesh;
}

function clearGroup(group) {
  const children = [...group.children];
  for (const child of children) {
    if (child.children && child.children.length) {
      clearGroup(child);
    }
    group.remove(child);
    if (child.geometry && child.geometry !== dominoGeometry) child.geometry.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach((mat) => mat.dispose && mat.dispose());
    } else if (child.material) {
      child.material.dispose && child.material.dispose();
    }
  }
}

function layoutSeatAnchor(relativeSeat) {
  if (relativeSeat === 0) return { x: 0, z: 3.75, rotY: 0 };
  if (relativeSeat === 1) return { x: 3.85, z: 0, rotY: -Math.PI / 2 };
  if (relativeSeat === 2) return { x: 0, z: -3.75, rotY: Math.PI };
  return { x: -3.85, z: 0, rotY: Math.PI / 2 };
}

function toRelativeSeat(seatIndex, localSeat) {
  if (localSeat == null) return seatIndex;
  return (seatIndex - localSeat + 4) % 4;
}

function renderHandsAndTrick() {
  clearGroup(handGroup);
  clearGroup(oppHandGroup);
  clearGroup(trickGroup);

  if (!roomState) return;

  oppHandGroup.add(burnGroupA);
  oppHandGroup.add(burnGroupB);

  const localSeat = getLocalSeat();
  const myHand = localSeat != null ? roomState.hands?.[localSeat] || [] : [];

  if (myHand.length) {
    const spacing = 1.22;
    const startX = -((myHand.length - 1) * spacing) / 2;
    myHand.forEach((tile, index) => {
      const mesh = createDominoMesh(tile, {
        faceUp: true,
        glowCount: countTilePoints(tile) > 0
      });
      mesh.position.set(startX + index * spacing, DOMINO_Y, 3.82);
      mesh.rotation.x = 0;
      mesh.userData.tileId = tile.id;
      mesh.userData.seatIndex = localSeat;
      mesh.userData.clickable = true;
      handGroup.add(mesh);
    });
  }

  for (let seatIndex = 0; seatIndex < 4; seatIndex += 1) {
    if (seatIndex === localSeat) continue;
    const count = roomState.handCounts?.[seatIndex] || 0;
    const rel = toRelativeSeat(seatIndex, localSeat);
    const anchor = layoutSeatAnchor(rel);

    for (let i = 0; i < count; i += 1) {
      const mesh = createDominoMesh({ a: 0, b: 0, id: 'back' }, { faceUp: false });
      mesh.position.set(anchor.x, DOMINO_Y + i * 0.012, anchor.z + i * 0.06);
      mesh.rotation.y = anchor.rotY;
      mesh.scale.setScalar(0.92);
      oppHandGroup.add(mesh);
    }
  }

  const trick = roomState.trick || [];
  const trickSpacing = 1.35;
  trick.forEach((play) => {
    const rel = toRelativeSeat(play.seatIndex, localSeat);
    const pos = [
      { x: 0, z: 1.02 },
      { x: trickSpacing, z: 0 },
      { x: 0, z: -1.02 },
      { x: -trickSpacing, z: 0 }
    ][rel] || { x: 0, z: 0 };

    const mesh = createDominoMesh(play.tile, {
      faceUp: true,
      glowCount: countTilePoints(play.tile) > 0,
      trumpSuit: roomState.trumpSuit,
      useMagentaTrump: roomState.mode === MODES.TRUMPS
    });
    mesh.position.set(pos.x, DOMINO_Y, pos.z);
    mesh.rotation.y = rel === 1 ? -Math.PI / 2 : rel === 3 ? Math.PI / 2 : rel === 2 ? Math.PI : 0;
    trickGroup.add(mesh);
  });

  renderBurnPiles();
}

function renderBurnPiles() {
  clearGroup(burnGroupA);
  clearGroup(burnGroupB);

  if (!roomState) return;

  const aTiles = roomState.burnPiles?.teamA || [];
  const bTiles = roomState.burnPiles?.teamB || [];

  const renderPile = (tiles, group, x, z, rotY) => {
    const sample = tiles.slice(-12);
    sample.forEach((tile, i) => {
      const mesh = createDominoMesh(tile, {
        faceUp: true,
        scale: 1.11,
        glowCount: countTilePoints(tile) > 0,
        trumpSuit: roomState.trumpSuit,
        useMagentaTrump: roomState.mode === MODES.TRUMPS
      });
      mesh.position.set(x + (i % 4) * 0.12, DOMINO_Y + i * 0.01, z + Math.floor(i / 4) * 0.1);
      mesh.rotation.y = rotY;
      group.add(mesh);
    });
  };

  renderPile(aTiles, burnGroupA, -2.8, 2.6, 0.2);
  renderPile(bTiles, burnGroupB, 2.2, -3.0, -0.2);
}

function setSeatAvatarModel(seatIndex, avatarId) {
  const targetGroup = seatAvatarGroup[seatIndex];
  targetGroup.clear();

  const rel = toRelativeSeat(seatIndex, getLocalSeat());
  const anchor = layoutSeatAnchor(rel);
  targetGroup.position.set(anchor.x, PLAY_PLANE_Y + 0.05, anchor.z);
  targetGroup.rotation.y = anchor.rotY + Math.PI;

  const token = `${seatIndex}:${avatarId || 'none'}:${Date.now()}`;
  activeAvatarLoadToken.set(seatIndex, token);

  const fallback = () => {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.2, 0.55, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x8d9cb6, roughness: 0.62, metalness: 0.15 })
    );
    body.castShadow = true;
    body.receiveShadow = true;
    body.position.y = 0.45;
    targetGroup.add(body);
  };

  const entry = avatarById.get(avatarId);
  if (!entry) {
    fallback();
    return;
  }

  gltfLoader.load(
    entry.url,
    (gltf) => {
      if (activeAvatarLoadToken.get(seatIndex) !== token) return;
      const model = gltf.scene || gltf.scenes?.[0];
      if (!model) {
        fallback();
        return;
      }

      model.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((mat) => {
            if (!mat) return;
            if (mat.map) {
              mat.map.colorSpace = THREE.SRGBColorSpace;
              mat.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
            }
            if (mat.emissiveMap) {
              mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            }
          });
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxAxis = Math.max(size.x, size.y, size.z) || 1;
      const scale = 0.95 / maxAxis;
      model.scale.setScalar(scale);
      box.setFromObject(model);
      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.sub(center);
      model.position.y += 0.55;

      targetGroup.add(model);
    },
    undefined,
    () => {
      fallback();
    }
  );
}

function renderAvatars() {
  if (!roomState) return;
  roomState.seats.forEach((seat) => {
    setSeatAvatarModel(seat.seatIndex, seat.avatarId);
  });
}

function updateHud() {
  if (!roomState) {
    hudBidValue.textContent = '-';
    hudTrumpValue.textContent = '-';
    marksText.textContent = 'Not in a room.';
    return;
  }

  hudBidValue.textContent = roomState.bidValue == null ? '-' : String(roomState.bidValue);
  hudTrumpValue.textContent = currentTrumpLabel();

  const marks = roomState.gameMarks || { teamA: 0, teamB: 0 };
  const rounds = roomState.roundWins || { teamA: 0, teamB: 0 };
  const points = roomState.pointsThisHand || { teamA: 0, teamB: 0 };
  const target = roomState.targetThisHand || { teamA: 0, teamB: 0 };
  marksText.textContent = `Points A/B: ${points.teamA}/${points.teamB} | Target A/B: ${target.teamA}/${target.teamB} | RoundWins A/B: ${rounds.teamA}/${rounds.teamB} | GameMarks A/B: ${marks.teamA}/${marks.teamB}`;
}

function updateNameplates() {
  const seatBids = roomState?.bidBySeat || { 0: '-', 1: '-', 2: '-', 3: '-' };
  const marks = roomState?.gameMarks || { teamA: 0, teamB: 0 };
  const maxMarks = Math.max(marks.teamA || 0, marks.teamB || 0);
  const tied = (marks.teamA || 0) === (marks.teamB || 0);
  const crownTeam = maxMarks > 0 && !tied ? (marks.teamA > marks.teamB ? 'teamA' : 'teamB') : null;

  for (let seatIndex = 0; seatIndex < 4; seatIndex += 1) {
    const node = document.getElementById(`nameplate-${seatIndex}`);
    const seat = roomState?.seats?.[seatIndex] || {
      seatIndex,
      name: `Seat ${seatIndex + 1}`,
      type: 'human',
      occupantClientId: null
    };
    const active = roomState?.turnSeat === seatIndex;

    const role = seat.type === 'cpu'
      ? `CPU L${seat.cpuLevel ?? 0}`
      : seat.occupantClientId
        ? (seat.occupantClientId === localClientId ? 'YOU' : 'HUMAN')
        : 'OPEN';

    const crown = crownTeam && teamForSeat(seatIndex) === crownTeam ? ' 👑' : '';
    const bidText = roomState?.phase === PHASES.BIDDING ? ` | Bid: ${seatBids[seatIndex] || 'PASS'}` : '';

    node.classList.toggle('active', active);
    node.innerHTML = `<div class="seatName">${seat.name}${crown}</div><div class="seatMeta">${role}${bidText}</div>`;
  }
}

function renderSeatControls() {
  seatControls.innerHTML = '';
  if (!roomState) return;

  const localSeat = getLocalSeat();
  const isHost = roomState.hostClientId === localClientId;

  roomState.seats.forEach((seat) => {
    const card = document.createElement('div');
    card.className = 'seatCard';

    const typeClass = seat.type === 'cpu' ? 'cpu' : 'human';
    const occupiedByMe = seat.occupantClientId === localClientId;
    const canAvatarEdit = seat.type === 'human' ? occupiedByMe : isHost;

    card.innerHTML = `
      <div class="seatTop">
        <div class="seatTitle">Seat ${seat.seatIndex + 1}: ${seat.name || 'Open'}</div>
        <span class="seatBadge ${typeClass}">${seat.type.toUpperCase()}</span>
      </div>
      <div class="seatGrid">
        <button data-action="claim" data-seat="${seat.seatIndex}" ${roomState.phase !== PHASES.LOBBY || seat.occupantClientId ? 'disabled' : ''}>Claim</button>
        <button data-action="release" data-seat="${seat.seatIndex}" ${(roomState.phase !== PHASES.LOBBY || (!occupiedByMe && !isHost) || !seat.occupantClientId) ? 'disabled' : ''}>Release</button>
      </div>
      <div class="controlRow">
        <label>Seat Type</label>
        <select data-action="setType" data-seat="${seat.seatIndex}" ${(!isHost || roomState.phase !== PHASES.LOBBY) ? 'disabled' : ''}>
          <option value="human" ${seat.type === 'human' ? 'selected' : ''}>human</option>
          <option value="cpu" ${seat.type === 'cpu' ? 'selected' : ''}>cpu</option>
        </select>
      </div>
      <div class="controlRow">
        <label>CPU Level</label>
        <select data-action="setCpu" data-seat="${seat.seatIndex}" ${(!isHost || roomState.phase !== PHASES.LOBBY) ? 'disabled' : ''}>
          <option value="0" ${seat.cpuLevel === 0 ? 'selected' : ''}>0</option>
          <option value="1" ${seat.cpuLevel === 1 ? 'selected' : ''}>1</option>
          <option value="2" ${seat.cpuLevel === 2 ? 'selected' : ''}>2</option>
          <option value="3" ${seat.cpuLevel === 3 ? 'selected' : ''}>3</option>
          <option value="4" ${seat.cpuLevel === 4 ? 'selected' : ''}>4</option>
        </select>
      </div>
      <div class="controlRow">
        <label>Avatar</label>
        <select data-action="avatar" data-seat="${seat.seatIndex}" ${canAvatarEdit ? '' : 'disabled'}>
          <option value="">Default</option>
          ${avatarCatalog.map((entry) => `<option value="${entry.id}" ${entry.id === seat.avatarId ? 'selected' : ''}>${entry.label}</option>`).join('')}
        </select>
      </div>
      <div class="smallText">${seat.occupantClientId ? `Client ${seat.occupantClientId}` : (seat.type === 'cpu' ? 'CPU seat' : 'Unclaimed')}</div>
    `;

    seatControls.appendChild(card);
  });

  seatControls.querySelectorAll('[data-action]').forEach((el) => {
    const action = el.dataset.action;
    const seatIndex = Number(el.dataset.seat);
    if (action === 'claim') {
      el.addEventListener('click', () => {
        sendAction('claimSeat', { seatIndex, name: `Player ${seatIndex + 1}` });
      });
    }
    if (action === 'release') {
      el.addEventListener('click', () => {
        sendAction('releaseSeat', { seatIndex });
      });
    }
    if (action === 'setType') {
      el.addEventListener('change', () => {
        sendAction('setSeatType', {
          seatIndex,
          type: el.value,
          cpuLevel: roomState.seats[seatIndex].cpuLevel
        });
      });
    }
    if (action === 'setCpu') {
      el.addEventListener('change', () => {
        sendAction('setSeatType', {
          seatIndex,
          type: roomState.seats[seatIndex].type,
          cpuLevel: Number(el.value)
        });
      });
    }
    if (action === 'avatar') {
      el.addEventListener('change', () => {
        sendAction('setSeatAvatar', {
          seatIndex,
          avatarId: el.value || null
        });
      });
    }
  });

  if (localSeat != null) {
    roomStatus.textContent = `Room ${roomState.roomId} | You are seat ${localSeat + 1}${isHost ? ' (Host)' : ''}`;
  } else {
    roomStatus.textContent = roomState ? `Room ${roomState.roomId}${isHost ? ' | Host' : ''}` : '';
  }
}

function updateBidControls() {
  bidButtonsWrap.innerHTML = '';
  const passBtn = document.getElementById('passBidBtn');
  if (!roomState || roomState.phase !== PHASES.BIDDING) {
    passBtn.disabled = true;
    return;
  }

  const canBid = localTurnToBid();
  passBtn.disabled = !canBid;

  const highBid = getCurrentHighBid();
  for (let bid = 30; bid <= 42; bid += 1) {
    const btn = document.createElement('button');
    btn.textContent = String(bid);
    btn.disabled = !canBid || bid <= highBid;
    btn.addEventListener('click', () => {
      sendAction('submitBid', { bid });
      forceClosePanel = true;
      updatePanelAutoBehavior();
    });
    bidButtonsWrap.appendChild(btn);
  }

  passBtn.onclick = () => {
    sendAction('submitBid', { bid: null });
    forceClosePanel = true;
    updatePanelAutoBehavior();
  };
}

function updateTrumpControls() {
  trumpButtonsWrap.innerHTML = '';

  const modeButtons = Array.from(modeButtonsWrap.querySelectorAll('button'));
  const canChooseMode = roomState && roomState.phase === PHASES.CHOOSE_MODE && localIsBidder();
  const canChooseTrump = roomState && roomState.phase === PHASES.CHOOSE_TRUMP && localIsBidder() && roomState.mode === MODES.TRUMPS;

  modeButtons.forEach((btn) => {
    const mode = btn.dataset.mode;
    btn.disabled = !canChooseMode;
    btn.classList.toggle('active', roomState?.mode === mode);
    btn.onclick = () => {
      if (!canChooseMode) return;
      sendAction('chooseMode', { mode });
      forceClosePanel = true;
      updatePanelAutoBehavior();
    };
  });

  for (let trump = 0; trump <= 6; trump += 1) {
    const btn = document.createElement('button');
    btn.textContent = String(trump);
    btn.disabled = !canChooseTrump;
    btn.addEventListener('click', () => {
      sendAction('chooseTrump', { trumpSuit: trump });
      forceClosePanel = true;
      updatePanelAutoBehavior();
    });
    trumpButtonsWrap.appendChild(btn);
  }
}

function applySnapshot(room) {
  roomState = room;
  updatePanelAutoBehavior();
  showSections();
  updateHud();
  updateNameplates();
  renderSeatControls();
  updateBidControls();
  updateTrumpControls();
  renderHandsAndTrick();
  renderAvatars();
}

function sendAction(action, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logMessage('Socket not connected.');
    return;
  }
  ws.send(JSON.stringify({ action, payload }));
}

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${window.location.host}`);

  ws.addEventListener('open', () => {
    logMessage('Connected', 1300);
  });

  ws.addEventListener('close', () => {
    infoMessage = 'Disconnected from server.';
    roomState = null;
    localClientId = null;
    updateHud();
    showSections();
    setPanelOpen(true);
    renderHandsAndTrick();
    updateNameplates();
  });

  ws.addEventListener('message', (event) => {
    let data = null;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    if (data.type === 'welcome') {
      localClientId = data.clientId;
      infoMessage = `Connected as ${localClientId}`;
      roomStatus.textContent = infoMessage;
      return;
    }

    if (data.type === 'roomCreated') {
      roomIdInput.value = data.roomId;
      logMessage(`Room ${data.roomId} created`);
      return;
    }

    if (data.type === 'snapshot') {
      applySnapshot(data.room);
      return;
    }

    if (data.type === 'error') {
      logMessage(data.message || 'Action rejected', 3300);
      return;
    }

    if (data.type === 'info') {
      logMessage(data.message || 'Info');
    }
  });
}

function initHdrEnvironment() {
  const fallbackEnv = () => {
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.05).texture;
    scene.environment = envTex;
  };

  new RGBELoader().load(
    '/assets/hdr/warm_interior_01.hdr',
    (texture) => {
      const envMap = pmremGenerator.fromEquirectangular(texture).texture;
      scene.environment = envMap;
      texture.dispose();
    },
    undefined,
    () => {
      fallbackEnv();
    }
  );
}

function ensureButtons() {
  document.getElementById('createRoomBtn').addEventListener('click', () => {
    sendAction('createRoom', { roomId: roomIdInput.value.trim() || undefined });
  });

  document.getElementById('joinRoomBtn').addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (!roomId) {
      logMessage('Enter room ID first.');
      return;
    }
    sendAction('joinRoom', { roomId });
  });

  document.getElementById('leaveRoomBtn').addEventListener('click', () => {
    sendAction('leaveRoom');
    roomState = null;
    showSections();
    renderHandsAndTrick();
    updateNameplates();
  });

  document.getElementById('startGameBtn').addEventListener('click', () => {
    sendAction('startGame');
  });

  document.getElementById('restartGameBtn').addEventListener('click', () => {
    sendAction('restartGame');
  });

  panelToggle.addEventListener('click', () => {
    setPanelOpen(!panelOpen);
  });

  closePanelBtn.addEventListener('click', () => {
    setPanelOpen(false);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'd' && event.shiftKey) {
      debugVisible = !debugVisible;
      debugPlane.visible = debugVisible;
      axesHelper.visible = debugVisible;
      logMessage(`Debug ${debugVisible ? 'on' : 'off'}`);
    }
  });
}

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function addPointerInteraction() {
  canvas.addEventListener('pointerdown', (event) => {
    if (!roomState || !isMyTurnToPlay()) return;

    const localSeat = getLocalSeat();
    if (localSeat == null || roomState.turnSeat !== localSeat) return;

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(handGroup.children, true);
    const selected = intersects.find((hit) => hit.object?.userData?.clickable);
    if (!selected) return;

    const tileId = selected.object.userData.tileId;
    if (!tileId) return;
    sendAction('playTile', { tileId });
  });
}

async function loadAvatarCatalog() {
  try {
    const res = await fetch('/assets/avatars/avatars.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data)) return;

    avatarCatalog.length = 0;
    avatarById.clear();
    for (const item of data) {
      if (!item?.id || !item?.url) continue;
      avatarCatalog.push(item);
      avatarById.set(item.id, item);
    }
  } catch {
    // Keep running with default avatar fallback.
  }
}

function initAvatarSeats() {
  const local = getLocalSeat();
  for (let seatIndex = 0; seatIndex < 4; seatIndex += 1) {
    const rel = toRelativeSeat(seatIndex, local);
    const anchor = layoutSeatAnchor(rel);
    seatAvatarGroup[seatIndex].position.set(anchor.x, PLAY_PLANE_Y + 0.05, anchor.z);
    seatAvatarGroup[seatIndex].rotation.y = anchor.rotY + Math.PI;
  }
}

window.addEventListener('resize', onResize);

initHdrEnvironment();
ensureButtons();
addPointerInteraction();
connect();
loadAvatarCatalog().then(() => {
  if (roomState) {
    renderSeatControls();
    renderAvatars();
  }
});
initAvatarSeats();
updateNameplates();
animate();
