"use strict";
// src/bot.ts
// Main Discord bot logic.
//
// When a voting session is finalized, the bot stores the final voting results on Auto-drive
// and posts a message in the thread containing the CID (Content Identifier).
// The `/results` command (invoked from the channel, not from the thread itself) retrieves this CID from the thread's messages,
// downloads the final results from Auto-drive, and returns them to the user.
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const discord_js_1 = require("discord.js");
const blockchain_1 = require("./blockchain");
const utils_1 = require("./utils");
// Load environment variables
const { DISCORD_TOKEN, SUBSTRATE_ENDPOINT, SEED_PHRASE, ROLE_ID, VOTERID_SECRET, VOTING_DURATION } = process.env;
// Parse voting duration (in hours); default is 168 hours (7 days)
const VOTING_DURATION_HOURS = parseInt(VOTING_DURATION || '168', 10);
const BOT_TOKEN = DISCORD_TOKEN || '';
let offlineSince = null;
// Create Discord client with required intents and partials
const client = new discord_js_1.Client({
    intents: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMembers,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.MessageContent
    ],
    partials: [discord_js_1.Partials.Message, discord_js_1.Partials.Channel, discord_js_1.Partials.Reaction]
});
// Define slash commands used by the bot
const commands = [
    new discord_js_1.SlashCommandBuilder()
        .setName('discussion')
        .setDescription('Create a Discussion thread')
        .addStringOption(opt => opt.setName('subject').setDescription('Subject').setRequired(true)),
    new discord_js_1.SlashCommandBuilder()
        .setName('proposal')
        .setDescription('Create a Proposal thread (time-limited by VOTING_DURATION)')
        .addStringOption(opt => opt.setName('subject').setDescription('Subject').setRequired(true)),
    new discord_js_1.SlashCommandBuilder()
        .setName('vote')
        .setDescription('Create a Voting thread (time-limited by VOTING_DURATION)')
        .addStringOption(opt => opt.setName('subject').setDescription('Subject').setRequired(true)),
    new discord_js_1.SlashCommandBuilder()
        .setName('myvotetoken')
        .setDescription('Get your VoteToken'),
    new discord_js_1.SlashCommandBuilder()
        .setName('results')
        .setDescription('Retrieve final voting results (only for finished threads)')
        .addStringOption(opt => opt.setName('threadref').setDescription('Thread name or ID').setRequired(true)),
    new discord_js_1.SlashCommandBuilder()
        .setName('help')
        .setDescription('List bot commands')
].map(c => c.toJSON());
/**
 * Register slash commands with Discord.
 *
 * @param guildId - (Optional) Guild ID to register commands for a specific server.
 */
async function registerCommands(guildId) {
    const rest = new discord_js_1.REST({ version: '10' }).setToken(BOT_TOKEN);
    if (!guildId) {
        await rest.put(discord_js_1.Routes.applicationCommands(client.user?.id || ''), { body: commands });
    }
    else {
        await rest.put(discord_js_1.Routes.applicationGuildCommands(client.user?.id || '', guildId), { body: commands });
    }
}
// Save offline timestamp on exit
process.on('beforeExit', () => (0, utils_1.storeOfflineTimestamp)());
process.on('SIGINT', () => {
    (0, utils_1.storeOfflineTimestamp)();
    process.exit(0);
});
// When the bot is ready, initialize connections and register commands.
client.once('ready', async () => {
    console.log(`Bot started as ${client.user?.tag}`);
    offlineSince = (0, utils_1.readOfflineTimestamp)();
    await registerCommands();
    await (0, blockchain_1.initChain)(SUBSTRATE_ENDPOINT || '', SEED_PHRASE || '');
    await (0, blockchain_1.initDrive)();
    await checkActiveThreads();
});
/**
 * Check all active threads in all guilds.
 * For each thread that is a proposal or voting thread and is expired,
 * the bot sends a final message, stores results on Auto-drive, posts the CID,
 * marks the thread as finalized, and locks the thread.
 */
async function checkActiveThreads() {
    const guilds = client.guilds.cache;
    for (const [_, guild] of guilds) {
        if (!guild)
            continue;
        await guild.members.fetch();
        const channels = await guild.channels.fetch();
        for (const [, chData] of channels) {
            if (!chData)
                continue;
            if (chData.type === discord_js_1.ChannelType.GuildText) {
                const textCh = chData;
                const activeThreads = await textCh.threads.fetchActive();
                activeThreads.threads.forEach(async (thread) => {
                    // Process only threads with prefix "P:" or "V:" (proposal or voting threads)
                    if (!thread.name.startsWith('P:') && !thread.name.startsWith('V:'))
                        return;
                    if (thread.locked || thread.archived || (0, utils_1.isThreadFinalized)(thread.id))
                        return;
                    if ((0, utils_1.isExpiredThread)(thread, VOTING_DURATION_HOURS)) {
                        // Send final message and store results on Auto-drive
                        await thread.send("Voting completed. Thread has been successfully locked.");
                        const cid = await (0, blockchain_1.storeVotingResultsOnChain)({
                            votingThreadId: thread.id,
                            dateOfCreating: (thread.createdAt ?? new Date()).toISOString(),
                            fullThreadName: thread.name,
                            eligibleCount: getRoleMembers(guild).size,
                            allEligibleMembers: Array.from(getRoleMembers(guild).values()).map(m => `${m.user.tag} (${m.id})`),
                            votes: 'unknown final votes (not parsed here)',
                            missedDeadline: true,
                            votingFinished: true
                        });
                        // Post a message with the CID in the thread
                        await thread.send(`Voting results have been uploaded to Auto-drive. CID: ${cid}`);
                        (0, utils_1.markThreadFinalized)(thread.id);
                        await (0, utils_1.lockThread)(thread);
                    }
                });
            }
        }
    }
}
// Handle slash commands
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand())
        return;
    const { commandName } = interaction;
    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({ content: 'No guild.', ephemeral: true });
        return;
    }
    if (commandName === 'discussion') {
        // Create a discussion thread without expiration.
        const subject = interaction.options.getString('subject', true);
        const name = `D:${subject}`;
        const thr = await createThread(interaction, name);
        if (!thr) {
            await interaction.reply({ content: 'Error while creating thread.', ephemeral: true });
            return;
        }
        await interaction.reply({ content: `Discussion thread created: ${thr.name}`, ephemeral: true });
    }
    if (commandName === 'proposal') {
        // Create a proposal thread with expiration.
        await guild.members.fetch();
        const subject = interaction.options.getString('subject', true);
        const expStr = (0, utils_1.formatExpirationDate)(new Date(), VOTING_DURATION_HOURS);
        const name = `P:${expStr}: ${subject}`;
        const thr = await createThread(interaction, name);
        if (!thr) {
            await interaction.reply({ content: 'Error while creating proposal thread.', ephemeral: true });
            return;
        }
        await thr.send(`Ping: <@&${ROLE_ID}>`);
        await interaction.reply({ content: `Proposal thread created: ${thr.name}`, ephemeral: true });
    }
    if (commandName === 'vote') {
        // Create a voting thread with expiration.
        await guild.members.fetch();
        const subject = interaction.options.getString('subject', true);
        const expStr = (0, utils_1.formatExpirationDate)(new Date(), VOTING_DURATION_HOURS);
        const name = `V:${expStr}: ${subject}`;
        const thr = await createThread(interaction, name);
        if (!thr) {
            await interaction.reply({ content: 'Error while creating voting thread.', ephemeral: true });
            return;
        }
        // Create voting interface buttons
        const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder().setCustomId('vote_for').setLabel('FOR').setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder().setCustomId('vote_against').setLabel('AGAINST').setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder().setCustomId('vote_abstain').setLabel('ABSTAIN').setStyle(discord_js_1.ButtonStyle.Secondary));
        const mems = getRoleMembers(guild);
        const tokens = [];
        // Generate a vote token for each eligible member
        mems.forEach(m => {
            const tk = (0, utils_1.generateVoteToken)(m.id, thr.id, VOTERID_SECRET || '');
            tokens.push(tk);
        });
        // Send a message with thread ID, mention role and voting buttons
        await thr.send({ content: `ThreadID: ${thr.id}\n<@&${ROLE_ID}>`, components: [row] });
        // Send initial progress message with spoiler formatting
        const content2 = `Voting progress: ||FOR: 0 | AGAINST: 0 | ABSTAIN: 0||\nVoting tokens left: ${tokens.join(', ')}`;
        await thr.send(content2);
        await interaction.reply({ content: `Voting thread created: ${thr.name}`, ephemeral: true });
    }
    if (commandName === 'myvotetoken') {
        // Return the vote token for the user in the current thread.
        const thr = interaction.channel;
        if (!thr || thr.type !== discord_js_1.ChannelType.PublicThread) {
            await interaction.reply({ content: 'This command only works in a thread.', ephemeral: true });
            return;
        }
        const vt = (0, utils_1.generateVoteToken)(interaction.user.id, thr.id, VOTERID_SECRET || '');
        await interaction.reply({ content: `Your VoteToken: ${vt}`, ephemeral: true });
    }
    if (commandName === 'results') {
        try {
            // This command is invoked from the main channel.
            // It looks for the CID in the thread messages and retrieves final results from Auto-drive.
            const ref = interaction.options.getString('threadref', true);
            const thr = await findThreadByRef(interaction, ref);
            if (!thr) {
                await interaction.reply({ content: 'Thread not found. Invoke `/results` only from main chat!', ephemeral: true });
                return;
            }
            // Ensure thread is finished
            if (!thr.locked) {
                await interaction.reply({ content: 'Voting is still in progress! Results will be available after it ends!', ephemeral: true });
                return;
            }
            // Fetch the last 50 messages from the thread to find the CID
            const messages = await thr.messages.fetch({ limit: 50 });
            let cid = null;
            messages.forEach(msg => {
                const match = msg.content.match(/CID:\s*([^\s]+)/);
                if (match) {
                    cid = match[1];
                }
            });
            if (!cid) {
                await interaction.reply({ content: 'CID not found in thread messages.', ephemeral: true });
                return;
            }
            // Retrieve final voting results from Auto-drive using the CID
            const results = await (0, blockchain_1.retrieveVotingResults)(cid);
            const replyText = `Final Results (retrieved from Auto-drive):\n` +
                `Thread: ${results.fullThreadName}\n` +
                `Date of creating: ${results.dateOfCreating}\n` +
                `Number of participants: ${results.eligibleCount}\n` +
                `Participants: ${results.allEligibleMembers.join(', ')}\n` +
                `Votes: ${results.votes}\n` +
                `Deadline missed: ${results.missedDeadline ? 'Yes' : 'No'}\n` +
                `Voting finished: ${results.votingFinished ? 'Yes' : 'No'}`;
            await interaction.reply({ content: replyText, ephemeral: false });
        }
        catch (err) {
            // try and log "Unknown interaction"
            console.error('Error in /results command:', err);
            // Optionally try a final error reply (in case the interaction is still valid)
            try {
                if (interaction.isRepliable()) {
                    await interaction.reply({ content: `Error retrieving results from Auto-drive: ${err}`, ephemeral: true });
                }
            }
            catch (e2) {
                // If cannot reply anymore, just ignore to prevent a crash
                console.error('Could not reply with error (interaction invalid).', e2);
            }
        }
    }
    if (commandName === 'help') {
        // Display a list of available commands.
        const msg = `Commands:
    /discussion <subject>
    /proposal <subject>
    /vote <subject>
    /myVoteToken
    /results <threadName|threadID>
    /help`;
        await interaction.reply({ content: msg, ephemeral: true });
    }
});
// Button interaction handler: processes vote button clicks.
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton())
        return;
    const buttonInteraction = interaction;
    const { customId } = buttonInteraction;
    const thread = buttonInteraction.channel;
    if (!thread || thread.type !== discord_js_1.ChannelType.PublicThread)
        return;
    if (thread.locked || thread.archived)
        return;
    if ((0, utils_1.isExpiredThread)(thread, VOTING_DURATION_HOURS)) {
        await (0, utils_1.lockThread)(thread);
        return;
    }
    // Get the progress message that holds current vote counts and remaining tokens.
    const pm = await findProgressMessage(thread);
    if (!pm) {
        await buttonInteraction.reply({ content: 'No voting data found in this thread.', ephemeral: true });
        return;
    }
    // Parse the progress message to extract current counts and tokens left.
    let forCount = 0, againstCount = 0, abstainCount = 0;
    let tokensLeft = [];
    {
        const lines = pm.content.split('\n');
        for (const line of lines) {
            if (line.startsWith('Voting progress:')) {
                const raw = line.replace('Voting progress:', '').replace(/\|/g, '').trim();
                const parts = raw.split('  ');
                if (parts.length >= 3) {
                    forCount = parseInt(parts[0].replace('FOR:', '').trim()) || 0;
                    againstCount = parseInt(parts[1].replace('AGAINST:', '').trim()) || 0;
                    abstainCount = parseInt(parts[2].replace('ABSTAIN:', '').trim()) || 0;
                }
            }
            else if (line.startsWith('Voting tokens left:')) {
                const leftover = line.replace('Voting tokens left:', '').trim();
                tokensLeft = leftover.split(',').map(x => x.trim()).filter(x => x);
            }
        }
    }
    // Generate a vote token for the user.
    const token = (0, utils_1.generateVoteToken)(buttonInteraction.user.id, thread.id, VOTERID_SECRET || '');
    if (!tokensLeft.includes(token)) {
        await buttonInteraction.reply({ content: 'You are either not eligible or have already used your token!', ephemeral: true });
        return;
    }
    // Update vote counts based on the button pressed.
    if (customId === 'vote_for')
        forCount++;
    if (customId === 'vote_against')
        againstCount++;
    if (customId === 'vote_abstain')
        abstainCount++;
    // Remove the user's token from the list so it cannot be reused.
    const newLeft = tokensLeft.filter(t => t !== token);
    const guild = buttonInteraction.guild;
    let totalMems = 0;
    if (guild) {
        totalMems = getRoleMembers(guild).size;
    }
    const totalVotes = forCount + againstCount + abstainCount;
    const finished = (0, utils_1.isVotingFinished)(totalVotes, totalMems, false);
    // Update the progress message with new counts.
    const newContent = `Voting progress: ||FOR: ${forCount} | AGAINST: ${againstCount} | ABSTAIN: ${abstainCount}||\n` +
        `Voting tokens left: ${newLeft.join(', ')}`;
    await pm.edit({ content: newContent });
    if (finished) {
        // If this vote completes the voting session, record final results.
        await buttonInteraction.reply({ content: `Your vote is recorded. This was the final vote.`, ephemeral: true });
        if (!(0, utils_1.isThreadFinalized)(thread.id)) {
            try {
                if (guild) {
                    const mems = getRoleMembers(guild);
                    const allEligible = mems.map(m => `${m.user.tag} (${m.id})`);
                    const payload = {
                        votingThreadId: thread.id,
                        dateOfCreating: (thread.createdAt ?? new Date()).toISOString(),
                        fullThreadName: thread.name,
                        eligibleCount: mems.size,
                        allEligibleMembers: allEligible,
                        votes: `FOR: ${forCount}, AGAINST: ${againstCount}, ABSTAIN: ${abstainCount}`,
                        missedDeadline: false,
                        votingFinished: true
                    };
                    const cid = await (0, blockchain_1.storeVotingResultsOnChain)(payload);
                    // Post the CID in the thread so that it can be retrieved later.
                    await thread.send(`Voting results have been uploaded to Auto-drive. CID: ${cid}`);
                }
            }
            catch (err) {
                console.error('Error storing final results on drive:', err);
                await thread.send(`Could not store final results on drive: ${err}`);
            }
            (0, utils_1.markThreadFinalized)(thread.id);
        }
        await thread.send('Voting complete. Results saved to Auto-drive and available via `/results <ThreadID>` command (not inside threads).');
        await (0, utils_1.lockThread)(thread);
        return;
    }
    else {
        await buttonInteraction.reply({ content: `Your vote is recorded. Token: ${token}`, ephemeral: true });
    }
});
// Handler for thread updates to enforce thread naming and locking policies.
client.on('threadUpdate', async (oldThread, newThread) => {
    if (oldThread.name.startsWith('V:') && !newThread.name.startsWith('V:')) {
        try {
            await newThread.setName(oldThread.name);
        }
        catch { }
    }
    if (oldThread.archived && !newThread.archived) {
        if (newThread.name.startsWith('V:') && (0, utils_1.isExpiredThread)(newThread, VOTING_DURATION_HOURS)) {
            await (0, utils_1.lockThread)(newThread);
        }
    }
});
/**
 * Create a new thread in the channel.
 *
 * @param interaction - The chat input command interaction.
 * @param name - The desired thread name.
 * @returns The created ThreadChannel or null if creation fails.
 */
async function createThread(interaction, name) {
    const channel = interaction.channel;
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
        return null;
    return channel.threads.create({
        name,
        autoArchiveDuration: 10080
    });
}
/**
 * Find a thread by its name or ID.
 *
 * @param interaction - The command interaction.
 * @param ref - The thread name or ID.
 * @returns The found ThreadChannel or null.
 */
async function findThreadByRef(interaction, ref) {
    const ch = interaction.channel;
    if (!ch || ch.type !== discord_js_1.ChannelType.GuildText)
        return null;
    const textCh = ch;
    const active = await textCh.threads.fetchActive();
    let found = null;
    active.threads.forEach(t => {
        if (t.id === ref || t.name === ref)
            found = t;
    });
    if (!found) {
        const archived = await textCh.threads.fetchArchived();
        archived.threads.forEach(t => {
            if (t.id === ref || t.name === ref)
                found = t;
        });
    }
    return found;
}
/**
 * Find the bot's progress message in a thread.
 *
 * @param thread - The Discord thread channel.
 * @returns The progress Message or null if not found.
 */
async function findProgressMessage(thread) {
    const msgs = await thread.messages.fetch({ limit: 50 });
    return msgs.find(m => m.content.includes('Voting progress:') && m.author.id === client.user?.id) || null;
}
/**
 * Return the collection of guild members that have the role specified by ROLE_ID.
 *
 * @param guild - The Discord guild.
 * @returns A Collection of GuildMember.
 */
function getRoleMembers(guild) {
    const role = guild.roles.cache.get(ROLE_ID || '');
    if (!role)
        return new discord_js_1.Collection();
    return role.members;
}
client.login(BOT_TOKEN);
