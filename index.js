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

const CATEGORY_MESSAGES = {
  general: "Please clearly explain your support issue.",
  partner: "Please provide partnership details, platform and audience size.",
  report: "Please provide proof (screenshots/videos) and full details.",
  store: "Please provide order ID or payment proof.",
  appeal: "Please explain why you believe this punishment should be appealed."
};

/* ================= LOAD / SAVE ================= */
let config = fs.existsSync(CONFIG_FILE)
  ? JSON.parse(fs.readFileSync(CONFIG_FILE))
  : { categoryId: null, logChannelId: null };

let counter = fs.existsSync(COUNTER_FILE)
  ? JSON.parse(fs.readFileSync(COUNTER_FILE)).counter
  : 1;

let tickets = fs.existsSync(TICKETS_FILE)
  ? JSON.parse(fs.readFileSync(TICKETS_FILE))
  : {};

const saveConfig = () => fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
const saveCounter = () => fs.writeFileSync(COUNTER_FILE, JSON.stringify({ counter }, null, 2));
const saveTickets = () => fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));

/* ================= HELPERS ================= */
const isAdmin = (m) => m.permissions.has(PermissionsBitField.Flags.Administrator);
const isStaffOrAdmin = (i) =>
  i.member.roles.cache.has(STAFF_ROLE_ID) || isAdmin(i.member);

async function safeReply(i, data) {
  if (i.replied || i.deferred) return i.followUp(data).catch(() => {});
  return i.reply(data).catch(() => {});
}

function sendLog(guild, embed, file = null) {
  const ch = guild.channels.cache.get(config.logChannelId);
  if (!ch) return;
  return file
    ? ch.send({ embeds: [embed], files: [file] })
    : ch.send({ embeds: [embed] });
}

async function sendTranscriptToUser(userId, file) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({
      content: "📄 Your ticket has been closed. Here is the transcript:",
      files: [file]
    });
  } catch {}
}

/* ================= TRANSCRIPT ================= */
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

----------------------------------

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
    .addChannelOption(o => o.setName("category").setDescription("Ticket category").setRequired(true))
    .addChannelOption(o => o.setName("log").setDescription("Log channel").setRequired(true)),
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Send ticket panel")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
];

/* ================= READY ================= */
client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), {
    body: commands.map(c => c.toJSON())
  });
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
      return safeReply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor("#9b59b6")
            .setTitle("🎫 ZerithMC Support Tickets")
            .setDescription(`
📜 **Ticket Rules**
• Genuine issues only  
• No spam or trolling  
• Be patient with staff  
• Provide proof if required  
• Respect staff decisions  

Select a category below to open a ticket.
`)
        ],
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

    sendLog(interaction.guild,
      new EmbedBuilder()
        .setColor("#2ecc71")
        .setTitle("🎫 Ticket Opened")
        .addFields(
          { name: "User", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Category", value: CATEGORIES[interaction.customId], inline: true },
          { name: "Channel", value: `${ch}`, inline: false }
        )
        .setTimestamp()
    );

    await safeReply(interaction, {
      embeds: [new EmbedBuilder().setColor("#2ecc71").setDescription(`✅ Ticket created: ${ch}`)],
      ephemeral: true
    });

    await ch.send({
      content: `<@${interaction.user.id}> <@&${STAFF_ROLE_ID}>`,
      embeds: [
        new EmbedBuilder()
          .setDescription(CATEGORY_MESSAGES[interaction.customId])
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
    await interaction.message.edit({
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("close")
            .setLabel("Close")
            .setEmoji("🔒")
            .setStyle(ButtonStyle.Danger)
        )
      ]
    });

    await interaction.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor("#f1c40f")
          .setDescription(`🛠️ This ticket will be handled by <@${interaction.user.id}>`)
      ]
    });

    return safeReply(interaction, { content: "✅ Ticket claimed.", ephemeral: true });
  }

  /* ---------- CLOSE ---------- */
  if (interaction.isButton() && interaction.customId === "close") {
    const data = tickets[interaction.channel.id];
    if (!data) return;

    if (!(interaction.user.id === data.claimedBy || isAdmin(interaction.member)))
      return safeReply(interaction, { content: "❌ Only claimer or admin can close.", ephemeral: true });

    data.status = "closed";
    saveTickets();

    await interaction.channel.setName(`closed-${interaction.channel.name}`);

    const transcript = await createTranscript(interaction.channel, data, interaction.user.username);
    await sendTranscriptToUser(data.opener, transcript);

    sendLog(interaction.guild,
      new EmbedBuilder()
        .setColor("#e74c3c")
        .setTitle("🔒 Ticket Closed")
        .addFields(
          { name: "Closed By", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Channel", value: `${interaction.channel}`, inline: false }
        )
        .setTimestamp(),
      transcript
    );

    return interaction.channel.send({
      embeds: [new EmbedBuilder().setColor("#e74c3c").setDescription("🔒 Ticket closed.")],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("transcript").setLabel("Transcript").setEmoji("🧾").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("reopen").setLabel("Reopen").setEmoji("🔓").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("delete").setLabel("Delete").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
        )
      ]
    });
  }

  /* ---------- TRANSCRIPT ---------- */
  if (interaction.isButton() && interaction.customId === "transcript") {
    if (!isStaffOrAdmin(interaction)) return;
    const data = tickets[interaction.channel.id];
    if (!data) return;
    const file = await createTranscript(interaction.channel, data, interaction.user.username);
    return safeReply(interaction, { files: [file], ephemeral: true });
  }

  
/* ---------- REOPEN ---------- */
if (interaction.isButton() && interaction.customId === "reopen") {
  if (!isStaffOrAdmin(interaction)) return;

  await interaction.deferUpdate(); // ✅ prevents "interaction failed"

  const data = tickets[interaction.channel.id];
  if (!data) return;

  data.status = "open";
  data.claimedBy = null;
  saveTickets();

  let name = interaction.channel.name;

  // ✅ handle ALL cases
  name = name
    .replace("closed-", "")
    .replace("claimed-", "");

  await interaction.channel.setName(`ticket-${name.split("ticket-").pop()}`);

  await interaction.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor("#2ecc71")
        .setDescription("🔓 **Ticket has been reopened.")
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("claim")
          .setLabel("Claim")
          .setEmoji("🛠️")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("close")
          .setLabel("Close")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Danger)
      )
    ]
  });
}


  /* ---------- DELETE ---------- */
  if (interaction.isButton() && interaction.customId === "delete") {
    if (!isStaffOrAdmin(interaction)) return;

    await interaction.channel.send("🗑️ Ticket will be deleted in **5 seconds**…");
    setTimeout(async () => {
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







