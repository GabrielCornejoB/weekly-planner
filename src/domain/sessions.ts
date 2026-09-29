/**
 * Placed blocks: one session of a task, and one one-off with no task behind it.
 *
 * A goal says how much time or how many visits a task wants. A placed block is
 * one of those things sitting on a day, and these are the mutations that put it
 * there, move it, reshape it, mark it done, and take it away. There is no
 * scheduler here: the person places every block, and the only job of this module
 * is to answer whether a proposed block may sit where they put it.
 *
 * Everything is asked, not re-derived. `schedule.ts` knows what holds a day and
 * whether a footprint fits inside one free stretch, so a place, a move, and a
 * resize all hand their candidate to `checkFootprintFits` rather than each
 * writing its own comparison. The rules this module owns are the ones
 * occupancy cannot see: what a new block inherits from its task, which edge a
 * resize moves, and what a travel edit does to the flag that follows the
 * default.
 *
 * These functions refuse rather than repair, and they never write to the board
 * they were given. A refused change leaves the caller's board exactly as it was,
 * which is what lets the grid put a dragged block back where it came from and
 * lets the orchestrator keep showing the old week while a sentence explains why
 * the new one is refused.
 *
 * Decisions recorded here, each pinned by a test:
 *
 * - A session's `startMinute` is the first minute the block occupies, travel
 *   included, which is the convention `schedule.ts` established. A tap therefore
 *   means "the block starts here", and travel is drawn on the block rather than
 *   beside it.
 * - **A move may change the day, and a work interval may not.** This is the one
 *   place the two disagree, and it is deliberate. Work belongs to a day, and
 *   which days have work is the day editor's question. A placed block belongs to
 *   the plan, and the product scope is explicit that moving one from Monday to
 *   Friday moves it: Monday keeps no copy, no ghost, and no missed mark.
 * - **A second session of the same task on the same day is allowed.** A gym goal
 *   is three visits, and a person may well do two of them on a Tuesday. Nothing
 *   here counts, so nothing here deduplicates; refusing the second block would
 *   be a rule the product scope does not have.
 * - **A resize moves one end of the activity and leaves the other where it is.**
 *   The minute is that end of the *activity*, because the activity is the
 *   rectangle a finger is on: travel is drawn as its own strip above and below
 *   it. The travel keeps its lengths and stays attached to the outside of the
 *   activity, so the activity is what grows or shrinks, and `activityMinutes` is
 *   the number progress will later sum. A drag on the grid and a typed end in
 *   the editor are the same call, and the only difference between them is that a
 *   drag snaps to fifteen minutes while a field steps by five.
 * - **A resize never touches `done`.** The product scope says so for progress and
 *   it is worth saying here too: a block that was done stays done when its length
 *   changes, and its credit becomes the new length. Marking not done again is the
 *   only way back, and that is a separate mutation.
 * - **Editing a block's travel is what breaks it from the default.** The flag
 *   starts true and stays true through every move, resize, and done mark, so a
 *   later change of the task's default travel still reaches the block. Only
 *   `setSessionTravel` clears it, including when the person types the same
 *   numbers back: they edited it, so it no longer follows.
 * - **A one-off is the same block without a task.** It has a name, a color, and a
 *   done mark; it has no quota, no `goalId`, and no `travelFollowsDefault` flag,
 *   because there is no default behind it to follow. The two kinds are told
 *   apart in exactly one place, `isSession`, so a rule such as the minimum
 *   activity length cannot come to mean two things.
 * - **Deleting one block asks nothing.** The product scope makes a single block
 *   easy to delete and a whole task or the whole board something that confirms
 *   first, and a dialog belongs to the orchestrator.
 * - **A refused change before the door mints no id; one inside it does.** The
 *   checks a caller can fail on its own — an unknown task, a minute off the
 *   step, a draft with an empty name — never reach `createId`. A change refused
 *   because it would not fit has already been given an id, since the fit check
 *   needs the candidate's own id to name the block it is checking.
 */

import type { CreateId } from '@/domain/board'
import { checkActivityMinutes, checkName, findGoal } from '@/domain/goals'
import {
  checkFootprintFits,
  checkMinute,
  checkTravelMinutes,
  oneOffFootprint,
  sessionFootprint,
  type Footprint,
  type PlacedTarget,
} from '@/domain/schedule'
import {
  type Board,
  type ColorId,
  type DayId,
  type OneOff,
  type RefusalReason,
  type ResizeEdge,
  type Result,
  type Session,
  type TravelMinutes,
} from '@/domain/types'

/**
 * A one-off as a form holds it, before it has an id or a day.
 *
 * It is the whole one-off rather than a patch, for the same reason a goal draft
 * is: a form owns every field, so there is no field a caller can leave out. The
 * time is not here, because placing a one-off means choosing a free slot first
 * and the slot is an argument of the call rather than a field of the draft.
 */
export interface OneOffDraft {
  name: string
  colorId: ColorId
  activityMinutes: number
  travel: TravelMinutes
}
/** The session with that id, or `null`. The grid and the session editor need it. */
export function findSession(board: Board, id: string): Session | null {
  return board.sessions.find((session) => session.id === id) ?? null
}

/** The one-off with that id, or `null`. */
export function findOneOff(board: Board, id: string): OneOff | null {
  return board.oneOffs.find((oneOff) => oneOff.id === id) ?? null
}

/**
 * Put the first block of a task on a day.
 *
 * The block starts at the task's default activity length and its default travel,
 * and it follows the default from this moment on: the flag is set to true, which
 * is what lets a later edit of that default reach this block while a block whose
 * own travel was edited keeps its edit. Nothing about the task's name, color, or
 * quota is copied onto the block, because the grid reads those off the task, so
 * there is nothing here that could fall out of step with it.
 *
 * The minute is asked first, before the task is looked up, for the same reason
 * `work.ts` asks a minute first: it is a property of the request, and a minute
 * off the step deserves its own sentence whether or not the rest of the request
 * makes sense. The task is asked next, because without one there is no length
 * and no travel to place.
 */
export function placeSession(
  board: Board,
  goalId: string,
  day: DayId,
  startMinute: number,
  createId: CreateId,
): Result<Board> {
  const badMinute = checkMinute(startMinute)
  if (badMinute !== null) return { ok: false, reason: badMinute }

  const goal = findGoal(board, goalId)
  if (goal === null) return { ok: false, reason: 'missing-goal' }

  const session: Session = {
    id: createId(),
    goalId,
    day,
    startMinute,
    activityMinutes: goal.defaultActivityMinutes,
    travel: {
      beforeMinutes: goal.defaultTravel.beforeMinutes,
      afterMinutes: goal.defaultTravel.afterMinutes,
    },
    travelFollowsDefault: true,
    done: false,
  }
  const refusal = checkFootprintFits(board, day, sessionFootprint(session))
  if (refusal !== null) return { ok: false, reason: refusal }
  return { ok: true, value: { ...board, sessions: [...board.sessions, session] } }
}

/**
 * Put a one-off on a day. The slot is the caller's, and the form's fields are
 * asked in the same order a goal draft's are: the name, then the length, then
 * the travel. A form can be wrong several ways at once and only one sentence is
 * shown, so the order is a rule rather than an accident of how the checks happen
 * to be written.
 */
export function placeOneOff(
  board: Board,
  day: DayId,
  startMinute: number,
  draft: OneOffDraft,
  createId: CreateId,
): Result<Board> {
  const badMinute = checkMinute(startMinute)
  if (badMinute !== null) return { ok: false, reason: badMinute }

  const badDraft = checkName(draft.name) ?? checkActivityMinutes(draft.activityMinutes)
  if (badDraft !== null) return { ok: false, reason: badDraft }
  const badTravel = travelRefusal(draft.travel)
  if (badTravel !== null) return { ok: false, reason: badTravel }

  const oneOff: OneOff = {
    id: createId(),
    name: draft.name,
    colorId: draft.colorId,
    day,
    startMinute,
    activityMinutes: draft.activityMinutes,
    travel: {
      beforeMinutes: draft.travel.beforeMinutes,
      afterMinutes: draft.travel.afterMinutes,
    },
    done: false,
  }
  const refusal = checkFootprintFits(board, day, oneOffFootprint(oneOff))
  if (refusal !== null) return { ok: false, reason: refusal }
  return { ok: true, value: { ...board, oneOffs: [...board.oneOffs, oneOff] } }
}

/**
 * Slide a block to a new day and a new start, keeping the whole footprint it had.
 * The length, the travel, and the done mark all travel with it: the product scope
 * is explicit that a block which is already done can be moved, and that moving
 * one from Monday to Friday leaves nothing behind on Monday.
 *
 * The day is an argument rather than something read off the block, which is the
 * whole difference from a work interval. Nothing is re-checked against the day
 * the block is leaving: that day simply loses it, and the day it arrives on is
 * checked like any other.
 */
export function moveSession(
  board: Board,
  id: string,
  day: DayId,
  startMinute: number,
): Result<Board> {
  const badMinute = checkMinute(startMinute)
  if (badMinute !== null) return { ok: false, reason: badMinute }
  const session = findSession(board, id)
  if (session === null) return missingBlock()
  return put(board, { ...session, day, startMinute }, session)
}

/** Move a one-off, which is the same change with no task behind it. */
export function moveOneOff(
  board: Board,
  id: string,
  day: DayId,
  startMinute: number,
): Result<Board> {
  const badMinute = checkMinute(startMinute)
  if (badMinute !== null) return { ok: false, reason: badMinute }
  const oneOff = findOneOff(board, id)
  if (oneOff === null) return missingBlock()
  return put(board, { ...oneOff, day, startMinute }, oneOff)
}

/**
 * Move one end of a block's activity and leave the other where it is.
 *
 * The travel keeps its lengths and stays attached to the outside of the activity,
 * so shortening the block's start moves the whole block's left edge with the
 * activity rather than leaving a gap, and the activity is what changes. The
 * minute is that end of the activity, since the activity is the rectangle the
 * grid draws and a finger lands on; the travel is a separate strip above and
 * below it.
 *
 * Dragging an end past the other one is `too-short` rather than a swap, and the
 * floor asked is the shortest activity a board can hold, with the same order the
 * step is asked in everywhere else.
 */
export function resizeSession(
  board: Board,
  id: string,
  edge: ResizeEdge,
  minute: number,
): Result<Board> {
  const badMinute = checkMinute(minute)
  if (badMinute !== null) return { ok: false, reason: badMinute }
  const session = findSession(board, id)
  if (session === null) return missingBlock()
  const tooShort = checkActivityMinutes(resizedActivity(session, edge, minute))
  if (tooShort !== null) return { ok: false, reason: tooShort }
  return put(board, resize(session, edge, minute), session)
}

/** Resize a one-off, which is the same change with no task behind it. */
export function resizeOneOff(
  board: Board,
  id: string,
  edge: ResizeEdge,
  minute: number,
): Result<Board> {
  const badMinute = checkMinute(minute)
  if (badMinute !== null) return { ok: false, reason: badMinute }
  const oneOff = findOneOff(board, id)
  if (oneOff === null) return missingBlock()
  const tooShort = checkActivityMinutes(resizedActivity(oneOff, edge, minute))
  if (tooShort !== null) return { ok: false, reason: tooShort }
  return put(board, resize(oneOff, edge, minute), oneOff)
}

/**
 * Set a block's own travel, either side or both, and stop it following the task's
 * default.
 *
 * This is the only mutation that clears the flag. A move, a resize, and a done
 * mark all leave it true, so an edit of the task's default travel still reaches
 * the block afterwards; a person who types travel for one day is saying this
 * block is different, and it stays different when the default moves. Clearing the
 * travel to nothing is an edit like any other, so it clears the flag too.
 *
 * The two lengths are independent and either may be zero. The rule is
 * `checkTravelMinutes`, the same one a commute and a task's default travel are
 * held to: nothing, or at least five minutes, on the five-minute step.
 */
export function setSessionTravel(board: Board, id: string, travel: TravelMinutes): Result<Board> {
  const badTravel = travelRefusal(travel)
  if (badTravel !== null) return { ok: false, reason: badTravel }
  const session = findSession(board, id)
  if (session === null) return missingBlock()
  return put(
    board,
    {
      ...session,
      travel: {
        beforeMinutes: travel.beforeMinutes,
        afterMinutes: travel.afterMinutes,
      },
      travelFollowsDefault: false,
    },
    session,
  )
}

/** Set a one-off's travel. There is no flag to clear: a one-off has no default. */
export function setOneOffTravel(board: Board, id: string, travel: TravelMinutes): Result<Board> {
  const badTravel = travelRefusal(travel)
  if (badTravel !== null) return { ok: false, reason: badTravel }
  const oneOff = findOneOff(board, id)
  if (oneOff === null) return missingBlock()
  return put(
    board,
    {
      ...oneOff,
      travel: {
        beforeMinutes: travel.beforeMinutes,
        afterMinutes: travel.afterMinutes,
      },
    },
    oneOff,
  )
}

/**
 * Mark a block done, or not done again. The only progress in the whole app is
 * this flag, so the mutation does nothing else: marking a block that is already
 * done again takes the credit back, which is the app's whole answer to having
 * got something wrong.
 *
 * Nothing is re-checked, because no minute moved. A block can be marked done even
 * if the day has since filled up around it, and the product scope wants the mark
 * to be the person saying "I did this" rather than something the geometry gets
 * to argue with.
 */
export function setSessionDone(board: Board, id: string, done: boolean): Result<Board> {
  const session = findSession(board, id)
  if (session === null) return missingBlock()
  return { ok: true, value: replaceSession(board, { ...session, done }) }
}

/** Mark a one-off done. A one-off has no quota, so this is only a mark. */
export function setOneOffDone(board: Board, id: string, done: boolean): Result<Board> {
  const oneOff = findOneOff(board, id)
  if (oneOff === null) return missingBlock()
  return { ok: true, value: replaceOneOff(board, { ...oneOff, done }) }
}

/**
 * Take a block off the board, along with any credit it was carrying.
 *
 * Asking first is the orchestrator's business: the product scope makes one block
 * easy to remove and a whole task or the whole board something that confirms.
 * Removing the block and its credit together is the rule from the product scope
 * rather than tidying, since the credit only existed because of the block.
 */
export function deleteSession(board: Board, id: string): Result<Board> {
  if (findSession(board, id) === null) return missingBlock()
  return { ok: true, value: { ...board, sessions: board.sessions.filter((s) => s.id !== id) } }
}

/** Remove a one-off. */
export function deleteOneOff(board: Board, id: string): Result<Board> {
  if (findOneOff(board, id) === null) return missingBlock()
  return { ok: true, value: { ...board, oneOffs: board.oneOffs.filter((o) => o.id !== id) } }
}

/**
 * The one door, the same shape as `work.ts`'s: build the block that would result,
 * ask whether it may sit on its day, and only then make a board.
 *
 * `previous` is the block being replaced, and all the check needs from it is an
 * id: a block is never refused for being in its own way, but a *second* block of
 * the same task on the same day is a different block and stays in the way, which
 * is why the exclusion is by id and never by task.
 */
function put<B extends Session | OneOff>(board: Board, next: B, previous: B): Result<Board> {
  const refusal = checkFootprintFits(board, next.day, footprintOf(next), targetOf(previous))
  if (refusal !== null) return { ok: false, reason: refusal }
  if (isSession(next)) return { ok: true, value: replaceSession(board, next) }
  return { ok: true, value: replaceOneOff(board, next) }
}

/** The block's own stretches, travel included, in the order they happen. */
function footprintOf(block: Session | OneOff): Footprint {
  return isSession(block) ? sessionFootprint(block) : oneOffFootprint(block)
}

function targetOf(block: Session | OneOff): PlacedTarget {
  return isSession(block) ? { kind: 'session', id: block.id } : { kind: 'one-off', id: block.id }
}

/**
 * A session and a one-off are the same block with a task behind it or without one,
 * so this is the only place the two are told apart. A session has a `goalId` and a
 * one-off has a `colorId`, and neither field is on the other, which makes the
 * narrowing a real check rather than a guess. Everything else here works on the
 * shape the two share, so a rule such as the minimum activity length cannot come
 * to mean two different things.
 */
function isSession(block: Session | OneOff): block is Session {
  return 'goalId' in block
}

/**
 * The activity length a resize to one end would leave, without building the
 * block. Asked before the door so a too-short result is reported as itself rather
 * than as an overlap, which is what a negative activity would otherwise become.
 */
function resizedActivity(block: Session | OneOff, edge: ResizeEdge, minute: number): number {
  const activityStart = block.startMinute + block.travel.beforeMinutes
  return edge === 'start'
    ? activityStart + block.activityMinutes - minute
    : minute - activityStart
}

/**
 * The block with one end of its activity moved. The travel keeps its lengths and
 * stays attached to the outside of the activity, so the block's first minute
 * follows the activity's first minute when the start is the edge that moved, and
 * is left alone when the end is. Nothing else changes: not the done mark, not the
 * flag, not the task behind it.
 */
function resize<B extends Session | OneOff>(block: B, edge: ResizeEdge, minute: number): B {
  if (edge === 'start') {
    return {
      ...block,
      startMinute: minute - block.travel.beforeMinutes,
      activityMinutes: resizedActivity(block, edge, minute),
    }
  }
  return { ...block, activityMinutes: resizedActivity(block, edge, minute) }
}

function replaceSession(board: Board, next: Session): Board {
  return {
    ...board,
    sessions: board.sessions.map((session) => (session.id === next.id ? next : session)),
  }
}

function replaceOneOff(board: Board, next: OneOff): Board {
  return {
    ...board,
    oneOffs: board.oneOffs.map((oneOff) => (oneOff.id === next.id ? next : oneOff)),
  }
}

/**
 * Travel is either nothing or a real trip, and it is the same rule a commute and a
 * task's default travel are held to, so it is asked in one place. The floor comes
 * before the step, which is why three minutes is `too-short` and seven is
 * `not-a-step`: every whole number under five is also off the five-minute step, so
 * asking the step first would tell a person their number is not a multiple of five
 * rather than that travel is five minutes or nothing.
 */
function travelRefusal(travel: TravelMinutes): RefusalReason | null {
  return checkTravelMinutes(travel.beforeMinutes) ?? checkTravelMinutes(travel.afterMinutes)
}

/**
 * No block with that id. It is its own reason, as `missing-work` is for work: a
 * stale id has no honest sentence among the rest, and calling a session missing
 * its goal would be nonsense. A stale id is a real event, because the grid is
 * where block ids come from and a person can start a drag, be refused, and drag
 * again from a board that has since changed underneath them.
 */
function missingBlock(): Result<Board> {
  return { ok: false, reason: 'missing-block' }
}
