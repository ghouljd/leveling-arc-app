export const missions = [
  { id: 'word', name: 'Integrity', xp: 8, mc: 2, episodic: true },
  { id: 'control', name: 'Self-control', xp: 8, mc: 2, episodic: true },
  { id: 'food', name: 'Nutrition', xp: 8, mc: 2, episodic: true },
  { id: 'alcohol', name: 'Abstinence', xp: 8, mc: 2, episodic: true },
  { id: 'focus', name: 'Personal focus', xp: 8, mc: 2, episodic: true },
  { id: 'reading', name: 'Reading', xp: 10, mc: 2, episodic: false },
  { id: 'sleep', name: 'Sleep', xp: 15, mc: 3, episodic: false },
  { id: 'pushups', name: 'Push-ups', xp: 8, mc: 2, episodic: false },
  { id: 'abs', name: 'Crunches', xp: 8, mc: 2, episodic: false },
  { id: 'squats', name: 'Squats', xp: 8, mc: 2, episodic: false },
  { id: 'steps', name: 'Steps', xp: 8, mc: 2, episodic: false },
  { id: 'airofit', name: 'Airofit training', xp: 8, mc: 2, episodic: false },
  { id: 'coach', name: 'Coach\'s plan', xp: 13, mc: 2, episodic: false },
] as const;
export type Mission = typeof missions[number];
export type Result = 'pending' | 'fulfilled' | 'failed' | 'ticket' | 'exempt';
export function evaluate(mission: Mission, result: Result, uncoveredEpisodes = 0) {
  if (!Number.isSafeInteger(uncoveredEpisodes) || uncoveredEpisodes < 0) throw new Error('Invalid quantity');
  if (result === 'pending' || result === 'exempt') return { xp: 0, mc: 0 };
  if (mission.episodic && uncoveredEpisodes > 0) return { xp: 0, mc: -5 * mission.mc * uncoveredEpisodes };
  if (result === 'failed') {
    if (mission.episodic) throw new Error('An episode-based failure requires a quantity');
    return { xp: 0, mc: -5 * mission.mc };
  }
  if (result === 'ticket') return { xp: 0, mc: 0 };
  return { xp: mission.xp, mc: mission.mc };
}
export function transitionCost(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1) throw new Error('Invalid level');
  return Math.ceil(300 * 1.15 ** (level - 1));
}
export function levelThreshold(level: number): number {
  transitionCost(level);
  let total = 0;
  for (let current = 1; current < level; current++) total += transitionCost(current);
  return total;
}
export function progress(xp: number) {
  if (!Number.isSafeInteger(xp) || xp < 0) throw new Error('Invalid XP');
  let level = 1, remaining = xp;
  while (remaining >= transitionCost(level)) remaining -= transitionCost(level++);
  return { level, current: remaining, next: transitionCost(level), rank: level >= 13 ? 'S' : level >= 10 ? 'A' : level >= 7 ? 'B' : level >= 4 ? 'C' : 'D' };
}
export function sleepResult(bed: string, wake: string, minutes: number, coverage: 'strict' | 'flexible' | 'ticket'): Result {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error('Invalid duration');
  if (minutes < 420) return 'failed';
  if (coverage === 'ticket') return 'ticket';
  if (coverage === 'flexible') return 'fulfilled';
  return bed === '22:30' && wake === '06:30' ? 'fulfilled' : 'failed';
}
