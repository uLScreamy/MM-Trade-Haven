const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');

// ==================== SETUP ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,   // Required to read member roles
    GatewayIntentBits.MessageContent  // REQUIRED for prefix commands
  ]
});

const DATA_FILE = './data.json';
const DEFAULT_PREFIX = '%';

// ==================== DATA SYSTEM ====================
const defaultData = {
  middlemen: {},
  leaderboardChannel: null,
  leaderboardMessage: null,
  prefix: DEFAULT_PREFIX,
  mmRoles: [] // Array of role IDs that can use mm done/stats
};

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
    return { ...defaultData };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE));
    return { ...defaultData, ...raw }; // Merge in case old data is missing new fields
  } catch {
    return { ...defaultData };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ==================== HELPERS ====================
function canUseMMCommands(member, data) {
  // Admins always bypass
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  // If no MM roles configured, only admins can use it
  if (!data.mmRoles || data.mmRoles.length === 0) return false;
  // Check if member has any of the configured MM roles
  return member.roles.cache.some(role => data.mmRoles.includes(role.id));
}

// ==================== LEADERBOARD ====================
function buildLeaderboardEmbed(middlemen) {
  const sorted = Object.entries(middlemen).sort((a, b) => b[1].deals - a[1].deals);
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
    const msg = await channel.send({ embeds: [embed] });
    data.leaderboardMessage = msg.id;
    saveData(data);
  }
}

// ==================== BOT READY ====================
client.once('ready', () => {
  const data = loadData();
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📌 Current prefix: "${data.prefix}"`);
  console.log(`🎖️ MM Roles: ${data.mmRoles.length > 0 ? data.mmRoles.join(', ') : 'None set'}`);
});

// ==================== MESSAGE HANDLER ====================
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const data = loadData();
  const prefix = data.prefix || DEFAULT_PREFIX;

  // Prefix check
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();
  if (!command) return;

  // ==================== HELP ====================
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📋 Command List')
      .setDescription(`Current prefix: \`${prefix}\``)
      .addFields(
        { name: `${prefix}mm done @user <value>`, value: 'Log a completed deal *(MM Role/Admin)*' },
        { name: `${prefix}mm stats [@user]`, value: 'Check middleman stats *(MM Role/Admin)*' },
        { name: `${prefix}mm remove @user <value>`, value: 'Remove a deal *(Admin only)*' },
        { name: `${prefix}mm setchannel #channel`, value: 'Set leaderboard channel *(Admin only)*' },
        { name: `${prefix}mm reset @user`, value: 'Reset user stats *(Admin only)*' },
        { name: `${prefix}setprefix <new>`, value: 'Change bot prefix *(Admin only)*' },
        { name: `${prefix}mmrole add @role`, value: 'Assign MM role *(Admin only)*' },
        { name: `${prefix}mmrole remove @role`, value: 'Remove MM role *(Admin only)*' },
        { name: `${prefix}mmrole list`, value: 'Show MM roles' },
        { name: `${prefix}help`, value: 'Show this message' }
      )
      .setColor(0x5865F2);
    return message.reply({ embeds: [embed] });
  }

  // ==================== SETPREFIX ====================
  if (command === 'setprefix') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('❌ You need **Manage Server** permission.');
    }

    const newPrefix = args[0];
    if (!newPrefix) return message.reply(`❌ Usage: \`${prefix}setprefix <newprefix>\``);
    if (newPrefix.length > 5) return message.reply('❌ Prefix must be 5 characters or less.');

    data.prefix = newPrefix;
    saveData(data);
    return message.reply(`✅ Prefix changed to \`${newPrefix}\``);
  }

  // ==================== MMROLE MANAGEMENT ====================
  if (command === 'mmrole') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return message.reply('❌ You need **Manage Server** permission.');
    }

    const sub = args.shift()?.toLowerCase();
    const role = message.mentions.roles.first();

    if (sub === 'add') {
      if (!role) return message.reply(`❌ Usage: \`${prefix}mmrole add @role\``);
      if (data.mmRoles.includes(role.id)) {
        return message.reply('❌ That role is already an MM role.');
      }

      data.mmRoles.push(role.id);
      saveData(data);
      return message.reply(`✅ Added ${role} to MM roles. Users with this role can now use \`${data.prefix}mm done\` and \`${data.prefix}mm stats\`.`);
    }

    else if (sub === 'remove') {
      if (!role) return message.reply(`❌ Usage: \`${prefix}mmrole remove @role\``);
      if (!data.mmRoles.includes(role.id)) {
        return message.reply('❌ That role is not in the MM role list.');
      }

      data.mmRoles = data.mmRoles.filter(id => id !== role.id);
      saveData(data);
      return message.reply(`✅ Removed ${role} from MM roles.`);
    }

    else if (sub === 'list') {
      if (!data.mmRoles || data.mmRoles.length === 0) {
        return message.reply('📭 No MM roles configured. Only admins can use MM commands right now.');
      }
      const list = data.mmRoles.map(id => `<@&${id}>`).join('\n');
      const embed = new EmbedBuilder()
        .setTitle('🎖️ MM Roles')
        .setDescription(list)
        .setColor(0xFFD700);
      return message.reply({ embeds: [embed] });
    }

    else {
      return message.reply(`❌ Usage: \`${prefix}mmrole <add|remove|list> @role\``);
    }
  }

  // ==================== MM COMMANDS ====================
  if (command === 'mm') {
    const sub = args.shift()?.toLowerCase();
    if (!sub) {
      return message.reply(`❌ Usage: \`${prefix}mm <done|stats|remove|setchannel|reset>\``);
    }

    // --- DONE ---
    if (sub === 'done') {
      if (!canUseMMCommands(message.member, data)) {
        const rolesList = data.mmRoles?.length ? data.mmRoles.map(id => `<@&${id}>`).join(', ') : '*None set*';
        return message.reply(`❌ You need an MM role or Admin permission.\nCurrent MM roles: ${rolesList}`);
      }

      const user = message.mentions.users.first();
      const value = parseInt(args.find(arg => /^\d+$/.test(arg)), 10);

      if (!user) return message.reply(`❌ Please mention a middleman. Example: \`${prefix}mm done @user 100\``);
      if (isNaN(value)) return message.reply(`❌ Please provide a valid number. Example: \`${prefix}mm done @user 100\``);

      if (!data.middlemen[user.id]) data.middlemen[user.id] = { deals: 0, value: 0 };
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
      if (!canUseMMCommands(message.member, data)) {
        const rolesList = data.mmRoles?.length ? data.mmRoles.map(id => `<@&${id}>`).join(', ') : '*None set*';
        return message.reply(`❌ You need an MM role or Admin permission.\nCurrent MM roles: ${rolesList}`);
      }

      const user = message.mentions.users.first() || message.author;
      const stats = data.middlemen[user.id];

      if (!stats) return message.reply(`❌ <@${user.id}> has no deals logged yet.`);

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
        return message.reply('❌ You need **Manage Server** permission.');
      }

      const user = message.mentions.users.first();
      const value = parseInt(args.find(arg => /^\d+$/.test(arg)), 10);

      if (!user) return message.reply(`❌ Please mention a middleman. Example: \`${prefix}mm remove @user 100\``);
      if (isNaN(value)) return message.reply(`❌ Please provide a valid number. Example: \`${prefix}mm remove @user 100\``);

      if (!data.middlemen[user.id]) return message.reply(`❌ <@${user.id}> has no deals logged.`);

      data.middlemen[user.id].deals = Math.max(0, data.middlemen[user.id].deals - 1);
      data.middlemen[user.id].value = Math.max(0, data.middlemen[user.id].value - value);
      saveData(data);

      await updateLeaderboard(message.guild);
      return message.reply(`✅ Removed 1 deal ($${value.toLocaleString()}) from <@${user.id}>`);
    }

    // --- SETCHANNEL ---
    else if (sub === 'setchannel') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return message.reply('❌ You need **Manage Server** permission.');
      }

      const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]);
      if (!channel) return message.reply(`❌ Please mention a channel. Example: \`${prefix}mm setchannel #leaderboard\``);

      data.leaderboardChannel = channel.id;
      data.leaderboardMessage = null;
      saveData(data);

      await updateLeaderboard(message.guild);
      return message.reply(`✅ Leaderboard channel set to <#${channel.id}>!`);
    }

    // --- RESET ---
    else if (sub === 'reset') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return message.reply('❌ You need **Manage Server** permission.');
      }

      const user = message.mentions.users.first();
      if (!user) return message.reply(`❌ Please mention a middleman. Example: \`${prefix}mm reset @user\``);

      delete data.middlemen[user.id];
      saveData(data);

      await updateLeaderboard(message.guild);
      return message.reply(`✅ Reset stats for <@${user.id}>`);
    }

    else {
      return message.reply(`❌ Unknown subcommand. Use \`${prefix}help\` for help.`);
    }
  }
});

// ==================== LOGIN ====================
client.login(process.env.TOKEN);
