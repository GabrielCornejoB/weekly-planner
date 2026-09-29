/**
 * Occupancy: which minutes of a day are held, and whether a proposed block may
 * take them.
 *
 * Everything on the grid is exclusive. A work interval, the commute attached to
 * work, the activity of a session or one-off, and the travel attached to either
 * all hold real minutes, and two of them may never share one. This module is the
 * single place that knows what holds what, so the grid, the editors, and every
 * mutation agree about what is free.
 *
 * Two conventions are worth stating once, because everything else follows from
 * them.
 *
 * A placed block stores the first minute it occupies, not the start of its
 * activity. Travel before comes first, so a session with twenty minutes of
 * travel and forty-five of activity starting at 8:00 runs 8:00 to 9:05, and
 * `activityMinutes` is the middle stretch of that. This is what lets a tap on
 * the grid mean "the block starts here" and lets travel be drawn on the block
 * instead of beside it.
 *
 * `startMinute` therefore sits outside the activity, and every check here works
 * on the whole footprint. The product rule is that a session, travel included,
 * must sit entirely inside one free stretch: it may not cross work, and it may
 * not be split across the 12:00–14:00 hole.
 *
 * These functions only answer questions. They do not change a board. Task 8's
 * work mutations, task 10's session mutations, and task 12's grid all ask here
 * rather than re-deriving a comparison, which is how a rule cannot be true in
 * one place and false in another.
 */

import {
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  MIN_TRAVEL_MINUTES,
  MIN_WORK_MINUTES,
  type Board,
  type DayId,
  type DayPlan,
  type OneOff,
  type RefusalReason,
  type Session,
  type TravelMinutes,
  type WorkInterval,
} from '@/domain/types'
import { isOnTypedStep, isWithinDay, rangesOverlap, type MinuteRange } from '@/domain/time'

/** A placed block: one session of a task, or a one-off with no task behind it. */
export type PlacedTarget =
  | { kind: 'session'; id: string }
  | { kind: 'one-off'; id: string }

/** Whatever holds a stretch of the day. */
export type BlockTarget = PlacedTarget | { kind: 'work'; id: string }

/** Which side of its owner a travel or commute stretch sits on. */
export type TravelDirection = 'before' | 'after'

/**
 * One stretch held by one thing. Half-open, so an end may equal a start.
 *
 * The union is on `role` so each case carries only what it can mean: a commute
 * hangs off the day rather than off a block and has no target, an activity
 * always knows which block it belongs to, and a travel stretch always knows
 * which side of the activity it is drawn on.
 */
export type OccupiedStretch =
  | { role: 'work'; target: BlockTarget; startMinute: number; endMinute: number }
  | { role: 'commute'; direction: TravelDirection; startMinute: number; endMinute: number }
  | { role: 'activity'; target: PlacedTarget; startMinute: number; endMinute: number }
  | {
      role: 'travel'
      target: PlacedTarget
      direction: TravelDirection
      startMinute: number
      endMinute: number
    }

/**
 * Everything one thing takes on a day, in the order it happens. Contiguous,
 * with no gap inside it, so the outer range covers every segment.
 */
export type Footprint = OccupiedStretch[]

/**
 * The first and last minute a footprint holds. This is the stretch that has to
 * fit inside 6:00–22:00 and inside one free gap, because the segments are
 * contiguous. An empty footprint is a zero-length range at the top of the day,
 * and every check refuses it as too short anyway.
 */
export function footprintRange(footprint: Footprint): MinuteRange {
  const first = footprint[0]
  if (first === undefined) return { startMinute: DAY_START_MINUTE, endMinute: DAY_START_MINUTE }
  let startMinute = first.startMinute
  let endMinute = first.endMinute
  for (const stretch of footprint) {
    startMinute = Math.min(startMinute, stretch.startMinute)
    endMinute = Math.max(endMinute, stretch.endMinute)
  }
  return { startMinute, endMinute }
}

/** A work interval is one solid stretch. It has no travel of its own. */
export function workFootprint(interval: WorkInterval): Footprint {
  return [workStretch(interval)]
}

function workStretch(interval: WorkInterval): OccupiedStretch {
  return {
    role: 'work',
    target: { kind: 'work', id: interval.id },
    startMinute: interval.startMinute,
    endMinute: interval.endMinute,
  }
}

/**
 * The commute bracketing a work day: before the first work interval and after
 * the last one.
 *
 * A commute attaches to the outer ends of the day and to nothing else. The
 * 12:00–14:00 hole between two work intervals gets no commute, because a trip
 * home at lunch belongs to whatever the person went home for, and going home is
 * not something the app may invent.
 *
 * The first start and the last end are read as a minimum and a maximum rather
 * than as the first and last entries, so an interval added later can sort
 * earlier without the commute quietly attaching to the wrong edge.
 *
 * A day with no work intervals has no commute footprint at all. That is not a
 * refusal, it is the absence of the thing a commute hangs from; `checkCommute`
 * is what turns setting one there into a refusal.
 */
export function commuteFootprint(plan: DayPlan): Footprint {
  const footprint: Footprint = []
  if (plan.workIntervals.length === 0) return footprint

  let firstStart = Number.POSITIVE_INFINITY
  let lastEnd = Number.NEGATIVE_INFINITY
  for (const interval of plan.workIntervals) {
    firstStart = Math.min(firstStart, interval.startMinute)
    lastEnd = Math.max(lastEnd, interval.endMinute)
  }

  if (plan.commuteBeforeMinutes > 0) {
    footprint.push({
      role: 'commute',
      direction: 'before',
      startMinute: firstStart - plan.commuteBeforeMinutes,
      endMinute: firstStart,
    })
  }
  if (plan.commuteAfterMinutes > 0) {
    footprint.push({
      role: 'commute',
      direction: 'after',
      startMinute: lastEnd,
      endMinute: lastEnd + plan.commuteAfterMinutes,
    })
  }
  return footprint
}

/** Travel before, then the activity, then travel after. */
export function sessionFootprint(session: Session): Footprint {
  return placedFootprint(
    { kind: 'session', id: session.id },
    session.startMinute,
    session.activityMinutes,
    session.travel,
  )
}

/** A one-off takes the same shape as a session, with no goal behind it. */
export function oneOffFootprint(oneOff: OneOff): Footprint {
  return placedFootprint(
    { kind: 'one-off', id: oneOff.id },
    oneOff.startMinute,
    oneOff.activityMinutes,
    oneOff.travel,
  )
}

function placedFootprint(
  target: PlacedTarget,
  startMinute: number,
  activityMinutes: number,
  travel: TravelMinutes,
): Footprint {
  const footprint: Footprint = []
  const activityStart = startMinute + travel.beforeMinutes
  const activityEnd = activityStart + activityMinutes

  // A side with no travel emits nothing rather than a zero-length stretch, so
  // an absent commute and an absent travel read the same way.
  if (travel.beforeMinutes > 0) {
    footprint.push({
      role: 'travel',
      target,
      direction: 'before',
      startMinute,
      endMinute: activityStart,
    })
  }
  footprint.push({
    role: 'activity',
    target,
    startMinute: activityStart,
    endMinute: activityEnd,
  })
  if (travel.afterMinutes > 0) {
    footprint.push({
      role: 'travel',
      target,
      direction: 'after',
      startMinute: activityEnd,
      endMinute: activityEnd + travel.afterMinutes,
    })
  }
  return footprint
}

/** Every placed block on a day, with its activity and its travel. */
export function placedOccupancy(board: Board, day: DayId): Footprint {
  return [
    ...board.sessions
      .filter((session) => session.day === day)
      .flatMap((session) => sessionFootprint(session)),
    ...board.oneOffs
      .filter((oneOff) => oneOff.day === day)
      .flatMap((oneOff) => oneOffFootprint(oneOff)),
  ]
}

/**
 * Everything that holds a minute on a day: the work, the commute bracketing it,
 * and every placed block. In order of start minute.
 *
 * `except` drops the stretches belonging to one block, which is how a move or a
 * resize is checked against everything else without being refused for colliding
 * with the block it is moving. Only the named block is dropped: a second session
 * of the same task on the same day is a different block and stays in the way.
 */
export function dayOccupancy(
  board: Board,
  day: DayId,
  except?: BlockTarget,
): Footprint {
  const plan = board.days[day]
  const stretches: Footprint = [
    ...commuteFootprint(plan),
    ...plan.workIntervals.map(workStretch),
    ...placedOccupancy(board, day),
  ]
  const kept =
    except === undefined
      ? stretches
      : stretches.filter((stretch) => !('target' in stretch) || !sameTarget(stretch.target, except))
  return kept.toSorted(byStartMinute)
}

function sameTarget(a: BlockTarget, b: BlockTarget): boolean {
  return a.kind === b.kind && a.id === b.id
}

function byStartMinute(a: OccupiedStretch, b: OccupiedStretch): number {
  return a.startMinute - b.startMinute
}

/**
 * The gaps in a day that nothing holds, from 6:00 to 22:00.
 *
 * A block belongs on the grid only if its whole footprint fits inside one of
 * these. Working out the gaps rather than testing against the occupied stretches
 * means the rule is stated once, as the product states it: a session, travel
 * included, sits inside a single free stretch.
 */
export function freeStretches(board: Board, day: DayId, except?: BlockTarget): MinuteRange[] {
  const free: MinuteRange[] = []
  let cursor = DAY_START_MINUTE
  for (const stretch of dayOccupancy(board, day, except)) {
    if (stretch.startMinute > cursor) {
      free.push({ startMinute: cursor, endMinute: stretch.startMinute })
    }
    cursor = Math.max(cursor, stretch.endMinute)
  }
  if (cursor < DAY_END_MINUTE) {
    free.push({ startMinute: cursor, endMinute: DAY_END_MINUTE })
  }
  return free
}

/**
 * Whether this footprint may sit on this day: nothing outside 6:00–22:00, and
 * every minute of it inside one free stretch. `null` means allowed.
 *
 * The rules it applies are the ones a placement cannot be judged without: a
 * stretch must be a real length, travel and commute must be long enough to mean
 * something, the footprint must stay in the visible day, and it must not
 * overlap anything already there.
 *
 * It deliberately does not check the minimum length of an activity or a work
 * interval. Those differ, `MIN_ACTIVITY_MINUTES` against `MIN_WORK_MINUTES`, so
 * they belong to the mutation that knows which kind of block it is placing.
 */
export function checkFootprintFits(
  board: Board,
  day: DayId,
  footprint: Footprint,
  except?: BlockTarget,
): RefusalReason | null {
  if (footprint.length === 0) return 'too-short'

  for (const stretch of footprint) {
    const refusal = stretchRefusal(stretch)
    if (refusal !== null) return refusal
  }

  const bounds = footprintRange(footprint)
  if (!isWithinDay(bounds)) return 'outside-day'

  const free = freeStretches(board, day, except)
  if (!free.some((stretch) => contains(stretch, bounds))) return 'overlaps'
  return null
}

/**
 * The one commute rule occupancy cannot see.
 *
 * A commute hangs off the outer ends of a work day, so a day with no work
 * intervals cannot carry one. With no work there is no footprint to build and
 * nothing for the minutes to attach to, so a check that only looked at the
 * stretches would accept a commute that occupies no particular time at all.
 *
 * Both directions are answered together, because a day off is a day off: one
 * direction of travel with no work is as impossible as both.
 */
export function checkCommute(plan: DayPlan, commute: TravelMinutes): RefusalReason | null {
  if (plan.workIntervals.length === 0 && (commute.beforeMinutes > 0 || commute.afterMinutes > 0)) {
    return 'commute-without-work'
  }
  return null
}

/**
 * Whether a number of travel minutes is a length a board can hold at all:
 * nothing, or at least five minutes, on the five-minute typed step.
 *
 * Commute and a task's travel are the same rule from the plan, so it is asked
 * once here. `work.ts` and `goals.ts` both hand their typed minutes to this
 * rather than each keeping a copy, which is what stops a commute from accepting
 * 7 minutes while a task's default travel refuses it.
 *
 * The floor is asked before the step, and that order is the point. Every whole
 * number under five is also off the five-minute step, so a person who typed
 * three minutes is told that travel is five minutes or nothing rather than being
 * told their number is not a multiple of five. Both refusals leave the same two
 * choices, so the one that explains the rule is the one worth saying.
 *
 * This judges a number someone typed. `stretchRefusal` below judges a real
 * stretch read back off a day, and needs no step rule: a stretch is the
 * difference of two stored minutes.
 */
export function checkTravelMinutes(minutes: number): RefusalReason | null {
  if (minutes < 0) return 'too-short'
  if (minutes !== 0 && minutes < MIN_TRAVEL_MINUTES) return 'too-short'
  if (!isOnTypedStep(minutes)) return 'not-a-step'
  return null
}

/**
 * Whether a clock position is a time a board can hold at all: not negative, and
 * on the five-minute typed step, so 1:40 is a time and 1:37 is not.
 *
 * This is the one rule a work interval and a placed block share about *when*
 * something is, and it lives here for the same reason `checkTravelMinutes` does.
 * A grid drag reports a quarter hour and a typed field reports a fifth, so both
 * are already on this step and the check never fires on a real drop; what it
 * does is stop 1:37 from being legal for a work interval and illegal for a
 * session, which is the kind of drift that only shows up on a phone.
 *
 * Everything else about a minute, including the 6:00 and 22:00 edges and the
 * fifteen-minute floor, belongs to the check that knows what the minute is for:
 * `checkDayPlan` for work, `checkFootprintFits` for a placed block.
 */
export function checkMinute(minute: number): RefusalReason | null {
  if (minute < 0) return 'too-short'
  if (!isOnTypedStep(minute)) return 'not-a-step'
  return null
}

/**
 * Whether a whole proposed day may replace the stored one: legal commute, legal
 * work intervals, and the resulting work day clear of every placed block.
 *
 * Work is compared against work inside `plan`, not against the day already on
 * the board, because the day being changed is not what the board holds yet.
 * That is what lets a morning interval move from 8:00–12:00 to 10:00–12:00
 * without being refused for the 8:00–10:00 it is leaving.
 *
 * The refusals come back in the order a person would want to hear them: the
 * commute has nowhere to attach, then a work interval that is too short, then
 * two intervals crossing each other, then a proposed stretch that leaves the
 * visible day or lands on a placed block.
 */
export function checkDayPlan(board: Board, day: DayId, plan: DayPlan): RefusalReason | null {
  const commuteRefusal = checkCommute(plan, {
    beforeMinutes: plan.commuteBeforeMinutes,
    afterMinutes: plan.commuteAfterMinutes,
  })
  if (commuteRefusal !== null) return commuteRefusal

  for (const interval of plan.workIntervals) {
    if (interval.endMinute - interval.startMinute < MIN_WORK_MINUTES) return 'too-short'
  }

  for (const [index, interval] of plan.workIntervals.entries()) {
    for (const later of plan.workIntervals.slice(index + 1)) {
      if (rangesOverlap(interval, later)) return 'overlaps'
    }
  }

  const proposed: Footprint = [...plan.workIntervals.map(workStretch), ...commuteFootprint(plan)]
  const blocks = placedOccupancy(board, day)
  for (const stretch of proposed) {
    const refusal = stretchRefusal(stretch)
    if (refusal !== null) return refusal
    if (!isWithinDay(stretch)) return 'outside-day'
    if (blocks.some((block) => rangesOverlap(stretch, block))) return 'overlaps'
  }
  return null
}

/**
 * What one stretch must satisfy before it meets anything else: a real length,
 * and for travel or commute, long enough to mean something.
 *
 * Travel and commute are either nothing or at least five minutes, because three
 * minutes of travel is a smudge on the grid rather than a trip.
 */
function stretchRefusal(stretch: OccupiedStretch): RefusalReason | null {
  const length = stretch.endMinute - stretch.startMinute
  if (length <= 0) return 'too-short'
  if (stretch.role === 'travel' || stretch.role === 'commute') {
    if (length < MIN_TRAVEL_MINUTES) return 'too-short'
  }
  return null
}

function contains(outer: MinuteRange, inner: MinuteRange): boolean {
  return outer.startMinute <= inner.startMinute && inner.endMinute <= outer.endMinute
}
