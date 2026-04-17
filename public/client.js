const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const nameEl = document.getElementById("name");
const statsEl = document.getElementById("stats");

const socket = new WebSocket(`ws://${location.host}`);
let myId = null;
let myName = "Pirate";
let state = null;

const keys = {
  left: false,
  right: false,
  forward: false,
  back: false,
  fire: false
};

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener("resize", resize);
resize();

socket.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === "welcome") {
    myId = msg.id;
    myName = msg.name;
    nameEl.textContent = `Kapitan: ${myName}`;
  } else if (msg.type === "state") {
    state = msg.state;
  }
});

function sendInput() {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "input", ...keys }));
}

function keySet(code, down) {
  if (code === "KeyA") keys.left = down;
  if (code === "KeyD") keys.right = down;
  if (code === "KeyW") keys.forward = down;
  if (code === "KeyS") keys.back = down;
  if (code === "Space") keys.fire = down;
}

window.addEventListener("keydown", (e) => {
  keySet(e.code, true);
});

window.addEventListener("keyup", (e) => {
  keySet(e.code, false);
});

setInterval(sendInput, 1000 / 20);

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

function drawGrid(cameraX, cameraY, world) {
  const spacing = 100;
  ctx.strokeStyle = "rgba(120,180,220,0.12)";
  ctx.lineWidth = 1;

  const startX = Math.floor(cameraX / spacing) * spacing;
  const endX = cameraX + canvas.width;
  const startY = Math.floor(cameraY / spacing) * spacing;
  const endY = cameraY + canvas.height;

  for (let x = startX; x < endX; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x - cameraX, 0);
    ctx.lineTo(x - cameraX, canvas.height);
    ctx.stroke();
  }
  for (let y = startY; y < endY; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y - cameraY);
    ctx.lineTo(canvas.width, y - cameraY);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(170,230,255,0.35)";
  ctx.strokeRect(-cameraX, -cameraY, world.width, world.height);
}

function render() {
  requestAnimationFrame(render);
  ctx.fillStyle = "#0a2134";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!state) {
    ctx.fillStyle = "#dcefff";
    ctx.font = "20px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Laczenie z serwerem...", canvas.width / 2, canvas.height / 2);
    return;
  }

  const me = state.players.find((p) => p.id === myId) || state.players[0];
  const cameraX = me ? me.x - canvas.width / 2 : 0;
  const cameraY = me ? me.y - canvas.height / 2 : 0;

  drawGrid(cameraX, cameraY, state.world);

  for (const b of state.bullets) {
    ctx.fillStyle = "#ffd067";
    ctx.beginPath();
    ctx.arc(b.x - cameraX, b.y - cameraY, b.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const m of state.mobs) {
    drawShip(m.x - cameraX, m.y - cameraY, m.angle, m.radius, "#c66e51", m.hp, m.maxHp);
  }

  for (const n of state.npcs) {
    drawShip(n.x - cameraX, n.y - cameraY, n.angle, n.radius, "#4ea4c7", n.hp, n.maxHp);
  }

  for (const p of state.players) {
    drawShip(
      p.x - cameraX,
      p.y - cameraY,
      p.angle,
      p.radius,
      p.id === myId ? "#5fe0a3" : "#79b7ff",
      p.hp,
      p.maxHp,
      p.name
    );
  }

  if (me) {
    statsEl.textContent = `HP: ${Math.ceil(me.hp)} / ${me.maxHp} | Score: ${me.score} | Graczy: ${state.players.length}`;
  }
}

render();
