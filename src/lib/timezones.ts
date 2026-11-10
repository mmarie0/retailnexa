export const US_TIMEZONES = [
  ['America/New_York', 'Eastern'],
  ['America/Chicago', 'Central'],
  ['America/Denver', 'Mountain'],
  ['America/Phoenix', 'Arizona'],
  ['America/Los_Angeles', 'Pacific'],
  ['America/Anchorage', 'Alaska'],
  ['Pacific/Honolulu', 'Hawaii'],
  ['America/Puerto_Rico', 'Atlantic (Puerto Rico)'],
] as const;
export const TIMEZONE_IDS = US_TIMEZONES.map(([id]) => id) as unknown as [string, ...string[]];
