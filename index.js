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

dotenv.config();

/* ================= CONFIG ================= */
const STAFF_ROLE_ID = "1411726484954939572";
const CONFIG_FILE = "./ticketConfig.json";
const COUNTER_FILE = "./ticketCounter.json";
const TICKETS_FILE = "./tickets.json";

const CATEGORIES = {
  general: "General Support",
  partner: "Partnership Request",
  report: "User Report",
  store: "Store / Purchases",
  appeal: "Appeal"
};

/* ================= LOAD DATA ================= */
let config = fs.existsSync(CONFIG_FILE)
  ? JSON.parse(fs.readFileSync(CONFIG_FILE))
  : { categoryId: null, logChannelId: null };

let counter = fs.existsSync(COUNTER_FILE)
  ? JSON.parse(fs.readFileSync(COUNTER_FILE)).counter
  : 1;

let tickets = fs.existsSync(TICKETS_FILE)
  ? JSON.parse(fs.readFileSync(TICKETS_FILE))
  : {};

const saveConfig = () =>
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
const saveCounter = () =>
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ counter }, null, 2));
const saveTickets = () =>
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));

/* ================= HELPERS ================= */
const isAdmin = (m) =>
  m.permissions.has(PermissionsBitField.Flags.Administrator);

const isStaffOrAdmin = (i) =>
  i.member.roles.cache.has(STAFF_ROLE_ID) || isAdmin(i.member);

async function safeReply(i, data) {
  if (i.replied || i.deferred) return i.followUp(data).catch(() => {});
  return i.reply(data).catch(() => {});
}

/* ================= TRANSCRIPT (TXT) ================= */
async function createTranscript(channel, data, closedBy) {
  const msgs = await channel.messages.fetch({ limit: 100 });
  const ordered = [...msgs.values()].reverse();

  let txt = `ZerithMC Ticket Transcript
==============================

Server     : ${channel.guild.name}
Channel    : ${channel.name}
Opened By  : <@${data.opener}>
Category   : ${CATEGORIES[data.category]}
Claimed By : ${data.claimedBy ? `<@${data.claimedBy}>` : "Not Claimed"}
Closed By  : ${closedBy}
Time       : ${new Date().toLocaleString()}

-----------------------------------

`;

  for (const m of ordered) {
    if (m.author.bot) continue;
    txt += `[${m.createdAt.toLocaleTimeString()}] ${m.author.username}: ${m.content || "[Attachment]"}\n`;
  }

  return {
    attachment: Buffer.from(txt, "utf8"),
    name: `${channel.name}-transcript.txt`
  };
}

/* ================= WEB ================= */
const app = express();
app.get("/", (_, r) => r.send("ZerithMC Ticket Bot Online"));
app.listen(3000);

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

/* ================= SLASH COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Setup ticket system")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption(o =>
      o.setName("category").setDescription("Ticket category").setRequired(true))
    .addChannelOption(o =>
      o.setName("log").setDescription("Log channel").setRequired(true)),

  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Send ticket panel")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
];

/* ================= READY ================= */
client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands.map(c => c.toJSON()) }
  );
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async interaction => {

  /* ---------- SLASH ---------- */
  if (interaction.isChatInputCommand()) {

    if (!isAdmin(interaction.member))
      return safeReply(interaction, { content: "❌ Admin only.", ephemeral: true });

    if (interaction.commandName === "setup") {
      config.categoryId = interaction.options.getChannel("category").id;
      config.logChannelId = interaction.options.getChannel("log").id;
      saveConfig();
      return safeReply(interaction, { content: "✅ Ticket system configured.", ephemeral: true });
    }

    if (interaction.commandName === "panel") {
      const embed = new EmbedBuilder()
        .setTitle("🎫 ZerithMC Support Tickets")
        .setColor("#ff0000")
        .setDescription(
`📜 **Ticket Rules**
• Genuine issues only
• No spam
• Be patient
• Provide proof if needed
• Respect staff

Select a ticket type below.`
        );

      return safeReply(interaction, {
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("general").setLabel("General").setEmoji("💬").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("partner").setLabel("Partnership").setEmoji("🤝").setStyle(ButtonStyle.Success)
          ),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("report").setLabel("Report").setEmoji("🚨").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("store").setLabel("Store").setEmoji("🛒").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("appeal").setLabel("Appeal").setEmoji("📩").setStyle(ButtonStyle.Secondary)
          )
        ]
      });
    }
  }

  /* ---------- CREATE TICKET ---------- */
  if (interaction.isButton() && CATEGORIES[interaction.customId]) {
    const ch = await interaction.guild.channels.create({
      name: `ticket-${counter}`,
      type: ChannelType.GuildText,
      parent: config.categoryId,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ]
    });

    tickets[ch.id] = {
      opener: interaction.user.id,
      category: interaction.customId,
      claimedBy: null,
      status: "open"
    };
    saveTickets();
    counter++; saveCounter();

    await safeReply(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor("#2ecc71")
          .setDescription(`✅ Your ticket has been created: ${ch}`)
      ],
      ephemeral: true
    });

    await ch.send({
      embeds: [
        new EmbedBuilder()
          .setDescription(`Hello <@${interaction.user.id}>, please describe your issue.`)
          .setFooter({ text: "ZerithMC Tickets" })
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("claim").setLabel("Claim").setEmoji("🛠️").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger)
        )
      ]
    });
  }

  /* ---------- CLAIM ---------- */
  if (interaction.isButton() && interaction.customId === "claim") {
    const data = tickets[interaction.channel.id];
    if (!data) return safeReply(interaction, { content: "❌ Ticket data missing.", ephemeral: true });
    if (!interaction.member.roles.cache.has(STAFF_ROLE_ID))
      return safeReply(interaction, { content: "❌ Staff only.", ephemeral: true });
    if (data.claimedBy)
      return safeReply(interaction, { content: "❌ Already claimed.", ephemeral: true });

    data.claimedBy = interaction.user.id;
    saveTickets();

    await interaction.channel.setName(`claimed-${interaction.channel.name}`);

    await interaction.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor("#f1c40f")
          .setDescription(`🛠️ This ticket will be handled by <@${interaction.user.id}>`)
      ]
    });

    return safeReply(interaction, { content: "✅ Ticket claimed.", ephemeral: true });
  }

  /* ---------- CLOSE CONFIRM ---------- */
  if (interaction.isButton() && interaction.customId === "close") {
    const data = tickets[interaction.channel.id];
    if (!data) return safeReply(interaction, { content: "❌ Ticket data missing.", ephemeral: true });

    if (!(interaction.user.id === data.claimedBy || isAdmin(interaction.member)))
      return safeReply(interaction, { content: "❌ Only claimer or admin can close.", ephemeral: true });

    return safeReply(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor("#e67e22")
          .setDescription("⚠️ Are you sure you want to close this ticket?")
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("confirm_close").setLabel("Confirm").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId("cancel_close").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
        )
      ],
      ephemeral: true
    });
  }

  if (interaction.isButton() && interaction.customId === "confirm_close") {
    const data = tickets[interaction.channel.id];
    data.status = "closed";
    saveTickets();

    await interaction.channel.setName(`closed-${interaction.channel.name}`);

    return interaction.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor("#e74c3c")
          .setDescription("🔒 Ticket closed.")
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("transcript").setLabel("Transcript").setEmoji("🧾").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("reopen").setLabel("Reopen").setEmoji("🔓").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("delete").setLabel("Delete").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
        )
      ]
    });
  }

  if (interaction.isButton() && interaction.customId === "cancel_close") {
    return safeReply(interaction, { content: "❌ Close cancelled.", ephemeral: true });
  }

  /* ---------- TRANSCRIPT ---------- */
  if (interaction.isButton() && interaction.customId === "transcript") {
    if (!isStaffOrAdmin(interaction))
      return safeReply(interaction, { content: "❌ Staff only.", ephemeral: true });

    const data = tickets[interaction.channel.id];
    const file = await createTranscript(interaction.channel, data, interaction.user.username);
    return safeReply(interaction, { files: [file], ephemeral: true });
  }

  /* ---------- REOPEN ---------- */
  if (interaction.isButton() && interaction.customId === "reopen") {
    if (!isStaffOrAdmin(interaction))
      return safeReply(interaction, { content: "❌ Staff only.", ephemeral: true });

    const data = tickets[interaction.channel.id];
    data.status = "open";
    data.claimedBy = null;
    saveTickets();

    await interaction.channel.setName(interaction.channel.name.replace("closed-", "ticket-"));
    return interaction.channel.send("🔓 Ticket reopened.");
  }

  /* ---------- DELETE (5s TIMER) ---------- */
  if (interaction.isButton() && interaction.customId === "delete") {
    if (!isStaffOrAdmin(interaction))
      return safeReply(interaction, { content: "❌ Staff only.", ephemeral: true });

    await interaction.channel.send("🗑️ Ticket will be deleted in **5 seconds**…");

    setTimeout(async () => {
      const data = tickets[interaction.channel.id];
      const file = await createTranscript(interaction.channel, data, interaction.user.username);

      interaction.guild.channels.cache
        .get(config.logChannelId)
        ?.send({ files: [file] });

      delete tickets[interaction.channel.id];
      saveTickets();
      await interaction.channel.delete();
    }, 5000);
  }
});

/* ================= SAFETY ================= */
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

/* ================= LOGIN ================= */
client.login(process.env.TOKEN);
