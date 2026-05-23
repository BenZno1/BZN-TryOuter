const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  REST,
  Routes,
} = require("discord.js");

require("dotenv").config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const YOUR_USER_ID = process.env.OWNER_ID; // Add OWNER_ID to your .env file
const YOUR_GUILD_ID = process.env.GUILD_ID; // Add GUILD_ID to your .env file

const sessions = new Map();

const BAR_OPTIONS = [
  { label: "1 Bar", value: "1_bar", emoji: "⬜" },
  { label: "2 Bar", value: "2_bar", emoji: "🟨" },
  { label: "3 Bar", value: "3_bar", emoji: "🟧" },
  { label: "4 Bar", value: "4_bar", emoji: "🟩" },
  { label: "5 Bar", value: "5_bar", emoji: "🟦" },
];

const BAR_DISPLAY = {
  "1_bar": "⬜ 1 Bar",
  "2_bar": "🟨 2 Bar",
  "3_bar": "🟧 3 Bar",
  "4_bar": "🟩 4 Bar",
  "5_bar": "🟦 5 Bar",
};

function buildTryoutEmbed(session) {
  const { targetUser, tryouts, result } = session;
  const statusText =
    result === "PASS" ? "✅ **PASS**" : result === "FAIL" ? "❌ **FAIL**" : "⏳ **Pending**";

  const embed = new EmbedBuilder()
    .setTitle("🎯 Tryout Evaluation")
    .setColor(result === "PASS" ? 0x57f287 : result === "FAIL" ? 0xed4245 : 0x5865f2)
    .addFields(
      { name: "👤 Player", value: `<@${targetUser.id}>`, inline: true },
      { name: "📊 Result", value: statusText, inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      { name: "Try Out 1", value: tryouts[1] ? BAR_DISPLAY[tryouts[1]] : "*Not rated*", inline: true },
      { name: "Try Out 2", value: tryouts[2] ? BAR_DISPLAY[tryouts[2]] : "*Not rated*", inline: true },
      { name: "Try Out 3", value: tryouts[3] ? BAR_DISPLAY[tryouts[3]] : "*Not rated*", inline: true }
    )
    .setFooter({ text: `Evaluated by ${session.evaluatorTag}` })
    .setTimestamp();

  return embed;
}

function buildComponents(session, disabled = false) {
  const { tryouts } = session;

  const makeSelect = (num) =>
    new StringSelectMenuBuilder()
      .setCustomId(`select_${num}_${session.id}`)
      .setPlaceholder(tryouts[num] ? `Try Out ${num}: ${BAR_DISPLAY[tryouts[num]]}` : `Rate Try Out ${num}`)
      .setDisabled(disabled)
      .addOptions(
        BAR_OPTIONS.map((o) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(o.label)
            .setValue(o.value)
            .setEmoji(o.emoji)
            .setDefault(tryouts[num] === o.value)
        )
      );

  const passButton = new ButtonBuilder()
    .setCustomId(`pass_${session.id}`)
    .setLabel("✅ PASS")
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled);

  const failButton = new ButtonBuilder()
    .setCustomId(`fail_${session.id}`)
    .setLabel("❌ FAIL")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled);

  return [
    new ActionRowBuilder().addComponents(makeSelect(1)),
    new ActionRowBuilder().addComponents(makeSelect(2)),
    new ActionRowBuilder().addComponents(makeSelect(3)),
    new ActionRowBuilder().addComponents(passButton, failButton),
  ];
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("tryout")
      .setDescription("Start a tryout evaluation for a server member")
      .addUserOption((option) =>
        option.setName("user").setDescription("The member being evaluated").setRequired(true)
      )
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Slash commands registered.");
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

// ─── DM Role System ───────────────────────────────────────────────────────────

// Stores which role list message ID maps to which pending role selections
const roleSessions = new Map();

async function getAssignableRoles(guild) {
  await guild.roles.fetch(); // make sure cache is fresh
  const botMember = guild.members.me;
  const botHighestPosition = botMember.roles.highest.position;

  return guild.roles.cache
    .filter((role) => {
      // Skip @everyone, managed roles (bots/integrations), and roles above the bot
      if (role.id === guild.id) return false;
      if (role.managed) return false;
      if (role.position >= botHighestPosition) return false;
      return true;
    })
    .sort((a, b) => b.position - a.position); // highest first
}

async function handleDMRoles(message) {
  const guild = message.client.guilds.cache.get(YOUR_GUILD_ID);
  if (!guild) return message.channel.send("❌ Couldn't find the server.");

  const member = guild.members.cache.get(message.author.id)
    ?? await guild.members.fetch(message.author.id).catch(() => null);

  if (!member) return message.channel.send("❌ You don't appear to be in the server.");

  const assignable = await getAssignableRoles(guild);

  if (!assignable.size) {
    return message.channel.send("❌ No assignable roles found. Make sure the bot's role is near the top of the role list.");
  }

  // Build a numbered list embed
  const roleList = assignable.map((role, i) => {
    const index = [...assignable.keys()].indexOf(role.id) + 1;
    const hasRole = member.roles.cache.has(role.id);
    return `**${index}.** ${role.name}${hasRole ? " ✅" : ""}`;
  }).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("🎭 Available Roles")
    .setDescription(
      `Here are all roles I can assign you. Roles with ✅ you already have.\n\n${roleList}\n\n**Reply with a number** to toggle that role, or \`cancel\` to exit.`
    )
    .setColor(0x5865f2)
    .setFooter({ text: "This session expires in 60 seconds." });

  const sent = await message.channel.send({ embeds: [embed] });

  // Store the session so we can match the follow-up reply
  roleSessions.set(message.author.id, {
    roles: [...assignable.values()],
    member,
    guild,
    expiresAt: Date.now() + 60_000,
  });

  // Auto-expire after 60s
  setTimeout(() => {
    if (roleSessions.has(message.author.id)) {
      roleSessions.delete(message.author.id);
      sent.edit({ embeds: [embed.setFooter({ text: "Session expired." }).setColor(0x747f8d)] }).catch(() => {});
    }
  }, 60_000);
}

async function handleDMRoleReply(message, session) {
  const input = message.content.trim().toLowerCase();

  if (input === "cancel") {
    roleSessions.delete(message.author.id);
    return message.channel.send("👋 Cancelled.");
  }

  const num = parseInt(input);
  if (isNaN(num) || num < 1 || num > session.roles.length) {
    return message.channel.send(`❌ Please reply with a number between 1 and ${session.roles.length}, or \`cancel\`.`);
  }

  const role = session.roles[num - 1];
  const member = session.member;

  try {
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      message.channel.send(`✅ Removed **${role.name}** from you.`);
    } else {
      await member.roles.add(role);
      message.channel.send(`✅ Given you **${role.name}**!`);
    }
  } catch (err) {
    console.error(err);
    message.channel.send("❌ Failed to update the role. Make sure the bot role is above it in the server settings.");
  }

  roleSessions.delete(message.author.id);
}

// ─────────────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages, // needed to receive DMs
    GatewayIntentBits.MessageContent,  // needed to read message content
  ],
  // Required for DMs to work with discord.js v14
  partials: ["CHANNEL"],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ─── DM message handler ───────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // Only handle DMs
  const { DMChannel } = require("discord.js");
  if (message.channel.type !== 1) return; // 1 = DM channel type

  // Debug: reply to every DM so we know the bot is receiving messages
  await message.channel.send(`📨 Got your message! Your ID: \`${message.author.id}\` | Expected: \`${YOUR_USER_ID}\``);

  // Only respond to the owner
  if (message.author.id !== YOUR_USER_ID) {
    return message.channel.send("❌ You are not authorised to use this bot.");
  }

  // Check if there's a pending role selection session
  const session = roleSessions.get(message.author.id);
  if (session) {
    if (Date.now() > session.expiresAt) {
      roleSessions.delete(message.author.id);
      return message.channel.send("⏰ Session expired. Send `!roles` to start again.");
    }
    return handleDMRoleReply(message, session);
  }

  // Trigger command
  if (message.content.toLowerCase() === "!roles") {
    return handleDMRoles(message);
  }

  // Help message for unrecognised DMs
  message.channel.send("👋 Send `!roles` to see and assign roles.");
});

// ─── Slash command + component handler (unchanged) ───────────────────────────
client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "tryout") {
    const targetUser = interaction.options.getUser("user");
    const sessionId = interaction.id;
    const session = {
      id: sessionId,
      targetUser,
      evaluatorTag: interaction.user.tag,
      tryouts: { 1: null, 2: null, 3: null },
      result: null,
    };
    sessions.set(sessionId, session);
    await interaction.reply({
      embeds: [buildTryoutEmbed(session)],
      components: buildComponents(session),
    });
  }

  if (interaction.isStringSelectMenu()) {
    const parts = interaction.customId.split("_");
    const tryoutIndex = parseInt(parts[1]);
    const sid = parts.slice(2).join("_");
    let session = sessions.get(sid);
    if (!session) {
      session = {
        id: sid,
        targetUser: await interaction.guild.members.fetch(
          interaction.message.embeds[0].fields[0].value.replace(/[<@>]/g, "")
        ).then(m => m.user),
        evaluatorTag: interaction.user.tag,
        tryouts: { 1: null, 2: null, 3: null },
        result: null,
      };
      sessions.set(sid, session);
    }
    session.tryouts[tryoutIndex] = interaction.values[0];
    await interaction.update({ embeds: [buildTryoutEmbed(session)], components: buildComponents(session) });
  }

  if (interaction.isButton()) {
    const parts = interaction.customId.split("_");
    const action = parts[0];
    const sid = parts.slice(1).join("_");
    if (action !== "pass" && action !== "fail") return;
    const session = sessions.get(sid);
    if (!session) return interaction.reply({ content: "❌ Session expired. Run /tryout again.", ephemeral: true });
    session.result = action.toUpperCase();
    await interaction.update({ embeds: [buildTryoutEmbed(session)], components: [] });
    setTimeout(() => sessions.delete(sid), 3600000);
  }
});

registerCommands().then(() => client.login(TOKEN));
