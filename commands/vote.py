import discord
from discord import app_commands

from commands.utils.config import load_config

cfg = load_config()


async def get_poll_message(client, thread: discord.Thread) -> discord.Message | None:
    async for msg in thread.history(limit=None):
        if msg.author == client.user and msg.content.startswith("**🗳️ Vote on this proposal:**"):
            return msg
    return None


async def get_governance_members(guild: discord.Guild, role_name: str):
    role = discord.utils.get(guild.roles, name=role_name)
    if not role:
        return None, []

    members = [
        member async for member in guild.fetch_members()
        if role in member.roles and not member.bot
    ]
    return role, members


async def collect_votes(poll_message: discord.Message):
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
                if not user.bot:
                    vote_categories[emoji].append(user)
                    all_voters.add(user)

    return vote_categories, all_voters



def vote_request(client):
    @client.tree.command(name="vote", description="Create or check a poll in this thread")
    async def vote_command(interaction: discord.Interaction):
        thread = interaction.channel
        if not isinstance(thread, discord.Thread):
            await interaction.response.send_message("⚠️ This command can only be used inside a thread.", ephemeral=True)
            return

        guild = interaction.guild
        role, governance_members = await get_governance_members(guild, cfg["governance_role"])
        if not role:
            await interaction.response.send_message("⚠️ Governance role not found.", ephemeral=True)
            return

        poll_message = await get_poll_message(client, thread)

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

        vote_categories, all_voters = await collect_votes(poll_message)

        non_voters = [m.display_name for m in governance_members if m not in all_voters]
        total = len(governance_members)
        voted = len(all_voters)
        participation = round((voted / total) * 100, 2) if total else 0.0

        embed = discord.Embed(
            title="📊 Vote Results",
            description="Here's how members have voted so far:",
            color=0x2ecc71
        )

        labels = {"✅": "In Favor", "❌": "Against", "❓": "Abstain", "🛠️": "Needs Work"}
        for emoji, users in vote_categories.items():
            names = ", ".join(u.display_name for u in users) if users else "_No votes_"
            embed.add_field(name=f"{emoji} {labels[emoji]}", value=names, inline=False)

        embed.add_field(name="👥 Not Voted Yet", value=", ".join(non_voters) or "_Everyone has voted!_", inline=False)
        embed.add_field(name="🧮 Vote Summary", value=f"Total eligible: **{total}**\nVoted: **{voted}**\nParticipation: **{participation}%**", inline=False)

        await interaction.response.send_message(embed=embed, ephemeral=True)



def close_vote_command(client):
    @client.tree.command(name="closevote", description="Close the vote in this thread (reactions will be locked)")
    async def closevote(interaction: discord.Interaction):
        thread = interaction.channel
        if not isinstance(thread, discord.Thread):
            await interaction.response.send_message("⚠️ This command can only be used inside a thread.", ephemeral=True)
            return

        guild = interaction.guild
        role, governance_members = await get_governance_members(guild, cfg["governance_role"])
        if not role:
            await interaction.response.send_message("⚠️ Governance role not found.", ephemeral=True)
            return

        poll_message = await get_poll_message(client, thread)
        if not poll_message:
            await interaction.response.send_message("⚠️ No active poll found in this thread.", ephemeral=True)
            return

        vote_categories, all_voters = await collect_votes(poll_message)
        non_voters = [m for m in governance_members if m not in all_voters]
        vote_categories["❓"].extend(non_voters)

        new_content = poll_message.content + "\n\n🔒 **Voting is now closed.**"
        await poll_message.edit(content=new_content)

        try:
            for reaction in poll_message.reactions:
                await poll_message.clear_reaction(reaction.emoji)
        except discord.Forbidden:
            await interaction.response.send_message("⚠️ I don't have permission to remove reactions.", ephemeral=True)
            return

        total = len(governance_members)
        total_votes = sum(len(v) for v in vote_categories.values())
        participation = round((total_votes / total) * 100, 2) if total else 0.0

        embed = discord.Embed(
            title="🔒 Vote Closed - Final Results",
            description="Voting has been closed. Here's the final breakdown:",
            color=0xe74c3c
        )

        labels = {"✅": "In Favor", "❌": "Against", "❓": "Abstain", "🛠️": "Needs Work"}
        for emoji, voters in vote_categories.items():
            names = ", ".join(v.display_name for v in voters) if voters else "_No votes_"
            percent = round((len(voters) / total) * 100, 2) if total else 0.0
            embed.add_field(name=f"{emoji} {labels[emoji]} — {len(voters)} ({percent:.2f}%)", value=names, inline=False)

        embed.add_field(name="🧮 Vote Summary", value=f"Total eligible: **{total}**\nVoted: **{total_votes}**\nParticipation: **{participation}%**", inline=False)

        await interaction.response.send_message(embed=embed, ephemeral=True)



def vote_recall(client):
    @client.tree.command(name="vote_recall", description="Ping governance members who haven't voted yet")
    async def vote_recall_command(interaction: discord.Interaction):
        thread = interaction.channel
        if not isinstance(thread, discord.Thread):
            await interaction.response.send_message("⚠️ This command can only be used inside a thread.", ephemeral=True)
            return

        guild = interaction.guild
        role, governance_members = await get_governance_members(guild, cfg["governance_role"])
        if not role:
            await interaction.response.send_message("⚠️ Governance role not found.", ephemeral=True)
            return

        poll_message = await get_poll_message(client, thread)
        if not poll_message:
            await interaction.response.send_message("⚠️ No active poll found in this thread.", ephemeral=True)
            return

        _, all_voters = await collect_votes(poll_message)
        non_voters = [m for m in governance_members if m not in all_voters]

        if not non_voters:
            await interaction.response.send_message("✅ Everyone has already voted.", ephemeral=True)
            return

        mentions = " ".join(m.mention for m in non_voters)
        await thread.send(f"🔔 Reminder: the following members have not voted yet:\n{mentions}", allowed_mentions=discord.AllowedMentions(users=True))
        await interaction.response.send_message("📣 Reminder sent.", ephemeral=True)
