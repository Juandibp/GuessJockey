'use strict';

const { deezer } = require('./config');

/**
 * Deezer has a free, keyless public API. Every track carries a `preview` field:
 * a 30-second 128kbps MP3 hosted on their CDN. That is all this game needs.
 */

async function dz(path) {
  const res = await fetch(`${deezer.api}${path}`, {
    headers: { 'User-Agent': 'guess-jockey-bot (+https://github.com)' },
  });
  if (!res.ok) throw new Error(`Deezer HTTP ${res.status} for ${path}`);
  const json = await res.json();
  if (json && json.error) {
    throw new Error(`Deezer API error: ${JSON.stringify(json.error)}`);
  }
  return json;
}

function parsePlaylistId(input) {
  if (!input) return null;
  const str = String(input).trim();
  const m =
    str.match(/playlist[/=](\d+)/i) ||
    str.match(/^(\d{3,})$/);
  return m ? m[1] : null;
}

function mapTrack(t) {
  return {
    id: t.id,
    title: t.title_short || t.title, // title_short drops "(feat. …)" clutter
    fullTitle: t.title,
    artist: t.artist && t.artist.name,
    preview: t.preview,
    cover:
      (t.album && (t.album.cover_medium || t.album.cover_big || t.album.cover)) ||
      null,
    album: (t.album && t.album.title) || null,
    link: t.link || null,
  };
}

async function fetchChartTracks(genreId = 0, limit = 100) {
  const json = await dz(`/chart/${genreId}/tracks?limit=${limit}`);
  return (json.data || []).map(mapTrack);
}

async function fetchPlaylistTracks(id, max = 400) {
  const out = [];
  let index = 0;
  while (out.length < max) {
    const json = await dz(`/playlist/${id}/tracks?limit=100&index=${index}`);
    const batch = json.data || [];
    out.push(...batch.map(mapTrack));
    if (!json.next || batch.length === 0) break;
    index += 100;
  }
  return out;
}

function cleanPool(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    if (!t.preview || !t.artist || !t.title) continue;
    const key = `${t.artist.toLowerCase()}|${t.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a shuffled list of playable tracks for one game.
 * @returns {Promise<Array>} at least `count` tracks, each with a working preview URL
 */
async function buildTrackPool({
  source = 'chart',
  genreId = 0,
  playlistId = null,
  count = 10,
} = {}) {
  let tracks = [];

  if (source === 'playlist' && playlistId) {
    tracks = await fetchPlaylistTracks(playlistId);
    if (cleanPool(tracks).length === 0) {
      throw new Error(
        `Playlist ${playlistId} has no tracks with previews (is it public?).`
      );
    }
  } else {
    tracks = await fetchChartTracks(genreId, 100);
    // Widen the "all" pool so a game feels varied rather than just this week's top 10.
    if (genreId === 0) {
      const extra = await Promise.allSettled([
        fetchChartTracks(132, 100), // pop
        fetchChartTracks(152, 100), // rock
        fetchChartTracks(116, 100), // rap
        fetchChartTracks(113, 100), // dance
      ]);
      for (const r of extra) {
        if (r.status === 'fulfilled') tracks.push(...r.value);
      }
    }
  }

  tracks = cleanPool(tracks);
  if (tracks.length < count) {
    throw new Error(
      `Only found ${tracks.length} playable tracks; need ${count}. Try another genre or playlist.`
    );
  }
  return shuffle(tracks).slice(0, count);
}

module.exports = {
  buildTrackPool,
  parsePlaylistId,
  fetchChartTracks,
  fetchPlaylistTracks,
};
