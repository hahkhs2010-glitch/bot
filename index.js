const mineflayer = require('mineflayer');
const mc = require('minecraft-protocol');
const express = require('express');

const app = express();
const HTTP_PORT = Number(process.env.PORT) || 3000;

app.get('/', (_req, res) => {
  res.status(200).send('Minecraft AFK Guard Bot is running.');
});

app.get('/health', (_req, res) => {
  const botOnline = Boolean(
    activeBot?.entity &&
    activeBot?._client &&
    activeBot._client.state === 'play'
  );

  res.status(200).json({
    ok: true,
    botOnline,
    uptime: Math.floor(process.uptime())
  });
});

const httpServer = app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`🌐 خادم البنج يعمل على المنفذ ${HTTP_PORT}`);
});

httpServer.on('error', (err) => {
  console.error('❌ تعذر تشغيل خادم Express:', err.message);
  process.exitCode = 1;
});

const MOVE_INTERVAL = 40 * 1000;
const MOVE_MIN = 5 * 1000;
const MOVE_MAX = 10 * 1000;
const FIRST_MOVE_DELAY = 10 * 1000;
const STEP_MS = 50;

const LEASH = 25;
const VERT_LEASH = 6;

const RECONNECT_BASE = 10 * 1000;
const RECONNECT_MAX = 5 * 60 * 1000;

const USERNAME = process.env.BOT_USERNAME || 'AfnanGuardBot';
const HOST = process.env.BOT_HOST || 'MinecraftRetards.aternos.me';
const DEFAULT_PORT = Number(process.env.BOT_PORT) || 23164;
const VERSION = process.env.BOT_VERSION || '26.2';

const SPAWN_TIMEOUT = 60 * 1000;
const DUPLICATE_WAIT = 90 * 1000;

let currentPort = DEFAULT_PORT;

let generation = 0;
let activeReconnect = null;
let activeBot = null;

const STALL_LIMIT = 15 * 60 * 1000;
let lastActivity = Date.now();
const beat = () => { lastActivity = Date.now(); };

function ping(host, port, timeout = 10000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => finish(null), timeout);
    try {
      mc.ping({ host, port }, (err, res) => finish(err ? null : res));
    } catch (e) {
      finish(null);
    }
  });
}

async function resolvePort() {
  const proxy = /aternos\.org\/connect/i;
  const here = await ping(HOST, currentPort);
  if (here && !proxy.test(JSON.stringify(here.description || ''))) return currentPort;

  const res = await ping(HOST, 25565);
  const m = res && JSON.stringify(res.description || '').match(/:(\d{2,5})\b/);
  if (m) {
    const found = Number(m[1]);
    if (found !== currentPort) {
      console.log(`🔀 بورت السيرفر اتغيّر: ${currentPort} ← ${found}`);
      currentPort = found;
    }
  }
  return currentPort;
}

const rand = (min, max) => min + Math.random() * (max - min);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function yawToVector(yaw) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

function chooseHeading(pos, origin, leash, jitter = rand) {
  const dx = pos.x - origin.x;
  const dz = pos.z - origin.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist > leash) {
    const back = Math.atan2(-(origin.x - pos.x), -(origin.z - pos.z));
    return back + jitter(-Math.PI / 4, Math.PI / 4);
  }
  return jitter(-Math.PI, Math.PI);
}

async function createBot(attempt = 0) {
  const myGen = ++generation;
  console.log('🔄 محاولة دخول البوت للسيرفر...');

  const port = await resolvePort();
  if (myGen !== generation) return;

  const bot = mineflayer.createBot({
    host: HOST,
    port,
    username: USERNAME,
    auth: 'offline',
    version: VERSION,
    viewDistance: 'tiny'
  });

  activeBot = bot;
  beat();

  let alive = true;
  let reconnecting = false;
  let spawned = false;
  let loopTimer = null;
  let watchdog = null;
  let duplicate = false;
  let origin = null;

  const online = () =>
    alive && spawned && bot.entity && bot._client && bot._client.state === 'play';

  const isFlying = () =>
    bot.game.gameMode === 'spectator' || bot.game.gameMode === 'creative';

  function shutdown() {
    alive = false;
    if (loopTimer) {
      clearTimeout(loopTimer);
      loopTimer = null;
    }
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  }

  function retry(n) {
    createBot(n).catch((e) => {
      console.error('❌ فشل بدء البوت:', e && e.message);
      setTimeout(() => retry(n), RECONNECT_BASE);
    });
  }

  function reconnect(waitMs = null) {
    if (reconnecting || myGen !== generation) return;
    reconnecting = true;
    beat();
    shutdown();
    try { bot.end('reconnect'); } catch (e) {}

    const delay = waitMs !== null
      ? waitMs
      : Math.min(RECONNECT_BASE * Math.pow(2, attempt), RECONNECT_MAX);
    console.log(`🔄 إعادة المحاولة بعد ${Math.round(delay / 1000)} ثانية...`);
    setTimeout(() => retry(attempt + 1), delay);
  }

  activeReconnect = reconnect;

  const chooseYaw = () => chooseHeading(bot.entity.position, origin, LEASH);

  async function glide(durationMs) {
    const yaw = chooseYaw();
    const pitch = rand(-0.25, 0.25);
    const dir = yawToVector(yaw);
    const speed = rand(0.10, 0.20);
    let climb = rand(-0.03, 0.03);
    const steps = Math.round(durationMs / STEP_MS);

    await bot.look(yaw, pitch, false).catch(() => {});

    for (let i = 0; i < steps; i++) {
      if (!online()) return;

      const p = bot.entity.position;
      p.x += dir.x * speed;
      p.z += dir.z * speed;

      const nextY = p.y + climb;
      if (Math.abs(nextY - origin.y) <= VERT_LEASH) {
        p.y = nextY;
      } else {
        climb = -climb;
      }

      bot.entity.velocity.set(0, 0, 0);
      bot.entity.onGround = false;

      if (i % 20 === 19) {
        bot.look(
          yaw + rand(-0.25, 0.25),
          pitch + rand(-0.12, 0.12),
          false
        ).catch(() => {});
      }

      await sleep(STEP_MS);
    }
  }

  async function walk(durationMs) {
    const dirs = ['forward', 'back', 'left', 'right'];
    const dir = dirs[Math.floor(Math.random() * dirs.length)];
    const half = durationMs / 2;

    await bot.look(rand(-Math.PI, Math.PI), rand(-0.2, 0.2), false).catch(() => {});

    const opposite = { forward: 'back', back: 'forward', left: 'right', right: 'left' }[dir];

    bot.setControlState(dir, true);
    await sleep(half);
    bot.setControlState(dir, false);
    if (!online()) return;

    await sleep(300);
    if (!online()) return;

    bot.setControlState(opposite, true);
    await sleep(half);
    bot.setControlState(opposite, false);
  }

  async function moveOnce() {
    if (!online()) return;

    const duration = rand(MOVE_MIN, MOVE_MAX);
    const before = bot.entity.position.clone();

    try {
      if (isFlying()) await glide(duration);
      else await walk(duration);
    } catch (e) {
      console.error('⚠️ فشلت الحركة:', e.message);
      return;
    }

    if (!online()) return;
    beat();
    const p = bot.entity.position;
    const moved = Math.sqrt(
      Math.pow(p.x - before.x, 2) + Math.pow(p.z - before.z, 2)
    );
    const fromHome = Math.sqrt(
      Math.pow(p.x - origin.x, 2) + Math.pow(p.z - origin.z, 2)
    );
    console.log(
      `🤖 تحرك ${moved.toFixed(1)} بلوك خلال ${(duration / 1000).toFixed(1)} ثانية` +
      ` | الموقع: ${p.x.toFixed(0)}, ${p.y.toFixed(1)}, ${p.z.toFixed(0)}` +
      ` | بُعده عن البداية: ${fromHome.toFixed(1)}`
    );
  }

  function scheduleNext(delay = MOVE_INTERVAL) {
    if (!alive) return;
    loopTimer = setTimeout(async () => {
      const started = Date.now();
      await moveOnce();
      const elapsed = Date.now() - started;
      scheduleNext(Math.max(1000, MOVE_INTERVAL - elapsed));
    }, delay);
  }

  bot.on('login', () => console.log('🔐 تم الاتصال بالسيرفر...'));

  bot.once('spawn', () => {
    spawned = true;
    attempt = 0;
    beat();
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    origin = bot.entity.position.clone();

    console.log('✅ البوت دخل السيرفر بنجاح! 🤖');
    console.log(`🎮 وضع اللعب: ${bot.game.gameMode}`);

    if (isFlying()) {
      bot.physicsEnabled = false;
      console.log('🕊️ وضع طيران — تحكّم يدوي في الحركة');
    }

    console.log(
      `📍 نقطة البداية: ${origin.x.toFixed(0)}, ${origin.y.toFixed(0)}, ${origin.z.toFixed(0)}` +
      ` (مش هيبعد أكتر من ${LEASH} بلوك)`
    );

    scheduleNext(FIRST_MOVE_DELAY);
  });

  bot.on('game', () => {
    if (!online()) return;
    if (isFlying() && bot.physicsEnabled) {
      bot.physicsEnabled = false;
      console.log('🕊️ اتحول لوضع طيران — تحكّم يدوي');
    } else if (!isFlying() && !bot.physicsEnabled) {
      bot.physicsEnabled = true;
      console.log('🚶 اتحول لوضع أرضي — فيزياء عادية');
    }
  });

  bot.on('kicked', (reason) => {
    const text = JSON.stringify(reason);
    if (text.includes('duplicate_login')) {
      duplicate = true;
      console.log('🚫 في نسخة تانية من البوت شغّالة بنفس الاسم!');
      console.log('   اقفل النسخة التانية — النسختين بيطردوا بعض.');
      return;
    }
    console.log('🚫 تم طرد البوت:', reason);
  });

  bot.on('error', (err) => console.error('❌ خطأ:', err.message));

  bot.on('end', (reason) => {
    console.log('⚠️ انقطع الاتصال:', reason);
    reconnect(duplicate ? DUPLICATE_WAIT : null);
  });

  watchdog = setTimeout(() => {
    if (!spawned) {
      console.log('⏱️ دخل بس ما ظهرش في العالم — بنعيد المحاولة');
      reconnect();
    }
  }, SPAWN_TIMEOUT);
}

process.on('unhandledRejection', (err) => {
  console.error('❌ خطأ غير متوقع:', err && err.message);
});

process.on('uncaughtException', (err) => {
  console.error('❌ خطأ فادح:', err && err.message);
  if (activeReconnect) activeReconnect();
  else setTimeout(() => createBot().catch(() => {}), RECONNECT_BASE);
});

let quitting = false;
function gracefulExit(signal) {
  if (quitting) return;
  quitting = true;
  console.log(`👋 وصلت إشارة ${signal} — بنقفل الاتصال بهدوء...`);
  generation++;
  try { if (activeBot) activeBot.quit('shutdown'); } catch (e) {}
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGTERM', () => gracefulExit('SIGTERM'));
process.on('SIGINT', () => gracefulExit('SIGINT'));

if (require.main === module) {
  setInterval(() => {
    if (quitting) return;
    const idle = Date.now() - lastActivity;
    if (idle > STALL_LIMIT) {
      console.error(`❌ البوت واقف من غير نشاط ${Math.round(idle / 60000)} دقيقة — بنعيد التشغيل`);
      process.exit(1);
    }
  }, 60 * 1000).unref();

  createBot().catch((e) => {
    console.error('❌ فشل بدء البوت:', e && e.message);
    setTimeout(() => createBot(1).catch(() => {}), RECONNECT_BASE);
  });
}

module.exports = { chooseHeading, yawToVector };