import discord
from discord import app_commands

import commands.utils.proposal as proposal
import commands.utils.admin as admin

def proposal_wrapper(client):
    @client.tree.command(name="proposal", description="Manage proposal actions")
    @app_commands.describe(
        proposal_actions="Choose an action to perform (init)",
        name="Main topic of the proposal"
    )
    @app_commands.choices(
        proposal_actions=[
            app_commands.Choice(name="Init Discussion", value="init"),
            app_commands.Choice(name="Submit Proposal", value="submit"),
        ]
    )
    async def proposal_menu(interaction: discord.Interaction, proposal_actions: app_commands.Choice[str],
                            name: str = None):
        user = interaction.user.display_name
        func_map = {
            "init": proposal.init,
        }

        embed = None
        if proposal_actions.value in ['init']:
            embed = func_map[proposal_actions.value](user, name)
            await admin.create_thread(interaction, name=f"Proposal-{name}", content=f"Proposal: {name}")

        if embed is not None:
            await interaction.response.send_message(embed=embed)
        else:
            await interaction.response.send_message("Invalid action.")
