// --- Config do jogo ---
const CANVAS = document.getElementById("game");
const CTX = CANVAS.getContext("2d");
const WIDTH = CANVAS.width;
const HEIGHT = CANVAS.height;

const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const OUTER_R = 240;       // raio externo (pista)
const INNER_R = 150;       // raio interno (grama interna)
const ROAD_COLOR = "#3f3f3f";
const LINE_COLOR = "#ffd84d";
const GRASS_COLOR = "#1e7a2e";

const LAPS_TO_WIN = 3;
const FPS = 60;
const DT = 1 / FPS;

const banner = document.getElementById("banner");
const startBtn = document.getElementById("start");
const aiToggle = document.getElementById("ai");

// HUD
const hud = {
  lap: { p1: document.getElementById("lap-p1"), p2: document.getElementById("lap-p2") },
  spd: { p1: document.getElementById("spd-p1"), p2: document.getElementById("spd-p2") },
  pos: { p1: document.getElementById("pos-p1"), p2: document.getElementById("pos-p2") },
  item:{ p1: document.getElementById("item-p1"), p2: document.getElementById("item-p2") },
};

// --- Sprites ---
const marioImg = new Image();
const luigiImg = new Image();
marioImg.src = "./docs/mario.gif";
luigiImg.src = "./docs/luigi.gif";

// --- Helpers ---
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp  = (a, b, t) => a + (b - a) * t;
const angleNorm = (a) => {
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
};
const deg = (r) => (r * 180 / Math.PI);

// posição ao longo da pista (raio médio) -> x,y
function onTrackPos(theta, radius = (OUTER_R + INNER_R) / 2) {
  return {
    x: CENTER.x + radius * Math.cos(theta),
    y: CENTER.y + radius * Math.sin(theta),
  };
}
function isOffRoad(x, y) {
  const dx = x - CENTER.x, dy = y - CENTER.y;
  const r = Math.hypot(dx, dy);
  return (r < INNER_R || r > OUTER_R);
}

// --- Caixas de item (turbo) distribuídas pelo anel ---
const BOX_COUNT = 8;
const boxes = Array.from({ length: BOX_COUNT }).map((_, i) => {
  const theta = (i / BOX_COUNT) * Math.PI * 2;
  const pos = onTrackPos(theta, (OUTER_R + INNER_R) / 2 + 8);
  return { theta, x: pos.x, y: pos.y, active: true, cooldown: 0 };
});

// --- Jogadores ---
function createKart(name, img, controls) {
  return {
    name,
    img,
    theta: -Math.PI / 2,              // ponto de largada (topo)
    radius: (OUTER_R + INNER_R) / 2,
    speed: 0,
    accel: 140,                        // px/s^2
    maxSpeed: 260,                     // px/s
    steer: 2.4,                        // rad/s @ vel máxima
    friction: 1.7,                     // desaceleração base
    offFriction: 3.2,                  // na grama
    width: 46, height: 46,
    lap: 1,
    passedGate: false,                 // para contagem de volta
    finished: false,
    item: null,                        // "turbo"
    turboT: 0,
    controls,                          // {up,down,left,right,item}
    ai: false
  };
}

const P1 = createKart("Mario", marioImg, {
  up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", item: "ShiftLeft"
});
const P2 = createKart("Luigi", luigiImg, {
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", item: "Enter"
});
P2.theta = -Math.PI / 2 - 0.08; // pequena defasagem de grid

let running = false;
let finishedOrder = [];

// --- Input ---
const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.code));
window.addEventListener("keyup",   (e) => keys.delete(e.code));

// --- IA simples para 2º jogador ---
function updateAI(kart) {
  if (!kart.ai) return;
  // sempre acelerar
  keys.add(kart.controls.up);
  keys.delete(kart.controls.down);

  // manter-se no centro da pista ajustando theta pouco
  // simulamos "steer assist": nada aqui, porque nosso movimento é por theta.
  // Usar turbo quando disponível e em reta (próximo ao topo)
  const atTop = Math.abs(angleNorm(kart.theta + Math.PI/2)) < 0.25;
  if (kart.item === "turbo" && atTop && Math.random() < 0.02) {
    // simular tecla do item
    useItem(kart);
  }
}

// --- Itens ---
function tryPickupBox(kart) {
  if (kart.item) return;
  for (const b of boxes) {
    if (!b.active) continue;
    const dx = kart.x - b.x, dy = kart.y - b.y;
    if (dx*dx + dy*dy < 28*28) {
      b.active = false; b.cooldown = 3;  // 3s de respawn
      kart.item = "turbo";
      updateHUD();
      break;
    }
  }
}
function updateBoxes(dt) {
  for (const b of boxes) {
    if (!b.active) {
      b.cooldown -= dt;
      if (b.cooldown <= 0) b.active = true;
    }
  }
}
function useItem(kart) {
  if (kart.item === "turbo") {
    kart.turboT = 1.2;            // 1.2s de turbo
    kart.item = null;
    updateHUD();
  }
}

// --- Update físico ---
function updateKart(kart, dt) {
  // input
  const up = keys.has(kart.controls.up);
  const down = keys.has(kart.controls.down);
  const left = keys.has(kart.controls.left);
  const right = keys.has(kart.controls.right);
  const pressItem = keys.has(kart.controls.item);

  if (pressItem) useItem(kart);

  // aceleração
  if (up) kart.speed += kart.accel * dt;
  if (down) kart.speed -= kart.accel * 0.8 * dt;

  // turbo
  if (kart.turboT > 0) {
    kart.speed += kart.accel * 1.6 * dt;
    kart.turboT -= dt;
  }

  // limites de velocidade
  kart.speed = clamp(kart.speed, -kart.maxSpeed * 0.5, kart.maxSpeed);

  // direção (quanto mais rápido, mais vira)
  const steerFactor = clamp(Math.abs(kart.speed) / kart.maxSpeed, 0, 1);
  if (left)  kart.theta -= kart.steer * steerFactor * dt;
  if (right) kart.theta += kart.steer * steerFactor * dt;
  kart.theta = angleNorm(kart.theta);

  // avança ao longo do anel (velocidade -> delta theta)
  const pathRadius = kart.radius;
  const arcPerSec = kart.speed / pathRadius;   // rad/s
  kart.theta += arcPerSec * dt;

  // posição cartesiana
  const pos = onTrackPos(kart.theta, pathRadius);
  kart.x = pos.x; kart.y = pos.y;

  // atrito (diferente na grama)
  const off = isOffRoad(kart.x, kart.y);
  const fric = (off ? kart.offFriction : kart.friction);
  if (!up && !down && kart.turboT <= 0) {
    const s = Math.sign(kart.speed);
    kart.speed -= s * fric * 60 * dt; // compensado por 60fps
    if (Math.sign(kart.speed) !== s) kart.speed = 0;
  }

  // pegar item
  tryPickupBox(kart);

  // checar volta (linha de chegada: eixo horizontal no topo)
  // Consideramos "passou pelo topo indo no sentido horário"
  const nearStart = Math.abs(angleNorm(kart.theta + Math.PI/2)) < 0.12; // ~7°
  if (nearStart && !kart.passedGate && !kart.finished) {
    kart.passedGate = true;
    if (kart.theta > -Math.PI/2) {
      // atravessou de esquerda -> direita (sentido da corrida)
      if (kart.lap < LAPS_TO_WIN) {
        kart.lap++;
      } else {
        kart.finished = true;
        finishedOrder.push(kart.name);
        showBanner(`${kart.name} terminou!`);
      }
    }
  }
  if (!nearStart) kart.passedGate = false;
}

function update(dt) {
  if (!running) return;
  P2.ai = aiToggle.checked;

  if (P2.ai) updateAI(P2);

  updateKart(P1, dt);
  updateKart(P2, dt);
  updateBoxes(dt);
  updateHUD();

  // fim de corrida
  if (P1.finished && P2.finished) {
    running = false;
    showBanner(`🏁 Resultado: 1º ${finishedOrder[0]} • 2º ${finishedOrder[1]}`);
  }
}

// --- HUD ---
function toPlace(p) { return p === 1 ? "1º" : (p === 2 ? "2º" : `${p}º`); }
function updateHUD() {
  // posição por progressão angular (theta normalizada de 0..2π)
  const prog = (t) => (angleNorm(t + Math.PI/2) + Math.PI) / (Math.PI*2); // 0..1 no topo
  const s1 = prog(P1.theta), s2 = prog(P2.theta);
  let p1Pos = 1, p2Pos = 2;
  if (P1.lap === P2.lap) {
    if (s1 < s2) { p1Pos = 2; p2Pos = 1; }
  } else if (P1.lap < P2.lap) { p1Pos = 2; p2Pos = 1; }
  hud.lap.p1.textContent = P1.lap;
  hud.lap.p2.textContent = P2.lap;
  hud.spd.p1.textContent = Math.round(Math.abs(P1.speed)).toString();
  hud.spd.p2.textContent = Math.round(Math.abs(P2.speed)).toString();
  hud.pos.p1.textContent = toPlace(p1Pos);
  hud.pos.p2.textContent = toPlace(p2Pos);
  hud.item.p1.textContent = P1.item ? "Turbo" : (P1.turboT>0 ? "Turbo!" : "—");
  hud.item.p2.textContent = P2.item ? "Turbo" : (P2.turboT>0 ? "Turbo!" : "—");
}

// --- Render ---
function drawTrack() {
  // fundo (grama)
  CTX.fillStyle = GRASS_COLOR;
  CTX.fillRect(0, 0, WIDTH, HEIGHT);

  // anel da pista (asfalto)
  CTX.beginPath();
  CTX.arc(CENTER.x, CENTER.y, OUTER_R, 0, Math.PI*2);
  CTX.arc(CENTER.x, CENTER.y, INNER_R, 0, Math.PI*2, true);
  CTX.closePath();
  CTX.fillStyle = ROAD_COLOR;
  CTX.fill();

  // faixa central pontilhada
  CTX.setLineDash([18, 16]);
  CTX.strokeStyle = LINE_COLOR;
  CTX.lineWidth = 4;
  CTX.beginPath();
  CTX.arc(CENTER.x, CENTER.y, (OUTER_R + INNER_R)/2, 0, Math.PI*2);
  CTX.stroke();
  CTX.setLineDash([]);

  // linha de chegada
  CTX.save();
  CTX.translate(CENTER.x, CENTER.y - OUTER_R + 6);
  CTX.fillStyle = "#fff";
  for (let i=0;i<14;i++){
    if (i%2===0) CTX.fillRect(-40 + i*12, -6, 12, 12);
  }
  CTX.restore();
}

function drawBoxes() {
  for (const b of boxes) {
    if (!b.active) continue;
    CTX.save();
    CTX.translate(b.x, b.y);
    CTX.rotate(perfNow * 0.004);
    CTX.fillStyle = "#9bf";
    CTX.strokeStyle = "#123";
    CTX.lineWidth = 2;
    CTX.beginPath();
    CTX.rect(-14, -14, 28, 28);
    CTX.fill();
    CTX.stroke();
    CTX.fillStyle = "#fff";
    CTX.font = "bold 16px sans-serif";
    CTX.textAlign = "center";
    CTX.textBaseline = "middle";
    CTX.fillText("?", 0, 1);
    CTX.restore();
  }
}

function drawKart(kart) {
  const angle = kart.theta + Math.PI/2; // tangente à pista
  CTX.save();
  CTX.translate(kart.x, kart.y);
  CTX.rotate(angle);
  // brilho de turbo
  if (kart.turboT > 0) {
    CTX.shadowBlur = 18;
    CTX.shadowColor = "#ffd84d";
  }
  const w = kart.width, h = kart.height;
  // base
  CTX.fillStyle = "rgba(0,0,0,.25)";
  CTX.fillRect(-w/2, -h/2, w, h);
  // sprite
  if (kart.img && kart.img.complete) {
    CTX.drawImage(kart.img, -w/2, -h/2, w, h);
  } else {
    CTX.fillStyle = "#fff";
    CTX.fillRect(-w/2, -h/2, w, h);
  }
  CTX.restore();
}

let perfNow = 0;
function render() {
  drawTrack();
  drawBoxes();
  drawKart(P1);
  drawKart(P2);

  // contagem regressiva
  if (countdownT > 0) {
    CTX.fillStyle = "rgba(0,0,0,.45)";
    CTX.fillRect(0,0,WIDTH,HEIGHT);
    CTX.fillStyle = "#fff";
    CTX.font = "bold 80px system-ui, sans-serif";
    CTX.textAlign = "center";
    CTX.textBaseline = "middle";
    CTX.fillText(countdownText, WIDTH/2, HEIGHT/2);
  }
}

// --- Loop principal ---
let last = performance.now();
let countdownT = 0;
let countdownText = "3";

function loop(now) {
  perfNow = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (countdownT > 0) {
    countdownT -= dt;
    if (countdownT <= 0) {
      if (countdownText === "GO!") {
        running = true;
      } else if (countdownText === "1") {
        countdownText = "GO!";
        countdownT = 0.9;
      } else if (countdownText === "2") {
        countdownText = "1";
        countdownT = 0.9;
      } else if (countdownText === "3") {
        countdownText = "2";
        countdownT = 0.9;
      }
    }
  } else if (running) {
    update(dt);
  }

  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- UI / Estado ---
function resetRace() {
  running = false;
  finishedOrder = [];
  hideBanner();

  Object.assign(P1, { theta: -Math.PI/2, speed: 0, lap: 1, passedGate:false, finished:false, item:null, turboT:0 });
  Object.assign(P2, { theta: -Math.PI/2 - 0.08, speed: 0, lap: 1, passedGate:false, finished:false, item:null, turboT:0 });
  boxes.forEach(b => { b.active = true; b.cooldown = 0; });

  updateHUD();
}

function showBanner(text) {
  banner.textContent = text;
  banner.classList.remove("hidden");
  setTimeout(()=>banner.classList.add("hidden"), 1500);
}
function hideBanner(){ banner.classList.add("hidden"); }

startBtn.addEventListener("click", () => {
  resetRace();
  countdownText = "3";
  countdownT = 0.9;
});

// qualidade de vida: evitar scroll com setas
window.addEventListener("keydown", (e) => {
  const block = ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space","Enter"];
  if (block.includes(e.code)) e.preventDefault();
});
