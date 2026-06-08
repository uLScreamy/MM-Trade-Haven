const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,   // Required to check roles
    GatewayIntentBits.MessageContent  // REQUIRED for prefix commands to work
  ]
});

const prefix = '%';
const RESTRICTED_ROLE_ID = '1444549234094247986';
const DATA_FILE = './data.json';

// Load or create data
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ middlemen: {}, leaderboardChannel: null, leaderboardMessage: null }));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Build leaderboard embed
function buildLeaderboardEmbed(middlemen) {
  const sorted = Object.entries(middlemen)
    .sort((a, b) => b[1].deals - a[1].deals);

  const medals = ['🥇', '🥈', '🥉'];

  const description = sorted.length === 0
    ? 'No deals yet! Use `%mm done` to add your first deal.'
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

// Update the leaderboard message in the channel
async function updateLeaderboard(guild) {
  const data = loadData();
  if (!data.leaderboardChannel) return;

  const channel = guild.channels.cache.get(data.leaderboardChannel);
  if (!channel) return;

  const embed = buildLeaderboardEmbed(data.middlemen);

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
    // Message was deleted, send new one
    const msg = await channel.send({ embeds: [embed] });
    data.leaderboardMessage = msg.id;
    saveData(data);
  }
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  // Ignore bots, DMs, and messages without prefix
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  // --- HELP ---
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📋 Command List')
      .setDescription('Here are all available commands:')
      .addFields(
        { name: '%mm done @user <value>', value: 'Log a completed deal (Restricted Role only)' },
        { name: '%mm stats [@user]', value: 'Check middleman stats (Restricted Role only)' },
        { name: '%mm remove @user <value>', value: 'Remove a deal (Admin only)' },
        { name: '%mm setchannel #channel', value: 'Set leaderboard channel (Admin only)' },
        { name: '%mm reset @user', value: 'Reset user stats (Admin only)' },
        { name: '%help', value: 'Show this message' }
      )
      .setColor(0x5865F2);
    return message.reply({ embeds: [embed] });
  }

  // --- MM COMMANDS ---
  if (command === 'mm') {
    const sub = args.shift()?.toLowerCase();
    if (!sub) return message.reply('❌ Usage: `%mm <done|stats|remove|setchannel|reset>`');

    const data = loadData();

    // --- DONE ---
    if (sub === 'done') {
      // Check restricted role
      if (!message.member.roles.cache.has(RESTRICTED_ROLE_ID)) {
        return message.reply('❌ You do not have permission to use this command!');
      }

      const user = message.mentions.users.first();
      const value = parseInt(args.find(arg => !isNaN(arg)), 10);

      if (!user) return message.reply('❌ Please mention a middleman. Example: `%mm done @user 100`');
      if (isNaN(value)) return message.reply('❌ Please provide a valid deal value. Example: `%mm done @user 100`');

      if (!data.middlemen[user.id]) {
        data.middlemen[user.id] = { deals: 0, value: 0 };
      }
      data.middlemen[user.id].deals += 1;
      data.middlemen[user.id].value += value;
      saveData(data);

      await updateLeaderboard(message.guild);

      const embed = new EmbedBuilder()
        .setTitle('✅ Deal Logged!')
        .setDescription(`<@${user.id}> completed a deal worth **$${value.toLocaleString()}**`)
        .addFields(
          { name: 'Total Deals', value: `${data.middlemen[user.id].deals}`, inline: true },
          { name: 'Total Value', value: `$${data.middlemen[user.id].value.toLocaleString()}`, inline: true }
        )
        .setColor(0x00FF88)
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    // --- STATS ---
    else if (sub === 'stats') {
      // Check restricted role
      if (!message.member.roles.cache.has(RESTRICTED_ROLE_ID)) {
        return message.reply('❌ You do not have permission to use this command!');
      }

      const user = message.mentions.users.first() || message.author;
      const stats = data.middlemen[user.id];

      if (!stats) {
        return message.reply(`❌ <@${user.id}> has no deals logged yet.`);
      }

      const allSorted = Object.entries(data.middlemen).sort((a, b) => b[1].deals - a[1].deals);
      const rank = allSorted.findIndex(([id]) => id === user.id) + 1;

      const embed = new EmbedBuilder()
        .setTitle(`📊 Stats for ${user.username}`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          { name: '🏆 Rank', value: `#${rank}`, inline: true },
          { name: '🤝 Deals', value: `${stats.deals}`, inline: true },
          { name: '💰 Total Value', value: `$${stats.value.toLocaleString()}`, inline: true }
        )
        .setColor(0x5865F2)
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    // --- REMOVE ---
    else if (sub === 'remove') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return message.reply('❌ You need **Manage Server** permission to use this.');
      }

      const user = message.mentions.users.first();
      const value = parseInt(args.find(arg => !isNaN(arg)), 10);

      if (!user) return message.reply('❌ Please mention a middleman. Example: `%mm remove @user 100`');
      if (isNaN(value)) return message.reply('❌ Please provide a valid value. Example: `%mm remove @user 100`');

      if (!data.middlemen[user.id]) {
        return message.reply(`❌ <@${user.id}> has no deals logged.`);
      }

      data.middlemen[user.id].deals = Math.max(0, data.middlemen[user.id].deals - 1);
      data.middlemen[user.id].value = Math.max(0, data.middlemen[user.id].value - value);
      saveData(data);

      await updateLeaderboard(message.guild);

      return message.reply(`✅ Removed 1 deal ($${value.toLocaleString()}) from <@${user.id}>`);
    }

    // --- SETCHANNEL ---
    else if (sub === 'setchannel') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return message.reply('❌ You need **Manage Server** permission to use this.');
      }

      const channel = message.mentions.channels.first();
      if (!channel) return message.reply('❌ Please mention a channel. Example: `%mm setchannel #leaderboard`');

      data.leaderboardChannel = channel.id;
      data.leaderboardMessage = null;
      saveData(data);

      await updateLeaderboard(message.guild);

      return message.reply(`✅ Leaderboard channel set to <#${channel.id}>!`);
    }

    // --- RESET ---
    else if (sub === 'reset') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return message.reply('❌ You need **Manage Server** permission to use this.');
      }

      const user = message.mentions.users.first();
      if (!user) return message.reply('❌ Please mention a middleman. Example: `%mm reset @user`');

      delete data.middlemen[user.id];
      saveData(data);

      await updateLeaderboard(message.guild);

      return message.reply(`✅ Reset stats for <@${user.id}>`);
    }

    else {
      return message.reply('❌ Unknown subcommand. Use `%mm <done|stats|remove|setchannel|reset>`');
    }
  }
});

client.login(process.env.TOKEN);
