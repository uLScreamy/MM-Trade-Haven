const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

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
    ? 'No deals yet! Use `/mm done` to add your first deal.'
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

// Slash commands definition
const commands = [
  new SlashCommandBuilder()
    .setName('mm')
    .setDescription('Middleman commands')
    .addSubcommand(sub =>
      sub.setName('done')
        .setDescription('Log a completed MM deal')
        .addUserOption(opt => opt.setName('middleman').setDescription('The middleman who completed the deal').setRequired(true))
        .addIntegerOption(opt => opt.setName('value').setDescription('Value of the deal in $').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a deal from a middleman')
        .addUserOption(opt => opt.setName('middleman').setDescription('The middleman').setRequired(true))
        .addIntegerOption(opt => opt.setName('value').setDescription('Value to remove').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('stats')
        .setDescription('Check stats of a middleman')
        .addUserOption(opt => opt.setName('middleman').setDescription('The middleman').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('setchannel')
        .setDescription('Set the leaderboard channel (Admin only)')
        .addChannelOption(opt => opt.setName('channel').setDescription('The channel to post the leaderboard in').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('reset')
        .setDescription('Reset a middleman\'s stats (Admin only)')
        .addUserOption(opt => opt.setName('middleman').setDescription('The middleman to reset').setRequired(true))
    ),
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Register slash commands
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('Error registering commands:', err);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'mm') return;

  const sub = interaction.options.getSubcommand();

  // Defer reply immediately to prevent Discord 3s timeout
  const ephemeralSubs = ['remove', 'setchannel', 'reset'];
  await interaction.deferReply({ ephemeral: ephemeralSubs.includes(sub) });

  const data = loadData();

  // --- DONE ---
  if (sub === 'done') {
    const mm = interaction.options.getUser('middleman');
    const value = interaction.options.getInteger('value');

    if (!data.middlemen[mm.id]) {
      data.middlemen[mm.id] = { deals: 0, value: 0 };
    }
    data.middlemen[mm.id].deals += 1;
    data.middlemen[mm.id].value += value;
    saveData(data);

    await updateLeaderboard(interaction.guild);

    const embed = new EmbedBuilder()
      .setTitle('✅ Deal Logged!')
      .setDescription(`<@${mm.id}> completed a deal worth **$${value.toLocaleString()}**`)
      .addFields(
        { name: 'Total Deals', value: `${data.middlemen[mm.id].deals}`, inline: true },
        { name: 'Total Value', value: `$${data.middlemen[mm.id].value.toLocaleString()}`, inline: true }
      )
      .setColor(0x00FF88)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  // --- REMOVE ---
  else if (sub === 'remove') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ You need **Manage Server** permission to use this.', ephemeral: true });
    }

    const mm = interaction.options.getUser('middleman');
    const value = interaction.options.getInteger('value');

    if (!data.middlemen[mm.id]) {
      return interaction.reply({ content: `❌ <@${mm.id}> has no deals logged.`, ephemeral: true });
    }

    data.middlemen[mm.id].deals = Math.max(0, data.middlemen[mm.id].deals - 1);
    data.middlemen[mm.id].value = Math.max(0, data.middlemen[mm.id].value - value);
    saveData(data);

    await updateLeaderboard(interaction.guild);

    await interaction.editReply({ content: `✅ Removed 1 deal ($${value.toLocaleString()}) from <@${mm.id}>`, ephemeral: true });
  }

  // --- STATS ---
  else if (sub === 'stats') {
    const mm = interaction.options.getUser('middleman') || interaction.user;
    const stats = data.middlemen[mm.id];

    if (!stats) {
      return interaction.reply({ content: `❌ <@${mm.id}> has no deals logged yet.`, ephemeral: true });
    }

    const allSorted = Object.entries(data.middlemen).sort((a, b) => b[1].deals - a[1].deals);
    const rank = allSorted.findIndex(([id]) => id === mm.id) + 1;

    const embed = new EmbedBuilder()
      .setTitle(`📊 Stats for ${mm.username}`)
      .setThumbnail(mm.displayAvatarURL())
      .addFields(
        { name: '🏆 Rank', value: `#${rank}`, inline: true },
        { name: '🤝 Deals', value: `${stats.deals}`, inline: true },
        { name: '💰 Total Value', value: `$${stats.value.toLocaleString()}`, inline: true }
      )
      .setColor(0x5865F2)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  // --- SETCHANNEL ---
  else if (sub === 'setchannel') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ You need **Manage Server** permission to use this.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel');
    data.leaderboardChannel = channel.id;
    data.leaderboardMessage = null;
    saveData(data);

    await updateLeaderboard(interaction.guild);

    await interaction.editReply({ content: `✅ Leaderboard channel set to <#${channel.id}>!`, ephemeral: true });
  }

  // --- RESET ---
  else if (sub === 'reset') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ You need **Manage Server** permission to use this.', ephemeral: true });
    }

    const mm = interaction.options.getUser('middleman');
    delete data.middlemen[mm.id];
    saveData(data);

    await updateLeaderboard(interaction.guild);

    await interaction.editReply({ content: `✅ Reset stats for <@${mm.id}>`, ephemeral: true });
  }
});

client.login(process.env.TOKEN);


const prefix = '-'; // Add prefix

// ... (your existing code)

client.on('messageCreate', async message => {
    // Ignore messages from bots
    if (message.author.bot) return;

    // Check for prefix
    if (!message.content.startsWith(prefix)) return;

    // Remove prefix and split into args
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    // ... (rest of your command handling)

    // For restricted commands (mm done, mm stats)
    if (commandName === 'mm' || commandName === 'stats') {
        const restrictedCommands = ['done', 'stats']; // Commands that require special role
        if (restrictedCommands.includes(args[0]?.toLowerCase())) {
            const requiredRoleId = '1444549234094247986';
            const member = message.member;

            if (!member.roles.cache.has(requiredRoleId)) {
                return message.reply('You do not have permission to use this command!');
            }
        }
    }

    // ... (rest of your command handling)
});
