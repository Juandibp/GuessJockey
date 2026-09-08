'use strict';

const { scoring } = require('../config');

/** Multiplier for the Nth person to get a component right (rank is 0-based). */
function orderMultiplier(rank) {
  return scoring.orderMultipliers[rank] ?? scoring.laterMultiplier;
}

/**
 * Points for one correct component (artist OR title).
 * @param {object}  p
 * @param {number}  p.base              base points for this component
 * @param {number}  p.rank              0 = first to get it, 1 = second, ...
 * @param {number}  p.fractionRemaining 0..1 of the guessing window still left
 * @param {boolean} p.isFirst           true only for rank 0 (gets the speed bonus)
 */
function componentPoints({ base, rank, fractionRemaining = 0, isFirst = false }) {
  let pts = base * orderMultiplier(rank);
  if (isFirst && fractionRemaining > 0) {
    pts += scoring.speedBonusMax * fractionRemaining;
  }
  return Math.round(pts);
}

module.exports = { orderMultiplier, componentPoints };
