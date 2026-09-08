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

  // Surface ffmpeg's own errors (can't open URL, no libopus, 403, …).
  const stderr = [];
  transcoder.process?.stderr?.on('data', (d) => {
    const s = d.toString().trim();
    if (s) stderr.push(s);
  });
  transcoder.on('error', (e) => console.error('[ffmpeg] error:', e.message));
  transcoder.process?.on('close', (code) => {
    if (code && code !== 255) {
      console.error(`[ffmpeg] exited ${code}: ${stderr.join(' | ') || '(no stderr)'}`);
    } else if (stderr.length) {
      console.error('[ffmpeg]', stderr.join(' | '));
    }
  });

  return createAudioResource(transcoder, { inputType: StreamType.OggOpus });
}

/**
 * Play one clip on an already-subscribed player and resolve when it finishes.
 * Throws if the clip never really played (ffmpeg/preview failure), so the
 * caller can skip the round instead of pretending it happened.
 */
async function playClip(player, url, opts = {}) {
  const resource = makeClipResource(url, opts);
  player.play(resource);

  try {
    await entersState(player, AudioPlayerStatus.Playing, 12_000);
  } catch {
    try { player.stop(true); } catch {}
    throw new Error('clip never started playing (ffmpeg could not open the preview)');
  }

  const startedAt = Date.now();
  await entersState(
    player,
    AudioPlayerStatus.Idle,
    (opts.duration ?? 20) * 1000 + 20_000
  );

  const playedMs = Date.now() - startedAt;
  if (playedMs < 1500) {
    throw new Error(`clip produced almost no audio (played ${playedMs}ms)`);
  }
}

module.exports = { connect, createPlayer, playClip };
