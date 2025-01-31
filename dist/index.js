"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// File: src/index.ts
const discord_js_1 = require("discord.js");
const dotenv_1 = require("dotenv");
const dayjs_1 = __importDefault(require("dayjs"));
const crypto_1 = __importDefault(require("crypto"));
const api_1 = require("@polkadot/api");
(0, dotenv_1.config)();
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SUBSTRATE_ENDPOINT = process.env.SUBSTRATE_ENDPOINT;
const SEED_PHRASE = process.env.SEED_PHRASE;
const ROLE_ID = process.env.ROLE_ID;
const VOTERID_SECRET = process.env.VOTERID_SECRET;
const client = new discord_js_1.Client({
    intents: [discord_js_1.GatewayIntentBits.Guilds, discord_js_1.GatewayIntentBits.GuildMessages],
});
let blockchainApi;
// Helper: Generate VoteToken
const generateVoteToken = (userId, threadId) => {
    const hash = crypto_1.default
        .createHmac('sha256', VOTERID_SECRET)
        .update(userId + threadId)
        .digest('hex');
    return hash.slice(0, 8); // Shorten to 8 characters
};
// Helper: Update Progress Message
const updateProgressMessage = async (thread, voteCounters, remainingTokens) => {
    const progressContent = `**Vote Progress:**
✅ FOR: ${voteCounters.FOR}
❌ AGAINST: ${voteCounters.AGAINST}
⚪ ABSTAIN: ${voteCounters.ABSTAIN}

**Remaining Participants:** ${remainingTokens.join(', ')}`;
    const messages = await thread.messages.fetch();
    const progressMessage = messages.find((msg) => msg.content.startsWith('**Vote Progress:**'));
    if (progressMessage) {
        await progressMessage.edit(progressContent);
    }
    else {
        await thread.send(progressContent);
    }
};
// Command Handlers
const commands = [
    {
        data: new discord_js_1.SlashCommandBuilder()
            .setName('discussion')
            .setDescription('Create a discussion thread.')
            .addStringOption((option) => option.setName('subject').setDescription('Subject of the discussion').setRequired(true)),
        execute: async (interaction) => {
            const subject = interaction.options.get('subject')?.value;
            const threadName = `D:${subject}`;
            const thread = await interaction.channel?.threads.create({
                name: threadName,
                autoArchiveDuration: 1440,
            });
            await interaction.reply({
                content: `Discussion thread created: ${threadName}`,
                ephemeral: true,
            });
        },
    },
    {
        data: new discord_js_1.SlashCommandBuilder()
            .setName('proposal')
            .setDescription('Create a proposal thread.')
            .addStringOption((option) => option.setName('subject').setDescription('Subject of the proposal').setRequired(true)),
        execute: async (interaction) => {
            const subject = interaction.options.get('subject')?.value;
            const expirationDate = (0, dayjs_1.default)().add(7, 'day').format('YYYY-MM-DD');
            const threadName = `P:${expirationDate}: ${subject}`;
            const thread = await interaction.channel?.threads.create({
                name: threadName,
                autoArchiveDuration: 10080,
            });
            const role = interaction.guild?.roles.cache.get(ROLE_ID);
            await thread?.send(`${role}, a new proposal thread has been created: ${threadName}`);
            await interaction.reply({
                content: `Proposal thread created: ${threadName}`,
                ephemeral: true,
            });
        },
    },
    {
        data: new discord_js_1.SlashCommandBuilder()
            .setName('vote')
            .setDescription('Create a voting thread.')
            .addStringOption((option) => option.setName('subject').setDescription('Subject of the vote').setRequired(true)),
        execute: async (interaction) => {
            const subject = interaction.options.get('subject')?.value;
            const expirationDate = (0, dayjs_1.default)().add(7, 'day').format('YYYY-MM-DD');
            const threadName = `V:${expirationDate}: ${subject}`;
            const thread = await interaction.channel?.threads.create({
                name: threadName,
                autoArchiveDuration: 10080,
            });
            const role = interaction.guild?.roles.cache.get(ROLE_ID);
            const members = role?.members.map((member) => member.user.id) || [];
            const voteTokens = members.map((userId) => generateVoteToken(userId, thread.id));
            const voteCounters = { FOR: 0, AGAINST: 0, ABSTAIN: 0 };
            await thread?.send(`${role}, please participate in the voting:`);
            await thread?.send(`✅ FOR
❌ AGAINST
⚪ ABSTAIN`);
            await updateProgressMessage(thread, voteCounters, voteTokens);
            await interaction.reply({
                content: `Voting thread created: ${threadName}`,
                ephemeral: true,
            });
        },
    },
];
// Initialize Discord Bot
client.once('ready', async () => {
    console.log('Bot is online!');
    const wsProvider = new api_1.WsProvider(SUBSTRATE_ENDPOINT);
    blockchainApi = await api_1.ApiPromise.create({ provider: wsProvider });
});
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand())
        return;
    const command = commands.find((cmd) => cmd.data.name === interaction.commandName);
    if (!command)
        return;
    try {
        await command.execute(interaction);
    }
    catch (error) {
        console.error(error);
        await interaction.reply({
            content: 'There was an error executing this command.',
            ephemeral: true,
        });
    }
});
client.login(DISCORD_TOKEN);
