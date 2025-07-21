import discord
from discord import app_commands

from commands.utils.config import load_config
from commands.utils.vote import vote_or_check, close_vote, vote_recall

cfg = load_config()

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


def vote_wrapper(client):
    @client.tree.command(name="vote", description="Manage proposal voting actions")
    @app_commands.describe(
        vote_action="Choose a voting action",
    )
    @app_commands.choices(
        vote_action=[
            app_commands.Choice(name="Create or Check Vote", value="create_or_check"),
            app_commands.Choice(name="Close Vote", value="close"),
            app_commands.Choice(name="Recall Non-Voters", value="recall"),
        ]
    )
    async def vote_menu(
        interaction: discord.Interaction,
        vote_action: app_commands.Choice[str],
    ):
        thread = interaction.channel
        if not isinstance(thread, discord.Thread):
            await interaction.response.send_message("⚠️ This command can only be used inside a thread.", ephemeral=True)
            return

        guild = interaction.guild
        role, governance_members = await get_governance_members(guild, cfg["governance_role"])

        poll_message = await get_poll_message(client, thread)

        if vote_action.value == "create_or_check":
            await vote_or_check(poll_message, thread, interaction, governance_members)
        elif vote_action.value == "close":
            await close_vote(poll_message, thread, interaction, governance_members)

        elif vote_action.value == "recall":
            await vote_recall(poll_message, thread, interaction, governance_members)
