"use strict";
// bot.ts
// Main Discord bot logic
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const discord_js_1 = require("discord.js");
const blockchain_1 = require("./blockchain");
const utils_1 = require("./utils");
// .env
const { DISCORD_TOKEN, SUBSTRATE_ENDPOINT, SEED_PHRASE, ROLE_ID, VOTERID_SECRET, VOTING_DURATION } = process.env;
// parse duration (in hours), default 168
const VOTING_DURATION_HOURS = parseInt(VOTING_DURATION || '168', 10);
const BOT_TOKEN = DISCORD_TOKEN || '';
let offlineSince = null;
const client = new discord_js_1.Client({
    intents: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMembers,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.MessageContent
    ],
    partials: [discord_js_1.Partials.Message, discord_js_1.Partials.Channel, discord_js_1.Partials.Reaction]
});
const commands = [
    new discord_js_1.SlashCommandBuilder()
        .setName('discussion')
        .setDescription('Create a Discussion thread')
        .addStringOption((opt) => opt.setName('subject').setDescription('Subject').setRequired(true)),
    new discord_js_1.SlashCommandBuilder()
        .setName('proposal')
        .setDescription('Create a Proposal thread (time-limited by VOTING_DURATION).')
        .addStringOption((opt) => opt.setName('subject').setDescription('Subject').setRequired(true)),
    new discord_js_1.SlashCommandBuilder()
        .setName('vote')
        .setDescription('Create a Voting thread (time-limited by VOTING_DURATION).')
        .addStringOption((opt) => opt.setName('subject').setDescription('Subject').setRequired(true)),
    new discord_js_1.SlashCommandBuilder()
        .setName('myvotetoken')
        .setDescription('Get your VoteToken'),
    new discord_js_1.SlashCommandBuilder()
        .setName('results')
        .setDescription('Retrieve voting results')
        .addStringOption((opt) => opt.setName('threadref').setDescription('Thread name or ID').setRequired(true)),
    new discord_js_1.SlashCommandBuilder()
        .setName('help')
        .setDescription('List bot commands')
].map((c) => c.toJSON());
async function registerCommands(guildId) {
    const rest = new discord_js_1.REST({ version: '10' }).setToken(BOT_TOKEN);
    if (!guildId) {
        await rest.put(discord_js_1.Routes.applicationCommands(client.user?.id || ''), {
            body: commands
        });
    }
    else {
        await rest.put(discord_js_1.Routes.applicationGuildCommands(client.user?.id || '', guildId), { body: commands });
    }
}
// On process exit, store offline time
process.on('beforeExit', () => (0, utils_1.storeOfflineTimestamp)());
process.on('SIGINT', () => {
    (0, utils_1.storeOfflineTimestamp)();
    process.exit(0);
});
client.once('ready', async () => {
    console.log(`Bot started as ${client.user?.tag}`);
    // read offline timestamp from file
    offlineSince = (0, utils_1.readOfflineTimestamp)();
    await registerCommands();
    await (0, blockchain_1.initChain)(SUBSTRATE_ENDPOINT || '', SEED_PHRASE || '');
    // If you do NOT want background checks, comment out these lines:
    setInterval(() => {
        checkActiveThreads().catch((err) => {
            console.error('Error in checkActiveThreads:', err);
        });
    }, 5 * 60 * 1000);
    await checkActiveThreads();
});
/**
 * Periodically check for expired threads, lock them, store final results if not already stored.
 */
async function checkActiveThreads() {
    const guilds = client.guilds.cache;
    for (const [gId] of guilds) {
        const guild = client.guilds.cache.get(gId);
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
                    // we only process if it's a "P:" or "V:" thread
                    if (!thread.name.startsWith('P:') && !thread.name.startsWith('V:')) {
                        return;
                    }
                    if ((0, utils_1.isThreadFinalized)(thread.id)) {
                        // we've already done final results for this thread
                        return;
                    }
                    if ((0, utils_1.isExpired)(thread.name)) {
                        // lock
                        await (0, utils_1.lockThread)(thread);
                        // mention offline time
                        const nowStr = new Date().toISOString();
                        let msg = `The bot noticed this thread is expired. Locking it now.`;
                        if (offlineSince) {
                            msg = `The bot was offline from ${offlineSince} to ${nowStr} and missed the deadline. Locking this thread.`;
                        }
                        await thread.send(msg);
                        // store final results on chain
                        try {
                            const guildMembers = getRoleMembers(guild);
                            const allEligible = guildMembers.map((m) => `${m.user.tag} (${m.id})`);
                            const payload = {
                                votingThreadId: thread.id,
                                dateOfCreating: (thread.createdAt ?? new Date()).toISOString(),
                                fullThreadName: thread.name,
                                eligibleCount: guildMembers.size,
                                allEligibleMembers: allEligible,
                                votes: 'unknown final votes (not parsed here)',
                                missedDeadline: true,
                                votingFinished: true
                            };
                            await (0, blockchain_1.storeVotingResultsOnChain)(payload);
                        }
                        catch (err) {
                            console.error('Error storing final results on chain:', err);
                            await thread.send(`Could not store final results on chain: ${err}`);
                        }
                        // mark finalized
                        (0, utils_1.markThreadFinalized)(thread.id);
                    }
                });
            }
        }
    }
}
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
        const subject = interaction.options.getString('subject', true);
        const name = `D:${subject}`;
        const thr = await createThread(interaction, name);
        if (!thr) {
            await interaction.reply({
                content: 'Error while creating thread.',
                ephemeral: true
            });
            return;
        }
        await interaction.reply({
            content: `Discussion thread created: ${thr.name}`,
            ephemeral: true
        });
    }
    if (commandName === 'proposal') {
        await guild.members.fetch();
        const subject = interaction.options.getString('subject', true);
        const expStr = (0, utils_1.formatExpirationDate)(new Date(), VOTING_DURATION_HOURS);
        const name = `P:${expStr}: ${subject}`;
        const thr = await createThread(interaction, name);
        if (!thr) {
            await interaction.reply({
                content: 'Error while creating proposal thread.',
                ephemeral: true
            });
            return;
        }
        await thr.send(`Ping: <@&${ROLE_ID}>`);
        await interaction.reply({
            content: `Proposal thread created: ${thr.name}`,
            ephemeral: true
        });
    }
    if (commandName === 'vote') {
        await guild.members.fetch();
        const subject = interaction.options.getString('subject', true);
        const expStr = (0, utils_1.formatExpirationDate)(new Date(), VOTING_DURATION_HOURS);
        const name = `V:${expStr}: ${subject}`;
        const thr = await createThread(interaction, name);
        if (!thr) {
            await interaction.reply({
                content: 'Error while creating voting thread.',
                ephemeral: true
            });
            return;
        }
        const row = new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
            .setCustomId('vote_for')
            .setLabel('FOR')
            .setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder()
            .setCustomId('vote_against')
            .setLabel('AGAINST')
            .setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder()
            .setCustomId('vote_abstain')
            .setLabel('ABSTAIN')
            .setStyle(discord_js_1.ButtonStyle.Secondary));
        const mems = getRoleMembers(guild);
        const tokens = [];
        mems.forEach((m) => {
            const tk = (0, utils_1.generateVoteToken)(m.id, thr.id, VOTERID_SECRET || '');
            tokens.push(tk);
        });
        await thr.send({
            content: `ThreadID: ${thr.id}\n<@&${ROLE_ID}>`,
            components: [row]
        });
        // The progress in the thread under spoiler:
        const content2 = `Voting progress: ||FOR: 0 | AGAINST: 0 | ABSTAIN: 0||\n` +
            `Voting tokens left: ${tokens.join(', ')}`;
        await thr.send(content2);
        await interaction.reply({
            content: `Voting thread created: ${thr.name}`,
            ephemeral: true
        });
    }
    if (commandName === 'myvotetoken') {
        const thr = interaction.channel;
        if (!thr || thr.type !== discord_js_1.ChannelType.PublicThread) {
            await interaction.reply({
                content: 'This command only works in a thread.',
                ephemeral: true
            });
            return;
        }
        const vt = (0, utils_1.generateVoteToken)(interaction.user.id, thr.id, VOTERID_SECRET || '');
        await interaction.reply({ content: `Your VoteToken: ${vt}`, ephemeral: true });
    }
    if (commandName === 'results') {
        const ref = interaction.options.getString('threadref', true);
        const thr = await findThreadByRef(interaction, ref);
        if (!thr) {
            await interaction.reply({ content: 'Thread not found.', ephemeral: true });
            return;
        }
        const expired = (0, utils_1.isExpired)(thr.name);
        const createdAt = (thr.createdAt ?? new Date()).toISOString();
        const mems = getRoleMembers(guild);
        const allEligible = mems.map((m) => `${m.user.tag} (${m.id})`);
        let forCount = 0, againstCount = 0, abstainCount = 0, tokensLeft = [];
        const pm = await findProgressMessage(thr);
        if (pm) {
            const lines = pm.content.split('\n');
            for (const line of lines) {
                if (line.startsWith('Voting progress:')) {
                    // e.g. "Voting progress: ||FOR: 1 | AGAINST: 2 | ABSTAIN: 1||"
                    const raw = line.replace('Voting progress:', '').replace(/\|/g, '').trim();
                    // raw might be "FOR: 1  AGAINST: 2  ABSTAIN: 1"
                    const parts = raw.split('  ');
                    if (parts.length >= 3) {
                        forCount = parseInt(parts[0].replace('FOR:', '').trim()) || 0;
                        againstCount = parseInt(parts[1].replace('AGAINST:', '').trim()) || 0;
                        abstainCount = parseInt(parts[2].replace('ABSTAIN:', '').trim()) || 0;
                    }
                }
                else if (line.startsWith('Voting tokens left:')) {
                    const leftover = line.replace('Voting tokens left:', '').trim();
                    tokensLeft = leftover
                        .split(',')
                        .map((x) => x.trim())
                        .filter((x) => x);
                }
            }
        }
        const totalVotes = forCount + againstCount + abstainCount;
        const finished = (0, utils_1.isVotingFinished)(totalVotes, mems.size, expired);
        const msg = `ID: ${thr.id}\n` +
            `Created at: ${createdAt}\n` +
            `Thread name: ${thr.name}\n` +
            `Total participants: ${mems.size}\n` +
            `Participants: ${allEligible.join(', ')}\n` +
            `FOR: ${forCount} | AGAINST: ${againstCount} | ABSTAIN: ${abstainCount}\n` +
            `Deadline missed: ${expired ? 'Yes' : 'No'}\n` +
            `Voting finished: ${finished ? 'Yes' : 'No'}\n` +
            `Tokens left: ${tokensLeft.join(', ')}`;
        await interaction.reply({ content: msg, ephemeral: false });
    }
    if (commandName === 'help') {
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
// Button clicks
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton())
        return;
    const buttonInteraction = interaction;
    const { customId } = buttonInteraction;
    const thread = buttonInteraction.channel;
    // if the thread is not a public thread, ignore
    if (!thread || thread.type !== discord_js_1.ChannelType.PublicThread)
        return;
    // if thread is locked or archived, do nothing
    if (thread.locked || thread.archived)
        return;
    // if expired => lock, do nothing else
    if ((0, utils_1.isExpired)(thread.name)) {
        await (0, utils_1.lockThread)(thread);
        return;
    }
    const pm = await findProgressMessage(thread);
    if (!pm) {
        // no progress message => can't update
        await buttonInteraction.reply({
            content: 'No voting data found.',
            ephemeral: true
        });
        return;
    }
    // parse existing
    let forCount = 0, againstCount = 0, abstainCount = 0;
    let tokensLeft = [];
    {
        const lines = pm.content.split('\n');
        for (const line of lines) {
            if (line.startsWith('Voting progress:')) {
                const raw = line.replace('Voting progress:', '').trim().replace(/\|/g, '');
                // e.g. "||FOR: 1  AGAINST: 2  ABSTAIN: 0||" -> "FOR: 1  AGAINST: 2  ABSTAIN: 0"
                const parts = raw.split('  ');
                if (parts.length >= 3) {
                    forCount = parseInt(parts[0].replace('FOR:', '').trim()) || 0;
                    againstCount = parseInt(parts[1].replace('AGAINST:', '').trim()) || 0;
                    abstainCount = parseInt(parts[2].replace('ABSTAIN:', '').trim()) || 0;
                }
            }
            else if (line.startsWith('Voting tokens left:')) {
                const leftover = line.replace('Voting tokens left:', '').trim();
                tokensLeft = leftover
                    .split(',')
                    .map((x) => x.trim())
                    .filter((x) => x);
            }
        }
    }
    const token = (0, utils_1.generateVoteToken)(buttonInteraction.user.id, thread.id, VOTERID_SECRET || '');
    if (!tokensLeft.includes(token)) {
        await buttonInteraction.reply({
            content: 'You are either not eligible or already used your token!',
            ephemeral: true
        });
        return;
    }
    if (customId === 'vote_for')
        forCount++;
    if (customId === 'vote_against')
        againstCount++;
    if (customId === 'vote_abstain')
        abstainCount++;
    // remove token
    const newLeft = tokensLeft.filter((t) => t !== token);
    // check if finished
    const guild = buttonInteraction.guild;
    let totalMems = 0;
    if (guild) {
        totalMems = getRoleMembers(guild).size;
    }
    const totalVotes = forCount + againstCount + abstainCount;
    const expired = (0, utils_1.isExpired)(thread.name);
    const finished = (0, utils_1.isVotingFinished)(totalVotes, totalMems, expired);
    const newContent = `Voting progress: ||FOR: ${forCount} | AGAINST: ${againstCount} | ABSTAIN: ${abstainCount}||\n` +
        `Voting tokens left: ${newLeft.join(', ')}`;
    await pm.edit({ content: newContent });
    if (finished) {
        // store final results, lock thread
        if (!(0, utils_1.isThreadFinalized)(thread.id)) {
            // do on-chain
            try {
                if (guild) {
                    const mems = getRoleMembers(guild);
                    const allEligible = mems.map((m) => `${m.user.tag} (${m.id})`);
                    const payload = {
                        votingThreadId: thread.id,
                        dateOfCreating: (thread.createdAt ?? new Date()).toISOString(),
                        fullThreadName: thread.name,
                        eligibleCount: mems.size,
                        allEligibleMembers: allEligible,
                        votes: `FOR: ${forCount}, AGAINST: ${againstCount}, ABSTAIN: ${abstainCount}`,
                        missedDeadline: expired,
                        votingFinished: true
                    };
                    await (0, blockchain_1.storeVotingResultsOnChain)(payload);
                }
            }
            catch (err) {
                console.error('Error storing final results:', err);
                await thread.send(`Could not store final results on chain: ${err}`);
            }
            (0, utils_1.markThreadFinalized)(thread.id);
        }
        // normal message (not ephemeral)
        await thread.send('Voting is complete. The results have been saved on chain. Use `/results <threadID>` to see details.');
        await (0, utils_1.lockThread)(thread);
        // don't send ephemeral here, or it might fail if locked
        return;
    }
    else {
        // not finished => ephemeral
        await buttonInteraction.reply({
            content: `Your vote is recorded. Token: ${token}`,
            ephemeral: true
        });
    }
});
// handle rename or unarchive
client.on('threadUpdate', async (oldThread, newThread) => {
    // revert rename if it's a voting thread
    if (oldThread.name.startsWith('V:') && !newThread.name.startsWith('V:')) {
        try {
            await newThread.setName(oldThread.name);
        }
        catch { }
    }
    if (oldThread.archived && !newThread.archived) {
        // if user tries to unarchive expired thread => lock again
        if (newThread.name.startsWith('V:') && (0, utils_1.isExpired)(newThread.name)) {
            await (0, utils_1.lockThread)(newThread);
        }
    }
});
/**
 * createThread
 */
async function createThread(interaction, name) {
    const channel = interaction.channel;
    if (!channel || channel.type !== discord_js_1.ChannelType.GuildText)
        return null;
    return channel.threads.create({
        name,
        autoArchiveDuration: 1440 // 1 day
    });
}
/**
 * findThreadByRef
 */
async function findThreadByRef(interaction, ref) {
    const ch = interaction.channel;
    if (!ch || ch.type !== discord_js_1.ChannelType.GuildText)
        return null;
    const textCh = ch;
    const active = await textCh.threads.fetchActive();
    let found = null;
    active.threads.forEach((t) => {
        if (t.id === ref || t.name === ref)
            found = t;
    });
    if (!found) {
        const archived = await textCh.threads.fetchArchived();
        archived.threads.forEach((t) => {
            if (t.id === ref || t.name === ref)
                found = t;
        });
    }
    return found;
}
/**
 * findProgressMessage
 */
async function findProgressMessage(thread) {
    const msgs = await thread.messages.fetch({ limit: 50 });
    return msgs.find((m) => m.content.includes('Voting progress:') && m.author.id === client.user?.id) || null;
}
/**
 * getRoleMembers
 */
function getRoleMembers(guild) {
    const role = guild.roles.cache.get(ROLE_ID || '');
    if (!role)
        return new discord_js_1.Collection();
    return role.members;
}
client.login(BOT_TOKEN);
