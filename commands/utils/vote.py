import discord


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


async def vote_or_check(poll_message: discord.Message, thread: discord.Thread, interaction: discord.Interaction,
                        governance_members: discord.Member = None):
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
    embed.add_field(name="🧮 Vote Summary",
                    value=f"Total eligible: **{total}**\nVoted: **{voted}**\nParticipation: **{participation}%**",
                    inline=False)

    await interaction.response.send_message(embed=embed, ephemeral=True)
