import discord
import logging
from discord import app_commands

from commands.utils.config import load_config
from commands.help import helper_wrapper
from commands.proposal import proposal_wrapper
from commands.utils.sql import run_init_sql
from commands.vote import vote_wrapper

run_init_sql()

cfg = load_config()
MY_GUILD = discord.Object(id=cfg["guild"])

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
discord_logger = logging.getLogger("discord")

class MyClient(discord.Client):
    def __init__(self, *, intents: discord.Intents):
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        self.tree.copy_global_to(guild=MY_GUILD)
        await self.tree.sync(guild=MY_GUILD)



async def on_ready():
    logging.info(f"{client.user} is connected to the following guilds:")
    for guild in client.guilds:
        logging.info(f"{guild.name} (id: {guild.id})")
    for permission in client.guilds[0].me.guild_permissions:
        logging.info(f"{permission[0]}: {permission[1]}")
    logging.info("Permission listing complete.")


if __name__ == '__main__':
    _intents = discord.Intents.default()
    _intents.guilds = True
    _intents.members = True
    client = MyClient(intents=_intents)

    helper_wrapper(client)
    proposal_wrapper(client)
    vote_wrapper(client)
    client.run(cfg["token"])