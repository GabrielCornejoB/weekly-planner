/**
 * Work intervals and commute: the only mutations that change a day plan.
 *
 * All five of them take the same shape, and that is the point. A work change is
 * a whole new day rather than a patch on the old one, because the commute
 * hangs off the outer ends of the day's work: move the first start and the
 * morning commute has to move with it, and a rule that judged the interval on
 * its own would miss that entirely. So each function here builds the day that
 * would result, hands it to `checkDayPlan`, and only then makes a board. One
 * door, five ways through it, and no arithmetic that `schedule.ts` already owns.
 *
 * These functions refuse rather than repair, and they never write to the board
 * they were given. A refused change leaves the caller's board exactly as it
 * was, which is what lets the grid put a dragged block back where it came from
 * and lets the orchestrator keep showing the old week while the sentence
 * explains why the new one is refused.
 *
 * Three decisions belong here rather than in a component, and each one is
 * load-bearing:
 *
 * - Work does not change days. An interval is moved, resized, or removed inside
 *   the day it is already on, and which days have work at all is the day
 *   editor's question. A drop on another column finds no interval there and is
 *   refused rather than silently pulling the interval off its day.
 * - Removing the last interval takes the commute with it. A commute hangs off
 *   work, so a day with no work cannot keep one; clearing it here is the rule
 *   from the product scope, not a repair of a broken board.
 * - Minutes are checked against the five-minute typed step before anything
 *   else. A 1:37 start is told to use 1:35 or 1:40, which is something a person
 *   can act on, rather than being told it is outside 6:00 to 22:00, which is
 *   true and useless. The bounds and the overlaps are `checkDayPlan`'s. A
 *   commute is the one exception, where the five-minute floor is asked first,
 *   and `commuteRefusal` says why.
 */

import type { CreateId } from '@/domain/board'
import { checkDayPlan } from '@/domain/schedule'
import { isOnTypedStep, type MinuteRange } from '@/domain/time'
import {
  MIN_TRAVEL_MINUTES,
  type Board,
  type DayId,
  type DayPlan,
  type RefusalReason,
  type ResizeEdge,
  type Result,
  type TravelMinutes,
  type WorkInterval,
} from '@/domain/types'

/**
 * The one door. Build the day that would result, ask whether it may replace the
 * stored one, and only then make a board.
 *
 * The day that changed is rebuilt whole, down to fresh interval objects, so
 * nothing on the returned board can be reached through the board it was made
 * from. The other six days are shared, because nothing about them changed.
 * Intervals are stored in clock order, so a backup text reads the same way the
 * grid does; two intervals on a day may not share a start minute, so the order
 * is never ambiguous.
 */
function commit(board: Board, day: DayId, candidate: (plan: DayPlan) => DayPlan): Result<Board> {
  const next = candidate(board.days[day])
  const refusal = checkDayPlan(board, day, next)
  if (refusal !== null) return { ok: false, reason: refusal }

  const rebuilt: DayPlan = {
    ...next,
    workIntervals: next.workIntervals.toSorted(byStartMinute).map(copyInterval),
  }
  return { ok: true, value: { ...board, days: { ...board.days, [day]: rebuilt } } }
}

/**
 * Put a new interval on a day. `range` is the whole interval, because adding
 * one is what a day editor does with a start and an end it was given; a move
 * and a resize are the two that work from one end only.
 *
 * The id is spent even when the change is refused, since the check does not
 * depend on it. That costs one uuid and keeps this function a single pass
 * through the door.
 */
export function addWorkInterval(
  board: Board,
  day: DayId,
  range: MinuteRange,
  createId: CreateId,
): Result<Board> {
  const refusal = rangeRefusal(range)
  if (refusal !== null) return { ok: false, reason: refusal }
  return commit(board, day, (plan) => ({
    ...plan,
    workIntervals: [...plan.workIntervals, { id: createId(), ...range }],
  }))
}

/**
 * Slide an interval to a new start, keeping the length it had. A drag reports
 * where the block was dropped and the block keeps its own height, so the end
 * is derived rather than restated.
 */
export function moveWorkInterval(
  board: Board,
  day: DayId,
  id: string,
  startMinute: number,
): Result<Board> {
  const badMinute = minuteRefusal(startMinute)
  if (badMinute !== null) return { ok: false, reason: badMinute }
  const interval = findInterval(board, day, id)
  if (interval === null) return missingWork()
  // Both ends of the interval were on the five-minute step already, so a start
  // that is on the step gives an end that is on it too.
  const length = interval.endMinute - interval.startMinute
  return commit(board, day, (plan) => replaceInterval(plan, id, startMinute, startMinute + length))
}

/**
 * Move one end of an interval and leave the other where it is. This is the same
 * mutation behind a grid resize and behind the two typed fields in the day
 * editor, so 1:40 is a legal edge and a fifteen-minute snap is the only
 * difference between the two callers.
 */
export function resizeWorkInterval(
  board: Board,
  day: DayId,
  id: string,
  edge: ResizeEdge,
  minute: number,
): Result<Board> {
  const badMinute = minuteRefusal(minute)
  if (badMinute !== null) return { ok: false, reason: badMinute }
  const interval = findInterval(board, day, id)
  if (interval === null) return missingWork()
  return commit(board, day, (plan) =>
    edge === 'start'
      ? replaceInterval(plan, id, minute, interval.endMinute)
      : replaceInterval(plan, id, interval.startMinute, minute),
  )
}

/**
 * Take an interval off a day. Removing the last one makes the day a day off,
 * and the commute goes with it, because there is no work left for it to hang
 * from.
 *
 * The check still runs, because every change goes through the same door, but a
 * removal can only ever free time: nothing already on the day can be in the
 * way, so this is the one change that is never refused for a reason of its own.
 */
export function removeWorkInterval(board: Board, day: DayId, id: string): Result<Board> {
  if (findInterval(board, day, id) === null) return missingWork()
  return commit(board, day, (plan) => withoutInterval(plan, id))
}

/**
 * Set the travel to work, either direction or both. The two lengths are
 * independent and either may be zero; the default on every day is neither.
 *
 * Lengthening a commute grows it outward from the work edge, so the check
 * behind this is the one that refuses when it would reach a block or leave the
 * visible day.
 */
export function setCommute(board: Board, day: DayId, commute: TravelMinutes): Result<Board> {
  const badMinute = commuteRefusal(commute.beforeMinutes) ?? commuteRefusal(commute.afterMinutes)
  if (badMinute !== null) return { ok: false, reason: badMinute }
  return commit(board, day, (plan) => ({
    ...plan,
    commuteBeforeMinutes: commute.beforeMinutes,
    commuteAfterMinutes: commute.afterMinutes,
  }))
}

/** The day without that interval, and without a commute once no work is left. */
function withoutInterval(plan: DayPlan, id: string): DayPlan {
  const workIntervals = plan.workIntervals.filter((interval) => interval.id !== id)
  if (workIntervals.length > 0) return { ...plan, workIntervals }
  return { workIntervals, commuteBeforeMinutes: 0, commuteAfterMinutes: 0 }
}

function replaceInterval(
  plan: DayPlan,
  id: string,
  startMinute: number,
  endMinute: number,
): DayPlan {
  return {
    ...plan,
    workIntervals: plan.workIntervals.map((interval) =>
      interval.id === id ? { id, startMinute, endMinute } : interval,
    ),
  }
}

function findInterval(board: Board, day: DayId, id: string): WorkInterval | null {
  return board.days[day].workIntervals.find((interval) => interval.id === id) ?? null
}

/**
 * No interval with that id on that day. It is its own reason rather than a
 * borrowed one: saying a work block is missing a goal would be nonsense, and
 * this is the answer for a stale drop, where the block belongs to another day
 * because work never changes days.
 */
function missingWork(): Result<Board> {
  return { ok: false, reason: 'missing-work' }
}

function rangeRefusal(range: MinuteRange): RefusalReason | null {
  return minuteRefusal(range.startMinute) ?? minuteRefusal(range.endMinute)
}

/**
 * The floor is asked before the step here, which is the opposite order to a
 * time, and for a reason. Every whole number under five is also off the
 * five-minute step, so a person who typed three minutes of commute is told
 * that a commute is five minutes or nothing rather than being told their
 * number is not a multiple of five. Both refusals leave the same two choices,
 * so the one that explains the rule is the one worth saying.
 */
function commuteRefusal(minutes: number): RefusalReason | null {
  if (minutes !== 0 && minutes < MIN_TRAVEL_MINUTES) return 'too-short'
  return minuteRefusal(minutes)
}

/**
 * Whether a minute is a length a board can hold at all: not negative, and on
 * the five-minute typed step, so 1:40 is a time and 1:37 is not. Everything
 * else about a minute, including the day edges and the fifteen-minute floor,
 * belongs to `checkDayPlan`.
 */
function minuteRefusal(minute: number): RefusalReason | null {
  if (minute < 0) return 'too-short'
  if (!isOnTypedStep(minute)) return 'not-a-step'
  return null
}

function byStartMinute(a: WorkInterval, b: WorkInterval): number {
  return a.startMinute - b.startMinute
}

function copyInterval(interval: WorkInterval): WorkInterval {
  return { id: interval.id, startMinute: interval.startMinute, endMinute: interval.endMinute }
}
