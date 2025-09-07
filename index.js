const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock, GoalNear } } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock');
const pvp = require('mineflayer-pvp').plugin;

const config = require('./settings.json');
const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('Bot has arrived 🤖');
});

app.listen(8000, () => {
  console.log('🌐 Web server started on http://localhost:8000');
});

// =============================
// 🎯 MODUL MODULAR
// =============================

function startChatModule(bot, config) {
  if (!config.utils['chat-messages'].enabled) return;

  console.log('[INFO] Chat module started');
  const messages = config.utils['chat-messages']['messages'];
  if (config.utils['chat-messages'].repeat) {
    const delay = config.utils['chat-messages']['repeat-delay'] * 1000;
    let i = 0;
    setInterval(() => {
      bot.chat(messages[i]);
      i = (i + 1) % messages.length;
    }, delay);
  } else {
    messages.forEach(msg => bot.chat(msg));
  }
}

function startAntiAFK(bot, config) {
  if (!config.utils['anti-afk'].enabled) return;

  bot.setControlState('jump', true);
  if (config.utils['anti-afk'].sneak) bot.setControlState('sneak', true);

  setInterval(() => {
    bot.setControlState('forward', true);
    setTimeout(() => {
      bot.setControlState('forward', false);
      bot.setControlState('back', true);
      setTimeout(() => bot.setControlState('back', false), 1000);
    }, 1000);
  }, 60000);
}

function startAutoEat(bot, mcData, config) {
  if (!config.utils['auto-eat']?.enabled) return;

  console.log('[INFO] Auto-eat module started');
  setInterval(() => {
    if (bot.food >= 20 || bot.isEating) return;

    const food = bot.inventory.items().find(item =>
      mcData.foods[item.type] && item.count > 0
    );

    if (food) {
      bot.equip(food, 'hand', () => {
        bot.consume(() => {
          console.log(`[AutoEat] Ate ${food.name}. Food: ${bot.food}/20`);
        });
      });
    }
  }, 3000);
}

const HOSTILE_MOBS = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'slime', 'phantom'];

function startAvoidMobs(bot, config) {
  if (!config.utils['avoid-mobs']?.enabled) return;

  console.log('[INFO] Avoid mobs module started');
  bot.on('entitySpawn', (entity) => {
    if (entity.type === 'mob' && HOSTILE_MOBS.includes(entity.mobType)) {
      const distance = bot.entity.position.distanceTo(entity.position);
      if (distance < 5) {
        const dx = bot.entity.position.x - entity.position.x;
        const dz = bot.entity.position.z - entity.position.z;
        const runPos = bot.entity.position.offset(dx * 3, 0, dz * 3);
        bot.pathfinder.setGoal(new GoalNear(runPos.x, runPos.y, runPos.z, 1));
        console.log(`[Avoid] Running from ${entity.mobType} at distance ${distance.toFixed(1)}`);
      }
    }
  });
}

function startCommandHandler(bot, mcData) {
  bot.on('chat', (username, message) => {
    if (!message.startsWith('/bot ')) return;

    const args = message.slice(5).split(' ');
    const command = args[0];

    if (command === 'go' && args.length === 4) {
      const [x, y, z] = args.slice(1).map(Number);
      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        bot.chat('❌ Invalid coordinates. Usage: /bot go <x> <y> <z>');
        return;
      }
      bot.pathfinder.setGoal(new GoalNear(x, y, z, 1));
      bot.chat(`✅ Going to ${x} ${y} ${z}`);
    } 
    else if (command === 'follow' && args.length === 2) {
      const targetName = args[1];
      const target = bot.players[targetName]?.entity;
      if (!target) {
        bot.chat(`❌ Player "${targetName}" not found.`);
        return;
      }
      // Simpan interval agar bisa dihentikan
      if (bot._followInterval) clearInterval(bot._followInterval);
      bot._followInterval = setInterval(() => {
        const tgt = bot.players[targetName]?.entity;
        if (tgt) {
          bot.pathfinder.setGoal(new GoalNear(tgt.position.x, tgt.position.y, tgt.position.z, 2));
        } else {
          clearInterval(bot._followInterval);
          bot.chat(`⏹️ Stopped following ${targetName} (player left).`);
        }
      }, 1000);
      bot.chat(`✅ Now following ${targetName}`);
    } 
    else if (command === 'stop') {
      if (bot._followInterval) clearInterval(bot._followInterval);
      bot.pathfinder.setGoal(null);
      bot.setControlState('forward', false);
      bot.setControlState('back', false);
      bot.chat('⏹️ Stopped all movement.');
    } 
    else if (command === 'eat') {
      if (bot.food >= 20) {
        bot.chat('✅ Already full!');
        return;
      }
      const food = bot.inventory.items().find(item => mcData.foods[item.type]);
      if (food) {
        bot.equip(food, 'hand', () => {
          bot.consume(() => {
            bot.chat(`🍖 Ate ${food.name}! Hunger: ${bot.food}/20`);
          });
        });
      } else {
        bot.chat('❌ No food found in inventory!');
      }
    }
    else {
      bot.chat('❓ Unknown command. Try: /bot go x y z | /bot follow <player> | /bot stop | /bot eat');
    }
  });
}

// =============================
// 🤖 CREATE BOT FUNCTION
// =============================

function createBot() {
  const bot = mineflayer.createBot({
    username: config['bot-account']['username'],
    password: config['bot-account']['password'],
    auth: config['bot-account']['type'],
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version,
  });

  // Load plugins — HAPUS navigate karena bentrok dengan pathfinder
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);
  bot.loadPlugin(pvp); // jika nanti mau tambah fitur pvp

  const mcData = require('minecraft-data')(bot.version);
  const defaultMove = new Movements(bot, mcData);
  bot.pathfinder.setMovements(defaultMove);

  // ======================
  // 🎯 Spawn Event — Main Logic
  // ======================
  bot.once('spawn', () => {
    console.log('\x1b[33m[AfkBot] Bot joined the server ✅\x1b[0m');

    // Jalankan semua modul
    startChatModule(bot, config);
    startAntiAFK(bot, config);
    startAutoEat(bot, mcData, config);
    startAvoidMobs(bot, config);
    startCommandHandler(bot, mcData);

    // Jika nanti mau aktifkan follow player via config, bisa ditambahkan:
    // if (config.utils['follow-player']?.enabled) startFollowPlayer(bot, config);
  });

  // 🎯 Saat sampai tujuan
  bot.on('goal_reached', () => {
    console.log(`\x1b[32m[AfkBot] Reached goal at ${bot.entity.position}\x1b[0m`);
  });

  // ☠️ Saat mati — AUTO RESPOND
  bot.on('death', () => {
    console.log(`\x1b[33m[AfkBot] Died at ${bot.entity.position} — Respawning...\x1b[0m`);
    setTimeout(() => {
      bot.chat('/spawn');
      console.log('[AutoRespawn] Sent /spawn command');
    }, 2000);
  });

  // 🔁 Auto Reconnect
  if (config.utils['auto-reconnect']) {
    bot.on('end', () => {
      console.log('[INFO] Disconnected. Reconnecting in 5s...');
      setTimeout(() => createBot(), config.utils['auto-recconect-delay'] || 5000);
    });
  }

  // ❌ Error handling
  bot.on('kicked', (reason) => console.log('\x1b[33m[KICKED]', reason, '\x1b[0m'));
  bot.on('error', (err) => console.log('\x1b[31m[ERROR]', err.message, '\x1b[0m'));
}

createBot();
