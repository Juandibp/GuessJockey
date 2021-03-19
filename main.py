import os

from discord.ext import commands
from Music import Music

#Silencing Youtube errors (Silence Wench)
#youtube_dl.utils.bug_reports_message = lambda: ''


bot = commands.Bot('$', description='Yet another music bot.')
bot.add_cog(Music(bot))


@bot.event
async def on_ready():
    print('Logged in as:\n{0.user.name}\n{0.user.id}'.format(bot))

bot.run(os.getenv("TOKEN"))