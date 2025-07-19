import discord
from discord import app_commands
from commands.utils.config import load_config

cfg = load_config()


def is_user_in_list(user: discord.User) -> bool:
    """
    Check if the user's ID is in the predefined list of IDs.

    :param user: The discord.User object to check.
    :return: True if the user's ID is in the list, False otherwise.
    """
    return user.id in cfg['admin_user']

async def create_thread(interaction: discord.Interaction, name: str, content: str):
    message = await interaction.channel.send(content)

    thread = await message.create_thread(
        name=name,
        auto_archive_duration=60  # Change this to team desicison, currently 60 minutes
    )
    role = discord.utils.get(interaction.guild.roles, name=cfg['governance_role'])

    await thread.send(
        f"{role.mention} here’s a thread update!",
        allowed_mentions=discord.AllowedMentions(roles=True)
    )
    return thread