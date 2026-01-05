import express from "express";
import fs from "fs";
import dotenv from "dotenv";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType,
  SlashCommandBuilder,
  REST,
  Routes
} from "discord.js";
import { createTranscript } from "discord-html-transcripts";

dotenv.config();

/* ================= CONFIG ================= */
const STAFF_ROLE_ID = "1411726484954939572";
const COUNTER_FILE = "./ticketCounter.json";
const CONFIG_FILE = "./ticketConfig.json";

/* ================= LOAD CONFIG ================= */
let config = {
  categoryId: null,
  logChannelId: null
};

if (fs.existsSync(CONFIG_FILE)) {
  config = JSON.parse(fs.readFileSync(CONFIG_FILE));
}

/* ================= COUNTER ================= */
let ticketCounter = 1;
if (fs.existsSync(COUNTER_FILE)) {
  ticketCounter = JSON.parse(fs.readFileSync(COUNTER_FILE)).counter || 1;
}
function saveCounter() {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ counter: ticketCounter }, null, 2));
}

/* ================= DATA ================= */
const ticketData = new Map();

/* ================= WEB ================= */
const app = express();
app.get("/", (_, res) => res.send("ZerithMC Ticket Bot Online"));
app.listen(3000);

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ]
});

/* ================= SLASH COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup ticket category & log channel")
    .addChannelOption(o =>
      o.setName("category").setDescription("Ticket category").setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("log").setDescription("Ticket log channel").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Send the ticket panel")
];

/* ================= READY ================= */
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );

  console.log("✅ Global slash commands registered");
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {

  /* ---------- SLASH ---------- */
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "setup") {
      config.categoryId = interaction.options.getChannel("category").id;
      config.logChannelId = interaction.options.getChannel("log").id;

      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

      return interaction.reply({
        content: "✅ Ticket system setup saved successfully.",
        ephemeral: true
      });
    }

    if (interaction.commandName === "panel") {

      const embed = new EmbedBuilder()
        .setTitle("🎫 ZerithMC Support Tickets")
        .setDescription(
`**📜 Ticket Rules**

• Please follow these before opening a ticket:

**1.** Open tickets only for genuine issues  
*(support, reports, appeals, purchases & partnerships)*

**2.** Do not spam or troll with unnecessary tickets.  
*This can lead to action.*

**3.** Be patient — Staff will reply as soon as possible.

**4.** Provide details clearly if possible.  
*(Proof / Screenshots if needed)*

**5.** Respect staff decisions and keep communication polite.

━━━━━━━━━━━━━━━━━━━

Here, you can directly contact our staff team if you'd like to report suspicious activity or have any general inquiries.

**We offer five different ticket options — simply select the type of ticket you'd like to open.**`
        )
        .setColor("#0b0b0b");

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("general").setLabel("General Support").setEmoji("💬").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("partner").setLabel("Partnership Requests").setEmoji("🤝").setStyle(ButtonStyle.Success)
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("report").setLabel("Report a User").setEmoji("🚨").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("store").setLabel("Store Purchases").setEmoji("🛒").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("appeal").setLabel("Appeal for Unban").setEmoji("📩").setStyle(ButtonStyle.Secondary)
      );

      return interaction.reply({ embeds: [embed], components: [row1, row2] });
    }
  }

  /* ---------- BUTTONS ---------- */
  if (!interaction.isButton()) return;
  const guild = interaction.guild;

  /* ---------- CREATE TICKET ---------- */
  if (["general","partner","report","store","appeal"].includes(interaction.customId)) {

    if (!config.categoryId || !config.logChannelId) {
      return interaction.reply({ content: "❌ Ticket system not setup yet.", ephemeral: true });
    }

    const channel = await guild.channels.create({
      name: `ticket-${ticketCounter}`,
      type: ChannelType.GuildText,
      parent: config.categoryId,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ]
    });

    ticketData.set(channel.id, {
      opener: interaction.user,
      type: interaction.customId,
      claimedBy: null
    });

    ticketCounter++;
    saveCounter();

    const logEmbed = new EmbedBuilder()
      .setTitle("🎫 Ticket Opened")
      .addFields(
        { name: "User", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Category", value: interaction.customId, inline: true },
        { name: "Channel", value: `${channel}`, inline: true }
      )
      .setColor("#2b2d31")
      .setTimestamp();

    guild.channels.cache.get(config.logChannelId)?.send({ embeds: [logEmbed] });

    const ticketEmbed = new EmbedBuilder()
      .setTitle("🎫 Ticket")
      .setDescription("Please describe your issue clearly.")
      .setColor("#00ffd5");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("claim").setLabel("Claim").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("close").setLabel("Close").setStyle(ButtonStyle.Danger)
    );

    await channel.send({ content: `<@${interaction.user.id}>`, embeds: [ticketEmbed], components: [row] });
    return interaction.reply({ content: `✅ Ticket created: ${channel}`, ephemeral: true });
  }

  /* ---------- CLAIM ---------- */
  if (interaction.customId === "claim") {
    if (!interaction.member.roles.cache.has(STAFF_ROLE_ID))
      return interaction.reply({ content: "❌ Staff only.", ephemeral: true });

    const data = ticketData.get(interaction.channel.id);
    if (data.claimedBy)
      return interaction.reply({ content: "❌ Already claimed.", ephemeral: true });

    data.claimedBy = interaction.user;
    return interaction.reply(`✅ Ticket claimed by ${interaction.user}`);
  }

  /* ---------- CLOSE ---------- */
  if (interaction.customId === "close") {
    const data = ticketData.get(interaction.channel.id);
    if (!data.claimedBy || interaction.user.id !== data.claimedBy.id)
      return interaction.reply({ content: "❌ Only claimer can close.", ephemeral: true });

    const transcript = await createTranscript(interaction.channel, {
      fileName: `${interaction.channel.name}.html`
    });

    const closeEmbed = new EmbedBuilder()
      .setTitle("🔒 Ticket Closed")
      .addFields(
        { name: "Opened By", value: `<@${data.opener.id}>`, inline: true },
        { name: "Claimed By", value: `<@${data.claimedBy.id}>`, inline: true }
      )
      .setColor("#e74c3c")
      .setTimestamp();

    try {
      await data.opener.send({ embeds: [closeEmbed], files: [transcript] });
    } catch {}

    guild.channels.cache.get(config.logChannelId)
      ?.send({ embeds: [closeEmbed], files: [transcript] });

    ticketData.delete(interaction.channel.id);
    interaction.channel.delete();
  }
});

/* ================= LOGIN ================= */
client.login(process.env.TOKEN);
