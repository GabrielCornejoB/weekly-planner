/**
 * Everything the app does to the board, with no React in it.
 *
 * The orchestrator component holds the board, decides which dialog is showing,
 * and passes the finished things down. Everything else — a change, a refusal, a
 * sentence, a save — happens here, because the plan's own test rule is that
 * behaviour is proved by calling functions and never by rendering a component,
 * and there is no jsdom in this project to render one with. A rule that lived
 * only in a component body would be the one behaviour in the app that nothing
 * could check.
 *
 * So this module is a set of pure functions of a state, and it holds three
 * ideas. The first is the **door**: `settle` is the only thing in the app that
 * writes a `BoardState`, so every change in the app is saved on the way through
 * it and refused on the way through it, and there is no second path that could
 * forget. The second is that **nothing here decides whether a change is legal**:
 * each flow hands its arguments to a domain function and settles whatever comes
 * back, and there is no `ok: false` written anywhere in this folder, so the
 * orchestrator has no way to invent a refusal the way it has no way to invent a
 * rule. The third is that a form which owns more than one thing — a whole day,
 * or a block's day, start, length, and travel — is a **sequence** of changes, and
 * `runSteps` is what walks one.
 *
 * Decisions recorded here:
 *
 * - **`Settled.ok` says the board changed, not that everything landed.** A form
 *   is closed when its edit is on the board and kept open when nothing of it
 *   is, because a form whose fields disagree with the board is worse than no
 *   form at all: the person would be fixing numbers that had already been
 *   replaced. A refusal always carries its sentence whichever way this comes out,
 *   so a half-applied edit explains itself and never leaves a dialog behind that
 *   shows last week's values.
 * - **A sequence stops at the first refusal and keeps what landed.** The
 *   alternative — rolling back — would need a second board and a second opinion
 *   about which changes are reversible. What reached the board is something the
 *   person asked for, and the banner says what did not happen.
 * - **The refusal string and the storage notice are both here, and never both
 *   at once.** A refused edit and a save that could not land are different
 *   sentences about different facts, so they are different fields, and the door
 *   that sets one clears the other: the newest thing that happened is the thing
 *   worth reading.
 * - **Flows are named after what the person did.** `addTask` and `deleteTask`
 *   are `createGoal` and `deleteGoal` underneath, because the list, the buttons,
 *   and the confirm dialogs all say "task" and a call site that says something
 *   else is a call site somebody has to translate.
 */

import { resetBoard, type CreateId } from '@/domain/board'
import { createGoal, deleteGoal, updateGoal, type GoalDraft } from '@/domain/goals'
import { refusalMessage } from '@/domain/refusal'
import {
  deleteOneOff,
  deleteSession,
  moveOneOff,
  moveSession,
  placeOneOff,
  placeSession,
  resizeOneOff,
  resizeSession,
  setOneOffDone,
  setOneOffTravel,
  setSessionDone,
  setSessionTravel,
  updateOneOff,
  type OneOffDraft,
} from '@/domain/sessions'
import {
  addWorkInterval,
  moveWorkInterval,
  removeWorkInterval,
  resizeWorkInterval,
  resizeWorkIntervalOnAnyDay,
  setCommute,
} from '@/domain/work'
import type { Board, ColorId, DayId, DayPlan, ResizeEdge, Result, TravelMinutes } from '@/domain/types'
import type { BlockTarget } from '@/domain/view'
import { loadBoard, saveBoard, type BoardStorage } from '@/persistence/storage'

import type { DayDraft, WorkDraft } from '@/components/DayEditor'
import type { OneOffEdit } from '@/components/OneOffForm'
import type { SessionDraft } from '@/components/SessionEditor'

/**
 * The two kinds of block a person can mark done or delete.
 *
 * Work is the odd one out and the type says so: it is blocked time rather than a
 * task, it has no quota, and the product lists "treating work as something to
 * check off" as out of scope — so there is no way to hand a work interval to
 * either of those flows, and the refusal is not needed because the request
 * cannot be phrased.
 *
 * Derived from `BlockTarget`, which is the same vocabulary the grid reports in,
 * rather than a second declaration of it. A block that gained a kind would widen
 * this too, which is the direction the drift goes in the dangerous direction.
 */
type PlacedTarget = Exclude<BlockTarget, { kind: 'work' }>

/**
 * What a work interval the day already has looks like in a submitted draft.
 *
 * The form carries an id for an interval that is already there and `null` for
 * one the person has just added, and that single field is the whole of what a
 * caller needs to tell "move this" from "add another". A draft is not a
 * discriminated union, so the narrowing is a predicate rather than a cast.
 */
interface KeptWork extends WorkDraft {
  id: string
}

function isKeptWork(interval: WorkDraft): interval is KeptWork {
  return interval.id !== null
}

/** The two things the app needs from its surroundings, injected at the edge. */
export interface Runtime {
  /**
   * The one id source for the whole board.
   *
   * One source and not one per module, because the preset hands out ids too: a
   * second source would hand a new block an id the board already has, and a
   * lookup by id would then find whichever came first.
   */
  createId: CreateId
  /** `window.localStorage` in the app, a fake in the tests. Never read directly. */
  storage: BoardStorage
}

/**
 * All of it: the board, and the two sentences that can be on screen about it.
 *
 * The dialog that is open, the task armed for placing, and the one-off the
 * person is about to tap a slot for are not in here. They are not about the
 * board, they are not saved, and they must not survive a reload — which is
 * exactly what would go wrong if they were folded in here.
 */
export interface BoardState {
  board: Board
  /** A refused change, in the words `refusal.ts` gave it. */
  refusal: string | null
  /**
   * A change that could not be saved. The board is still there in memory, and
   * this is the sentence that points at Backup as the way to keep it.
   */
  notice: string | null
}

/** What the door hands back: the new state, and whether the board changed. */
export interface Settled {
  state: BoardState
  ok: boolean
}

/**
 * One change in a sequence: a function of the board as it stands right now.
 *
 * A thunk rather than a result, because each change in a sequence is made
 * against the board the one before it produced, and a list of results would have
 * been computed against the same old board and gone stale in the middle of an
 * edit.
 */
type Step = (board: Board) => Result<Board>

/**
 * Open the board, and write nothing.
 *
 * `loadBoard` never writes on any path — a missing key, unreadable text, a
 * corrupt blob, and a blob that is not a board all hand back the preset and
 * leave the stored text alone — so mounting is not a save. A first open shows
 * the preset and does not put it in storage until something has actually
 * changed.
 */
export function initialState(runtime: Runtime): BoardState {
  return {
    board: loadBoard(runtime.storage, runtime.createId),
    refusal: null,
    notice: null,
  }
}

/**
 * The one door. A result becomes a state, and only a change that landed is
 * saved.
 *
 * This is the whole of the plan's "every successful mutation saves. A refused
 * mutation does not", and it is one function rather than a rule repeated at
 * every call site, so a flow that forgot it would be a flow with nowhere to
 * forget it: there is no other way to produce a `BoardState` in this app.
 *
 * A refusal keeps the board it was handed, exactly as it was, and shows the
 * sentence. A change that lands replaces the board, clears any older refusal —
 * the person has done something since, so that sentence is stale — and saves; if
 * the save could not land, the board is still replaced in memory and the notice
 * is shown instead, because losing the change is the worse of the two faults and
 * Backup is how a person keeps a board their browser will not.
 */
export function settle(
  state: BoardState,
  runtime: Runtime,
  result: Result<Board>,
): Settled {
  if (!result.ok) {
    return { state: { ...state, refusal: refusalMessage(result.reason), notice: null }, ok: false }
  }
  const saved = saveBoard(runtime.storage, result.value)
  return {
    state: {
      board: result.value,
      refusal: null,
      notice: saved.ok ? null : refusalMessage(saved.reason),
    },
    ok: true,
  }
}

/** Put a message away. The two are never both set, so this puts away what is up. */
export function dismissMessage(state: BoardState): BoardState {
  return { ...state, refusal: null, notice: null }
}

/**
 * Walk an edit's changes in order, stopping at the first refusal.
 *
 * Every flow below that is more than one mutation comes through here, so the
 * meaning of a partial edit is decided once: what landed is kept and saved, what
 * did not is not attempted, and the last refusal's sentence is the one on screen.
 * `ok` is true if *anything* landed, because that is the question a dialog asks
 * when it is deciding whether its work is done.
 */
function runSteps(state: BoardState, runtime: Runtime, steps: Step[]): Settled {
  let current = state
  let landed = false
  for (const step of steps) {
    const settled = settle(current, runtime, step(current.board))
    current = settled.state
    landed = landed || settled.ok
    if (!settled.ok) break
  }
  return { state: current, ok: landed }
}

/**
 * Put the first block of a task on a free stretch, at the task's own defaults.
 *
 * The tap reports a quarter hour and the block is given the default length and
 * the default travel, so the person's one gesture places a whole block. The
 * task is named by the id the list handed up, and a task that has been deleted
 * since is `missing-goal` from the domain rather than a shrug from here.
 */
export function placeGoal(
  state: BoardState,
  runtime: Runtime,
  goalId: string,
  day: DayId,
  startMinute: number,
): Settled {
  return settle(
    state,
    runtime,
    placeSession(state.board, goalId, day, startMinute, runtime.createId),
  )
}

/**
 * Put a new one-off where the person tapped.
 *
 * The form's draft carries four fields and a slot, and the mutation takes those
 * four fields and that slot. The travel is copied rather than handed over, so the
 * board does not end up holding an object the form is still holding.
 */
export function addOneOff(state: BoardState, runtime: Runtime, edit: OneOffEdit): Settled {
  const draft: OneOffDraft = {
    name: edit.name,
    colorId: edit.colorId,
    activityMinutes: edit.activityMinutes,
    travel: { ...edit.travel },
  }
  return settle(
    state,
    runtime,
    placeOneOff(state.board, edit.day, edit.startMinute, draft, runtime.createId),
  )
}

/**
 * Where a block was dropped.
 *
 * The day comes from the drop, and what happens to it is the one place the two
 * kinds of block genuinely differ. A placed block moves across days, and the day
 * it left simply loses it: no copy, no ghost, no missed mark. A work interval
 * does not, so a drop on another column finds nothing there and is refused
 * `missing-work` — and the block goes back, which is the honest reading of a
 * gesture the app never offered.
 */
export function dropBlock(
  state: BoardState,
  runtime: Runtime,
  target: BlockTarget,
  day: DayId,
  startMinute: number,
): Settled {
  return settle(state, runtime, movedTo(state.board, target, day, startMinute))
}

function movedTo(
  board: Board,
  target: BlockTarget,
  day: DayId,
  startMinute: number,
): Result<Board> {
  switch (target.kind) {
    case 'work':
      return moveWorkInterval(board, day, target.id, startMinute)
    case 'session':
      return moveSession(board, target.id, day, startMinute)
    case 'one-off':
      return moveOneOff(board, target.id, day, startMinute)
  }
}

/**
 * One edge of a block, dragged to a quarter hour.
 *
 * The minute is the edge of the *activity*, because that is the rectangle the
 * finger landed on: the travel is a strip above and below it. Work is the one
 * kind the grid reports without a day, so its own lookup happens in the domain
 * rather than here — which is also why a stale work id is refused in the same
 * words as any other missing block.
 */
export function resizeBlock(
  state: BoardState,
  runtime: Runtime,
  target: BlockTarget,
  edge: ResizeEdge,
  minute: number,
): Settled {
  return settle(state, runtime, resizedTo(state.board, target, edge, minute))
}

function resizedTo(
  board: Board,
  target: BlockTarget,
  edge: ResizeEdge,
  minute: number,
): Result<Board> {
  switch (target.kind) {
    case 'work':
      return resizeWorkIntervalOnAnyDay(board, target.id, edge, minute)
    case 'session':
      return resizeSession(board, target.id, edge, minute)
    case 'one-off':
      return resizeOneOff(board, target.id, edge, minute)
  }
}

/**
 * Mark a block done, or not done again.
 *
 * The only change in the app that re-checks nothing, and it is also the one
 * that is easiest to get wrong in a caller: a done mark is the person saying
 * they did the thing, so no minute is asked about and nothing is saved that the
 * geometry did not agree to. It is not offered for work, and `PlacedTarget` is
 * the type that says so.
 */
export function markBlockDone(
  state: BoardState,
  runtime: Runtime,
  block: PlacedTarget,
  done: boolean,
): Settled {
  return settle(state, runtime, markedDone(state.board, block, done))
}

function markedDone(board: Board, block: PlacedTarget, done: boolean): Result<Board> {
  switch (block.kind) {
    case 'session':
      return setSessionDone(board, block.id, done)
    case 'one-off':
      return setOneOffDone(board, block.id, done)
  }
}

/**
 * Take a block off the board, done mark and all.
 *
 * It asks nothing. The product reserves confirmation for a whole task and the
 * whole board, and one block is neither — a confirm dialog over a single block
 * would be a dialog for every tap of a finger somebody meant to place.
 */
export function deleteBlock(
  state: BoardState,
  runtime: Runtime,
  block: PlacedTarget,
): Settled {
  return settle(state, runtime, deletedBlock(state.board, block))
}

function deletedBlock(board: Board, block: PlacedTarget): Result<Board> {
  switch (block.kind) {
    case 'session':
      return deleteSession(board, block.id)
    case 'one-off':
      return deleteOneOff(board, block.id)
  }
}

/**
 * Save an edited block of a task: a move, a travel, and the new end.
 *
 * **The order is the form's, and it is not arbitrary.** The domain's resize takes
 * one end of the *activity*, measured from the end of the travel that is on the
 * block at the time, and the form has already worked that end out against the
 * travel in this same draft. So the travel has to be on the block before the end
 * is applied to it, and the move has to be on the block before either, or the
 * end would be measured from a start the person has just changed. Three changes,
 * one edit, and the order is the reason the form's note about it exists.
 *
 * A block that is already done stays done throughout, because a move and a
 * resize both carry the mark with them.
 */
export function editSession(
  state: BoardState,
  runtime: Runtime,
  id: string,
  draft: SessionDraft,
): Settled {
  return runSteps(state, runtime, [
    (board) => moveSession(board, id, draft.day, draft.startMinute),
    (board) => setSessionTravel(board, id, draft.travel),
    (board) => resizeSession(board, id, 'end', draft.activityEndMinute),
  ])
}

/**
 * Save an edited one-off: its name and color, a move, a travel, and the new end.
 *
 * The same three changes as a block of a task, in the same order and for the same
 * reason — a one-off is placed like anything else, on the chart and in every rule
 * — with the one extra change at the front that only a one-off has. A session's
 * name and color live on its task; a one-off has no task, so `updateOneOff` is the
 * door for them, and it goes **first** because a name and a color occupy no time
 * and cannot be refused for anything to do with the day. Putting it at the front
 * is what makes a mistyped name refuse with the week exactly as it was, rather
 * than after the block has already moved somewhere else.
 */
export function editOneOff(
  state: BoardState,
  runtime: Runtime,
  id: string,
  edit: OneOffEdit,
): Settled {
  return runSteps(state, runtime, [
    (board) => updateOneOff(board, id, { name: edit.name, colorId: edit.colorId }),
    (board) => moveOneOff(board, id, edit.day, edit.startMinute),
    (board) => setOneOffTravel(board, id, edit.travel),
    (board) => resizeOneOff(board, id, 'end', edit.activityEndMinute),
  ])
}

/**
 * Save a whole day: the work intervals the person left, moved, resized, and
 * added, and the commute.
 *
 * The form hands up a whole day because that is the shape of the thing being
 * edited — a work interval and its commute are not independent facts, since the
 * morning commute ends where the first interval begins. The domain, though, has
 * five doors rather than one, so the order is this function's decision and it is
 * the whole of what it is:
 *
 * - **Removals first**, because a removal can only ever free time and so can
 *   never be the reason a later change is refused, while an addition placed
 *   before them would be refused against an interval the person is removing in
 *   the same breath.
 * - **Then the moves and resizes of what is staying**, each asked only about the
 *   field that actually changed, so an edit that moved nothing is not a move, and
 *   an edit that changed only the end is not a move with a length derived from
 *   somewhere else.
 * - **Then the additions**, so a block that is being moved is not refused against
 *   an interval the person has just drawn.
 *
 * And the commute goes **first when the draft shortens it and last when the draft
 * lengthens it**, which is the one piece of ordering here that needs an argument.
 *
 * A commute hangs off the day's outer work ends, so a work change is judged
 * against whatever commute is on the day when it happens — that is the product's
 * own rule ("start earlier than 8:00, but not before 6:00, and only if the
 * commute still fits"), and it is why a commute left until last would refuse the
 * commonest edit in the app: start earlier *and* stop commuting, which a person
 * almost certainly means as one thing. So a shorter commute is applied before the
 * work changes, and that is safe rather than merely convenient: the new commute
 * occupies a *subset* of the minutes the old one already occupied, so it cannot
 * collide with anything, cannot reach past 6:00 or 22:00, and cannot fail for
 * want of work to hang from. A longer commute has no such guarantee — it may only
 * fit against the work the person has just drawn — so it goes last, where it is
 * checked against the day that will actually exist.
 *
 * Either way the commute is applied once, from a value the person typed. Nothing
 * here decides whether any of it fits: every step is the domain's own door, and a
 * refused commute at the front of a sequence means none of the work changes are
 * attempted, which is the better of the two half-applied answers.
 */
export function editDay(
  state: BoardState,
  runtime: Runtime,
  day: DayId,
  draft: DayDraft,
): Settled {
  const stored = state.board.days[day]
  const kept = draft.workIntervals.filter(isKeptWork)
  const keptIds = new Set(kept.map((interval) => interval.id))
  const steps: Step[] = []
  const shortening = isShorterCommute(stored, draft)

  if (shortening) {
    steps.push((board) => setCommute(board, day, commuteOf(draft)))
  }

  for (const interval of stored.workIntervals) {
    if (keptIds.has(interval.id)) continue
    steps.push((board) => removeWorkInterval(board, day, interval.id))
  }

  for (const interval of kept) {
    const before = stored.workIntervals.find((existing) => existing.id === interval.id)
    // A day the board does not have this interval on cannot be built by this
    // form, since the ids came off the board. The lookup is a guard rather than
    // a rule, and a null here would mean a draft that is not this day's.
    if (before === undefined) continue
    if (before.startMinute !== interval.startMinute) {
      steps.push((board) => moveWorkInterval(board, day, interval.id, interval.startMinute))
    }
    if (before.endMinute !== interval.endMinute) {
      steps.push((board) => resizeWorkInterval(board, day, interval.id, 'end', interval.endMinute))
    }
  }

  for (const interval of draft.workIntervals) {
    if (interval.id !== null) continue
    steps.push((board) =>
      addWorkInterval(
        board,
        day,
        { startMinute: interval.startMinute, endMinute: interval.endMinute },
        runtime.createId,
      ),
    )
  }

  if (!shortening) {
    steps.push((board) => setCommute(board, day, commuteOf(draft)))
  }

  return runSteps(state, runtime, steps)
}

/** The commute the day editor submitted, as the one argument both doors take. */
function commuteOf(draft: DayDraft): TravelMinutes {
  return {
    beforeMinutes: draft.commuteBeforeMinutes,
    afterMinutes: draft.commuteAfterMinutes,
  }
}

/**
 * Is the draft's commute the day commute with minutes taken away, rather than
 * added?
 *
 * The comparison is only ever about *how long*, never about whether the two
 * lengths are legal: a longer commute is applied last, a shorter one first, and
 * the domain's own rule decides whether either may happen at all. Both directions
 * must be no longer and at least one shorter, because a draft that shortens the
 * morning and lengthens the evening is a change in two directions at once, and
 * there is no subset argument for the pair — so it is applied last, as one
 * value.
 */
function isShorterCommute(stored: DayPlan, draft: DayDraft): boolean {
  return (
    draft.commuteBeforeMinutes <= stored.commuteBeforeMinutes &&
    draft.commuteAfterMinutes <= stored.commuteAfterMinutes &&
    (draft.commuteBeforeMinutes < stored.commuteBeforeMinutes ||
      draft.commuteAfterMinutes < stored.commuteAfterMinutes)
  )
}

/** Add a task, with the name, color, quota, and defaults the form submitted. */
export function addTask(
  state: BoardState,
  runtime: Runtime,
  draft: GoalDraft,
): Settled {
  return settle(state, runtime, createGoal(state.board, draft, runtime.createId))
}

/**
 * Edit a task.
 *
 * The kind is in the draft and the kind is not editable, so a form that somehow
 * submitted the other one is refused `kind-locked` by the domain. The form shows
 * the kind as text and offers no control, so this cannot happen from the app; the
 * refusal is the honest answer if it ever does.
 */
export function editTask(
  state: BoardState,
  runtime: Runtime,
  id: string,
  draft: GoalDraft,
): Settled {
  return settle(state, runtime, updateGoal(state.board, id, draft))
}

/**
 * Delete a task, and every block of it.
 *
 * The person has already been asked: the confirm dialog is the orchestrator's and
 * this is what it does when the answer is yes. Renaming or recolouring a task
 * reaches every block of it without visiting any, because those two fields live
 * on the task — deleting one has to go and take its blocks, because a block
 * whose task is gone has no name, no color, and no quota to count against.
 */
export function deleteTask(
  state: BoardState,
  runtime: Runtime,
  id: string,
): Settled {
  return settle(state, runtime, deleteGoal(state.board, id))
}

/**
 * Clear the board, back to the preset.
 *
 * Nothing survives this, which is what the plan means by a reset: past boards are
 * not kept, and task definitions do not survive either, so the next plan is made
 * from scratch. It takes no board, because there is nothing to carry over from
 * one — the caller's state is replaced by the result, and that result is saved
 * like any other change.
 *
 * The two `{ ok: true, … }` literals in this file are the only results the
 * orchestrator writes, and both are the shape of a success rather than a
 * judgement: the domain has nothing to refuse here, and nothing in this folder
 * has any way to say `ok: false` at all.
 */
export function clearBoard(state: BoardState, runtime: Runtime): Settled {
  return settle(state, runtime, { ok: true, value: resetBoard(runtime.createId) })
}

/**
 * Replace the whole board with one that was pasted.
 *
 * The person has been asked first, and the paste was judged a board before the
 * question was ever put to them — so this is reached only with a board that has
 * already passed the type guard and the live-board invariants, and "Nothing was
 * replaced" is still true for the person who said no, because the answer was no.
 *
 * It does not merge and it does not repair. The previous board is not kept, which
 * is what the plan asks for and the reason this is one flow rather than a
 * sequence: a merge would be a second place deciding what to do with a block that
 * is in the file and not on the board.
 */
export function replaceBoard(
  state: BoardState,
  runtime: Runtime,
  board: Board,
): Settled {
  return settle(state, runtime, { ok: true, value: board })
}

/**
 * The colors already in use, for a new task or a new event to start on something
 * distinct.
 *
 * Both lists, and not just the tasks': a hue on this board is how a block is
 * recognized, so a new event that took a task's color would be read as another
 * visit of it. It is a reader rather than a rule — `nextColorId` decides which id
 * comes back, and this only says which ones are taken.
 */
export function usedColorIds(board: Board): ColorId[] {
  return [...board.goals, ...board.oneOffs].map((item) => item.colorId)
}
