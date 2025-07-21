import discord

def helper_wrapper(client):
    @client.tree.command(name="help", description="Displays the help menu")
    async def help_command(interaction: discord.Interaction):
        embed = discord.Embed(title="Autonomys Governance Assistant", description="Available commands:", color=0x3498db)
        embed.add_field(name="/proposal", value="Proposal menu", inline=False)
        embed.add_field(name="/vote", value="Vote menu", inline=False)
        embed.set_footer(text="See you later fellow ambassador")
        await interaction.response.send_message(embed=embed)
