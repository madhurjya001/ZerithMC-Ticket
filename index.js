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
const CONFIG_FILE = "./ticketConfig.json";
const COUNTER_FILE = "./ticketCounter.json";
const TICKET_DATA_FILE = "./tickets.json";

/* ================= CATEGORY NAMES ================= */
const CATEGORY_NAMES = {
  general: "General Support",
  partner: "Partnership Requests",
  report: "Report a User",
  store: "Store Purchases",
  appeal: "Appeal for Unban"
};

/* ================= STORAGE ================= */
let config = { categoryId: null, logChannelId: null };
if (fs.existsSync(CONFIG_FILE)) config = JSON.parse(fs.readFileSync(CONFIG_FILE));

let ticketCounter = 1;
if (fs.existsSync(COUNTER_FILE))
  ticketCounter = JSON.parse(fs.readFileSync(COUNTER_FILE)).counter || 1;

let ticketStore = {};
if (fs.existsSync(TICKET_DATA_FILE))
  ticketStore = JSON.parse(fs.readFileSync(TICKET_DATA_FILE));

function saveCounter() {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ counter: ticketCounter }, null, 2));
}
function saveTickets() {
  fs.writeFileSync(TICKET_DATA_FILE, JSON.stringify(ticketStore, null, 2));
}

/* ================= SAFE REPLY ================= */
async function safeReply(interaction, data) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(data).catch(() => {});
  }
  return interaction.reply(data).catch(() => {});
}

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
    .setDescription("Setup ticket system")
    .addChannelOption(o =>
      o.setName("category").setDescription("Ticket category").setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("log").setDescription("Log channel").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Send ticket panel")
];

/* ================= READY ================= */
client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {

  /* ---------- SLASH ---------- */
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "setup") {
      config.categoryId = interaction.options.getChannel("category").id;
      config.logChannelId = interaction.options.getChannel("log").id;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      return safeReply(interaction, {
        content: "✅ Ticket system setup saved successfully.",
        ephemeral: true
      });
    }

    if (interaction.commandName === "panel") {
      const embed = new EmbedBuilder()
        .setTitle("🎫 ZerithMC Support Tickets")
        .setDescription(
`📜 **Ticket Rules**

• Open tickets only for genuine issues  
• No spam or trolling  
• Be patient with staff  
• Provide proof if needed  
• Respect staff decisions  

Select a ticket type below.`
        )
        .setColor("#ff0000"); // 🔴 RED PANEL

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("general").setLabel("General Support").setEmoji("💬").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("partner").setLabel("Partnership").setEmoji("🤝").setStyle(ButtonStyle.Success)
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("report").setLabel("Report").setEmoji("🚨").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("store").setLabel("Store").setEmoji("🛒").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("appeal").setLabel("Appeal").setEmoji("📩").setStyle(ButtonStyle.Secondary)
      );

      return safeReply(interaction, { embeds: [embed], components: [row1, row2] });
    }
  }

  /* ---------- BUTTONS ---------- */
  if (!interaction.isButton()) return;
  const guild = interaction.guild;

  /* ---------- CREATE TICKET ---------- */
  if (CATEGORY_NAMES[interaction.customId]) {

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

    ticketStore[channel.id] = {
      opener: interaction.user.id,
      category: interaction.customId,
      claimedBy: null
    };
    saveTickets();

    ticketCounter++;
    saveCounter();

    await safeReply(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor("#2ecc71")
          .setTitle("✅ Ticket Created")
          .setDescription(`Your ticket has been created.\n\n🔗 ${channel}`)
      ],
      ephemeral: true
    });

    const welcome = new EmbedBuilder()
      .setColor("#0b0b0b")
      .setDescription(
        `Hey <@${interaction.user.id}>, thanks for reaching out.\n\nPlease describe your issue clearly.`
      )
      .setFooter({ text: "ZerithMC Tickets" });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("claim").setLabel("Claim").setEmoji("🛠️").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("close_request").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
    );

    await channel.send({ embeds: [welcome], components: [buttons] });

    guild.channels.cache.get(config.logChannelId)?.send({
      embeds: [
        new EmbedBuilder()
          .setColor("#5865F2")
          .setTitle("🎫 Ticket Opened")
          .addFields(
            { name: "User", value: `<@${interaction.user.id}>` },
            { name: "Category", value: CATEGORY_NAMES[interaction.customId] },
            { name: "Channel", value: `${channel}` },
            { name: "Time", value: `<t:${Math.floor(Date.now()/1000)}:F>` }
          )
      ]
    });
  }

  /* ---------- CLAIM ---------- */
  if (interaction.customId === "claim") {
    if (!interaction.member.roles.cache.has(STAFF_ROLE_ID))
      return safeReply(interaction, { content: "❌ Staff only.", ephemeral: true });

    const data = ticketStore[interaction.channel.id];
    if (!data) return safeReply(interaction, { content: "❌ Ticket data missing.", ephemeral: true });

    if (data.claimedBy)
      return safeReply(interaction, { content: "❌ Already claimed.", ephemeral: true });

    data.claimedBy = interaction.user.id;
    saveTickets();

    await interaction.channel.setName(`claimed-${interaction.channel.name}`);

    await interaction.message.edit({
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel("Claimed").setEmoji("🛠️").setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId("close_request").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
        )
      ]
    });

    return safeReply(interaction, { content: "✅ Ticket claimed.", ephemeral: true });
  }

  /* ---------- CLOSE REQUEST ---------- */
  if (interaction.customId === "close_request") {
    const data = ticketStore[interaction.channel.id];
    if (!data) return safeReply(interaction, { content: "❌ Ticket data missing.", ephemeral: true });

    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (!isAdmin) {
      if (!data.claimedBy)
        return safeReply(interaction, { content: "❌ Ticket must be claimed first.", ephemeral: true });

      if (interaction.user.id !== data.claimedBy)
        return safeReply(interaction, { content: "❌ Only claimer can close.", ephemeral: true });
    }

    return safeReply(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor("#f1c40f")
          .setTitle("Confirm Close")
          .setDescription("Are you sure you want to close this ticket?")
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("close_yes").setLabel("Yes").setEmoji("✅").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId("close_no").setLabel("Cancel").setEmoji("❌").setStyle(ButtonStyle.Secondary)
        )
      ],
      ephemeral: true
    });
  }

  if (interaction.customId === "close_no")
    return safeReply(interaction, { content: "❌ Close cancelled.", ephemeral: true });

  /* ---------- CLOSE ---------- */
  if (interaction.customId === "close_yes") {

    await interaction.channel.permissionOverwrites.edit(
      interaction.guild.id,
      { SendMessages: false }
    );

    const data = ticketStore[interaction.channel.id];
    const transcript = await createTranscript(interaction.channel, {
      fileName: `${interaction.channel.name}.html`,
      saveImages: true,
      poweredBy: false
    });

    const summary = new EmbedBuilder()
      .setColor("#e74c3c")
      .setTitle("📄 Ticket Transcript Summary")
      .addFields(
        { name: "Opened By", value: `<@${data.opener}>` },
        { name: "Claimed By", value: data.claimedBy ? `<@${data.claimedBy}>` : "Not Claimed" },
        { name: "Closed By", value: `<@${interaction.user.id}>` },
        { name: "Category", value: CATEGORY_NAMES[data.category] },
        { name: "Time", value: `<t:${Math.floor(Date.now()/1000)}:F>` }
      )
      .setFooter({ text: "ZerithMC Tickets" });

    interaction.guild.channels.cache.get(config.logChannelId)?.send({
      embeds: [summary],
      files: [transcript]
    });

    try {
      await interaction.guild.members.fetch(data.opener)
        .then(m => m.send({ embeds: [summary], files: [transcript] }))
        .catch(() => {});
    } catch {}

    await interaction.channel.send({
      embeds: [
        new EmbedBuilder().setColor("#2b2d31").setTitle("ZerithMC Ticket Controls")
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("transcript").setLabel("Transcript").setEmoji("🧾").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("reopen").setLabel("Open").setEmoji("🔓").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("delete").setLabel("Delete").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
        )
      ]
    });
  }

  /* ---------- CONTROLS ---------- */
  if (interaction.customId === "reopen") {
    await interaction.channel.permissionOverwrites.edit(
      interaction.guild.id,
      { SendMessages: true }
    );
    return safeReply(interaction, { content: "🔓 Ticket reopened.", ephemeral: true });
  }

  if (interaction.customId === "delete") {
    return interaction.channel.delete();
  }

  if (interaction.customId === "transcript") {
    const transcript = await createTranscript(interaction.channel, {
      fileName: `${interaction.channel.name}.html`,
      saveImages: true,
      poweredBy: false
    });
    return safeReply(interaction, { files: [transcript], ephemeral: true });
  }
});

/* ================= SAFETY ================= */
process.on("unhandledRejection", err => console.error(err));
process.on("uncaughtException", err => console.error(err));

/* ================= LOGIN ================= */
client.login(process.env.TOKEN);
