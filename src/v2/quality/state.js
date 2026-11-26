import { TIER_ORDER, TIERS } from '../../render/quality.js';

export const DEFAULT_TIER = 'high';
let tier = DEFAULT_TIER;

export const currentTier = () => tier;
export const tierConfig = () => TIERS[tier];

export function setTier(name) {
  if (!TIER_ORDER.includes(name) || name === tier) return false;
  tier = name;
  return true;
}
