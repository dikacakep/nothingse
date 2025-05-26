// Load environment variables
require('dotenv').config();

// WhatsApp & Discord Bot
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

// === KONFIGURASI ===
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SEED_GEAR_CHANNEL = process.env.SEED_GEAR_CHANNEL;
const EGG_CHANNEL = process.env.EGG_CHANNEL;
const WEATHER_CHANNEL = process.env.WEATHER_CHANNEL;

const PERSONAL_IDS = [
  // Nomor pribadi
];
const GROUP_IDS = [
  '120363401113516518@g.us'
];

const emojiMap = {
  // 🌱 Seeds Stock
  'Carrot': '🥕', 'Strawberry': '🍓', 'Blueberry': '🫐',
  'Orange Tulip': '🌷', 'Tomato': '🍅', 'Corn': '🌽',
  'Daffodil': '🌼', 'Watermelon': '🍉', 'Pumpkin': '🎃',
  'Apple': '🍎', 'Bamboo': '🎋', 'Coconut': '🥥',
  'Cactus': '🌵', 'Dragon Fruit': '🌴', 'Mango': '🥭',
  'Grape': '🍇', 'Mushroom': '🍄', 'Pepper': '🌶',
  'Cacao': '🌰', 'Beanstalk': '🫛',

  // ⚙ Gear Stock
  'Watering Can': '🚿', 'Trowel': '🛠', 'Recall Wrench': '🔧',
  'Basic Sprinkler': '💧', 'Advanced Sprinkler': '💧', 'Godly Sprinkler': '💦',
  'Lightning Rod': '⚡', 'Master Sprinkler': '💦',
  'Favorite Tool': '❤', 'Harvest Tool': '🚜',

  // 🥚 Egg Stock
  'Common Egg': '🥚', 'Uncommon Egg': '🥚',
  'Rare Egg': '🍳', 'Legendary Egg': '🍳',
  'Mythical Egg': '🐣', 'Bug Egg': '🐣'
};

const HIDE_TAG_KEYWORDS = [
  'Bug Egg', 'Legendary Egg', 'Mythical Egg',
  'Dragon Fruit', 'Grape', 'Mango', 'Mushroom',
  'Pepper', 'Cacao', 'Beanstalk',
  'Advanced Sprinkler', 'Godly Sprinkler', 'Master Sprinkler',
  'Harvest Tool', 'Lightning Rod'
];

let sock;
let latestEggStock = '';
const groupMetadataCache = {};

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' })
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('❌ WhatsApp disconnected. Reconnecting...', shouldReconnect);
      if (shouldReconnect) connectToWhatsApp();
    } else if (connection === 'open') {
      console.log('✅ Connected to WhatsApp');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (msg.key.remoteJid.endsWith('@g.us')) {
      console.log('📌 Grup ID:', msg.key.remoteJid);
    }
  });
}

function cleanContent(content) {
  return content
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/<@&\d+>/g, '')
    .replace(/\*/g, '')
    .trim();
}

function formatEmbed(embed) {
  let result = '';
  if (embed.fields) {
    embed.fields.forEach(field => {
      const title = field.name.toLowerCase();
      const isSeedStock = title.includes('seed');
      const header =
        isSeedStock ? '*🌱 Seeds Stock*' :
        title.includes('gear') ? '*⚙ Gear Stock*' :
        title.includes('egg')  ? '*🥚 Egg Stock*'  : `*${field.name}*`;

      result += `${header}:\n`;

      const lines = cleanContent(field.value)
        .split(/\n|,|\r/)
        .map(l => l.replace(/^:\w+:\s*/, '').trim())
        .filter(Boolean);

      lines.forEach(line => {
        const match = line.match(/^([\w\s]+)\sx(\d+)?$/i);
        if (match) {
          let name = match[1].trim();
          const qty = match[2] || '';
          const emoji = emojiMap[name] || '🔹';

          if (isSeedStock) {
            name += ' Seeds';
          }

          result += `- ${emoji} ${name} x${qty}\n`;
        }
      });

      result += '\n';
    });
  }

  if (embed.title || embed.description) {
    const desc = (embed.description || '').replace(/\*\*(.*?)\*\*/g, '*$1*');
    result = `${embed.title ? `🌤️ ${embed.title}\n` : ''}${desc}\n\n${result}`;
  }

  return result.trim();
}

function containsImportantItem(text) {
  return HIDE_TAG_KEYWORDS.some(keyword =>
    text.toLowerCase().includes(keyword.toLowerCase())
  );
}

async function getGroupParticipants(jid) {
  if (!groupMetadataCache[jid]) {
    const metadata = await sock.groupMetadata(jid);
    groupMetadataCache[jid] = metadata.participants.map(p => p.id);
  }
  return groupMetadataCache[jid];
}

async function sendToWhatsApp(message, useHidetag = false) {
  if (!message || message.trim() === '') return;

  const allRecipients = [...PERSONAL_IDS, ...GROUP_IDS];
  for (const jid of allRecipients) {
    const isGroup = jid.endsWith('@g.us');
    const start = Date.now();

    if (isGroup && useHidetag) {
      const participants = await getGroupParticipants(jid);
      await sock.sendMessage(jid, { text: message, mentions: participants });
    } else {
      await sock.sendMessage(jid, { text: message });
    }

    const duration = Date.now() - start;
    console.log(`✅ Pesan dikirim ke ${isGroup ? 'Grup' : 'Nomor'}: ${jid} (${duration}ms)`);
  }
}

// === DISCORD BOT ===
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

discordClient.once('ready', async () => {
  console.log(`🤖 Discord bot logged in as ${discordClient.user.tag}`);

  const eggChannel = await discordClient.channels.fetch(EGG_CHANNEL);
  const lastMessage = (await eggChannel.messages.fetch({ limit: 1 })).first();
  if (lastMessage?.embeds?.length) {
    latestEggStock = formatEmbed(lastMessage.embeds[0]);
  }
});

discordClient.on('messageCreate', async (msg) => {
  try {
    if (![SEED_GEAR_CHANNEL, EGG_CHANNEL, WEATHER_CHANNEL].includes(msg.channel.id)) return;
    if (msg.author.bot && !msg.webhookId && msg.channel.id !== WEATHER_CHANNEL) return;

    const isWeather = msg.channel.id === WEATHER_CHANNEL;
    const isEgg = msg.channel.id === EGG_CHANNEL;
    const isSeedOrGear = msg.channel.id === SEED_GEAR_CHANNEL;

    if (isWeather) {
      if (msg.embeds.length > 0) {
        const weatherText = msg.embeds.map(e => formatEmbed(e)).join('\n\n');
        await sendToWhatsApp(weatherText, true);
      } else {
        console.log('⛔ Pesan cuaca diabaikan (tidak ada embed)');
      }
      return;
    }

    if (isEgg && msg.embeds.length > 0) {
      latestEggStock = formatEmbed(msg.embeds[msg.embeds.length - 1]);
      return;
    }

    if (isSeedOrGear) {
      const seedText = msg.embeds.map(e => formatEmbed(e)).join('\n\n');
      const fullStockMessage = [seedText, latestEggStock].filter(Boolean).join('\n\n');

      if (fullStockMessage) {
        const useHidetag = containsImportantItem(fullStockMessage);
        const jakartaTime = new Date().toLocaleString('id-ID', {
          timeZone: 'Asia/Jakarta',
          year: '2-digit',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });

        const footer = [
          `> 🔗 Social Media:`,
          `> https://www.tiktok.com/@irexus_official`,
          `> https://www.instagram.com/irexus.roblox`,
          `> shortcuts make it easier for you if available good stock (🚪Private Server Link)`,
          `> https://www.roblox.com/share?code=eaef6c0b990a5248b4871df3ed22348a&type=Server`,
          `> Last Update: ${jakartaTime} Asia/Jakarta (WIB)`
        ].join('\n');

        await sendToWhatsApp(`${fullStockMessage}\n\n${footer}`, useHidetag);
      } else {
        console.log('❌ Tidak ada stock seed/gear/egg untuk dikirim.');
      }

      return;
    }

  } catch (err) {
    console.error('❌ Gagal mengirim ke WhatsApp:', err.message);
  }
});

(async () => {
  await connectToWhatsApp();
  if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN tidak ditemukan di .env!');
    return;
  }
  discordClient.login(DISCORD_TOKEN);
})();
