import os


import discord
from discord.ext import commands
import youtube_dl

from music import Music

#Silencing Youtube errors (Silence Wench)
youtube_dl.utils.bug_reports_message = lambda: ''


prefix = "$"

client = commands.Bot(prefix, description='Yet another music bot, but this time for a game!')
client.add_cog(Music(client))


@client.event
async def on_ready():
    print('Logged in as {0.user}'.format(client))


client.run(os.getenv("TOKEN"))