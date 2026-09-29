/**
 * How a task is doing: the quota math, and the sentence the list shows.
 *
 * A goal is the only thing in this app that has a fraction. This module answers
 * two questions about it, in one place so the list cannot contradict itself:
 * how much has been done against the quota, and what the row should read. It
 * sums and it formats. It changes nothing and refuses nothing, because no shape
 * of progress is worth refusing: going past the goal is allowed and is reported
 * honestly, and unplaced stops at zero.
 *
 * Two rules are easy to get wrong, and both are from the product scope:
 *
 * - **Only a done block counts as done.** Time on the grid that is still planned
 *   is not progress, so `done` is the activity of the blocks marked done and
 *   nothing else. Placed is a different number and is reported as such, because
 *   the distance between the two is the whole point of the sentence.
 * - **Travel never counts.** Not toward a time budget, not toward a visit, and
 *   not toward a visit's length. So this module reads `activityMinutes` and
 *   never walks a footprint: an hour of study inside an hour and a half of
 *   door-to-door reading is one hour, and a two-hour trip to the gym is one
 *   visit however long the drive was.
 *
 * A one-off is not a goal and has no fraction. A done mark on a dentist
 * appointment is a mark, not a total, so one-offs are not counted here at all.
 *
 * Decisions recorded here, each pinned by a test:
 *
 * - **Both sides whole hours is the short form, and it drops the unit on the
 *   goal**: `2 hours done of 5.` rather than `2 hours done of 5 hours.` That is
 *   how the worked examples in the product scope read, and the short form is
 *   the one a person sees most often, so it is the shorter one. The long form
 *   names both sides in full — `1 hour 40 minutes done of 5 hours.` — and it
 *   starts as soon as *either* side is not a whole number of hours, so a row
 *   can never mix the two forms.
 * - **Zero is a whole number of hours, and the short form counts hours itself.**
 *   A task with nothing done yet reads `0 hours done of 5.`, and the news is in
 *   the second clause, which is the part a person is looking for. Spelling that
 *   as "nothing is done yet" would be a second wording of a number the first
 *   clause already gives exactly. The hours are counted here rather than handed
 *   to `formatDuration`, because that spells a zero as `0 minutes` — right for a
 *   length such as absent travel, wrong for a total, where it would put two
 *   different units in one clause.
 * - **The surplus clause waits until it is not redundant.** Six hours done of
 *   five reads `6 hours done of 5. Nothing is unplaced.` — the surplus is
 *   already in the first clause, and a third sentence about it would say the
 *   same thing twice. It appears when the grid holds more than the goal while
 *   the done total has not caught up, which is the case where the surplus is
 *   information the reader does not have yet.
 * - **Unplaced cannot go below zero, and the surplus is measured on the grid.**
 *   Six hours placed of five is nothing unplaced and one hour over, rather than
 *   a negative unplaced: both numbers are read by a person, and "−1 hour is
 *   not on the grid" is a sentence nobody should ever see.
 * - **Done can never exceed placed**, since every done block is a placed block,
 *   so measuring against the grid is the same as measuring against the done
 *   total and there is only one surplus to keep.
 * - **The status is derived here and never stored.** `unplaced` is checked
 *   first, because time that is not on the grid is the thing a person can act
 *   on; then `over`; then `met`; and `planned` is whatever is left. The
 *   component maps these four names to classes, so it never has to work out for
 *   itself which of them a row is.
 */

import { formatDuration } from '@/domain/time'
import type { Board, Goal, Session } from '@/domain/types'

/** An hour, in minutes. Progress is quoted in hours wherever it can be. */
const MINUTES_PER_HOUR = 60

/**
 * How a goal stands in the list. Derived from the numbers, never stored on a
 * board, so it cannot go stale behind a mutation.
 */
export type ProgressStatus = 'unplaced' | 'planned' | 'met' | 'over'

/**
 * One row's progress, ready to be rendered.
 *
 * Every number is in the unit the task uses: minutes for a time budget, visits
 * for a count. `unplaced` is the goal minus everything placed, and `over` is
 * everything placed minus the goal; neither is negative, and only one of them
 * can be above zero at a time.
 */
export interface GoalProgress {
  goalId: string
  kind: Goal['kind']
  /** Activity minutes marked done, or visits marked done. */
  done: number
  /** Activity minutes on the grid, or visits on the grid, done or not. */
  placed: number
  /** The quota itself: `goalMinutes` or `goalCount`. */
  goal: number
  /** What is still missing from the grid, never below zero. */
  unplaced: number
  /** What is on the grid beyond the goal, never below zero. */
  over: number
  status: ProgressStatus
  /** The whole row as one string, e.g. `2 hours done of 5. 1 hour is not on the grid.` */
  sentence: string
}

/**
 * The three numbers every sentence is built from, in the unit the task uses.
 *
 * A time budget is counted in minutes of activity and a visit count in visits,
 * and the length of a visit is deliberately not part of the count: two gym
 * visits of 45 and 90 minutes are two visits, not two and a quarter hours.
 * That is the whole difference between the two kinds, so it is the only place
 * `kind` is read here.
 */
function totals(goal: Goal, sessions: Session[]): { done: number; placed: number; goal: number } {
  if (goal.kind === 'count') {
    return {
      goal: goal.goalCount,
      placed: sessions.length,
      done: sessions.filter((session) => session.done).length,
    }
  }
  return {
    goal: goal.goalMinutes,
    placed: activityMinutes(sessions),
    done: activityMinutes(sessions.filter((session) => session.done)),
  }
}

function activityMinutes(sessions: Session[]): number {
  return sessions.reduce((total, session) => total + session.activityMinutes, 0)
}

/**
 * What the list shows for one task.
 *
 * The goal is handed in rather than looked up, because the caller is already
 * walking `board.goals` to build the list, and a goal that is not on this board
 * has no honest progress to report.
 */
export function goalProgress(board: Board, goal: Goal): GoalProgress {
  const sessions = board.sessions.filter((session) => session.goalId === goal.id)
  const { done, placed, goal: quota } = totals(goal, sessions)
  const unplaced = Math.max(0, quota - placed)
  const over = Math.max(0, placed - quota)
  return {
    goalId: goal.id,
    kind: goal.kind,
    done,
    placed,
    goal: quota,
    unplaced,
    over,
    status: statusOf(unplaced, over, done, quota),
    sentence: sentenceOf(goal.kind, done, placed, quota),
  }
}

/**
 * The row, in the order a person reads it: how much is done against the goal,
 * then what is not on the grid, and then — only if it is news — what is on the
 * grid beyond the goal.
 */
function sentenceOf(kind: Goal['kind'], done: number, placed: number, quota: number): string {
  const unplaced = Math.max(0, quota - placed)
  const over = Math.max(0, placed - quota)
  const clauses = [doneOfClause(kind, done, quota), unplacedClause(kind, unplaced)]
  if (over > 0 && done <= quota) clauses.push(overClause(kind, over))
  return clauses.join(' ')
}

/**
 * `2 hours done of 5.`, or `1 hour 40 minutes done of 5 hours.`, or `1 of 3 done.`
 *
 * The short form is a whole number of hours on both sides and leaves the goal
 * bare, which is how the product scope's worked examples read. Anything less
 * than that on either side names both sides in full rather than rounding one of
 * them, because a quota of 1 hour 40 minutes is a real number the person typed.
 */
function doneOfClause(kind: Goal['kind'], done: number, quota: number): string {
  if (kind === 'count') return `${done} of ${quota} done.`
  if (isWholeHour(done) && isWholeHour(quota)) {
    return `${asHours(done)} done of ${quota / 60}.`
  }
  return `${formatDuration(done)} done of ${formatDuration(quota)}.`
}

/**
 * A whole number of hours read as hours, rather than through `formatDuration`.
 *
 * `formatDuration` spells a zero as `0 minutes`, which is right for a length —
 * travel can be absent and zero is still a length — and wrong here, where the
 * short form is counting hours: `0 minutes done of 5` would name two different
 * units in one clause. The goal is written as a bare number because that is how
 * the product scope's worked examples read.
 */
function asHours(minutes: number): string {
  const hours = minutes / MINUTES_PER_HOUR
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

/** `1 hour is not on the grid.`, `2 visits are not on the grid.`, or nothing. */
function unplacedClause(kind: Goal['kind'], unplaced: number): string {
  if (unplaced === 0) return 'Nothing is unplaced.'
  const length = measure(kind, unplaced)
  return `${length.text} ${length.singular ? 'is' : 'are'} not on the grid.`
}

/** `1 hour more than the goal is on the grid.` */
function overClause(kind: Goal['kind'], over: number): string {
  const length = measure(kind, over)
  return `${length.text} more than the goal ${length.singular ? 'is' : 'are'} on the grid.`
}

/**
 * A number with its unit, and whether that unit is singular, so that `1 hour is`
 * and `4 hours are` can both be written without the test appearing twice.
 *
 * The verb agrees with the quantity, not with the presence of an hour: one hour
 * is singular and four hours are plural, and a quantity of minutes is plural
 * however many hours are in it, so "1 hour 40 minutes are not on the grid".
 */
function measure(kind: Goal['kind'], count: number): { text: string; singular: boolean } {
  if (kind === 'count') {
    return { text: `${count} ${count === 1 ? 'visit' : 'visits'}`, singular: count === 1 }
  }
  return { text: formatDuration(count), singular: count === MINUTES_PER_HOUR }
}

function isWholeHour(minutes: number): boolean {
  return minutes % MINUTES_PER_HOUR === 0
}

/**
 * Which of the four the row is.
 *
 * `unplaced` is asked first because time that is not on the grid is the thing a
 * person can act on: a task with four of five hours done and nothing else
 * placed has still not been planned, and the week is not ready because of it.
 */
function statusOf(unplaced: number, over: number, done: number, quota: number): ProgressStatus {
  if (unplaced > 0) return 'unplaced'
  if (over > 0) return 'over'
  return done >= quota ? 'met' : 'planned'
}
