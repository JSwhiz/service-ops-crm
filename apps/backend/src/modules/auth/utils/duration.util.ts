const DURATION_MULTIPLIERS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseDurationToMs(rawDuration: string): number {
  const normalized = rawDuration.trim();

  if (!normalized) {
    throw new Error('Duration value cannot be empty');
  }

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const match = normalized.match(/^(\d+)([smhd])$/i);

  if (!match) {
    throw new Error(`Unsupported duration format: ${rawDuration}`);
  }

  const [, amountRaw, unitRaw] = match;
  const amount = Number(amountRaw);
  const unit = (unitRaw ?? '').toLowerCase();
  const multiplier = DURATION_MULTIPLIERS[unit];

  if (!multiplier) {
    throw new Error(`Unsupported duration unit: ${unitRaw}`);
  }

  return amount * multiplier;
}
