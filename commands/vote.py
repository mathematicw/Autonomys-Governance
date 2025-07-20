import discord
from discord import app_commands
from discord.ext import commands

import commands.utils.proposal as proposal
import commands.utils.admin as admin
from commands.utils.config import load_config

cfg = load_config()


def vote_request(client):
    @client.tree.command(name="vote", description="Create or check a poll in this thread")
    async def vote_command(interaction: discord.Interaction):
        thread = interaction.channel

        if not isinstance(thread, discord.Thread):
            await interaction.response.send_message("⚠️ This command can only be used inside a thread.", ephemeral=True)
            return

        guild = interaction.guild
        governance_role_name = cfg['governance_role']
        role = discord.utils.get(guild.roles, name=governance_role_name)

        if not role:
            await interaction.response.send_message(f"⚠️ Governance role '{governance_role_name}' not found.", ephemeral=True)
            return

        poll_message = None
        async for msg in thread.history(limit=None):
            if msg.author == client.user and msg.content.startswith("**🗳️ Vote on this proposal:**"):
                poll_message = msg
                break

        if not poll_message:
            poll_message = await thread.send(
                "**🗳️ Vote on this proposal:**\n\n"
                "✅ = In Favor\n"
                "❌ = Against\n"
                "❓ = Abstain\n"
                "🛠️ = Needs Work"
            )
            for emoji in ["✅", "❌", "❓", "🛠️"]:
                await poll_message.add_reaction(emoji)

            await interaction.response.send_message("✅ Poll created in this thread.", ephemeral=True)
            return

        vote_categories = {
            "✅": [],
            "❌": [],
            "❓": [],
            "🛠️": []
        }

        all_voters = set()

        for reaction in poll_message.reactions:
            if str(reaction.emoji) in vote_categories:
                async for user in reaction.users():
                    if user.bot:
                        continue
                    vote_categories[str(reaction.emoji)].append(user.display_name)
                    all_voters.add(user)

        governance_members = [member async for member in guild.fetch_members() if role in member.roles and not member.bot]

        non_voters = [member.display_name for member in governance_members if member not in all_voters]

        total_governance = len(governance_members)
        total_votes = len(all_voters)
        participation = round((total_votes / total_governance) * 100, 2) if total_governance > 0 else 0.0

        embed = discord.Embed(
            title="📊 Vote Results",
            description="Here's how members have voted so far:",
            color=0x2ecc71
        )

        for emoji, users in vote_categories.items():
            names = ", ".join(users) if users else "_No votes_"
            label = {
                "✅": "In Favor",
                "❌": "Against",
                "❓": "Abstain",
                "🛠️": "Needs Work"
            }[emoji]
            embed.add_field(name=f"{emoji} {label}", value=names, inline=False)

        embed.add_field(
            name="👥 Not Voted Yet",
            value=", ".join(non_voters) if non_voters else "_Everyone has voted!_",
            inline=False
        )

        embed.add_field(
            name="🧮 Vote Summary",
            value=(
                f"Total eligible voters: **{total_governance}**\n"
                f"Total votes cast: **{total_votes}**\n"
                f"Participation: **{participation}%**"
            ),
            inline=False
        )

        await interaction.response.send_message(embed=embed, ephemeral=True)



def close_vote_command(client):
    @client.tree.command(name="closevote", description="Close the vote in this thread (reactions will be locked)")
    async def closevote(interaction: discord.Interaction):
        thread = interaction.channel

        if not isinstance(thread, discord.Thread):
            await interaction.response.send_message("⚠️ This command can only be used inside a thread.", ephemeral=True)
            return

        poll_message = None
        async for msg in thread.history(limit=None):
            if msg.author == client.user and msg.content.startswith("**🗳️ Vote on this proposal:**"):
                poll_message = msg
                break

        if not poll_message:
            await interaction.response.send_message("⚠️ No active poll found in this thread.", ephemeral=True)
            return

        guild = interaction.guild
        governance_role_name = cfg['governance_role']
        role = discord.utils.get(guild.roles, name=governance_role_name)

        if not role:
            await interaction.response.send_message(f"⚠️ Governance role '{governance_role_name}' not found.", ephemeral=True)
            return

        # Collect current voters from reactions
        vote_categories = {
            "✅": [],
            "❌": [],
            "❓": [],
            "🛠️": []
        }
        all_voters = set()

        for reaction in poll_message.reactions:
            emoji = str(reaction.emoji)
            if emoji in vote_categories:
                async for user in reaction.users():
                    if user.bot:
                        continue
                    vote_categories[emoji].append(user)
                    all_voters.add(user)

        # Fetch all governance members eligible to vote
        governance_members = [member async for member in guild.fetch_members() if role in member.roles and not member.bot]

        # Determine non-voters
        non_voters = [member for member in governance_members if member not in all_voters]

        # Automatically add non-voters as "Abstain" (❓)
        vote_categories["❓"].extend(non_voters)

        # Edit poll message to mark vote closed
        new_content = poll_message.content + "\n\n🔒 **Voting is now closed.**"
        await poll_message.edit(content=new_content)

        # Remove all reactions to prevent further voting
        try:
            for reaction in poll_message.reactions:
                await poll_message.clear_reaction(reaction.emoji)
        except discord.Forbidden:
            await interaction.response.send_message("⚠️ I don't have permission to remove reactions.", ephemeral=True)
            return

        # Prepare vote summary embed
        total_governance = len(governance_members)
        total_votes = sum(len(voters) for voters in vote_categories.values())
        participation = round((total_votes / total_governance) * 100, 2) if total_governance > 0 else 0.0

        embed = discord.Embed(
            title="🔒 Vote Closed - Final Results",
            description="Voting has been closed. Here's the final breakdown:",
            color=0xe74c3c
        )

        label_map = {
            "✅": "In Favor",
            "❌": "Against",
            "❓": "Abstain",
            "🛠️": "Needs Work"
        }

        for emoji, voters in vote_categories.items():
            if voters:
                names = ", ".join(voter.display_name for voter in voters)
            else:
                names = "_No votes_"
            percentage = (len(voters) / total_governance * 100) if total_governance > 0 else 0
            embed.add_field(
                name=f"{emoji} {label_map.get(emoji, emoji)} — {len(voters)} vote(s) ({percentage:.2f}%)",
                value=names,
                inline=False
            )

        embed.add_field(
            name="🧮 Vote Summary",
            value=(
                f"Total eligible voters: **{total_governance}**\n"
                f"Total votes counted (including abstain): **{total_votes}**\n"
                f"Participation: **{participation}%**"
            ),
            inline=False
        )

        await interaction.response.send_message(embed=embed, ephemeral=True)

def vote_recall(client):
    @client.tree.command(name="vote_recall", description="Ping governance members who haven't voted yet")
    async def vote_recall_command(interaction: discord.Interaction):
        thread = interaction.channel

        if not isinstance(thread, discord.Thread):
            await interaction.response.send_message("⚠️ This command can only be used inside a thread.", ephemeral=True)
            return

        guild = interaction.guild
        governance_role_name = cfg['governance_role']
        role = discord.utils.get(guild.roles, name=governance_role_name)

        if not role:
            await interaction.response.send_message(f"⚠️ Governance role '{governance_role_name}' not found.", ephemeral=True)
            return

        # Locate the original poll message
        poll_message = None
        async for msg in thread.history(limit=None):
            if msg.author == client.user and msg.content.startswith("**🗳️ Vote on this proposal:**"):
                poll_message = msg
                break

        if not poll_message:
            await interaction.response.send_message("⚠️ No active poll found in this thread.", ephemeral=True)
            return

        # Collect voters
        all_voters = set()
        for reaction in poll_message.reactions:
            async for user in reaction.users():
                if not user.bot:
                    all_voters.add(user)

        # Get governance members who have not voted
        governance_members = [
            member async for member in guild.fetch_members()
            if role in member.roles and not member.bot
        ]

        non_voters = [member for member in governance_members if member not in all_voters]

        if not non_voters:
            await interaction.response.send_message("✅ All governance members have voted.", ephemeral=True)
            return

        # Mention non-voters
        mentions = " ".join(member.mention for member in non_voters)
        message = f"🔔 Reminder: The following members have not voted yet:\n{mentions}"

        await interaction.response.send_message("📣 Reminder sent.", ephemeral=True)
        await thread.send(message, allowed_mentions=discord.AllowedMentions(users=True))
