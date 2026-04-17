const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const WORLD_WIDTH = 2600;
const WORLD_HEIGHT = 1800;
const TICK_RATE = 30;
const DT = 1 / TICK_RATE;
const MAX_INPUT_AGE_MS = 200;

const clients = new Map();
const players = new Map();
const bullets = new Map();
const npcs = new Map();
const mobs = new Map();
let bulletId = 1;
let entityId = 1;

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function uid(prefix) {
  const id = `${prefix}_${entityId}`;
  entityId += 1;
  return id;
}

function createShip(id, kind) {
  return {
    id,
    kind,
    x: rand(120, WORLD_WIDTH - 120),
    y: rand(120, WORLD_HEIGHT - 120),
    vx: 0,
    vy: 0,
    angle: rand(0, Math.PI * 2),
    hp: 100,
    maxHp: 100,
    radius: 20,
    speed: kind === "player" ? 180 : 140,
    turnSpeed: 2.8,
    cooldown: 0,
    alive: true,
    score: 0
  };
}

function createMob() {
  return {
    id: uid("mob"),
    kind: "mob",
    x: rand(100, WORLD_WIDTH - 100),
    y: rand(100, WORLD_HEIGHT - 100),
    vx: 0,
    vy: 0,
    angle: rand(0, Math.PI * 2),
    hp: 60,
    maxHp: 60,
    radius: 17,
    speed: 110,
    turnSpeed: 2.2,
    cooldown: rand(0.2, 1.0),
    alive: true,
    score: 0
  };
}

function createBullet(ownerId, ownerKind, x, y, angle, damage) {
  const speed = 420;
  return {
    id: `b_${bulletId++}`,
    ownerId,
    ownerKind,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    ttl: 2.5,
    radius: 4,
    damage
  };
}

for (let i = 0; i < 4; i += 1) {
  const npc = createShip(uid("npc"), "npc");
  npcs.set(npc.id, npc);
}

for (let i = 0; i < 8; i += 1) {
  const mob = createMob();
  mobs.set(mob.id, mob);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8"
};

const server = http.createServer((req, res) => {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absPath = path.join(__dirname, "public", filePath);
  fs.readFile(absPath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const ws of clients.keys()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}

function nearestTarget(from, includePlayers = true) {
  let best = null;
  let bestD2 = Infinity;

  const pools = [npcs.values(), mobs.values()];
  if (includePlayers) pools.unshift(players.values());

  for (const pool of pools) {
    for (const ent of pool) {
      if (!ent.alive || ent.id === from.id) continue;
      const d2 = dist2(from.x, from.y, ent.x, ent.y);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = ent;
      }
    }
  }
  return best;
}

function fireIfReady(shooter, ownerKind, target, spread = 0.12, damage = 16) {
  if (!target || shooter.cooldown > 0) return;
  const angle = Math.atan2(target.y - shooter.y, target.x - shooter.x) + rand(-spread, spread);
  const muzzleX = shooter.x + Math.cos(angle) * (shooter.radius + 7);
  const muzzleY = shooter.y + Math.sin(angle) * (shooter.radius + 7);
  const bullet = createBullet(shooter.id, ownerKind, muzzleX, muzzleY, angle, damage);
  bullets.set(bullet.id, bullet);
  shooter.cooldown = 0.55;
}

function damageTarget(target, amount, attackerId) {
  target.hp -= amount;
  if (target.hp > 0) return;
  target.alive = false;

  if (players.has(attackerId)) {
    players.get(attackerId).score += 1;
  }

  if (target.kind === "player") {
    target.hp = target.maxHp;
    target.x = rand(120, WORLD_WIDTH - 120);
    target.y = rand(120, WORLD_HEIGHT - 120);
    target.alive = true;
    return;
  }

  if (target.kind === "npc") {
    npcs.delete(target.id);
    const npc = createShip(uid("npc"), "npc");
    npcs.set(npc.id, npc);
    return;
  }

  if (target.kind === "mob") {
    mobs.delete(target.id);
    const mob = createMob();
    mobs.set(mob.id, mob);
  }
}

function updateAI(unit, dt, targetPreferencePlayers = true) {
  const target = nearestTarget(unit, targetPreferencePlayers);
  if (!target) return;

  const desired = Math.atan2(target.y - unit.y, target.x - unit.x);
  let diff = desired - unit.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  unit.angle += clamp(diff, -unit.turnSpeed * dt, unit.turnSpeed * dt);

  unit.vx = Math.cos(unit.angle) * unit.speed;
  unit.vy = Math.sin(unit.angle) * unit.speed;
  unit.x = clamp(unit.x + unit.vx * dt, unit.radius, WORLD_WIDTH - unit.radius);
  unit.y = clamp(unit.y + unit.vy * dt, unit.radius, WORLD_HEIGHT - unit.radius);

  if (unit.cooldown > 0) unit.cooldown -= dt;
  const inRange = dist2(unit.x, unit.y, target.x, target.y) < 420 * 420;
  if (inRange) fireIfReady(unit, unit.kind, target, unit.kind === "mob" ? 0.18 : 0.12, unit.kind === "mob" ? 12 : 15);
}

function updatePlayers(dt) {
  for (const player of players.values()) {
    const input = player.input;
    if (!input || Date.now() - input.ts > MAX_INPUT_AGE_MS) {
      player.vx *= 0.95;
      player.vy *= 0.95;
    } else {
      if (input.left) player.angle -= player.turnSpeed * dt;
      if (input.right) player.angle += player.turnSpeed * dt;

      const thrust = input.forward ? 1 : input.back ? -0.55 : 0;
      const ax = Math.cos(player.angle) * player.speed * thrust;
      const ay = Math.sin(player.angle) * player.speed * thrust;
      player.vx = clamp(player.vx + ax * dt * 2.2, -player.speed, player.speed);
      player.vy = clamp(player.vy + ay * dt * 2.2, -player.speed, player.speed);

      if (input.fire) {
        const target = nearestTarget(player, true);
        fireIfReady(player, "player", target, 0.06, 18);
      }
    }

    player.x = clamp(player.x + player.vx * dt, player.radius, WORLD_WIDTH - player.radius);
    player.y = clamp(player.y + player.vy * dt, player.radius, WORLD_HEIGHT - player.radius);
    player.vx *= 0.985;
    player.vy *= 0.985;
    if (player.cooldown > 0) player.cooldown -= dt;
  }
}

function updateBullets(dt) {
  for (const bullet of bullets.values()) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.ttl -= dt;

    if (
      bullet.ttl <= 0 ||
      bullet.x < -30 ||
      bullet.y < -30 ||
      bullet.x > WORLD_WIDTH + 30 ||
      bullet.y > WORLD_HEIGHT + 30
    ) {
      bullets.delete(bullet.id);
      continue;
    }

    const targets = [
      ...players.values(),
      ...npcs.values(),
      ...mobs.values()
    ];

    for (const target of targets) {
      if (!target.alive || target.id === bullet.ownerId) continue;
      const rr = target.radius + bullet.radius;
      if (dist2(bullet.x, bullet.y, target.x, target.y) <= rr * rr) {
        damageTarget(target, bullet.damage, bullet.ownerId);
        bullets.delete(bullet.id);
        break;
      }
    }
  }
}

function gameState() {
  return {
    t: Date.now(),
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    players: Array.from(players.values()).map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      angle: p.angle,
      hp: p.hp,
      maxHp: p.maxHp,
      radius: p.radius,
      score: p.score,
      name: p.name
    })),
    npcs: Array.from(npcs.values()).map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      angle: n.angle,
      hp: n.hp,
      maxHp: n.maxHp,
      radius: n.radius
    })),
    mobs: Array.from(mobs.values()).map((m) => ({
      id: m.id,
      x: m.x,
      y: m.y,
      angle: m.angle,
      hp: m.hp,
      maxHp: m.maxHp,
      radius: m.radius
    })),
    bullets: Array.from(bullets.values()).map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      radius: b.radius
    }))
  };
}

wss.on("connection", (ws) => {
  const player = createShip(uid("player"), "player");
  player.name = `Pirate-${Math.floor(rand(100, 999))}`;
  player.input = { ts: 0, left: false, right: false, forward: false, back: false, fire: false };
  players.set(player.id, player);
  clients.set(ws, player.id);

  ws.send(JSON.stringify({ type: "welcome", id: player.id, name: player.name }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const id = clients.get(ws);
      const p = id ? players.get(id) : null;
      if (!p) return;

      if (msg.type === "input") {
        p.input = {
          ts: Date.now(),
          left: !!msg.left,
          right: !!msg.right,
          forward: !!msg.forward,
          back: !!msg.back,
          fire: !!msg.fire
        };
      }
    } catch (_) {
      // Ignore malformed payload.
    }
  });

  ws.on("close", () => {
    const id = clients.get(ws);
    clients.delete(ws);
    if (id) players.delete(id);
  });
});

setInterval(() => {
  updatePlayers(DT);
  for (const npc of npcs.values()) updateAI(npc, DT, true);
  for (const mob of mobs.values()) updateAI(mob, DT, true);
  updateBullets(DT);
}, 1000 / TICK_RATE);

setInterval(() => {
  broadcast({ type: "state", state: gameState() });
}, 1000 / 20);

server.listen(PORT, () => {
  console.log(`Sea Fight server on http://localhost:${PORT}`);
});
