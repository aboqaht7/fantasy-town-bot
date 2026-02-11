import 'dotenv/config';
import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionsBitField, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';

import {
  getBalance, addBalance, topBalances,
  getLastDaily, setLastDaily,
  setLogChannel, getLogChannel,
  addPunishment, removePunishment, duePunishments
} from './db.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const APP_ID = process.env.APP_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNER_ID = process.env.OWNER_ID;

if (!BOT_TOKEN || !APP_ID || !GUILD_ID || !OWNER_ID) {
  console.error('❌ Missing env vars: BOT_TOKEN, APP_ID, GUILD_ID, OWNER_ID');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let DANGEROUS_ENABLED = true;
const PREFIX = '-';

const isOwnerId = (id) => id === OWNER_ID;

function memberPermissionsHas(member, perm) {
  try { return member?.permissions?.has(perm) ?? false; } catch { return false; }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function parseDurationMs(input) {
  if (!input) return null;
  const t = String(input).trim().toLowerCase();

  // رقم فقط = دقائق
  if (/^\d+$/.test(t)) return Number(t) * 60 * 1000;

  const m = t.match(/^(\d+)\s*([smhd])$/);
  if (!m) return null;

  const n = Number(m[1]);
  const unit = m[2];
  const mult = unit === 's' ? 1000
    : unit === 'm' ? 60 * 1000
    : unit === 'h' ? 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;

  return n * mult;
}

async function logAction(guild, text) {
  const logId = getLogChannel(guild.id);
  if (!logId) return;
  const ch = await guild.channels.fetch(logId).catch(() => null);
  if (ch) ch.send(text).catch(() => {});
}

async function sendBanPhrases(channel) {
  if (!channel) return;
  await channel.send('سردب').catch(() => {});
  await channel.send('شقلب').catch(() => {});
  await channel.send('بنعالي').catch(() => {});
}

async function unbanIfBanned(guild, userId, reason) {
  const bans = await guild.bans.fetch().catch(() => null);
  if (!bans) return false;
  if (!bans.has(userId)) return false;
  await guild.members.unban(userId, reason || 'temp ban expired').catch(() => {});
  return true;
}

const commands = [
  // Ping
  new SlashCommandBuilder().setName('بنق').setDescription('فحص البوت'),
  new SlashCommandBuilder().setName('ping').setDescription('Bot check'),

  // Danger toggle
  new SlashCommandBuilder().setName('خطر')
    .setDescription('قفل/فتح الأوامر الحساسة (الأونر فقط)')
    .addStringOption(o => o.setName('وضع').setDescription('تشغيل/إيقاف').setRequired(true)
      .addChoices({ name: 'تشغيل', value: 'on' }, { name: 'إيقاف', value: 'off' })),
  new SlashCommandBuilder().setName('danger')
    .setDescription('Enable/disable dangerous commands (Owner only)')
    .addStringOption(o => o.setName('mode').setDescription('on/off').setRequired(true)
      .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })),

  // Set log channel
  new SlashCommandBuilder().setName('تعيين-لوق')
    .setDescription('تعيين قناة اللوق (الأونر فقط)')
    .addChannelOption(o => o.setName('القناة').setDescription('قناة اللوق').setRequired(true)),
  new SlashCommandBuilder().setName('set-log')
    .setDescription('Set log channel (Owner only)')
    .addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true)),

  // Setup channels
  new SlashCommandBuilder().setName('تهيئة').setDescription('إنشاء قنوات RP أساسية (الأونر فقط)'),
  new SlashCommandBuilder().setName('setup').setDescription('Create basic RP channels (Owner only)'),

  // Lock/Unlock
  new SlashCommandBuilder().setName('قفل')
    .setDescription('قفل كتابة قناة (أونر/أدمن)')
    .addChannelOption(o => o.setName('القناة').setDescription('القناة').setRequired(true)),
  new SlashCommandBuilder().setName('lock')
    .setDescription('Lock a channel (Owner/Admin)')
    .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)),

  new SlashCommandBuilder().setName('فتح')
    .setDescription('فتح كتابة قناة (أونر/أدمن)')
    .addChannelOption(o => o.setName('القناة').setDescription('القناة').setRequired(true)),
  new SlashCommandBuilder().setName('unlock')
    .setDescription('Unlock a channel (Owner/Admin)')
    .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)),

  // Clear
  new SlashCommandBuilder().setName('مسح')
    .setDescription('حذف رسائل (أونر/أدمن)')
    .addIntegerOption(o => o.setName('عدد').setDescription('1-100').setRequired(true)),
  new SlashCommandBuilder().setName('clear')
    .setDescription('Delete messages (Owner/Admin)')
    .addIntegerOption(o => o.setName('amount').setDescription('1-100').setRequired(true)),

  // Ban (Arabic + English)
  new SlashCommandBuilder().setName('باند')
    .setDescription('حظر عضو (أونر/أدمن)')
    .addUserOption(o => o.setName('شخص').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('سبب').setDescription('اختياري')),
  new SlashCommandBuilder().setName('ban')
    .setDescription('Ban a member (Owner/Admin)')
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Optional')),

  // Money
  new SlashCommandBuilder().setName('رصيد')
    .setDescription('عرض رصيدك أو رصيد شخص')
    .addUserOption(o => o.setName('شخص').setDescription('اختياري')),
  new SlashCommandBuilder().setName('balance')
    .setDescription('Show your balance or someone’s')
    .addUserOption(o => o.setName('user').setDescription('Optional')),

  new SlashCommandBuilder().setName('يومية').setDescription('استلام مكافأة يومية'),
  new SlashCommandBuilder().setName('daily').setDescription('Claim daily reward'),

  new SlashCommandBuilder().setName('تحويل')
    .setDescription('تحويل فلوس لشخص')
    .addUserOption(o => o.setName('شخص').setDescription('المستلم').setRequired(true))
    .addIntegerOption(o => o.setName('مبلغ').setDescription('المبلغ').setRequired(true)),
  new SlashCommandBuilder().setName('pay')
    .setDescription('Send money to someone')
    .addUserOption(o => o.setName('user').setDescription('Recipient').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true)),

  new SlashCommandBuilder().setName('توب').setDescription('أعلى 10 أرصدة'),
  new SlashCommandBuilder().setName('top').setDescription('Top 10 balances'),

  // Tickets
  new SlashCommandBuilder().setName('تذكرة').setDescription('فتح تذكرة دعم'),
  new SlashCommandBuilder().setName('ticket').setDescription('Open a support ticket'),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: commands });
  console.log('✅ Registered commands');
}

client.once('ready', async () => {
  console.log(`🤖 Fantasy Town ready: ${client.user.tag}`);
  await registerCommands();

  // ✅ يفك الباندات المؤقتة تلقائيًا كل دقيقة
  setInterval(async () => {
    try {
      const now = Date.now();
      const due = duePunishments(now);
      for (const p of due) {
        if (p.type !== 'ban') continue;

        const g = await client.guilds.fetch(p.guild_id).catch(() => null);
        if (!g) { removePunishment(p.guild_id, p.user_id, p.type); continue; }

        const did = await unbanIfBanned(g, p.user_id, 'temp ban expired');
        if (did) await logAction(g, `✅ UNBAN تلقائي <@${p.user_id}> (انتهاء مدة)`);
        removePunishment(p.guild_id, p.user_id, p.type);
      }
    } catch (e) {
      console.error(e);
    }
  }, 60 * 1000);
});

// Buttons + Slash
client.on('interactionCreate', async (i) => {
  // Ticket close button
  if (i.isButton()) {
    if (i.customId === 'ticket_close') {
      const can = i.memberPermissions?.has(PermissionsBitField.Flags.Administrator) || isOwnerId(i.user.id);
      if (!can) return i.reply({ content: '❌ للإدارة فقط.', ephemeral: true });
      await i.channel?.delete('Ticket closed').catch(() => null);
      return;
    }
    return;
  }

  if (!i.isChatInputCommand()) return;

  const isAdmin = i.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
  const canMod = isAdmin || isOwnerId(i.user.id);

  const requireDanger = async () => {
    if (!DANGEROUS_ENABLED) {
      await i.reply({ content: '🛑 الأوامر الحساسة مقفلة. استخدم /خطر تشغيل أو /danger on', ephemeral: true });
      return false;
    }
    return true;
  };

  // Ping
  if (['بنق', 'ping'].includes(i.commandName)) {
    return i.reply({ content: '✅ البوت شغال (Fantasy Town)', ephemeral: true });
  }

  // Danger
  if (['خطر', 'danger'].includes(i.commandName)) {
    if (!isOwnerId(i.user.id)) return i.reply({ content: '❌ الأونر فقط.', ephemeral: true });
    const mode = i.options.getString('وضع') || i.options.getString('mode');
    DANGEROUS_ENABLED = (mode === 'on');
    await logAction(i.guild, `🛑 danger=${mode} by <@${i.user.id}>`);
    return i.reply({ content: `✅ وضع الخطر: ${mode === 'on' ? 'تشغيل' : 'إيقاف'}`, ephemeral: true });
  }

  // Set log
  if (['تعيين-لوق', 'set-log'].includes(i.commandName)) {
    if (!isOwnerId(i.user.id)) return i.reply({ content: '❌ الأونر فقط.', ephemeral: true });
    const ch = i.options.getChannel('القناة') || i.options.getChannel('channel');
    if (!ch?.isTextBased()) return i.reply({ content: '❌ اختر قناة نصية.', ephemeral: true });
    setLogChannel(i.guild.id, ch.id);
    return i.reply({ content: `✅ تم تعيين قناة اللوق: ${ch}`, ephemeral: true });
  }

  // Setup
  if (['تهيئة', 'setup'].includes(i.commandName)) {
    if (!isOwnerId(i.user.id)) return i.reply({ content: '❌ الأونر فقط.', ephemeral: true });
    if (!(await requireDanger())) return;

    const guild = i.guild;
    const cat = await guild.channels.create({ name: 'Fantasy Town │ RP', type: ChannelType.GuildCategory });
    await guild.channels.create({ name: 'القوانين', type: ChannelType.GuildText, parent: cat.id });
    await guild.channels.create({ name: 'الإعلانات', type: ChannelType.GuildText, parent: cat.id });
    await guild.channels.create({ name: 'العام', type: ChannelType.GuildText, parent: cat.id });

    await logAction(guild, `⚙️ setup by <@${i.user.id}>`);
    return i.reply({ content: '✅ تم إنشاء القنوات الأساسية.', ephemeral: true });
  }

  // Lock/Unlock
  if (['قفل','lock','فتح','unlock'].includes(i.commandName)) {
    if (!canMod) return i.reply({ content: '❌ تحتاج أدمن أو أونر.', ephemeral: true });
    if (!(await requireDanger())) return;

    const ch = i.options.getChannel('القناة') || i.options.getChannel('channel');
    if (!ch?.isTextBased()) return i.reply({ content: '❌ اختر قناة نصية.', ephemeral: true });

    const lock = (i.commandName === 'قفل' || i.commandName === 'lock');
    await ch.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: lock ? false : null });

    await logAction(i.guild, `${lock ? '🔒 lock' : '🔓 unlock'} ${ch} by <@${i.user.id}>`);
    return i.reply({ content: `${lock ? '🔒 تم قفل' : '🔓 تم فتح'} ${ch}`, ephemeral: true });
  }

  // Clear
  if (['مسح','clear'].includes(i.commandName)) {
    if (!canMod) return i.reply({ content: '❌ تحتاج أدمن أو أونر.', ephemeral: true });
    if (!(await requireDanger())) return;

    const amount = i.options.getInteger('عدد') ?? i.options.getInteger('amount');
    if (!amount || amount < 1 || amount > 100) return i.reply({ content: '❌ العدد 1-100', ephemeral: true });

    const deleted = await i.channel.bulkDelete(amount, true).catch(() => null);
    await logAction(i.guild, `🧹 clear ${deleted?.size ?? amount} by <@${i.user.id}>`);
    return i.reply({ content: `✅ تم حذف ${deleted?.size ?? amount} رسالة.`, ephemeral: true });
  }

  // BAN (Slash) + phrases
  if (['باند','ban'].includes(i.commandName)) {
    if (!canMod) return i.reply({ content: '❌ تحتاج أدمن أو أونر.', ephemeral: true });
    if (!(await requireDanger())) return;

    const user = i.options.getUser('شخص') || i.options.getUser('user', true);
    const reason = i.options.getString('سبب') || i.options.getString('reason') || 'بدون سبب';

    const ok = await i.guild.members.ban(user.id, { reason }).then(() => true).catch(() => false);
    if (!ok) return i.reply({ content: '❌ ما قدرت أبند. تأكد صلاحيات البوت وترتيب الرتب.', ephemeral: true });

    await i.reply({ content: `⛔ تم حظر ${user} — السبب: ${reason}` });
    await sendBanPhrases(i.channel);
    await logAction(i.guild, `⛔ BAN ${user.tag} reason: ${reason} by <@${i.user.id}>`);
    return;
  }

  // Balance
  if (['رصيد','balance'].includes(i.commandName)) {
    const u = i.options.getUser('شخص') || i.options.getUser('user') || i.user;
    const bal = getBalance(i.guild.id, u.id);
    return i.reply({ content: `💰 رصيد **${u.username}**: **${bal}**` });
  }

  // Daily
  if (['يومية','daily'].includes(i.commandName)) {
    const key = todayKey();
    const last = getLastDaily(i.guild.id, i.user.id);
    if (last === key) return i.reply({ content: '⏳ استلمت اليومية اليوم. تعال بكرة!', ephemeral: true });

    const reward = 250;
    const newBal = addBalance(i.guild.id, i.user.id, reward);
    setLastDaily(i.guild.id, i.user.id, key);

    await logAction(i.guild, `🎁 daily ${reward} to <@${i.user.id}> (bal=${newBal})`);
    return i.reply({ content: `🎁 استلمت **${reward}** 💰 (رصيدك الآن: **${newBal}**)` });
  }

  // Pay
  if (['تحويل','pay'].includes(i.commandName)) {
    const to = i.options.getUser('شخص') || i.options.getUser('user');
    const amount = i.options.getInteger('مبلغ') ?? i.options.getInteger('amount');

    if (!to) return i.reply({ content: '❌ اختر شخص.', ephemeral: true });
    if (!amount || amount <= 0) return i.reply({ content: '❌ مبلغ غير صحيح.', ephemeral: true });
    if (to.id === i.user.id) return i.reply({ content: '❌ ما تقدر تحول لنفسك.', ephemeral: true });

    const fromBal = getBalance(i.guild.id, i.user.id);
    if (fromBal < amount) return i.reply({ content: `❌ رصيدك ما يكفي. رصيدك: ${fromBal}`, ephemeral: true });

    addBalance(i.guild.id, i.user.id, -amount);
    const toBal = addBalance(i.guild.id, to.id, amount);

    await logAction(i.guild, `💸 pay ${amount} <@${i.user.id}> -> <@${to.id}>`);
    return i.reply({ content: `✅ تم تحويل **${amount}** إلى ${to}. (رصيده الآن: **${toBal}**)` });
  }

  // Top
  if (['توب','top'].includes(i.commandName)) {
    const rows = topBalances(i.guild.id, 10);
    const lines = await Promise.all(rows.map(async (r, idx) => {
      const m = await i.guild.members.fetch(r.user_id).catch(() => null);
      const name = m?.user?.username || r.user_id;
      return `**${idx + 1}.** ${name} — 💰 **${r.balance}**`;
    }));
    return i.reply({ content: `🏆 **أعلى الأرصدة**\n${lines.join('\n') || 'لا يوجد بيانات بعد.'}` });
  }

  // Ticket
  if (['تذكرة','ticket'].includes(i.commandName)) {
    const guild = i.guild;

    const ch = await guild.channels.create({
      name: `تذكرة-${i.user.username}`.toLowerCase(),
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      ],
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close').setLabel('إغلاق التذكرة').setStyle(ButtonStyle.Danger)
    );

    await ch.send({ content: `🎫 أهلاً ${i.user} — اكتب مشكلتك هنا.`, components: [row] });
    await logAction(guild, `🎫 ticket by <@${i.user.id}> -> ${ch}`);
    return i.reply({ content: `✅ تم فتح تذكرتك: ${ch}`, ephemeral: true });
  }
});

// Prefix (-) commands + special RP words
client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!msg.guild) return;

    const text = (msg.content || '').trim();
    if (!text.startsWith(PREFIX)) return;

    const parts = text.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = (parts.shift() || '').toLowerCase();

    const member = await msg.guild.members.fetch(msg.author.id).catch(() => null);
    const canMod = memberPermissionsHas(member, PermissionsBitField.Flags.Administrator) || isOwnerId(msg.author.id);

    // ✅ فك باند
    // -فك @user   |  -unban @user
    if (['فك', 'unban'].includes(cmd)) {
      if (!canMod) return msg.reply('❌ هذا الأمر للإدارة فقط.');
      if (!DANGEROUS_ENABLED) return msg.reply('🛑 الأوامر الحساسة مقفلة.');

      const target = msg.mentions.users.first();
      if (!target) return msg.reply('❌ مثال: `-فك @شخص`');

      const ok = await msg.guild.members.unban(target.id, 'manual unban')
        .then(() => true).catch(() => false);

      // نحذف أي مؤقت مسجل حتى لو ما كان مبند
      removePunishment(msg.guild.id, target.id, 'ban');

      if (!ok) return msg.reply('⚠️ ما قدرت أفك الباند (يمكن مو مبند).');
      await msg.reply(`✅ تم فك الباند عن ${target}`);
      await logAction(msg.guild, `✅ UNBAN يدوي ${target.tag} by <@${msg.author.id}>`);
      return;
    }

    // ✅ فك تايم أوت
    // -فك-تايم @user  | -untimeout @user
    if (['فك-تايم', 'untimeout'].includes(cmd)) {
      if (!canMod) return msg.reply('❌ هذا الأمر للإدارة فقط.');
      if (!DANGEROUS_ENABLED) return msg.reply('🛑 الأوامر الحساسة مقفلة.');

      const target = msg.mentions.users.first();
      if (!target) return msg.reply('❌ مثال: `-فك-تايم @شخص`');

      const m = await msg.guild.members.fetch(target.id).catch(() => null);
      if (!m) return msg.reply('❌ ما لقيت العضو.');

      const ok = await m.timeout(null, 'manual untimeout').then(() => true).catch(() => false);
      if (!ok) return msg.reply('⚠️ ما قدرت أفك التايم (تأكد الصلاحيات/الرتب).');

      await msg.reply(`✅ تم فك التايم أوت عن ${target}`);
      await logAction(msg.guild, `✅ UNTIMEOUT ${target.tag} by <@${msg.author.id}>`);
      return;
    }

    // ✅ كلمات = باند (بالشرطة) سردب/شقلب/بنعالي
    // الاستخدام:
    // -سردب @شخص
    // -سردب @شخص 3d   (مؤقت)
    // أو رد على رسالة الشخص: -شقلب 12h
    if (['سردب', 'شقلب', 'بنعالي'].includes(cmd)) {
      if (!canMod) return msg.reply('❌ هذا الأمر للإدارة فقط.');
      if (!DANGEROUS_ENABLED) return msg.reply('🛑 الأوامر الحساسة مقفلة.');

      const targetUser =
        msg.mentions.users.first() ||
        (msg.reference?.messageId
          ? (await msg.channel.messages.fetch(msg.reference.messageId).catch(() => null))?.author
          : null);

      if (!targetUser) return msg.reply('❌ لازم تمنشن الشخص أو ترد على رسالته.');

      // مدة اختيارية للباند المؤقت
      const durToken = parts.find(p => /^\d+([smhd])?$/.test(p));
      const durationMs = parseDurationMs(durToken);

      // حد أقصى منطقي 28 يوم
      if (durationMs && durationMs > 28 * 24 * 60 * 60 * 1000) {
        return msg.reply('❌ المدة طويلة. الحد الأقصى 28d.');
      }

      const reason = durationMs ? `temp via كلمة: ${cmd} (${durToken})` : `كلمة باند: ${cmd}`;

      const ok = await msg.guild.members.ban(targetUser.id, { reason }).then(() => true).catch(() => false);
      if (!ok) return msg.reply('❌ ما قدرت أبند. تأكد صلاحيات البوت وترتيب الرتب.');

      if (durationMs) {
        addPunishment(msg.guild.id, targetUser.id, 'ban', Date.now() + durationMs, reason, msg.author.id);
        await msg.reply(`⛔ تم حظر ${targetUser} مؤقتًا لمدة ${durToken} (${cmd})`);
      } else {
        await msg.reply(`⛔ تم حظر ${targetUser} (${cmd})`);
      }

      await logAction(msg.guild, `⛔ BAN via كلمة (${cmd}) target=${targetUser.tag} ${durationMs ? `dur=${durToken}` : 'permanent'} by <@${msg.author.id}>`);
      return;
    }

    // ✅ كلمات = تايم أوت (اص / لاتسولف) — مدة اختيارية
    // -اص @شخص 10m | -لاتسولف @شخص 2h | رقم فقط = دقائق
    // أو رد على رسالة الشخص: -اص 15m
    if (['اص
