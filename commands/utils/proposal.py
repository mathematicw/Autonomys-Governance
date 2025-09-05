from datetime import datetime
import sqlite3
import logging
import discord

import commands.utils.color as color
import commands.utils.bot_default as bf

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")


def init(user: str, thread_name: str):
    connection_obj = sqlite3.connect('governance.db')
    cursor_obj = connection_obj.cursor()
    cursor_obj.execute("PRAGMA foreign_keys = ON;")
    current_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    embed = bf.error_generic()

    try:
        cursor_obj.execute(
            "INSERT INTO Proposal (Initiator, Name, DateCreated, DateUpdated) VALUES (?, ?, ?, ?);",
            (user, thread_name, current_date, current_date)
        )
        connection_obj.commit()
        logging.info(f"{user} Initialized '{thread_name}' successfully.")
        embed = discord.Embed(title=f"Proposal Initialized", color=color.GREEN)
        embed.add_field(name=f"Proposal: {thread_name} ", value=f"Initialized", inline=False)

    except sqlite3.IntegrityError as e:
        if "UNIQUE constraint failed" in str(e):
            logging.info(f"Error: '{thread_name}' is already Initialized.")
            embed = discord.Embed(title=f"Proposal already Initialized", color=color.YELLOW)
        else:
            logging.info(f"Error Initializing Proposal '{thread_name}: from {user}': {e}")
    finally:
        return embed