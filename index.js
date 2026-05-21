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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

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
    const session = sessions.get(sid);
    if (!session) return interaction.reply({ content: "❌ Session expired. Run /tryout again.", ephemeral: true });
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