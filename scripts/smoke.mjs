// End-to-end smoke test for the Browser Empires game server.
// Plain Node ESM. Spawns the real server, drives two WebSocket clients
// through lobby -> game start -> economy -> movement -> game over.
//
// Run with: node scripts/smoke.mjs   (cwd D:\age)

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import WebSocket from 'ws';

// ---- constants (kept in sync manually with shared/src/constants.ts values we need) ----
// We don't import TS directly here (plain node), so we re-declare the handful
// of numeric constants we need for assertions, and cross-check MAP_SIZE etc.
// via the actual server-sent data wherever possible instead of hardcoding.

const ROOT = 'D:\\age';
const GAME_PORT = 8080; // from shared/src/constants.ts

// Lê MAP_SIZE direto do arquivo de constantes para o teste nunca ficar defasado.
function readMapSize() {
  const src = readFileSync(`${ROOT}\\shared\\src\\constants.ts`, 'utf8');
  const m = /MAP_SIZE\s*=\s*(\d+)/.exec(src);
  return m ? parseInt(m[1], 10) : 48;
}
const MAP_SIZE = readMapSize();

const results = [];
let stepCounter = 0;

function record(pass, msg) {
  stepCounter++;
  const line = `${stepCounter}. ${pass ? 'PASS' : 'FAIL'} - ${msg}`;
  console.log(line);
  results.push(pass);
  return pass;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms waiting for: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function waitForPort(port, host, maxMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const sock = net.createConnection({ port, host }, () => {
        sock.end();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() - start > maxMs) {
          reject(new Error(`Server did not open port ${port} within ${maxMs}ms`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    }
    attempt();
  });
}

// ---------------- Minimal client wrapper ----------------

class Client {
  constructor(name, url) {
    this.name = name;
    this.ws = new WebSocket(url);
    this.queue = [];
    this.waiters = [];
    this.snapshots = [];
    this.messages = [];
    this.ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.messages.push(msg);
      if (msg.type === 'snapshot') this.snapshots.push(msg);
      this.queue.push(msg);
      this._drain();
    });
  }

  _drain() {
    while (this.queue.length > 0 && this.waiters.length > 0) {
      const w = this.waiters.shift();
      let takenIdx = -1;
      for (let i = 0; i < this.queue.length; i++) {
        if (w.pred(this.queue[i])) {
          takenIdx = i;
          break;
        }
      }
      if (takenIdx === -1) {
        this.waiters.unshift(w);
        return;
      }
      const [msg] = this.queue.splice(takenIdx, 1);
      w.resolve(msg);
    }
  }

  waitForOpen() {
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }

  /** Wait for a message matching predicate, among already-queued or future messages. */
  waitFor(pred, ms, label) {
    const p = new Promise((resolve) => {
      this.waiters.push({ pred, resolve });
      this._drain();
    });
    return withTimeout(p, ms, `${this.name}: ${label}`);
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  latestSnapshot() {
    return this.snapshots[this.snapshots.length - 1];
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll a condition function (returning truthy value to resolve with) until timeout. */
async function pollUntil(fn, ms, intervalMs = 100) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) return undefined;
    await sleep(intervalMs);
  }
}

// ---------------- Main ----------------

let serverProc = null;

async function killServerTree() {
  if (!serverProc || serverProc.killed || serverProc.exitCode !== null) return;
  const pid = serverProc.pid;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: true });
      k.on('exit', () => resolve());
      k.on('error', () => resolve());
    });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        serverProc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
}

async function main() {
  console.log('--- Browser Empires smoke test ---');

  serverProc = spawn('npx', ['tsx', 'server/src/index.ts'], {
    cwd: ROOT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverOutput = '';
  serverProc.stdout.on('data', (d) => {
    serverOutput += d.toString();
  });
  serverProc.stderr.on('data', (d) => {
    serverOutput += d.toString();
  });

  serverProc.on('exit', (code, sig) => {
    if (!finished) {
      console.error(`Server process exited early (code=${code}, sig=${sig}). Output so far:\n${serverOutput}`);
    }
  });

  let finished = false;

  try {
    await withTimeout(waitForPort(GAME_PORT, '127.0.0.1', 15000), 15500, 'server port open');
    record(true, `Server booted and port ${GAME_PORT} is accepting connections`);

    const url = `ws://127.0.0.1:${GAME_PORT}`;
    const a = new Client('A', url);
    const b = new Client('B', url);

    await withTimeout(Promise.all([a.waitForOpen(), b.waitForOpen()]), 5000, 'websocket open');

    // ---- both receive welcome ----
    const welcomeA = await a.waitFor((m) => m.type === 'welcome', 5000, 'welcome');
    const welcomeB = await b.waitFor((m) => m.type === 'welcome', 5000, 'welcome');
    record(
      typeof welcomeA.playerId === 'number' && typeof welcomeB.playerId === 'number' && welcomeA.playerId !== welcomeB.playerId,
      `Both clients received distinct 'welcome' playerIds (A=${welcomeA.playerId}, B=${welcomeB.playerId})`,
    );
    const idA = welcomeA.playerId;
    const idB = welcomeB.playerId;

    // ---- setName ----
    a.send({ type: 'setName', name: 'Alice' });
    b.send({ type: 'setName', name: 'Bob' });
    // no direct ack required outside a room; just proceed but guard with a short settle.
    await sleep(100);
    record(true, 'Both clients sent setName without error');

    // ---- A createRoom ----
    a.send({ type: 'createRoom' });
    const roomStateA = await a.waitFor((m) => m.type === 'roomState', 5000, 'roomState after createRoom');
    const roomId = roomStateA.roomId;
    record(typeof roomId === 'string' && roomId.length > 0, `A created room, roomId=${roomId}`);

    // ---- room nasce com 1 bot automático; remove p/ manter o cenário 2 humanos ----
    const hasAutoBot = Array.isArray(roomStateA.players) && roomStateA.players.some((p) => p.isBot);
    record(hasAutoBot, 'New room starts with an auto-added bot');
    a.send({ type: 'removeBot' });
    await a.waitFor(
      (m) => m.type === 'roomState' && m.players.length === 1,
      5000,
      'roomState with 1 player after removing auto-bot',
    );
    record(true, 'Auto-bot removed; room back to host only');

    // ---- B discovers room id: try pushed roomList first, else listRooms ----
    let roomIdFromB = await Promise.race([
      b.waitFor((m) => m.type === 'roomList' && m.rooms.some((r) => r.id === roomId), 3000, 'roomList push').then(
        (m) => m.rooms.find((r) => r.id === roomId).id,
      ),
      (async () => {
        await sleep(200);
        b.send({ type: 'listRooms' });
        const m = await b.waitFor((mm) => mm.type === 'roomList', 5000, 'roomList after listRooms');
        const found = m.rooms.find((r) => r.id === roomId);
        return found ? found.id : undefined;
      })(),
    ]).catch(() => undefined);
    record(roomIdFromB === roomId, `B discovered room id ${roomId} via roomList`);

    // ---- B joinRoom ----
    b.send({ type: 'joinRoom', roomId });
    const roomStateAfterJoin = await b.waitFor(
      (m) => m.type === 'roomState' && m.players.length === 2,
      5000,
      'roomState with 2 players after B joins',
    );
    record(roomStateAfterJoin.players.length === 2, 'B joined room; roomState shows 2 players');

    // ---- both setReady true ----
    a.send({ type: 'setReady', ready: true });
    b.send({ type: 'setReady', ready: true });
    const readyState = await pollUntil(() => {
      // find latest roomState-like signal via messages array on either client
      const rs = [...a.messages].reverse().find((m) => m.type === 'roomState');
      return rs && rs.players.length === 2 && rs.players.every((p) => p.id === rs.players.find((pp) => pp.isHost).id ? true : p.ready) ? rs : undefined;
    }, 5000);
    record(!!readyState, 'Both players marked ready (roomState reflects readiness)');

    // ---- A startGame ----
    a.send({ type: 'startGame' });
    const [gameStartA, gameStartB] = await withTimeout(
      Promise.all([
        a.waitFor((m) => m.type === 'gameStart', 5000, 'gameStart'),
        b.waitFor((m) => m.type === 'gameStart', 5000, 'gameStart'),
      ]),
      5500,
      'both gameStart',
    );
    const mapOk = gameStartA.map && gameStartA.map.size === MAP_SIZE && Array.isArray(gameStartA.map.tiles) && gameStartA.map.tiles.length === MAP_SIZE * MAP_SIZE;
    const playersOk = Array.isArray(gameStartA.players) && gameStartA.players.length === 2;
    record(
      mapOk && playersOk && gameStartB.map.size === gameStartA.map.size,
      `Both clients received gameStart with MAP_SIZE=${gameStartA.map && gameStartA.map.size} and ${gameStartA.players && gameStartA.players.length} players`,
    );

    // ---- snapshots: town centers, villagers, resources, popCap ----
    const snap = await pollUntil(() => {
      const s = a.latestSnapshot();
      if (!s) return undefined;
      const tcA = s.buildings.filter((bld) => bld.owner === idA && bld.type === 'town_center');
      const tcB = s.buildings.filter((bld) => bld.owner === idB && bld.type === 'town_center');
      const villA = s.units.filter((u) => u.owner === idA && u.type === 'villager');
      const villB = s.units.filter((u) => u.owner === idB && u.type === 'villager');
      if (tcA.length && tcB.length && villA.length && villB.length) return s;
      return undefined;
    }, 3000);

    if (!snap) {
      record(false, 'Received snapshot with town centers and villagers for both players within 3s');
    } else {
      const tcA = snap.buildings.filter((bld) => bld.owner === idA && bld.type === 'town_center');
      const tcB = snap.buildings.filter((bld) => bld.owner === idB && bld.type === 'town_center');
      const villA = snap.units.filter((u) => u.owner === idA && u.type === 'villager');
      const villB = snap.units.filter((u) => u.owner === idB && u.type === 'villager');
      const START_VILLAGERS = 3;
      record(
        tcA.length === 1 && tcB.length === 1 && tcA[0].progress === 1 && tcB[0].progress === 1,
        `Each player owns exactly 1 town_center with progress 1 (A:${tcA.length}@${tcA[0] && tcA[0].progress}, B:${tcB.length}@${tcB[0] && tcB[0].progress})`,
      );
      record(
        villA.length === START_VILLAGERS && villB.length === START_VILLAGERS,
        `Each player has START_VILLAGERS=${START_VILLAGERS} villagers (A:${villA.length}, B:${villB.length})`,
      );

      const pA = snap.players.find((p) => p.id === idA);
      const pB = snap.players.find((p) => p.id === idB);
      const STARTING_RESOURCES = { food: 250, wood: 250, gold: 100, stone: 100 };
      const resOk = (r) => r && Object.keys(STARTING_RESOURCES).every((k) => r[k] === STARTING_RESOURCES[k]);
      record(
        resOk(pA && pA.resources) && resOk(pB && pB.resources),
        `Both players' resources equal STARTING_RESOURCES (A=${JSON.stringify(pA && pA.resources)}, B=${JSON.stringify(pB && pB.resources)})`,
      );
      record(
        pA && pA.popCap > 0 && pB && pB.popCap > 0,
        `Both players' popCap > 0 (A=${pA && pA.popCap}, B=${pB && pB.popCap})`,
      );

      // ---- train a villager from A's town_center ----
      const tcId = tcA[0].id;
      const foodBefore = pA.resources.food;
      const VILLAGER_FOOD_COST = 50;
      const VILLAGER_TRAIN_TIME = 8;

      a.send({ type: 'cmd', cmd: { kind: 'train', buildingId: tcId, unit: 'villager' } });

      const droppedSnap = await pollUntil(() => {
        const s = a.latestSnapshot();
        const p = s && s.players.find((pp) => pp.id === idA);
        if (p && p.resources.food === foodBefore - VILLAGER_FOOD_COST) return s;
        return undefined;
      }, 2000);
      record(
        !!droppedSnap,
        `A's food dropped by villager cost (${VILLAGER_FOOD_COST}) within 2s after training`,
      );

      const grownSnap = await pollUntil(() => {
        const s = a.latestSnapshot();
        if (!s) return undefined;
        const count = s.units.filter((u) => u.owner === idA && u.type === 'villager').length;
        return count > villA.length ? s : undefined;
      }, (VILLAGER_TRAIN_TIME + 4) * 1000);
      record(
        !!grownSnap,
        `A gained a new villager within trainTime+4s (${VILLAGER_TRAIN_TIME + 4}s)`,
      );

      // ---- move A's villagers ~5 tiles from spawn ----
      const latestForMove = a.latestSnapshot();
      const aVillagers = latestForMove.units.filter((u) => u.owner === idA && u.type === 'villager');
      const beforePositions = new Map(aVillagers.map((u) => [u.id, { x: u.x, y: u.y }]));
      const avgX = aVillagers.reduce((s, u) => s + u.x, 0) / aVillagers.length;
      const avgY = aVillagers.reduce((s, u) => s + u.y, 0) / aVillagers.length;
      const mapSize = gameStartA.map.size;
      // pick a direction toward map center to stay in-bounds and likely walkable
      const cx = mapSize / 2;
      const cy = mapSize / 2;
      const dx = cx - avgX;
      const dy = cy - avgY;
      const dlen = Math.hypot(dx, dy) || 1;
      const targetX = avgX + (dx / dlen) * 5;
      const targetY = avgY + (dy / dlen) * 5;

      a.send({
        type: 'cmd',
        cmd: { kind: 'move', unitIds: aVillagers.map((u) => u.id), x: targetX, y: targetY },
      });

      const movedSnap = await pollUntil(() => {
        const s = a.latestSnapshot();
        if (!s) return undefined;
        const units = s.units.filter((u) => u.owner === idA && u.type === 'villager' && beforePositions.has(u.id));
        const anyMoved = units.some((u) => {
          const before = beforePositions.get(u.id);
          return Math.hypot(u.x - before.x, u.y - before.y) > 0.15;
        });
        return anyMoved ? s : undefined;
      }, 2000);
      record(!!movedSnap, "A's villagers' positions changed across snapshots within 2s of move command");

      // ---- B closes socket -> A should get gameOver with A as winner ----
      b.close();
      const gameOverMsg = await a.waitFor((m) => m.type === 'gameOver', 5000, 'gameOver after B disconnects');
      record(
        gameOverMsg.winner === idA,
        `A received gameOver with A (id=${idA}) as winner (got winner=${gameOverMsg.winner})`,
      );
    }

    a.close();
    if (b.ws.readyState === WebSocket.OPEN) b.close();
  } finally {
    finished = true;
    await killServerTree();
  }

  const allPass = results.length > 0 && results.every(Boolean);
  console.log('---');
  console.log(allPass ? 'ALL ASSERTIONS PASSED' : 'SOME ASSERTIONS FAILED');
  process.exit(allPass ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Smoke test crashed:', err && err.stack ? err.stack : err);
  await killServerTree();
  process.exit(1);
});
