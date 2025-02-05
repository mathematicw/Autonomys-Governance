// src/bot.ts
// Main Discord bot logic.
// Upon voting finalizinf CID is saved in message on thread
// Command /results looks for message with prefix "CID:" and download vote data from Auto-drive.

import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  TextChannel,
  ChatInputCommandInteraction,
  ButtonInteraction,
  CommandInteraction,
  SlashCommandBuilder,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ThreadChannel,
  REST,
  Routes,
  GuildMember,
  Collection,
  Message
} from 'discord.js';
import dayjs from 'dayjs';

import {
  initChain,
  storeVotingResultsOnChain,
  VotingResultsPayload,
  initDrive,
  retrieveVotingResults
} from './blockchain';

import {
  generateVoteToken,
  isExpiredThread,
  isVotingFinished,
  lockThread,
  storeOfflineTimestamp,
  readOfflineTimestamp,
  markThreadFinalized,
  isThreadFinalized,
  formatExpirationDate
} from './utils';

const {
  DISCORD_TOKEN,
  SUBSTRATE_ENDPOINT,
  SEED_PHRASE,
  ROLE_ID,
  VOTERID_SECRET,
  VOTING_DURATION
} = process.env;

const VOTING_DURATION_HOURS = parseInt(VOTING_DURATION || '168', 10);
const BOT_TOKEN = DISCORD_TOKEN || '';

let offlineSince: string | null = null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const commands = [
  new SlashCommandBuilder()
    .setName('discussion')
    .setDescription('Create a Discussion thread')
    .addStringOption(opt => opt.setName('subject').setDescription('Subject').setRequired(true)),
  new SlashCommandBuilder()
    .setName('proposal')
    .setDescription('Create a Proposal thread (time-limited by VOTING_DURATION)')
    .addStringOption(opt => opt.setName('subject').setDescription('Subject').setRequired(true)),
  new SlashCommandBuilder()
    .setName('vote')
    .setDescription('Create a Voting thread (time-limited by VOTING_DURATION)')
    .addStringOption(opt => opt.setName('subject').setDescription('Subject').setRequired(true)),
  new SlashCommandBuilder()
    .setName('myvotetoken')
    .setDescription('Get your VoteToken'),
  new SlashCommandBuilder()
    .setName('results')
    .setDescription('Retrieve final voting results (only for finished threads)')
    .addStringOption(opt => opt.setName('threadref').setDescription('Thread name or ID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('List bot commands')
].map(c => c.toJSON());

async function registerCommands(guildId?: string) {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  if (!guildId) {
    await rest.put(Routes.applicationCommands(client.user?.id || ''), { body: commands });
  } else {
    await rest.put(Routes.applicationGuildCommands(client.user?.id || '', guildId), { body: commands });
  }
}

process.on('beforeExit', () => storeOfflineTimestamp());
process.on('SIGINT', () => {
  storeOfflineTimestamp();
  process.exit(0);
});

client.once('ready', async () => {
  console.log(`Bot started as ${client.user?.tag}`);
  offlineSince = readOfflineTimestamp();
  await registerCommands();
  await initChain(SUBSTRATE_ENDPOINT || '', SEED_PHRASE || '');
  await initDrive();
  await checkActiveThreads();
});

async function checkActiveThreads() {
  const guilds = client.guilds.cache;
  for (const [_, guild] of guilds) {
    if (!guild) continue;
    await guild.members.fetch();
    const channels = await guild.channels.fetch();
    for (const [, chData] of channels) {
      if (!chData) continue;
      if (chData.type === ChannelType.GuildText) {
        const textCh = chData as TextChannel;
        const activeThreads = await textCh.threads.fetchActive();
        activeThreads.threads.forEach(async (thread) => {
          if (!thread.name.startsWith('P:') && !thread.name.startsWith('V:')) return;
          if (thread.locked || thread.archived || isThreadFinalized(thread.id)) return;
          if (isExpiredThread(thread, VOTING_DURATION_HOURS)) {
            await thread.send("Voting completed. Thread has been successfully locked.");
            const cid = await storeVotingResultsOnChain({
              votingThreadId: thread.id,
              dateOfCreating: (thread.createdAt ?? new Date()).toISOString(),
              fullThreadName: thread.name,
              eligibleCount: getRoleMembers(guild).size,
              allEligibleMembers: Array.from(getRoleMembers(guild).values()).map(m => `${m.user.tag} (${m.id})`),
              votes: 'unknown final votes (not parsed here)',
              missedDeadline: true,
              votingFinished: true
            });
            await thread.send(`Voting results have been uploaded to Auto-drive. CID: ${cid}`);
            markThreadFinalized(thread.id);
            await lockThread(thread);
          }
        });
      }
    }
  }
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
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
      await interaction.reply({ content: 'Error while creating thread.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: `Discussion thread created: ${thr.name}`, ephemeral: true });
  }
  
  if (commandName === 'proposal') {
    await guild.members.fetch();
    const subject = interaction.options.getString('subject', true);
    const expStr = formatExpirationDate(new Date(), VOTING_DURATION_HOURS);
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
    await guild.members.fetch();
    const subject = interaction.options.getString('subject', true);
    const expStr = formatExpirationDate(new Date(), VOTING_DURATION_HOURS);
    const name = `V:${expStr}: ${subject}`;
    const thr = await createThread(interaction, name);
    if (!thr) {
      await interaction.reply({ content: 'Error while creating voting thread.', ephemeral: true });
      return;
    }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('vote_for').setLabel('FOR').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('vote_against').setLabel('AGAINST').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('vote_abstain').setLabel('ABSTAIN').setStyle(ButtonStyle.Secondary)
    );
    const mems = getRoleMembers(guild);
    const tokens: string[] = [];
    mems.forEach(m => {
      const tk = generateVoteToken(m.id, thr.id, VOTERID_SECRET || '');
      tokens.push(tk);
    });
    await thr.send({ content: `ThreadID: ${thr.id}\n<@&${ROLE_ID}>`, components: [row] });
    const content2 = `Voting progress: ||FOR: 0 | AGAINST: 0 | ABSTAIN: 0||\nVoting tokens left: ${tokens.join(', ')}`;
    await thr.send(content2);
    await interaction.reply({ content: `Voting thread created: ${thr.name}`, ephemeral: true });
  }
  
  if (commandName === 'myvotetoken') {
    const thr = interaction.channel;
    if (!thr || thr.type !== ChannelType.PublicThread) {
      await interaction.reply({ content: 'This command only works in a thread.', ephemeral: true });
      return;
    }
    const vt = generateVoteToken(interaction.user.id, thr.id, VOTERID_SECRET || '');
    await interaction.reply({ content: `Your VoteToken: ${vt}`, ephemeral: true });
  }
  
  if (commandName === 'results') {
    const ref = interaction.options.getString('threadref', true);
    const thr = await findThreadByRef(interaction, ref);
    if (!thr) {
      await interaction.reply({ content: 'Thread not found.', ephemeral: true });
      return;
    }
    if (!thr.locked) {
      await interaction.reply({ content: 'Voting is still in progress! Results will be available after it ends!', ephemeral: true });
      return;
    }
    // Поиск сообщения с CID
    const messages = await thr.messages.fetch({ limit: 50 });
    let cid: string | null = null;
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
    try {
      const results = await retrieveVotingResults(cid);
      const replyText = 
        `Final Results (retrieved from Auto-drive):\n` +
        `Thread: ${results.fullThreadName}\n` +
        `Eligible participants: ${results.eligibleCount}\n` +
        `Votes: ${results.votes}\n` +
        `Deadline missed: ${results.missedDeadline ? 'Yes' : 'No'}\n` +
        `Voting finished: ${results.votingFinished ? 'Yes' : 'No'}`;
      await interaction.reply({ content: replyText, ephemeral: false });
    } catch (err) {
      await interaction.reply({ content: `Error retrieving results from Auto-drive: ${err}`, ephemeral: true });
    }
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

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const buttonInteraction = interaction as ButtonInteraction;
  const { customId } = buttonInteraction;
  const thread = buttonInteraction.channel;
  if (!thread || thread.type !== ChannelType.PublicThread) return;
  if (thread.locked || thread.archived) return;
  if (isExpiredThread(thread, VOTING_DURATION_HOURS)) {
    await lockThread(thread);
    return;
  }
  const pm = await findProgressMessage(thread);
  if (!pm) {
    await buttonInteraction.reply({ content: 'No voting data found in this thread.', ephemeral: true });
    return;
  }
  let forCount = 0, againstCount = 0, abstainCount = 0;
  let tokensLeft: string[] = [];
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
      } else if (line.startsWith('Voting tokens left:')) {
        const leftover = line.replace('Voting tokens left:', '').trim();
        tokensLeft = leftover.split(',').map(x => x.trim()).filter(x => x);
      }
    }
  }
  const token = generateVoteToken(buttonInteraction.user.id, thread.id, VOTERID_SECRET || '');
  if (!tokensLeft.includes(token)) {
    await buttonInteraction.reply({ content: 'You are either not eligible or have already used your token!', ephemeral: true });
    return;
  }
  if (customId === 'vote_for') forCount++;
  if (customId === 'vote_against') againstCount++;
  if (customId === 'vote_abstain') abstainCount++;
  const newLeft = tokensLeft.filter(t => t !== token);
  const guild = buttonInteraction.guild;
  let totalMems = 0;
  if (guild) {
    totalMems = getRoleMembers(guild).size;
  }
  const totalVotes = forCount + againstCount + abstainCount;
  const finished = isVotingFinished(totalVotes, totalMems, false);
  const newContent =
    `Voting progress: ||FOR: ${forCount} | AGAINST: ${againstCount} | ABSTAIN: ${abstainCount}||\n` +
    `Voting tokens left: ${newLeft.join(', ')}`;
  await pm.edit({ content: newContent });
  
  if (finished) {
    await buttonInteraction.reply({ content: `Your vote is recorded. This was the final vote.`, ephemeral: true });
    if (!isThreadFinalized(thread.id)) {
      try {
        if (guild) {
          const mems = getRoleMembers(guild);
          const allEligible = mems.map(m => `${m.user.tag} (${m.id})`);
          const payload: VotingResultsPayload = {
            votingThreadId: thread.id,
            dateOfCreating: (thread.createdAt ?? new Date()).toISOString(),
            fullThreadName: thread.name,
            eligibleCount: mems.size,
            allEligibleMembers: allEligible,
            votes: `FOR: ${forCount}, AGAINST: ${againstCount}, ABSTAIN: ${abstainCount}`,
            missedDeadline: false,
            votingFinished: true
          };
          const cid = await storeVotingResultsOnChain(payload);
          await thread.send(`Voting results have been uploaded to Auto-drive. CID: ${cid}`);
        }
      } catch (err) {
        console.error('Error storing final results on drive:', err);
        await thread.send(`Could not store final results on drive: ${err}`);
      }
      markThreadFinalized(thread.id);
    }
    await thread.send('Voting is complete. The results have been saved on chain. Use /results <threadID> for details.');
    await lockThread(thread);
    return;
  } else {
    await buttonInteraction.reply({ content: `Your vote is recorded. Token: ${token}`, ephemeral: true });
  }
});

client.on('threadUpdate', async (oldThread, newThread) => {
  if (oldThread.name.startsWith('V:') && !newThread.name.startsWith('V:')) {
    try {
      await newThread.setName(oldThread.name);
    } catch {}
  }
  if (oldThread.archived && !newThread.archived) {
    if (newThread.name.startsWith('V:') && isExpiredThread(newThread, VOTING_DURATION_HOURS)) {
      await lockThread(newThread);
    }
  }
});

async function createThread(
  interaction: ChatInputCommandInteraction,
  name: string
): Promise<ThreadChannel | null> {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) return null;
  return channel.threads.create({
    name,
    autoArchiveDuration: 1440
  });
}

async function findThreadByRef(
  interaction: CommandInteraction,
  ref: string
): Promise<ThreadChannel | null> {
  const ch = interaction.channel;
  if (!ch || ch.type !== ChannelType.GuildText) return null;
  const textCh = ch as TextChannel;
  const active = await textCh.threads.fetchActive();
  let found: ThreadChannel | null = null;
  active.threads.forEach(t => {
    if (t.id === ref || t.name === ref) found = t;
  });
  if (!found) {
    const archived = await textCh.threads.fetchArchived();
    archived.threads.forEach(t => {
      if (t.id === ref || t.name === ref) found = t;
    });
  }
  return found;
}

async function findProgressMessage(thread: ThreadChannel): Promise<Message | null> {
  const msgs = await thread.messages.fetch({ limit: 50 });
  return msgs.find(m =>
    m.content.includes('Voting progress:') && m.author.id === client.user?.id
  ) || null;
}

function getRoleMembers(guild: any): Collection<string, GuildMember> {
  const role = guild.roles.cache.get(ROLE_ID || '');
  if (!role) return new Collection();
  return role.members;
}

client.login(BOT_TOKEN);

