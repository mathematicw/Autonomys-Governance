// bot.ts
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
  isExpired,
  isVotingFinished,
  lockThread,
  storeOfflineTimestamp,
  readOfflineTimestamp,
  markThreadFinalized,
  isThreadFinalized,
  formatExpirationDate
} from './utils';

// .env
const {
  DISCORD_TOKEN,
  SUBSTRATE_ENDPOINT,
  SEED_PHRASE,
  ROLE_ID,
  VOTERID_SECRET,
  VOTING_DURATION
} = process.env;

// parse duration (in hours), default 168
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
    .addStringOption((opt) =>
      opt.setName('subject').setDescription('Subject').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('proposal')
    .setDescription('Create a Proposal thread (time-limited by VOTING_DURATION).')
    .addStringOption((opt) =>
      opt.setName('subject').setDescription('Subject').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('vote')
    .setDescription('Create a Voting thread (time-limited by VOTING_DURATION).')
    .addStringOption((opt) =>
      opt.setName('subject').setDescription('Subject').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('myvotetoken')
    .setDescription('Get your VoteToken'),
  new SlashCommandBuilder()
    .setName('results')
    .setDescription('Retrieve voting results')
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

// On process exit, store offline time
process.on('beforeExit', () => storeOfflineTimestamp());
process.on('SIGINT', () => {
  storeOfflineTimestamp();
  process.exit(0);
});

client.once('ready', async () => {
  console.log(`Bot started as ${client.user?.tag}`);

  // read offline timestamp from file
  offlineSince = readOfflineTimestamp();

  await registerCommands();
  await initChain(SUBSTRATE_ENDPOINT || '', SEED_PHRASE || '');

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
    if (!guild) continue;
    await guild.members.fetch();

    const channels = await guild.channels.fetch();
    for (const [, chData] of channels) {
      if (!chData) continue;
      if (chData.type === ChannelType.GuildText) {
        const textCh = chData as TextChannel;
        const activeThreads = await textCh.threads.fetchActive();
        activeThreads.threads.forEach(async (thread) => {
          // we only process if it's a "P:" or "V:" thread
          if (!thread.name.startsWith('P:') && !thread.name.startsWith('V:')) {
            return;
          }
          if (isThreadFinalized(thread.id)) {
            // we've already done final results for this thread
            return;
          }
          if (isExpired(thread.name)) {
            // lock
            await lockThread(thread);

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

            // mark finalized
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
    const expStr = formatExpirationDate(new Date(), VOTING_DURATION_HOURS);
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
    const expStr = formatExpirationDate(new Date(), VOTING_DURATION_HOURS);
    const name = `V:${expStr}: ${subject}`;
    const thr = await createThread(interaction, name);
    if (!thr) {
      await interaction.reply({
        content: 'Error while creating voting thread.',
        ephemeral: true
      });
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

    // The progress in the thread under spoiler:
    const content2 =
      `Voting progress: ||FOR: 0 | AGAINST: 0 | ABSTAIN: 0||\n` +
      `Voting tokens left: ${tokens.join(', ')}`;
    await thr.send(content2);

    await interaction.reply({
      content: `Voting thread created: ${thr.name}`,
      ephemeral: true
    });
  }

  if (commandName === 'myvotetoken') {
    const thr = interaction.channel;
    if (!thr || thr.type !== ChannelType.PublicThread) {
      await interaction.reply({
        content: 'This command only works in a thread.',
        ephemeral: true
      });
      return;
    }
    const vt = generateVoteToken(
      interaction.user.id,
      thr.id,
      VOTERID_SECRET || ''
    );
    await interaction.reply({ content: `Your VoteToken: ${vt}`, ephemeral: true });
  }

  if (commandName === 'results') {
    const ref = interaction.options.getString('threadref', true);
    const thr = await findThreadByRef(interaction, ref);
    if (!thr) {
      await interaction.reply({ content: 'Thread not found.', ephemeral: true });
      return;
    }
    const expired = isExpired(thr.name);
    const createdAt = (thr.createdAt ?? new Date()).toISOString();

    const mems = getRoleMembers(guild);
    const allEligible = mems.map((m) => `${m.user.tag} (${m.id})`);
    let forCount = 0,
      againstCount = 0,
      abstainCount = 0,
      tokensLeft: string[] = [];
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
        } else if (line.startsWith('Voting tokens left:')) {
          const leftover = line.replace('Voting tokens left:', '').trim();
          tokensLeft = leftover
            .split(',')
            .map((x) => x.trim())
            .filter((x) => x);
        }
      }
    }
    const totalVotes = forCount + againstCount + abstainCount;
    const finished = isVotingFinished(totalVotes, mems.size, expired);

    const msg =
      `ID: ${thr.id}\n` +
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
  if (!interaction.isButton()) return;
  const buttonInteraction = interaction as ButtonInteraction;
  const { customId } = buttonInteraction;
  const thread = buttonInteraction.channel;

  // if the thread is not a public thread, ignore
  if (!thread || thread.type !== ChannelType.PublicThread) return;

  // if thread is locked or archived, do nothing
  if (thread.locked || thread.archived) return;

  // if expired => lock, do nothing else
  if (isExpired(thread.name)) {
    await lockThread(thread);
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
  let forCount = 0,
    againstCount = 0,
    abstainCount = 0;
  let tokensLeft: string[] = [];
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
      } else if (line.startsWith('Voting tokens left:')) {
        const leftover = line.replace('Voting tokens left:', '').trim();
        tokensLeft = leftover
          .split(',')
          .map((x) => x.trim())
          .filter((x) => x);
      }
    }
  }

  const token = generateVoteToken(
    buttonInteraction.user.id,
    thread.id,
    VOTERID_SECRET || ''
  );
  if (!tokensLeft.includes(token)) {
    await buttonInteraction.reply({
      content: 'You are either not eligible or already used your token!',
      ephemeral: true
    });
    return;
  }

  if (customId === 'vote_for') forCount++;
  if (customId === 'vote_against') againstCount++;
  if (customId === 'vote_abstain') abstainCount++;

  // remove token
  const newLeft = tokensLeft.filter((t) => t !== token);

  // check if finished
  const guild = buttonInteraction.guild;
  let totalMems = 0;
  if (guild) {
    totalMems = getRoleMembers(guild).size;
  }
  const totalVotes = forCount + againstCount + abstainCount;
  const expired = isExpired(thread.name);
  const finished = isVotingFinished(totalVotes, totalMems, expired);

  const newContent =
    `Voting progress: ||FOR: ${forCount} | AGAINST: ${againstCount} | ABSTAIN: ${abstainCount}||\n` +
    `Voting tokens left: ${newLeft.join(', ')}`;

  await pm.edit({ content: newContent });

  if (finished) {
    // store final results, lock thread
    if (!isThreadFinalized(thread.id)) {
      // do on-chain
      try {
        if (guild) {
          const mems = getRoleMembers(guild);
          const allEligible = mems.map((m) => `${m.user.tag} (${m.id})`);
          const payload: VotingResultsPayload = {
            votingThreadId: thread.id,
            dateOfCreating: (thread.createdAt ?? new Date()).toISOString(),
            fullThreadName: thread.name,
            eligibleCount: mems.size,
            allEligibleMembers: allEligible,
            votes: `FOR: ${forCount}, AGAINST: ${againstCount}, ABSTAIN: ${abstainCount}`,
            missedDeadline: expired,
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

    // normal message (not ephemeral)
    await thread.send(
      'Voting is complete. The results have been saved on chain. Use `/results <threadID>` to see details.'
    );
    await lockThread(thread);

    // don't send ephemeral here, or it might fail if locked
    return;
  } else {
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
    } catch {}
  }
  if (oldThread.archived && !newThread.archived) {
    // if user tries to unarchive expired thread => lock again
    if (newThread.name.startsWith('V:') && isExpired(newThread.name)) {
      await lockThread(newThread);
    }
  }
});

/**
 * createThread
 */
async function createThread(
  interaction: ChatInputCommandInteraction,
  name: string
): Promise<ThreadChannel | null> {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) return null;
  return channel.threads.create({
    name,
    autoArchiveDuration: 1440 // 1 day
  });
}

/**
 * findThreadByRef
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
  active.threads.forEach((t) => {
    if (t.id === ref || t.name === ref) found = t;
  });
  if (!found) {
    const archived = await textCh.threads.fetchArchived();
    archived.threads.forEach((t) => {
      if (t.id === ref || t.name === ref) found = t;
    });
  }
  return found;
}

/**
 * findProgressMessage
 */
async function findProgressMessage(thread: ThreadChannel): Promise<Message | null> {
  const msgs = await thread.messages.fetch({ limit: 50 });
  return msgs.find((m) =>
    m.content.includes('Voting progress:') && m.author.id === client.user?.id
  ) || null;
}

/**
 * getRoleMembers
 */
function getRoleMembers(guild: any): Collection<string, GuildMember> {
  const role = guild.roles.cache.get(ROLE_ID || '');
  if (!role) return new Collection();
  return role.members;
}

client.login(BOT_TOKEN);

