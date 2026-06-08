const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const DATA_FILE = './data.json';

// ─── DATA ─────────────────────────────────────────────────────────────────────

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      middlemen: {},
      leaderboardChannel: null,
      leaderboardMessage: null,
      prefix: '-',
      mmRoleId: null
    }));
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE));
  // ensure defaults
  if (!data.prefix) data.prefix = '-';
  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ─── PERMISSION HELPERS ───────────────────────────────────────────────────────

function hasMmRole(member, mmRoleId) {
  if (!mmRoleId) return true; // if no role set, everyone can use it
  return member.roles.cache.has(mmRoleId);
}

function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}

// ─── LEADERBOARD ──────────────────────────────────────────────────────────────

function buildLeaderboardEmbed(middlemen, prefix) {
  const sorted = Object.entries(middlemen).sort((a, b) => b[1].deals - a[1].deals);
  const medals = ['🥇', '🥈', '🥉'];
  const description = sorted.length === 0
    ? `No deals yet! Use \`${prefix}mm done @user <value>\` to log your first deal.`
    : sorted.map(([id, stats], i) => {
        const medal = medals[i] || `**#${i + 1}**`;
        return `${medal} <@${id}> — **${stats.deals} deals** | 💰 $${stats.value.toLocaleString()}`;
      }).join('\n');

  return new EmbedBuilder()
    .setTitle('🏆 Middleman Leaderboard')
    .setDescription(description)
    .setColor(0xFFD700)
    .setFooter({ text: 'Last updated' })
    .setTimestamp();
}

async function updateLeaderboard(guild) {
  const data = loadData();
  if (!data.leaderboardChannel) return;
  const channel = guild.channels.cache.get(data.leaderboardChannel);
  if (!channel) return;
  const embed = buildLeaderboardEmbed(data.middlemen, data.prefix);
  try {
    if (data.leaderboardMessage) {
      const msg = await channel.messages.fetch(data.leaderboardMessage);
      await msg.edit({ embeds: [embed] });
    } else {
      const msg = await channel.send({ embeds: [embed] });
      data.leaderboardMessage = msg.id;
      saveData(data);
    }
  } catch {
    const msg = await channel.send({ embeds: [embed] });
    data.leaderboardMessage = msg.id;
    saveData(data);
  }
}

// ─── SLASH COMMANDS ───────────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('mm')
    .setDescription('Middleman commands')
    .addSubcommand(sub =>
      sub.setName('done')
        .setDescription('Log a completed MM deal (MM role only)')
        .addUserOption(opt => opt.setName('middleman').setDescription('The middleman').setRequired(true))
        .addIntegerOption(opt => opt.setName('value').setDescription('Deal value in $').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('stats')
        .setDescription('Check stats of a middleman (MM role only)')
        .addUserOption(opt => opt.setName('middleman').setDescription('The middleman').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a deal (Admin only)')
        .addUserOption(opt => opt.setName('middleman').setDescription('The middleman').setRequired(true))
        .addIntegerOption(opt => opt.setName('value').setDescription('Value to remove').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('setchannel')
        .setDescription('Set the leaderboard channel (Admin only)')
        .addChannelOption(opt => opt.setName('channel').setDescription('The channel').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('reset')
        .setDescription("Reset a middleman's stats (Admin only)")
        .addUserOption(opt => opt.setName('middleman').setDescription('The middleman').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('setprefix')
        .setDescription('Change the bot prefix (Admin only)')
        .addStringOption(opt => opt.setName('prefix').setDescription('New prefix e.g. ! or $ or .').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('setrole')
        .setDescription('Set which role can use mm done and mm stats (Admin only)')
        .addRoleOption(opt => opt.setName('role').setDescription('The MM role').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('config')
        .setDescription('Show current bot config (Admin only)')
    ),
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('Error registering commands:', err);
  }
});

// ─── SHARED LOGIC ─────────────────────────────────────────────────────────────

async function handleDone(mm, value, guild, member, data) {
  if (!hasMmRole(member, data.mmRoleId) && !isAdmin(member)) return { error: '❌ You don\'t have the required role to use this command.' };
  if (!data.middlemen[mm.id]) data.middlemen[mm.id] = { deals: 0, value: 0 };
  data.middlemen[mm.id].deals += 1;
  data.middlemen[mm.id].value += value;
  saveData(data);
  await updateLeaderboard(guild);
  return new EmbedBuilder()
    .setTitle('✅ Deal Logged!')
    .setDescription(`<@${mm.id}> completed a deal worth **$${value.toLocaleString()}**`)
    .addFields(
      { name: 'Total Deals', value: `${data.middlemen[mm.id].deals}`, inline: true },
      { name: 'Total Value', value: `$${data.middlemen[mm.id].value.toLocaleString()}`, inline: true }
    )
    .setColor(0x00FF88)
    .setTimestamp();
}

async function handleStats(mm, member, data) {
  if (!hasMmRole(member, data.mmRoleId) && !isAdmin(member)) return { error: '❌ You don\'t have the required role to use this command.' };
  const stats = data.middlemen[mm.id];
  if (!stats) return { error: `❌ <@${mm.id}> has no deals logged yet.` };
  const allSorted = Object.entries(data.middlemen).sort((a, b) => b[1].deals - a[1].deals);
  const rank = allSorted.findIndex(([id]) => id === mm.id) + 1;
  return new EmbedBuilder()
    .setTitle(`📊 Stats for ${mm.username}`)
    .setThumbnail(mm.displayAvatarURL())
    .addFields(
      { name: '🏆 Rank', value: `#${rank}`, inline: true },
      { name: '🤝 Deals', value: `${stats.deals}`, inline: true },
      { name: '💰 Total Value', value: `$${stats.value.toLocaleString()}`, inline: true }
    )
    .setColor(0x5865F2)
    .setTimestamp();
}

// ─── SLASH HANDLER ────────────────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'mm') return;

  const sub = interaction.options.getSubcommand();
  const member = interaction.member;
  const data = loadData();

  // Admin-only commands — check before defer
  const adminOnly = ['remove', 'setchannel', 'reset', 'setprefix', 'setrole', 'config'];
  if (adminOnly.includes(sub) && !isAdmin(member)) {
    return interaction.reply({ content: '❌ You need **Manage Server** permission to use this.', ephemeral: true });
  }

  const ephemeralSubs = ['remove', 'setchannel', 'reset', 'setprefix', 'setrole', 'config'];
  await interaction.deferReply({ ephemeral: ephemeralSubs.includes(sub) });

  if (sub === 'done') {
    const mm = interaction.options.getUser('middleman');
    const value = interaction.options.getInteger('value');
    const result = await handleDone(mm, value, interaction.guild, member, data);
    if (result.error) return interaction.editReply({ content: result.error });
    return interaction.editReply({ embeds: [result] });
  }

  else if (sub === 'stats') {
    const mm = interaction.options.getUser('middleman') || interaction.user;
    const result = await handleStats(mm, member, data);
    if (result.error) return interaction.editReply({ content: result.error });
    return interaction.editReply({ embeds: [result] });
  }

  else if (sub === 'remove') {
    const mm = interaction.options.getUser('middleman');
    const value = interaction.options.getInteger('value');
    if (!data.middlemen[mm.id]) return interaction.editReply({ content: `❌ <@${mm.id}> has no deals logged.` });
    data.middlemen[mm.id].deals = Math.max(0, data.middlemen[mm.id].deals - 1);
    data.middlemen[mm.id].value = Math.max(0, data.middlemen[mm.id].value - value);
    saveData(data);
    await updateLeaderboard(interaction.guild);
    return interaction.editReply({ content: `✅ Removed 1 deal ($${value.toLocaleString()}) from <@${mm.id}>` });
  }

  else if (sub === 'setchannel') {
    const channel = interaction.options.getChannel('channel');
    data.leaderboardChannel = channel.id;
    data.leaderboardMessage = null;
    saveData(data);
    await updateLeaderboard(interaction.guild);
    return interaction.editReply({ content: `✅ Leaderboard channel set to <#${channel.id}>!` });
  }

  else if (sub === 'reset') {
    const mm = interaction.options.getUser('middleman');
    delete data.middlemen[mm.id];
    saveData(data);
    await updateLeaderboard(interaction.guild);
    return interaction.editReply({ content: `✅ Reset stats for <@${mm.id}>` });
  }

  else if (sub === 'setprefix') {
    const newPrefix = interaction.options.getString('prefix');
    data.prefix = newPrefix;
    saveData(data);
    return interaction.editReply({ content: `✅ Prefix changed to \`${newPrefix}\`! Example: \`${newPrefix}mm done @user 500\`` });
  }

  else if (sub === 'setrole') {
    const role = interaction.options.getRole('role');
    data.mmRoleId = role.id;
    saveData(data);
    return interaction.editReply({ content: `✅ MM role set to <@&${role.id}>! Only this role can use \`mm done\` and \`mm stats\`.` });
  }

  else if (sub === 'config') {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Bot Config')
      .setColor(0x5865F2)
      .addFields(
        { name: '📌 Prefix', value: `\`${data.prefix}\``, inline: true },
        { name: '🎭 MM Role', value: data.mmRoleId ? `<@&${data.mmRoleId}>` : 'Not set (everyone)', inline: true },
        { name: '📊 Leaderboard Channel', value: data.leaderboardChannel ? `<#${data.leaderboardChannel}>` : 'Not set', inline: true },
        { name: '👥 Total Middlemen', value: `${Object.keys(data.middlemen).length}`, inline: true }
      );
    return interaction.editReply({ embeds: [embed] });
  }
});

// ─── PREFIX HANDLER ───────────────────────────────────────────────────────────

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const data = loadData();
  const prefix = data.prefix || '-';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  if (command !== 'mm') return;

  const sub = args[0]?.toLowerCase();
  const member = message.member;

  // -mm done @user <value>
  if (sub === 'done') {
    const mm = message.mentions.users.first();
    const value = parseInt(args[2]);
    if (!mm) return message.reply(`❌ Usage: \`${prefix}mm done @user <value>\``);
    if (isNaN(value)) return message.reply(`❌ Usage: \`${prefix}mm done @user <value>\``);
    const result = await handleDone(mm, value, message.guild, member, data);
    if (result.error) return message.reply(result.error);
    return message.reply({ embeds: [result] });
  }

  // -mm stats [@user]
  else if (sub === 'stats') {
    const mm = message.mentions.users.first() || message.author;
    const result = await handleStats(mm, member, data);
    if (result.error) return message.reply(result.error);
    return message.reply({ embeds: [result] });
  }

  // -mm remove @user <value> (admin only)
  else if (sub === 'remove') {
    if (!isAdmin(member)) return message.reply('❌ You need **Manage Server** permission.');
    const mm = message.mentions.users.first();
    const value = parseInt(args[2]);
    if (!mm || isNaN(value)) return message.reply(`❌ Usage: \`${prefix}mm remove @user <value>\``);
    if (!data.middlemen[mm.id]) return message.reply(`❌ <@${mm.id}> has no deals logged.`);
    data.middlemen[mm.id].deals = Math.max(0, data.middlemen[mm.id].deals - 1);
    data.middlemen[mm.id].value = Math.max(0, data.middlemen[mm.id].value - value);
    saveData(data);
    await updateLeaderboard(message.guild);
    return message.reply(`✅ Removed 1 deal ($${value.toLocaleString()}) from <@${mm.id}>`);
  }

  // -mm setchannel #channel (admin only)
  else if (sub === 'setchannel') {
    if (!isAdmin(member)) return message.reply('❌ You need **Manage Server** permission.');
    const channel = message.mentions.channels.first();
    if (!channel) return message.reply(`❌ Usage: \`${prefix}mm setchannel #channel\``);
    data.leaderboardChannel = channel.id;
    data.leaderboardMessage = null;
    saveData(data);
    await updateLeaderboard(message.guild);
    return message.reply(`✅ Leaderboard channel set to <#${channel.id}>!`);
  }

  // -mm reset @user (admin only)
  else if (sub === 'reset') {
    if (!isAdmin(member)) return message.reply('❌ You need **Manage Server** permission.');
    const mm = message.mentions.users.first();
    if (!mm) return message.reply(`❌ Usage: \`${prefix}mm reset @user\``);
    delete data.middlemen[mm.id];
    saveData(data);
    await updateLeaderboard(message.guild);
    return message.reply(`✅ Reset stats for <@${mm.id}>`);
  }

  // -mm setprefix <newprefix> (admin only)
  else if (sub === 'setprefix') {
    if (!isAdmin(member)) return message.reply('❌ You need **Manage Server** permission.');
    const newPrefix = args[1];
    if (!newPrefix) return message.reply(`❌ Usage: \`${prefix}mm setprefix !\``);
    data.prefix = newPrefix;
    saveData(data);
    return message.reply(`✅ Prefix changed to \`${newPrefix}\`! Example: \`${newPrefix}mm done @user 500\``);
  }

  // -mm setrole @role (admin only)
  else if (sub === 'setrole') {
    if (!isAdmin(member)) return message.reply('❌ You need **Manage Server** permission.');
    const role = message.mentions.roles.first();
    if (!role) return message.reply(`❌ Usage: \`${prefix}mm setrole @role\``);
    data.mmRoleId = role.id;
    saveData(data);
    return message.reply(`✅ MM role set to <@&${role.id}>! Only this role can use \`mm done\` and \`mm stats\`.`);
  }

  // -mm config (admin only)
  else if (sub === 'config') {
    if (!isAdmin(member)) return message.reply('❌ You need **Manage Server** permission.');
    const embed = new EmbedBuilder()
      .setTitle('⚙️ Bot Config')
      .setColor(0x5865F2)
      .addFields(
        { name: '📌 Prefix', value: `\`${data.prefix}\``, inline: true },
        { name: '🎭 MM Role', value: data.mmRoleId ? `<@&${data.mmRoleId}>` : 'Not set (everyone)', inline: true },
        { name: '📊 Leaderboard Channel', value: data.leaderboardChannel ? `<#${data.leaderboardChannel}>` : 'Not set', inline: true },
        { name: '👥 Total Middlemen', value: `${Object.keys(data.middlemen).length}`, inline: true }
      );
    return message.reply({ embeds: [embed] });
  }

  // -mm help
  else {
    const embed = new EmbedBuilder()
      .setTitle('📋 MM Bot Commands')
      .setColor(0x5865F2)
      .addFields(
        { name: `🟢 MM Role only`, value: `\`${prefix}mm done @user <value>\`\n\`${prefix}mm stats [@user]\`` },
        { name: `🔴 Admin only`, value: `\`${prefix}mm remove @user <value>\`\n\`${prefix}mm setchannel #channel\`\n\`${prefix}mm reset @user\`\n\`${prefix}mm setprefix <prefix>\`\n\`${prefix}mm setrole @role\`\n\`${prefix}mm config\`` }
      );
    return message.reply({ embeds: [embed] });
  }
});

client.login(process.env.TOKEN);
