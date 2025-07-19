import discord

import commands.utils.color as color


def error_generic():
    embed = discord.Embed(title=f"Erreur du bot",
                          color=color.RED)
    embed.description = "<@869961454521049098>"
    return embed