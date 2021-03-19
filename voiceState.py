import asyncio
import functools
import itertools
import math
import random
import os


import discord
from discord.ext import commands
import youtube_dl
from async_timeout import timeout

from songQueue import songQueue
from voiceError import VoiceError

class voiceState:
    def __init__(self, bot: commands.Bot, ctx: commands.Context):
        self.bot = bot
        self._ctx = ctx

        self.current = None
        self.voice = None
        self.next = asyncio.Event()
        self.songs = songQueue()

        self._loop = False
        self._volume = 0.5
        self.skip_votes = set()

        self.audio_player = bot.loop.create_task(self.audio_player_task())

    def __del__(self):
        self.audio_player.cancel()

    @property
    def loop(self):
        return self._loop()
    
    @loop.setter
    def loop(self, value:bool):
        self._loop = value
    
    @property
    def volume(self):
        return self._volume
    
    @volume.setter
    def volume(self, value:float):
        self._volume = value

    @property
    def is_playing(self):
        return self.voice and self.current
    
    async def audio_player_task(self):
        while True:
            self.next.clear()

            if not self.loop:
                #Try to get a song within 3 minutes
                #If no song is added within the time limit the player
                #will be disconnected for performance issues
                try:
                    async with timeout(180): #3 minutes
                        self.current = await self.songs.get()
                except asyncio.TimeoutError:
                    self.bot.loop.create_task(self.stop())
                    return

            self.current.source.volume = self._volume
            self.voice.play(self.current.source, after=self.play_next_song)
            await self.current.source.channel.send(embed = self.current.create_embed())

            await self.next.wait()

    def play_next_song(self, error=None):
        if error:
            raise VoiceError(str(error))

        self.next.set()

    def skip(self):
        self.skip_votes.clear()

        if self.isPlaying:
            self.voice.stop()

    async def stop(self):
        self.songs.clear()

        if self.voice:
            await self.voice.disconnect()
            self.voice = None

