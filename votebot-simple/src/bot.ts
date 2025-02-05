// src/bot.ts
// Main Discord bot logic

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
  Message,
  MessageEditOptions
} from 'discord.js';
import dayjs from 'dayjs';

import {
  initChain,
  storeVotingResultsOnChain,
  VotingResultsPayload
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

// Environment variables from .env
const {
  DISCORD_TOKEN,
  SUBSTRATE_ENDPOINT,
  SEED_PHRASE,
  ROLE_ID,
  VOTERID_SECRET,
  VOTING_DURATION
} = process.env;

// Parse voting duration in hours; default is 168 (7 days)
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

// Define slash commands (all replies and logs in English)
const commands = [
  new SlashCommandBuilder()
    .setName('discussion')
    .setDescription('Create a Discussion thread')
    .addStringOption((opt) =>
      opt.setName('subject').setDescription('Subject').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('proposal')
    .setDescription('Create a Proposal thread (time-limited by VOTING_DURATION)')
    .addStringOption((opt) =>
      opt.setName('subject').setDescription('Subject').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('vote')
    .setDescription('Create a Voting thread (time-limited by VOTING_DURATION)')
    .addStringOption((opt) =>
      opt.setName('subject').setDescription('Subject').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('myvotetoken')
    .setDescription('Get your VoteToken'),
  new SlashCommandBuilder()
    .setName('results')
    .setDescription('Retrieve voting results (only for finished threads)')
    .addStringOption((opt) =>
      opt.setName('threadref').setDescription('Thread name or ID').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('List bot commands')
].map((c) => c.toJSON());

async function registerCommands(guildId?: string) {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  if (!guildId) {
    await rest.put(Routes.applicationCommands(client.user?.id || ''), {
      body: commands
    });
  } else {
    await rest.put(
      Routes.applicationGuildCommands(client.user?.id || '', guildId),
      { body: commands }
    );
  }
}

// On process exit, store offline timestamp.
process.on('beforeExit', () => storeOfflineTimestamp());
process.on('SIGINT', () => {
  storeOfflineTimestamp();
  process.exit(0);
});

client.once('ready', async () => {
  console.log(`Bot started as ${client.user?.tag}`);
  // Read offline timestamp from file.
  offlineSince = readOfflineTimestamp();

  await registerCommands();
  await initChain(SUBSTRATE_ENDPOINT || '', SEED_PHRASE || '');

  // For this task, check active threads only once on startup.
  await checkActiveThreads();
});

/**
 * Check for expired threads in all guilds.
 * For each thread with prefix "P:" or "V:" that is not already locked/archived and not finalized,
 * if the thread has expired (i.e. thread.createdAt + VOTING_DURATION_HOURS < now),
 * then lock it, send a message, and store final results on-chain.
 */
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
          // Process only threads with prefix "P:" or "V:"
          if (!thread.name.startsWith('P:') && !thread.name.startsWith('V:')) return;
          // If thread is already locked/archived or already finalized, skip.
          if (thread.locked || thread.archived || isThreadFinalized(thread.id)) return;
          // Check expiration using thread.createdAt plus duration.
          if (isExpiredThread(thread, VOTING_DURATION_HOURS)) {
            await lockThread(thread);
            const nowStr = new Date().toISOString();
            let msg = `The thread has expired. Locking it now.`;
            if (offlineSince) {
              msg = `The bot was offline from ${offlineSince} to ${nowStr} and missed the deadline. Locking this thread.`;
            }
            await thread.send(msg);
            try {
              const guildMembers = getRoleMembers(guild);
              const allEligible = guildMembers.map(
                (m) => `${m.user.tag} (${m.id})`
              );
              const payload: VotingResultsPayload = {
                votingThreadId: thread.id,
                dateOfCreating: (thread.createdAt ?? new Date()).toISOString(),
                fullThreadName: thread.name,
                eligibleCount: guildMembers.size,
                allEligibleMembers: allEligible,
                votes: 'unknown final votes (not parsed here)',
                missedDeadline: true,
                votingFinished: true
              };
              await storeVotingResultsOnChain(payload);
            } catch (err) {
              console.error('Error storing final results on chain:', err);
              await thread.send(`Could not store final results on chain: ${err}`);
            }
            markThreadFinalized(thread.id);
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
    // Create a Discussion thread (no expiration check).
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
    // Create a Proposal thread with prefix "P:" and expiration date (YYYY-MM-DD).
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
    // Create a Voting thread with prefix "V:" and expiration date (YYYY-MM-DD).
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
      new ButtonBuilder()
        .setCustomId('vote_for')
        .setLabel('FOR')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('vote_against')
        .setLabel('AGAINST')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('vote_abstain')
        .setLabel('ABSTAIN')
        .setStyle(ButtonStyle.Secondary)
    );
    const mems = getRoleMembers(guild);
    const tokens: string[] = [];
    mems.forEach((m) => {
      const tk = generateVoteToken(m.id, thr.id, VOTERID_SECRET || '');
      tokens.push(tk);
    });
    await thr.send({
      content: `ThreadID: ${thr.id}\n<@&${ROLE_ID}>`,
      components: [row]
    });
    // Post initial progress message under spoiler.
    const content2 =
      `Voting progress: ⚠️ Keep in mind — opening the spoiler may bias your decision! ||FOR: 0 | AGAINST: 0 | ABSTAIN: 0||\n` +
      `Voting tokens left: ${tokens.join(', ')}`;
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
    // Only show results for finished (locked) threads.
    if (!thr.locked) {
      await interaction.reply({ content: 'Voting is still in progress! Results will be available after it ends!', ephemeral: true });
      return;
    }
    const createdAt = (thr.createdAt ?? new Date()).toISOString();
    const mems = getRoleMembers(guild);
    const allEligible = mems.map((m) => `${m.user.tag} (${m.id})`);
    let forCount = 0, againstCount = 0, abstainCount = 0, tokensLeft: string[] = [];
    const pm = await findProgressMessage(thr);
    if (pm) {
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
    const totalVotes = forCount + againstCount + abstainCount;
    const expired = isExpiredThread(thr, VOTING_DURATION_HOURS);
    const finished = isVotingFinished(totalVotes, mems.size, expired);
    // Build results message including extra lines.
    const msg =
      `ID: ${thr.id}\n` +
      `Created at: ${createdAt}\n` +
      `Thread name: ${thr.name}\n` +
      `Total participants: ${mems.size}\n` +
      `Participants voted: ${totalVotes}\n` +
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

// Button interactions: handle vote button clicks.
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const buttonInteraction = interaction as ButtonInteraction;
  const { customId } = buttonInteraction;
  const thread = buttonInteraction.channel;
  if (!thread || thread.type !== ChannelType.PublicThread) return;
  if (thread.locked || thread.archived) return;
  // If the thread is expired based on creation time, lock it and do nothing.
  if (isExpiredThread(thread, VOTING_DURATION_HOURS)) {
    await lockThread(thread);
    return;
  }
  const pm = await findProgressMessage(thread);
  if (!pm) {
    await buttonInteraction.reply({ content: 'No voting data found in this thread.', ephemeral: true });
    return;
  }
  // Parse current voting counts and tokens left from the progress message.
  let forCount = 0, againstCount = 0, abstainCount = 0;
  let tokensLeft: string[] = [];
  {
    const lines = pm.content.split('\n');
    for (const line of lines) {
      if (line.startsWith('Voting progress:')) {
        const raw = line.replace('Voting progress:', '').trim().replace(/\|/g, '');
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
    // First, send an ephemeral reply to the last voter confirming the vote.
    await buttonInteraction.reply({ content: `Your vote is recorded. This was the final vote.`, ephemeral: true });
    // Then, store final results on-chain if not already done.
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
          await storeVotingResultsOnChain(payload);
        }
      } catch (err) {
        console.error('Error storing final results:', err);
        await thread.send(`Could not store final results on chain: ${err}`);
      }
      markThreadFinalized(thread.id);
    }
    // Post a normal message in the thread announcing completion.
    await thread.send('Voting is complete. The results have been saved on chain. Use `/results <threadID>` to see details.');
    // Finally, lock the thread.
    await lockThread(thread);
    return;
  } else {
    // If voting is not finished, send an ephemeral reply.
    await buttonInteraction.reply({ content: `Your vote is recorded. Token: ${token}`, ephemeral: true });
  }
});

// Handle thread updates: revert unauthorized renames or unarchiving of expired threads.
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

/**
 * createThread - Create a new thread in the channel.
 *
 * @param interaction - The chat input command interaction.
 * @param name - The desired thread name.
 * @returns The created ThreadChannel or null.
 */
async function createThread(
  interaction: ChatInputCommandInteraction,
  name: string
): Promise<ThreadChannel | null> {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) return null;
  return channel.threads.create({
    name,
    autoArchiveDuration: 1440 // 1 day (in minutes)
  });
}

/**
 * findThreadByRef - Find a thread by its name or ID.
 *
 * @param interaction - The command interaction.
 * @param ref - The thread name or ID.
 * @returns The found ThreadChannel or null.
 */
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

/**
 * findProgressMessage - Find the bot's progress message in a thread.
 *
 * @param thread - The Discord thread channel.
 * @returns The progress Message or null if not found.
 */
async function findProgressMessage(thread: ThreadChannel): Promise<Message | null> {
  const msgs = await thread.messages.fetch({ limit: 50 });
  return msgs.find(m =>
    m.content.includes('Voting progress:') && m.author.id === client.user?.id
  ) || null;
}

/**
 * getRoleMembers - Return the collection of guild members that have the role specified by ROLE_ID.
 *
 * @param guild - The Discord guild.
 * @returns A Collection of GuildMember.
 */
function getRoleMembers(guild: any): Collection<string, GuildMember> {
  const role = guild.roles.cache.get(ROLE_ID || '');
  if (!role) return new Collection();
  return role.members;
}

client.login(BOT_TOKEN);

