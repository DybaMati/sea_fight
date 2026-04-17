const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const WORLD_WIDTH = 2600;
const WORLD_HEIGHT = 1800;
const TICK_RATE = 30;
const DT = 1 / TICK_RATE;
const MAX_INPUT_AGE_MS = 200;
const AUTH_COOKIE_NAME = "sea_fight_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const DB_CONFIG = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "dyba",
  password: process.env.DB_PASSWORD || "1234",
  database: process.env.DB_NAME || "sea_fight"
};

let dbPool = null;

const clients = new Map();
const players = new Map();
const bullets = new Map();
const mobs = new Map();
const sessions = new Map();
const playerByUserId = new Map();
const disconnectTimers = new Map();
let bulletId = 1;
let entityId = 1;
const PLAYER_DISCONNECT_GRACE_MS = 5000;

async function ensureSchema() {
  const bootstrap = await mysql.createConnection({
    host: DB_CONFIG.host,
    port: DB_CONFIG.port,
    user: DB_CONFIG.user,
    password: DB_CONFIG.password
  });
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await bootstrap.end();

  dbPool = mysql.createPool({
    ...DB_CONFIG,
    connectionLimit: 10
  });

  const conn = await dbPool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS statki_1 (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        nick VARCHAR(32) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        exp INT UNSIGNED NOT NULL DEFAULT 0,
        level INT UNSIGNED NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP NULL DEFAULT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migracja dla starszych instancji tabeli bez kolumn exp/level.
    try {
      await conn.query("ALTER TABLE statki_1 ADD COLUMN exp INT UNSIGNED NOT NULL DEFAULT 0");
    } catch (_) {
      // Column probably already exists.
    }
    try {
      await conn.query("ALTER TABLE statki_1 ADD COLUMN level INT UNSIGNED NOT NULL DEFAULT 1");
    } catch (_) {
      // Column probably already exists.
    }
  } finally {
    conn.release();
  }
}

async function loadUserProgress(userId) {
  const [rows] = await dbPool.execute("SELECT exp, level FROM statki_1 WHERE id = ? LIMIT 1", [userId]);
  if (!rows.length) return { exp: 0, level: 1 };
  const exp = Number(rows[0].exp || 0);
  return {
    exp,
    level: levelFromExp(exp)
  };
}

async function saveUserProgress(userId, exp, level) {
  if (!userId) return;
  await dbPool.execute("UPDATE statki_1 SET exp = ?, level = ? WHERE id = ?", [exp, level, userId]);
}

function loadMonsterTypes() {
  const monstersDir = path.join(__dirname, "monsters");
  if (!fs.existsSync(monstersDir)) return [];

  const files = fs
    .readdirSync(monstersDir)
    .filter((file) => file.endsWith(".js"));

  const loaded = [];
  for (const file of files) {
    const fullPath = path.join(monstersDir, file);
    const monster = require(fullPath);
    if (!monster || !monster.id || !monster.name) continue;
    loaded.push(monster);
  }
  return loaded;
}

const MOB_TYPES = loadMonsterTypes();

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

function expForLevel(level) {
  // Calkowity EXP wymagany do osiagniecia danego poziomu.
  if (level <= 1) return 0;
  const n = level - 1;
  return 20 * n * (n + 3);
}

function levelFromExp(exp) {
  const safeExp = Math.max(0, Number(exp) || 0);
  let level = 1;
  while (safeExp >= expForLevel(level + 1)) {
    level += 1;
    if (level > 500) break;
  }
  return level;
}

function maxHpForLevel(level) {
  // Bazowe HP 100 + 12 za kazdy kolejny poziom.
  return 100 + Math.max(0, level - 1) * 12;
}

function uid(prefix) {
  const id = `${prefix}_${entityId}`;
  entityId += 1;
  return id;
}

function createShip(id, kind) {
  const baseMaxHp = maxHpForLevel(1);
  return {
    id,
    kind,
    x: rand(120, WORLD_WIDTH - 120),
    y: rand(120, WORLD_HEIGHT - 120),
    vx: 0,
    vy: 0,
    angle: rand(0, Math.PI * 2),
    hp: baseMaxHp,
    maxHp: baseMaxHp,
    radius: 20,
    speed: kind === "player" ? 180 : 120,
    turnSpeed: 2.8,
    cooldown: 0,
    alive: true,
    score: 0,
    exp: 0,
    level: 1,
    healCooldown: 0,
    attackCooldown: 1.0,
    attackRange: 420,
    moveTarget: null
  };
}

function createMob() {
  if (MOB_TYPES.length === 0) {
    throw new Error("Brak definicji potworow w folderze monsters/");
  }
  const type = MOB_TYPES[Math.floor(rand(0, MOB_TYPES.length))];
  return {
    id: uid("mob"),
    kind: "mob",
    x: rand(100, WORLD_WIDTH - 100),
    y: rand(100, WORLD_HEIGHT - 100),
    vx: 0,
    vy: 0,
    angle: rand(0, Math.PI * 2),
    hp: type.hp,
    maxHp: type.hp,
    radius: type.radius,
    speed: type.speed,
    turnSpeed: type.turnSpeed,
    cooldown: rand(0.2, 1.0),
    alive: true,
    score: 0,
    combatReadyAt: Date.now() + rand(7000, 12000),
    name: type.name,
    color: type.color,
    mobTypeId: type.id,
    expReward: type.expReward,
    damage: type.damage,
    attackRange: type.attackRange,
    attackSpread: type.attackSpread,
    attackCooldown: type.attackCooldown,
    aggroTargetId: null
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
    damage,
    maxTravel: Infinity,
    traveled: 0
  };
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

function parseCookies(cookieHeader = "") {
  const pairs = cookieHeader.split(";").map((p) => p.trim()).filter(Boolean);
  const out = {};
  for (const pair of pairs) {
    const i = pair.indexOf("=");
    if (i < 0) continue;
    out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
  }
  return out;
}

function createSession(user) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    user,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return token;
}

function getSessionFromReq(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[AUTH_COOKIE_NAME];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, session };
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${AUTH_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function serveStatic(res, filePath) {
  const normalized = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absPath = path.join(__dirname, "public", normalized);
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
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "POST" && url.pathname === "/api/register") {
      const payload = await readJson(req);
      const nick = String(payload.nick || "").trim();
      const email = String(payload.email || "").trim().toLowerCase();
      const password = String(payload.password || "");
      if (!nick || !email || !password) {
        json(res, 400, { error: "Wymagane: nick, email, haslo." });
        return;
      }
      if (nick.length < 3 || nick.length > 32) {
        json(res, 400, { error: "Nick musi miec 3-32 znaki." });
        return;
      }
      if (password.length < 6) {
        json(res, 400, { error: "Haslo musi miec min. 6 znakow." });
        return;
      }
      const passwordHash = await bcrypt.hash(password, 10);
      try {
        const [result] = await dbPool.execute(
          "INSERT INTO statki_1 (nick, email, password_hash) VALUES (?, ?, ?)",
          [nick, email, passwordHash]
        );
        const user = { id: result.insertId, nick, email };
        const token = createSession(user);
        setSessionCookie(res, token);
        json(res, 201, { ok: true, user });
      } catch (error) {
        if (error && error.code === "ER_DUP_ENTRY") {
          json(res, 409, { error: "Nick lub email juz istnieje." });
          return;
        }
        throw error;
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const payload = await readJson(req);
      const email = String(payload.email || "").trim().toLowerCase();
      const password = String(payload.password || "");
      if (!email || !password) {
        json(res, 400, { error: "Podaj email i haslo." });
        return;
      }
      const [rows] = await dbPool.execute(
        "SELECT id, nick, email, password_hash FROM statki_1 WHERE email = ? LIMIT 1",
        [email]
      );
      if (!rows.length) {
        json(res, 401, { error: "Niepoprawny email lub haslo." });
        return;
      }
      const userRow = rows[0];
      const ok = await bcrypt.compare(password, userRow.password_hash);
      if (!ok) {
        json(res, 401, { error: "Niepoprawny email lub haslo." });
        return;
      }
      await dbPool.execute("UPDATE statki_1 SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", [userRow.id]);
      const user = { id: userRow.id, nick: userRow.nick, email: userRow.email };
      const token = createSession(user);
      setSessionCookie(res, token);
      json(res, 200, { ok: true, user });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const auth = getSessionFromReq(req);
      if (auth) sessions.delete(auth.token);
      clearSessionCookie(res);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      const auth = getSessionFromReq(req);
      if (!auth) {
        json(res, 401, { error: "Brak sesji." });
        return;
      }
      json(res, 200, { user: auth.session.user });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/online-count") {
      json(res, 200, { online: players.size });
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      serveStatic(res, "/home.html");
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth") {
      serveStatic(res, "/auth.html");
      return;
    }

    if (req.method === "GET" && (url.pathname === "/game" || url.pathname === "/index.html")) {
      const auth = getSessionFromReq(req);
      if (!auth) {
        res.statusCode = 302;
        res.setHeader("Location", "/auth");
        res.end();
        return;
      }
      serveStatic(res, "/index.html");
      return;
    }

    serveStatic(res, url.pathname);
  } catch (error) {
    console.error("HTTP error", error);
    json(res, 500, { error: "Blad serwera." });
  }
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

function hasLiveConnection(playerId) {
  for (const id of clients.values()) {
    if (id === playerId) return true;
  }
  return false;
}

function schedulePlayerRemoval(playerId) {
  if (disconnectTimers.has(playerId)) {
    clearTimeout(disconnectTimers.get(playerId));
  }
  const timer = setTimeout(() => {
    disconnectTimers.delete(playerId);
    if (hasLiveConnection(playerId)) return;
    const player = players.get(playerId);
    if (!player) return;
    saveUserProgress(player.userId, player.exp, player.level).catch((error) => {
      console.error("Nie udalo sie zapisac postepu gracza.", error);
    });
    players.delete(playerId);
    if (player.userId) playerByUserId.delete(player.userId);
  }, PLAYER_DISCONNECT_GRACE_MS);
  disconnectTimers.set(playerId, timer);
}

function nearestTarget(from, includePlayers = true) {
  let best = null;
  let bestD2 = Infinity;

  const pools = [mobs.values()];
  if (includePlayers) pools.unshift(players.values());

  for (const pool of pools) {
    for (const ent of pool) {
      if (!ent.alive || ent.id === from.id) continue;
      if (from.kind === "mob" && ent.kind === "mob") continue;
      const d2 = dist2(from.x, from.y, ent.x, ent.y);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = ent;
      }
    }
  }
  return best;
}

function nearestPlayerTo(from) {
  let best = null;
  let bestD2 = Infinity;
  for (const p of players.values()) {
    if (!p.alive || p.id === from.id) continue;
    const d2 = dist2(from.x, from.y, p.x, p.y);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = p;
    }
  }
  return best;
}

function fireIfReady(shooter, ownerKind, target, spread = 0.12, damage = 16) {
  if (!target || shooter.cooldown > 0) return;
  const targetDistance = Math.sqrt(dist2(shooter.x, shooter.y, target.x, target.y));
  const angle = Math.atan2(target.y - shooter.y, target.x - shooter.x) + rand(-spread, spread);
  const muzzleX = shooter.x + Math.cos(angle) * (shooter.radius + 7);
  const muzzleY = shooter.y + Math.sin(angle) * (shooter.radius + 7);
  const bullet = createBullet(shooter.id, ownerKind, muzzleX, muzzleY, angle, damage);
  bullet.maxTravel = Math.max(30, targetDistance + target.radius + 10);
  bullets.set(bullet.id, bullet);
  shooter.cooldown = shooter.attackCooldown || 0.55;
}

function damageTarget(target, amount, attackerId) {
  if (target.kind === "mob" && players.has(attackerId)) {
    // Mob zaczyna reagowac od pierwszego trafienia.
    target.aggroTargetId = attackerId;
  }

  target.hp -= amount;
  if (target.hp > 0) return;
  target.alive = false;

  if (players.has(attackerId)) {
    const player = players.get(attackerId);
    const prevLevel = player.level;
    player.score += 1;
    if (target.kind === "player") player.exp += 40;
    if (target.kind === "mob") player.exp += target.expReward || 12;
    player.level = levelFromExp(player.exp);
    if (player.level !== prevLevel) {
      const oldMaxHp = player.maxHp;
      player.maxHp = maxHpForLevel(player.level);
      // Zachowaj ten sam procent zycia po wejsciu na nowy poziom.
      const hpRatio = oldMaxHp > 0 ? player.hp / oldMaxHp : 1;
      player.hp = Math.max(1, Math.round(player.maxHp * hpRatio));
    }
  }

  if (target.kind === "player") {
    target.maxHp = maxHpForLevel(target.level || 1);
    target.hp = target.maxHp;
    target.x = rand(120, WORLD_WIDTH - 120);
    target.y = rand(120, WORLD_HEIGHT - 120);
    target.alive = true;
    return;
  }

  if (target.kind === "mob") {
    mobs.delete(target.id);
    const mob = createMob();
    mobs.set(mob.id, mob);
  }
}

function updateAI(unit, dt, targetPreferencePlayers = true) {
  const now = Date.now();
  let target = null;
  if (unit.kind === "mob") {
    target = unit.aggroTargetId ? players.get(unit.aggroTargetId) || null : null;
    if (!target || !target.alive) {
      unit.aggroTargetId = null;
      target = null;
    }
  } else {
    target = nearestTarget(unit, targetPreferencePlayers);
  }
  if (!target) {
    if (unit.kind === "mob") {
      // Spokojny dryf kiedy mob nie jest w walce.
      unit.angle += rand(-0.6, 0.6) * dt;
      const driftSpeed = unit.speed * 0.45;
      unit.vx = Math.cos(unit.angle) * driftSpeed;
      unit.vy = Math.sin(unit.angle) * driftSpeed;
      unit.x = clamp(unit.x + unit.vx * dt, unit.radius, WORLD_WIDTH - unit.radius);
      unit.y = clamp(unit.y + unit.vy * dt, unit.radius, WORLD_HEIGHT - unit.radius);
      if (unit.cooldown > 0) unit.cooldown -= dt;
    }
    return;
  }

  const desired = Math.atan2(target.y - unit.y, target.x - unit.x);
  let diff = desired - unit.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  unit.angle += clamp(diff, -unit.turnSpeed * dt, unit.turnSpeed * dt);

  if (unit.kind === "mob") {
    // Moby sa pasywne i po wejsciu w walke stoja w miejscu.
    unit.vx = 0;
    unit.vy = 0;
  } else {
    unit.vx = Math.cos(unit.angle) * unit.speed;
    unit.vy = Math.sin(unit.angle) * unit.speed;
  }
  unit.x = clamp(unit.x + unit.vx * dt, unit.radius, WORLD_WIDTH - unit.radius);
  unit.y = clamp(unit.y + unit.vy * dt, unit.radius, WORLD_HEIGHT - unit.radius);

  if (unit.cooldown > 0) unit.cooldown -= dt;
  if (unit.kind === "mob" && now < (unit.combatReadyAt || 0)) return;
  const range = unit.attackRange || 420;
  const spread = unit.kind === "mob" ? (unit.attackSpread || 0.18) : 0.12;
  const inRange = dist2(unit.x, unit.y, target.x, target.y) < range * range;
  if (inRange) fireIfReady(unit, unit.kind, target, spread, unit.kind === "mob" ? unit.damage : 15);
}

function updatePlayers(dt) {
  for (const player of players.values()) {
    const input = player.input;
    const hasFreshInput = !!input && Date.now() - input.ts <= MAX_INPUT_AGE_MS;
    if (!hasFreshInput) {
      player.vx *= 0.8;
      player.vy *= 0.8;
    } else if (input.manualControl) {
      player.moveTarget = null;
      if (input.left) player.angle -= player.turnSpeed * dt;
      if (input.right) player.angle += player.turnSpeed * dt;

      const thrust = input.forward ? 1 : input.back ? -0.55 : 0;
      const targetSpeed = player.speed * thrust;
      player.vx = Math.cos(player.angle) * targetSpeed;
      player.vy = Math.sin(player.angle) * targetSpeed;
    }
    if ((!hasFreshInput || !input.manualControl) && player.moveTarget) {
      const dx = player.moveTarget.x - player.x;
      const dy = player.moveTarget.y - player.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 12 * 12) {
        player.moveTarget = null;
        player.vx *= 0.8;
        player.vy *= 0.8;
      } else {
        const distance = Math.sqrt(d2);
        const desired = Math.atan2(dy, dx);
        let diff = desired - player.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        player.angle += clamp(diff, -player.turnSpeed * dt, player.turnSpeed * dt);
        const absDiff = Math.abs(diff);
        const alignFactor = absDiff > 1.0 ? 0 : absDiff > 0.55 ? 0.35 : 1;
        const speedFactor = clamp(distance / 140, 0.2, 1);
        const travelSpeed = player.speed * speedFactor * alignFactor;
        player.vx = Math.cos(player.angle) * travelSpeed;
        player.vy = Math.sin(player.angle) * travelSpeed;
      }
    }

    player.x = clamp(player.x + player.vx * dt, player.radius, WORLD_WIDTH - player.radius);
    player.y = clamp(player.y + player.vy * dt, player.radius, WORLD_HEIGHT - player.radius);
    player.vx *= 0.9;
    player.vy *= 0.9;
    if (player.cooldown > 0) player.cooldown -= dt;
    if (player.healCooldown > 0) player.healCooldown -= dt;
  }
}

function findEntityById(id) {
  return players.get(id) || mobs.get(id) || null;
}

function handlePlayerAction(player, msg) {
  if (msg.action === "attack") {
    if (!msg.targetId) return;
    const target = findEntityById(msg.targetId);
    if (!target || !target.alive || target.id === player.id) return;
    const inRange = dist2(player.x, player.y, target.x, target.y) <= player.attackRange * player.attackRange;
    if (!inRange || player.cooldown > 0) return;
    fireIfReady(player, "player", target, 0.03, 20);
    return;
  }

  if (msg.action === "moveTo") {
    const x = Number(msg.x);
    const y = Number(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    player.moveTarget = {
      x: clamp(x, player.radius, WORLD_WIDTH - player.radius),
      y: clamp(y, player.radius, WORLD_HEIGHT - player.radius)
    };
    return;
  }

  if (msg.action === "heal") {
    if (player.healCooldown > 0 || player.hp >= player.maxHp) return;
    player.hp = Math.min(player.maxHp, player.hp + 35);
    player.healCooldown = 3;
  }
}

function updateBullets(dt) {
  for (const bullet of bullets.values()) {
    const stepX = bullet.vx * dt;
    const stepY = bullet.vy * dt;
    bullet.x += stepX;
    bullet.y += stepY;
    bullet.traveled += Math.sqrt(stepX * stepX + stepY * stepY);
    bullet.ttl -= dt;

    if (
      bullet.ttl <= 0 ||
      bullet.traveled >= bullet.maxTravel ||
      bullet.x < -30 ||
      bullet.y < -30 ||
      bullet.x > WORLD_WIDTH + 30 ||
      bullet.y > WORLD_HEIGHT + 30
    ) {
      bullets.delete(bullet.id);
      continue;
    }

    const targets = [...players.values(), ...mobs.values()];

    for (const target of targets) {
      if (!target.alive || target.id === bullet.ownerId) continue;
      if (bullet.ownerKind === "mob" && target.kind === "mob") continue;
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
      name: p.name,
      exp: p.exp,
      level: p.level,
      healCooldown: p.healCooldown,
      levelStartExp: expForLevel(p.level),
      nextLevelExp: expForLevel(p.level + 1)
    })),
    mobs: Array.from(mobs.values()).map((m) => ({
      id: m.id,
      x: m.x,
      y: m.y,
      angle: m.angle,
      hp: m.hp,
      maxHp: m.maxHp,
      radius: m.radius,
      name: m.name,
      color: m.color,
      expReward: m.expReward
    })),
    bullets: Array.from(bullets.values()).map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      radius: b.radius
    }))
  };
}

wss.on("connection", async (ws, req) => {
  const auth = getSessionFromReq(req);
  if (!auth) {
    ws.close(1008, "Unauthorized");
    return;
  }
  const user = auth.session.user;
  let player = null;
  const existingPlayerId = playerByUserId.get(user.id);
  if (existingPlayerId && players.has(existingPlayerId)) {
    player = players.get(existingPlayerId);
    if (disconnectTimers.has(existingPlayerId)) {
      clearTimeout(disconnectTimers.get(existingPlayerId));
      disconnectTimers.delete(existingPlayerId);
    }
  } else {
    player = createShip(uid("player"), "player");
    player.input = { ts: 0, left: false, right: false, forward: false, back: false, fire: false, manualControl: false };
    players.set(player.id, player);
    playerByUserId.set(user.id, player.id);
  }
  player.name = user.nick;
  player.userId = user.id;
  try {
    const progress = await loadUserProgress(user.id);
    player.exp = progress.exp;
    player.level = progress.level;
    player.maxHp = maxHpForLevel(player.level);
    player.hp = Math.min(player.hp, player.maxHp);
  } catch (error) {
    console.error("Nie udalo sie wczytac postepu gracza.", error);
  }
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
          fire: false,
          manualControl: !!msg.left || !!msg.right || !!msg.forward || !!msg.back
        };
        return;
      }

      if (msg.type === "action") {
        handlePlayerAction(p, msg);
      }
    } catch (_) {
      // Ignore malformed payload.
    }
  });

  ws.on("close", () => {
    const id = clients.get(ws);
    clients.delete(ws);
    if (id) schedulePlayerRemoval(id);
  });
});

setInterval(() => {
  updatePlayers(DT);
  for (const mob of mobs.values()) updateAI(mob, DT, true);
  updateBullets(DT);
}, 1000 / TICK_RATE);

setInterval(() => {
  broadcast({ type: "state", state: gameState() });
}, 1000 / 20);

setInterval(() => {
  for (const player of players.values()) {
    saveUserProgress(player.userId, player.exp, player.level).catch((error) => {
      console.error("Nie udalo sie okresowo zapisac postepu gracza.", error);
    });
  }
}, 15000);

async function start() {
  try {
    await ensureSchema();
    server.listen(PORT, () => {
      console.log(`Sea Fight server on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Nie mozna uruchomic serwera/bazy.", error);
    process.exit(1);
  }
}

start();
