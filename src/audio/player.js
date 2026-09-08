'use strict';

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const prism = require('prism-media');

function connect(channel) {
  return joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
    debug: Boolean(process.env.VOICE_DEBUG),
  });
}

function createPlayer() {
  return createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });
}

/**
 * Transcode a slice of the Deezer MP3 preview straight to Ogg/Opus with
 * short fades, so Discord can play it with no extra re-encoding step.
 */
function makeClipResource(url, { start = 0, duration = 20 } = {}) {
  const fadeOutStart = Math.max(0, duration - 1);
  const transcoder = new prism.FFmpeg({
    args: [
      '-ss', String(start),
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '2',
      '-i', url,
      '-t', String(duration),
      '-vn',
      '-af', `afade=t=in:st=0:d=0.75,afade=t=out:st=${fadeOutStart}:d=1`,
      '-c:a', 'libopus',
      '-b:a', '96k',
      '-ar', '48000',
      '-ac', '2',
      '-f', 'ogg',
      '-loglevel', 'error',
    ],
  });
  return createAudioResource(transcoder, { inputType: StreamType.OggOpus });
}

/**
 * Play one clip on an already-subscribed player and resolve when it finishes.
 */
async function playClip(player, url, opts = {}) {
  const resource = makeClipResource(url, opts);
  player.play(resource);
  await entersState(player, AudioPlayerStatus.Playing, 12_000);
  await entersState(
    player,
    AudioPlayerStatus.Idle,
    (opts.duration ?? 20) * 1000 + 20_000
  );
}

module.exports = { connect, createPlayer, playClip };
