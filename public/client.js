const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const statsEl = document.getElementById("stats");
const coordsEl = document.getElementById("coords");
const targetEl = document.getElementById("target");
const attackBtn = document.getElementById("attackBtn");
const healBtn = document.getElementById("healBtn");
const connectionStatusEl = document.getElementById("connectionStatus");

const RECONNECT_MS = 5000;
let socket = null;
let reconnectTimer = null;
let isConnected = false;
let myId = null;
let state = null;
let selectedTargetId = null;
let zoom = 1;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.8;

const keys = {
  left: false,
  right: false,
  forward: false,
  back: false
};

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener("resize", resize);
resize();

function setConnectionStatus(text, visible) {
  connectionStatusEl.textContent = text;
  connectionStatusEl.classList.toggle("hidden", !visible);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  setConnectionStatus("Brak polaczenia z serwerem, ponowne laczenie za 5 sec", true);
  reconnectTimer = setTimeout(connectSocket, RECONNECT_MS);
}

function connectSocket() {
  clearReconnectTimer();
  socket = new WebSocket(`ws://${location.host}`);

  socket.addEventListener("open", () => {
    isConnected = true;
    setConnectionStatus("", false);
  });

  socket.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "welcome") {
      myId = msg.id;
    } else if (msg.type === "state") {
      state = msg.state;
    }
  });

  socket.addEventListener("close", () => {
    isConnected = false;
    state = null;
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    isConnected = false;
  });
}

connectSocket();

function sendInput() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "input", ...keys }));
}

function keySet(code, down) {
  if (code === "KeyA") keys.left = down;
  if (code === "KeyD") keys.right = down;
  if (code === "KeyW") keys.forward = down;
  if (code === "KeyS") keys.back = down;
}

window.addEventListener("keydown", (e) => {
  keySet(e.code, true);
});

window.addEventListener("keyup", (e) => {
  keySet(e.code, false);
});

window.addEventListener("wheel", (e) => {
  e.preventDefault();
  const step = e.deltaY > 0 ? -0.08 : 0.08;
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + step));
}, { passive: false });

window.addEventListener("keydown", (e) => {
  if (e.code === "Equal" || e.code === "NumpadAdd") {
    zoom = Math.min(MAX_ZOOM, zoom + 0.08);
  }
  if (e.code === "Minus" || e.code === "NumpadSubtract") {
    zoom = Math.max(MIN_ZOOM, zoom - 0.08);
  }
  if (e.code === "Digit0") {
    zoom = 1;
  }
});

setInterval(sendInput, 1000 / 20);

function sendAction(action, targetId = null) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "action", action, targetId }));
}

attackBtn.addEventListener("click", () => {
  sendAction("attack", selectedTargetId);
});

healBtn.addEventListener("click", () => {
  sendAction("heal");
});

function allTargetableEntities() {
  if (!state) return [];
  return [
    ...state.players.filter((p) => p.id !== myId).map((p) => ({ ...p, kind: "player" })),
    ...state.npcs.map((n) => ({ ...n, kind: "npc" })),
    ...state.mobs.map((m) => ({ ...m, kind: "mob" }))
  ];
}

function findById(id) {
  if (!id || !state) return null;
  return allTargetableEntities().find((e) => e.id === id) || null;
}

function drawShip(x, y, angle, radius, color, hp, maxHp, name) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(radius + 8, 0);
  ctx.lineTo(-radius, -radius * 0.7);
  ctx.lineTo(-radius + 6, 0);
  ctx.lineTo(-radius, radius * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const hpW = radius * 2.2;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(x - hpW / 2, y - radius - 16, hpW, 5);
  ctx.fillStyle = "#3dde75";
  ctx.fillRect(x - hpW / 2, y - radius - 16, hpW * (hp / maxHp), 5);

  if (name) {
    ctx.fillStyle = "#dcefff";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(name, x, y - radius - 22);
  }
}

function drawGrid(cameraX, cameraY, world, scale) {
  const spacing = 100;
  ctx.strokeStyle = "rgba(120,180,220,0.12)";
  ctx.lineWidth = 1;

  const startX = Math.floor(cameraX / spacing) * spacing;
  const endX = cameraX + canvas.width / scale;
  const startY = Math.floor(cameraY / spacing) * spacing;
  const endY = cameraY + canvas.height / scale;

  for (let x = startX; x < endX; x += spacing) {
    ctx.beginPath();
    ctx.moveTo((x - cameraX) * scale, 0);
    ctx.lineTo((x - cameraX) * scale, canvas.height);
    ctx.stroke();
  }
  for (let y = startY; y < endY; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, (y - cameraY) * scale);
    ctx.lineTo(canvas.width, (y - cameraY) * scale);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(170,230,255,0.35)";
  ctx.strokeRect(-cameraX * scale, -cameraY * scale, world.width * scale, world.height * scale);
}

function render() {
  requestAnimationFrame(render);
  ctx.fillStyle = "#0a2134";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!state) {
    ctx.fillStyle = "#dcefff";
    ctx.font = "20px Arial";
    ctx.textAlign = "center";
    ctx.fillText(isConnected ? "Ladowanie stanu gry..." : "Laczenie z serwerem...", canvas.width / 2, canvas.height / 2);
    return;
  }

  const me = state.players.find((p) => p.id === myId) || state.players[0];
  const cameraX = me ? me.x - canvas.width / (2 * zoom) : 0;
  const cameraY = me ? me.y - canvas.height / (2 * zoom) : 0;
  const currentTarget = findById(selectedTargetId);

  drawGrid(cameraX, cameraY, state.world, zoom);

  for (const b of state.bullets) {
    ctx.fillStyle = "#ffd067";
    ctx.beginPath();
    ctx.arc((b.x - cameraX) * zoom, (b.y - cameraY) * zoom, b.radius * zoom, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const m of state.mobs) {
    drawShip((m.x - cameraX) * zoom, (m.y - cameraY) * zoom, m.angle, m.radius * zoom, "#c66e51", m.hp, m.maxHp);
  }

  for (const n of state.npcs) {
    drawShip((n.x - cameraX) * zoom, (n.y - cameraY) * zoom, n.angle, n.radius * zoom, "#4ea4c7", n.hp, n.maxHp);
  }

  for (const p of state.players) {
    drawShip(
      (p.x - cameraX) * zoom,
      (p.y - cameraY) * zoom,
      p.angle,
      p.radius * zoom,
      p.id === myId ? "#5fe0a3" : "#79b7ff",
      p.hp,
      p.maxHp,
      p.name
    );
  }

  if (currentTarget) {
    ctx.strokeStyle = "#ffe27f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(
      (currentTarget.x - cameraX) * zoom,
      (currentTarget.y - cameraY) * zoom,
      (currentTarget.radius + 8) * zoom,
      0,
      Math.PI * 2
    );
    ctx.stroke();
  } else if (selectedTargetId) {
    selectedTargetId = null;
  }

  if (me) {
    const healLeft = Math.max(0, me.healCooldown || 0);
    statsEl.textContent =
      `HP: ${Math.ceil(me.hp)} / ${me.maxHp} | EXP: ${me.exp} | LVL: ${me.level} | ` +
      `Score: ${me.score} | Heal CD: ${healLeft.toFixed(1)}s | Zoom: ${zoom.toFixed(2)}x`;
    coordsEl.textContent = `Koordy: X ${Math.round(me.x)} | Y ${Math.round(me.y)} | Graczy: ${state.players.length}`;
    healBtn.disabled = healLeft > 0 || me.hp >= me.maxHp;
  }

  if (currentTarget) {
    targetEl.textContent = `Cel: ${currentTarget.kind.toUpperCase()} (${Math.ceil(currentTarget.hp)} HP)`;
  } else {
    targetEl.textContent = "Cel: brak (atak wybierze najblizszy cel w zasiegu)";
  }
  attackBtn.disabled = false;
}

canvas.addEventListener("click", (event) => {
  if (!state) return;
  const me = state.players.find((p) => p.id === myId) || state.players[0];
  if (!me) return;

  const cameraX = me.x - canvas.width / (2 * zoom);
  const cameraY = me.y - canvas.height / (2 * zoom);
  const worldX = event.clientX / zoom + cameraX;
  const worldY = event.clientY / zoom + cameraY;

  let best = null;
  let bestD2 = 36 * 36;
  for (const entity of allTargetableEntities()) {
    const dx = entity.x - worldX;
    const dy = entity.y - worldY;
    const d2 = dx * dx + dy * dy;
    const pickRadius = entity.radius + 12;
    if (d2 <= pickRadius * pickRadius && d2 < bestD2) {
      best = entity;
      bestD2 = d2;
    }
  }
  selectedTargetId = best ? best.id : null;
});

render();
