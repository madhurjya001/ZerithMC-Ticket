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

/* ================= COUNTER ================= */
let ticketCounter = 1;
if (fs.existsSync(COUNTER_FILE)) {
  ticketCounter = JSON.parse(fs.readFileSync(COUNTER_FILE)).counter || 1;
}
function saveCounter() {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ counter: ticketCounter }, null, 2));
}

/* ================= DATA ================= */
let CATEGORY_ID;
let LOG_CHANNEL_ID;
const ticketData = new Map();

/* ================= WEB ================= */
const app = express();
app.get("/", (_, res) => res.send("Ticket Bot Online"));
app.listen(3000);

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
  ]
});

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup ticket system")
    .addChannelOption(o =>
      o.setName("category").setDescription("Ticket category").setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("log").setDescription("Ticket log channel").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Send ticket panel")
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
await rest.put(
  Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
  { body: commands }
);

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {

  /* ---------- SLASH ---------- */
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "setup") {
      CATEGORY_ID = interaction.options.getChannel("category").id;
      LOG_CHANNEL_ID = interaction.options.getChannel("log").id;
      return interaction.reply({ content: "✅ Ticket system setup completed.", ephemeral: true });
    }

    if (interaction.commandName === "panel") {
      const embed = new EmbedBuilder()
        .setTitle("🎫 Support Tickets")
        .setDescription("Choose the correct category to open a ticket.")
        .setColor("#ff0000ff");

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("general").setLabel("General Support").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("partner").setLabel("Partnership").setStyle(ButtonStyle.Success)
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("report").setLabel("Report User").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("store").setLabel("Store").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("appeal").setLabel("Appeal").setStyle(ButtonStyle.Secondary)
      );

      return interaction.reply({ embeds: [embed], components: [row1, row2] });
    }
  }

  /* ---------- BUTTONS ---------- */
  if (!interaction.isButton()) return;
  const guild = interaction.guild;

  /* ---------- CLAIM ---------- */
  if (interaction.customId === "claim") {
    if (!interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
      return interaction.reply({ content: "❌ Staff only.", ephemeral: true });
    }

    const data = ticketData.get(interaction.channel.id);
    if (data.claimedBy) {
      return interaction.reply({ content: "❌ Ticket already claimed.", ephemeral: true });
    }

    data.claimedBy = interaction.user;
    await interaction.channel.setName(`claimed-${interaction.channel.name}`);

    const claimLog = new EmbedBuilder()
      .setTitle("🛠️ Ticket Claimed")
      .setColor("#f1c40f")
      .addFields(
        { name: "👤 Staff", value: `<@${interaction.user.id}>`, inline: true },
        { name: "📂 Category", value: data.type, inline: true },
        { name: "📌 Channel", value: `${interaction.channel}`, inline: true }
      )
      .setTimestamp();

    guild.channels.cache.get(LOG_CHANNEL_ID)?.send({ embeds: [claimLog] });
    return interaction.reply(`✅ Ticket claimed by ${interaction.user}`);
  }

  /* ---------- CLOSE (ONLY CLAIMER) ---------- */
  if (interaction.customId === "close") {
    const data = ticketData.get(interaction.channel.id);

    if (!data.claimedBy) {
      return interaction.reply({
        content: "❌ This ticket has not been claimed yet.",
        ephemeral: true
      });
    }

    if (interaction.user.id !== data.claimedBy.id) {
      return interaction.reply({
        content: "❌ Only the staff member who claimed this ticket can close it.",
        ephemeral: true
      });
    }

    const transcript = await createTranscript(interaction.channel, {
      fileName: `${interaction.channel.name}.html`
    });

    const closeEmbed = new EmbedBuilder()
      .setTitle("🔒 Ticket Closed")
      .setColor("#e74c3c")
      .addFields(
        { name: "👤 Opened By", value: `<@${data.opener.id}>`, inline: true },
        { name: "🛠️ Claimed By", value: `<@${data.claimedBy.id}>`, inline: true },
        { name: "🔒 Closed By", value: `<@${interaction.user.id}>`, inline: true },
        { name: "📂 Category", value: data.type, inline: true },
        { name: "🆔 Ticket", value: interaction.channel.name, inline: true }
      )
      .setTimestamp();

    try {
      await data.opener.send({ embeds: [closeEmbed], files: [transcript] });
    } catch {}

    guild.channels.cache.get(LOG_CHANNEL_ID)
      ?.send({ embeds: [closeEmbed], files: [transcript] });

    ticketData.delete(interaction.channel.id);
    return interaction.channel.delete();
  }

  /* ---------- CREATE TICKET ---------- */
  const channel = await guild.channels.create({
    name: `ticket-${ticketCounter}`,
    parent: CATEGORY_ID,
    type: ChannelType.GuildText,
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

  const openLog = new EmbedBuilder()
    .setTitle("🎫 Ticket Opened")
    .setColor("#2b2d31")
    .addFields(
      { name: "👤 User", value: `<@${interaction.user.id}>`, inline: true },
      { name: "📂 Category", value: interaction.customId, inline: true },
      { name: "📌 Channel", value: `${channel}`, inline: true }
    )
    .setTimestamp();

  guild.channels.cache.get(LOG_CHANNEL_ID)?.send({ embeds: [openLog] });

  const ticketEmbed = new EmbedBuilder()
    .setTitle("🎫 Ticket")
    .setDescription("Please describe your issue clearly.")
    .setColor("#00ffd5");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("claim").setLabel("Claim").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("close").setLabel("Close").setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `<@${interaction.user.id}>`, embeds: [ticketEmbed], components: [row] });
  interaction.reply({ content: `✅ Ticket created: ${channel}`, ephemeral: true });
});

/* ================= LOGIN ================= */
client.login(process.env.TOKEN);
