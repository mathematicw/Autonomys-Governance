import discord
from discord import app_commands
from discord.ext import commands

import commands.utils.proposal as proposal
import commands.utils.admin as admin

class ProposalModal(discord.ui.Modal, title="Initialize Proposal Discussion"):
    def __init__(self, interaction: discord.Interaction, name: str):
        super().__init__()
        self.interaction = interaction
        self.name = name

        self.content = discord.ui.TextInput(
            label="Discussion Content",
            style=discord.TextStyle.paragraph,
            placeholder="Write the full discussion message here...",
            max_length=4000,
            required=True
        )

        self.add_item(self.content)

    async def on_submit(self, interaction: discord.Interaction):
        user = self.interaction.user.display_name
        embed = proposal.init(user, self.name)

        # Create thread and post message
        await admin.create_thread(
            interaction=self.interaction,
            name=f"Proposal-{self.name}",
            content=self.content.value
        )

        await interaction.response.send_message(embed=embed, ephemeral=True)

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
    async def proposal_menu(
        interaction: discord.Interaction,
        proposal_actions: app_commands.Choice[str],
        name: str = None
    ):
        if proposal_actions.value == "init":
            modal = ProposalModal(interaction, name)
            await interaction.response.send_modal(modal)
        else:
            await interaction.response.send_message("Invalid action.")
