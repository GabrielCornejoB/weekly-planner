/**
 * Goal definitions: the named tasks that carry a color, a quota, and the
 * defaults a newly placed block of that task starts with.
 *
 * A goal is the only place a name, a color, and a quota live. A session does not
 * copy them, and that is the whole design: "changing the name changes every
 * block of this task" is true by construction rather than by a loop that has to
 * remember to visit every session. The grid reads the name off the goal, so
 * there is nothing on a block to update and nothing that can fall out of step.
 *
 * Default travel is the one field that *is* copied onto a session, because the
 * footprint of a placed block is real minutes of a day. So a change to the
 * default reaches the sessions that still follow it, and leaves alone the ones
 * whose travel a person edited for a day that is different.
 *
 * These functions refuse rather than repair, and they never write to the board
 * they were given, so the orchestrator can keep showing the old list while a
 * sentence explains why the new one was refused.
 *
 * Decisions recorded here, each pinned by a test:
 *
 * - The kind is fixed at create time. `updateGoal` is handed a whole draft, kind
 *   included, and a draft whose kind does not match the goal it is editing is
 *   refused `kind-locked` rather than being coerced. A form owns every field of
 *   a goal, so the draft is the whole goal; there is no partial update whose
 *   kind could be quietly left out.
 * - Quotas have their own rule and their own reason. A visit count is a whole
 *   number of at least one; a time budget is at least one shortest activity,
 *   fifteen minutes. Neither is asked about the five-minute typed step, which
 *   the plan states for clock positions and which a default activity length does
 *   need, because that length becomes a block's real minutes on the grid.
 * - Names are stored exactly as they were typed. A name of nothing but spaces
 *   is refused as empty, since nobody meant to name a task that, but nothing is
 *   trimmed or otherwise tidied.
 * - Goals are appended and never sorted. The product scope puts priorities out
 *   of scope, so the order of the list is the order the person made them.
 * - A refused create mints no id. The checks do not need one, so a refused
 *   change cannot spend the app's uuid source.
 */

import type { CreateId } from '@/domain/board'
import { checkTravelMinutes } from '@/domain/schedule'
import { isOnTypedStep } from '@/domain/time'
import {
  MAX_NAME_LENGTH,
  MIN_ACTIVITY_MINUTES,
  type Board,
  type ColorId,
  type Goal,
  type RefusalReason,
  type Result,
  type Session,
  type TravelMinutes,
} from '@/domain/types'

/**
 * A time budget on its way to becoming a goal. The union is on `kind`, the same
 * discriminant the stored goal has, so a count goal cannot be handed minutes and
 * a time goal cannot be handed a visit count: the illegal shape does not
 * compile rather than being checked at runtime.
 *
 * A draft is the whole goal, not a patch. A form owns every field, and an edit
 * is that form submitted again, so there is no field a caller can leave out and
 * no way for a name edit to be half applied.
 */
export interface TimeGoalDraft {
  kind: 'time'
  name: string
  colorId: ColorId
  goalMinutes: number
  defaultActivityMinutes: number
  defaultTravel: TravelMinutes
}

export interface CountGoalDraft {
  kind: 'count'
  name: string
  colorId: ColorId
  goalCount: number
  defaultActivityMinutes: number
  defaultTravel: TravelMinutes
}

export type GoalDraft = TimeGoalDraft | CountGoalDraft

/**
 * The goal with that id, or `null`. Task 10 needs it to place a session, since
 * that is where a block's first activity length and travel come from.
 */
export function findGoal(board: Board, id: string): Goal | null {
  return board.goals.find((goal) => goal.id === id) ?? null
}

/**
 * Add a task definition. Nothing is placed by this: the defaults it carries are
 * what the *next* block of this task will start with, and the person still puts
 * that block somewhere themselves.
 */
export function createGoal(board: Board, draft: GoalDraft, createId: CreateId): Result<Board> {
  const refusal = draftRefusal(draft)
  if (refusal !== null) return { ok: false, reason: refusal }
  const goal = fromDraft(draft, createId())
  return { ok: true, value: { ...board, goals: [...board.goals, goal] } }
}

/**
 * Change a task definition. The name, color, quota, default length, and default
 * travel may all change; the kind may not.
 *
 * Only default travel reaches a session. A name or a color changes every block
 * of the task because the block reads it off the goal, so no session is touched
 * at all and a block keeps its own activity length, which is what a quota change
 * has to mean: the numbers move, nothing on the grid does.
 */
export function updateGoal(board: Board, id: string, draft: GoalDraft): Result<Board> {
  const index = board.goals.findIndex((goal) => goal.id === id)
  if (index < 0) return { ok: false, reason: 'missing-goal' }
  // The kind is the answer to "which task is this", so it is checked before the
  // draft's other fields: a form that submitted the wrong kind has nothing else
  // worth saying until the kind is put right.
  if (board.goals[index].kind !== draft.kind) return { ok: false, reason: 'kind-locked' }

  const refusal = draftRefusal(draft)
  if (refusal !== null) return { ok: false, reason: refusal }

  const goal = fromDraft(draft, id)
  return {
    ok: true,
    value: {
      ...board,
      goals: board.goals.map((existing, at) => (at === index ? goal : existing)),
      sessions: followingDefaultTravel(board.sessions, id, draft.defaultTravel),
    },
  }
}

/**
 * Delete a task, and every block of it.
 *
 * Removing the goal's sessions with it is not tidying: a session is a placed
 * block *of that task*, and a block whose task does not exist has no name, no
 * color, and no quota to count against. One-offs are left alone, since a one-off
 * owns its own name, color, and time and was never a session of anything.
 *
 * The caller asks the person to confirm first. That is a dialog, not a rule, so
 * it belongs to the orchestrator and not here.
 */
export function deleteGoal(board: Board, id: string): Result<Board> {
  if (findGoal(board, id) === null) return { ok: false, reason: 'missing-goal' }
  return {
    ok: true,
    value: {
      ...board,
      goals: board.goals.filter((goal) => goal.id !== id),
      sessions: board.sessions.filter((session) => session.goalId !== id),
    },
  }
}

/**
 * Carry a new default travel to the sessions that are still using the old one.
 *
 * A session whose travel was edited keeps that edit, so it is left exactly as it
 * is. A session already holding the new lengths is left alone as well, and when
 * nothing needed to move the whole array is handed straight back, so a name,
 * color, or quota edit does not rebuild a single block of the task: not one
 * object, and not the array either.
 */
function followingDefaultTravel(
  sessions: Session[],
  goalId: string,
  travel: TravelMinutes,
): Session[] {
  let moved = false
  const next = sessions.map((session) => {
    if (session.goalId !== goalId || !session.travelFollowsDefault) return session
    if (sameTravel(session.travel, travel)) return session
    moved = true
    return {
      ...session,
      travel: { beforeMinutes: travel.beforeMinutes, afterMinutes: travel.afterMinutes },
    }
  })
  return moved ? next : sessions
}

function sameTravel(a: TravelMinutes, b: TravelMinutes): boolean {
  return a.beforeMinutes === b.beforeMinutes && a.afterMinutes === b.afterMinutes
}

/**
 * The goal a draft describes, with an id. The travel is copied rather than held
 * by reference, so nothing on a board can be reached through the draft the form
 * still holds.
 */
function fromDraft(draft: GoalDraft, id: string): Goal {
  const shared = {
    id,
    name: draft.name,
    colorId: draft.colorId,
    defaultActivityMinutes: draft.defaultActivityMinutes,
    defaultTravel: {
      beforeMinutes: draft.defaultTravel.beforeMinutes,
      afterMinutes: draft.defaultTravel.afterMinutes,
    },
  }
  if (draft.kind === 'time') {
    return { ...shared, kind: 'time', goalMinutes: draft.goalMinutes }
  }
  return { ...shared, kind: 'count', goalCount: draft.goalCount }
}

/**
 * What every field of a goal has to satisfy, in the order a person would want
 * to hear about it: it has a name, then a quota worth reaching, then a default
 * block that can exist on the grid, then travel that means something.
 *
 * Create and update both come through here, so the two cannot disagree about
 * what a legal goal is. That is the test: every refusal below is asserted
 * through both doors.
 */
function draftRefusal(draft: GoalDraft): RefusalReason | null {
  return (
    nameRefusal(draft.name) ??
    quotaRefusal(draft) ??
    activityRefusal(draft.defaultActivityMinutes) ??
    travelRefusal(draft.defaultTravel)
  )
}

/**
 * A name has to name something, and has to fit the label on a block. Spaces are
 * not a name, so a name of nothing but spaces is empty rather than short.
 *
 * The check is against the name as typed, and the name is stored as typed: the
 * app refuses rather than repairs, and quietly trimming a person's words is a
 * repair. Trimming for the emptiness test only is a reading, not a change.
 */
function nameRefusal(name: string): RefusalReason | null {
  if (name.trim().length === 0) return 'empty-name'
  if (name.length > MAX_NAME_LENGTH) return 'name-too-long'
  return null
}

/**
 * A quota below the shortest thing that could ever fill it is not a target, it
 * is a typo: no visit under one, and no time budget under one fifteen-minute
 * activity. Both are `invalid-quota`, the reason the plan gives them.
 *
 * The count is a whole number of visits, so 1.5 visits is refused rather than
 * rounded. The time budget is a length and is not asked about the five-minute
 * step: a target is not a clock position, and `invalid-quota` is the honest
 * answer to a number that is not one.
 */
function quotaRefusal(draft: GoalDraft): RefusalReason | null {
  if (draft.kind === 'time') {
    return Number.isInteger(draft.goalMinutes) && draft.goalMinutes >= MIN_ACTIVITY_MINUTES
      ? null
      : 'invalid-quota'
  }
  return Number.isInteger(draft.goalCount) && draft.goalCount >= 1 ? null : 'invalid-quota'
}

/**
 * The default activity length is the length of the first block of this task, so
 * it is held to the rules a placed block is held to: a quarter hour at least, on
 * the five-minute typed step. This is the one minute value in a draft that is
 * asked about the step, and the reason is that it stops being a target and
 * becomes real minutes on the grid.
 */
function activityRefusal(minutes: number): RefusalReason | null {
  if (minutes < MIN_ACTIVITY_MINUTES) return 'too-short'
  if (!isOnTypedStep(minutes)) return 'not-a-step'
  return null
}

/**
 * Travel is either nothing or a real trip, on the same rule a commute is held
 * to. `checkTravelMinutes` is the one place that rule is written down, so a
 * three-minute default is `too-short` here for the same reason it is there.
 */
function travelRefusal(travel: TravelMinutes): RefusalReason | null {
  return checkTravelMinutes(travel.beforeMinutes) ?? checkTravelMinutes(travel.afterMinutes)
}
