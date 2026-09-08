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
const { spawn, spawnSync } = require('node:child_process');

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
 * Pick an ffmpeg binary. Order: $FFMPEG_PATH -> system `ffmpeg` (full build,
 * has working HTTPS) -> the `ffmpeg-static` bundle (fallback for dev machines
 * with no system ffmpeg). prism-media picks ffmpeg-static first with no way to
 * override, and its bundle can't open HTTPS URLs on some hosts, so we resolve
 * and spawn ffmpeg ourselves.
 */
function resolveFfmpeg() {
  const candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  candidates.push('ffmpeg');
  try {
    const s = require('ffmpeg-static');
    if (s) candidates.push(s.path || s);
  } catch {
    /* not installed — fine */
  }

  const tried = [];
  for (const bin of candidates) {
    try {
      const r = spawnSync(bin, ['-version'], { windowsHide: true });
      if (r.status === 0) return bin;
      tried.push(`${bin} (exit ${r.status})`);
    } catch (e) {
      tried.push(`${bin} (${e.code || e.message})`);
    }
  }
  console.error('[ffmpeg] no working binary found; tried:', tried.join(', '));
  return 'ffmpeg';
}

const FFMPEG_BIN = resolveFfmpeg();
console.log('[ffmpeg] using:', FFMPEG_BIN);

/**
 * Transcode a slice of the Deezer MP3 preview to Ogg/Opus (with short fades) so
 * Discord can play it with no extra re-encoding step.
 */
function makeClipResource(url, { start = 0, duration = 20 } = {}) {
  const fadeOutStart = Math.max(0, duration - 1);
  const args = [
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
    'pipe:1',
  ];

  const child = spawn(FFMPEG_BIN, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const errs = [];
  child.stderr.on('data', (d) => {
    const s = d.toString().trim();
    if (s) errs.push(s);
  });
  child.on('error', (e) => console.error('[ffmpeg] spawn error:', e.message));
  child.on('close', (code) => {
    if (code) {
      console.error(`[ffmpeg] exit ${code}: ${errs.join(' | ') || '(no stderr)'}`);
    } else if (errs.length) {
      console.error('[ffmpeg]', errs.join(' | '));
    }
  });
  // If the player tears the stream down early, don't leave ffmpeg running.
  child.stdout.once('close', () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });

  return createAudioResource(child.stdout, { inputType: StreamType.OggOpus });
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
    try {
      player.stop(true);
    } catch {}
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
