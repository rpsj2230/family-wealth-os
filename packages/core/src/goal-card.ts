/**
 * The figures on one goal's progress card, in words a person can read at a glance. Pure; the numbers come from projectGoal.
 */
import type { GoalProjection } from './goals';
import { formatInr } from './money';

export interface GoalCardInput {
  proj: GoalProjection;
  /** worth today of the money earmarked for the goal */
  allocated: number;
}

export interface GoalCardFigures {
  state: GoalProjection['status'];
  /** 0..100: how much of the cost then the projection covers (capped for the bar) */
  fundedPct: number | null;
  /** 0..100: how much of the cost then is already earmarked today */
  earmarkedPct: number | null;
  /** extra to put in each month to close the gap; 0 when on track */
  topUp: number;
  headline: string;
}

export function goalCardFigures(i: GoalCardInput): GoalCardFigures {
  const { proj } = i;
  if (proj.status === 'no_target' || proj.status === 'past_due')
    return {
      state: proj.status,
      fundedPct: null,
      earmarkedPct: null,
      topUp: 0,
      headline:
        proj.status === 'no_target'
          ? 'Set a target and a date to see if this goal is funded.'
          : 'The target date has passed. Move the date or leave the goal as it is.',
    };
  const funded = Math.min(100, Math.max(0, (proj.fundedPct ?? 0) * 100));
  const earmarked =
    proj.futureCost && proj.futureCost > 0
      ? Math.min(100, Math.max(0, (i.allocated / proj.futureCost) * 100))
      : null;
  const topUp = Math.max(0, Math.round(proj.requiredMonthlyExtra ?? 0));
  return {
    state: proj.status,
    fundedPct: Math.round(funded),
    earmarkedPct: earmarked === null ? null : Math.round(earmarked),
    topUp,
    headline:
      proj.status === 'on_track'
        ? 'On track under these assumptions.'
        : `Short of the target under these assumptions. About ${formatInr(topUp)} more each month closes it.`,
  };
}
