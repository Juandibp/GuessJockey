'use strict';

const { distance } = require('fastest-levenshtein');

// "feat. X", "ft X", "featuring X" -> drop from here to end of string
const FEAT = /\b(feat|ft|featuring)\b.*$/i;

// " - 2011 Remaster", " - Radio Edit", etc.
const EDITION =
  /\s*[-–—]\s*[^-–—]*?\b(remaster(?:ed)?|radio edit|single version|album version|mono|stereo|deluxe|anniversary|re-?recorded|live|version|edit)\b.*$/i;

const DIACRITICS = /[̀-ͯ]/g;

/**
 * Visual look-alikes used in band/song styling, mapped to the ASCII letter they
 * resemble (NOT a linguistically correct transliteration): "KoЯn" -> "korn",
 * "P!nk" -> "pink", "Ke$ha" -> "kesha", "Sigur Rós" handled by diacritics.
 */
const CONFUSABLES = {
  // Cyrillic homoglyphs
  а: 'a', б: 'b', в: 'b', г: 'r', д: 'a', е: 'e', ж: 'x', з: '3', и: 'n',
  й: 'n', к: 'k', л: 'a', м: 'm', н: 'h', о: 'o', п: 'n', р: 'p', с: 'c',
  т: 't', у: 'y', ф: 'o', х: 'x', ц: 'u', ч: '4', ш: 'w', щ: 'w', ъ: '',
  ы: 'bi', ь: '', э: 'e', ю: 'io', я: 'r',
  // Greek homoglyphs
  α: 'a', β: 'b', γ: 'r', δ: 'd', ε: 'e', ζ: 'z', η: 'n', θ: 'o', ι: 'i',
  κ: 'k', λ: 'a', μ: 'u', ν: 'v', ξ: 'e', ο: 'o', π: 'n', ρ: 'p', σ: 'o',
  ς: 's', τ: 't', υ: 'u', φ: 'o', χ: 'x', ψ: 'w', ω: 'w',
  // Latin extended + symbols that stand in for a letter
  ø: 'o', đ: 'd', ð: 'd', ł: 'l', þ: 'p', ß: 'ss', æ: 'ae', œ: 'oe',
  ə: 'e', ǝ: 'e', ɪ: 'i', ʌ: 'v', '∀': 'a', '∆': 'a', '∂': 'd',
  $: 's', '€': 'e', '£': 'l', '¥': 'y', µ: 'u', '@': 'a', '!': 'i',
  '©': 'c', '®': 'r', '™': 'tm', '†': 't', '×': 'x',
};

function deConfusable(s) {
  let out = '';
  for (const ch of s) out += CONFUSABLES[ch] ?? ch;
  return out;
}

/**
 * Fold a title/artist/guess down to a bare comparable form:
 * lowercase, look-alikes -> ASCII, no accents, no bracketed asides, no "feat",
 * no edition tags, "&" -> "and", punctuation stripped, leading articles dropped.
 */
function normalize(str) {
  return deConfusable(String(str || '').toLowerCase())
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(FEAT, ' ')
    .replace(EDITION, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalized similarity in [0, 1]. 1 == identical after normalization. */
function closeness(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const d = distance(x, y);
  return 1 - d / Math.max(x.length, y.length);
}

/**
 * Does `guess` count as `answer`?
 * Accepts exact-after-normalize, substring containment either way (when the
 * shorter side covers enough of the longer), and fuzzy similarity over threshold.
 */
function isMatch(guess, answer, threshold = 0.82) {
  const g = normalize(guess);
  const a = normalize(answer);
  if (!g || !a) return false;
  if (g === a) return true;

  // spacing-only differences: "acdc" vs "ac dc", "twentyonepilots" vs "twenty one pilots"
  if (g.replace(/\s+/g, '') === a.replace(/\s+/g, '')) return true;

  // "it's obviously bohemian rhapsody" contains the whole answer
  if (a.length >= 5 && g.includes(a)) return true;
  // guess is nearly all of the answer (typo tolerance handled below)
  if (g.length >= 5 && a.includes(g) && g.length / a.length >= 0.75) return true;

  return closeness(g, a) >= threshold;
}

module.exports = { normalize, closeness, isMatch };
