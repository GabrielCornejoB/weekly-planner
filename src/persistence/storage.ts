/**
 * The one document the app keeps: what it opens with, and what it writes after
 * every successful change.
 *
 * The storage object is injected. Both functions take
 * `Pick<Storage, 'getItem' | 'setItem'>`, so the app passes `window.localStorage`
 * at the edge and the tests pass a fake, and neither function reads `window`
 * itself. `JSON.parse` lives in one function that returns `unknown`, and the
 * hand-written guard below is the only narrowing: nothing here casts parsed
 * text to a `Board`, and nothing repairs one either.
 *
 * Load never writes. Every way the stored document can be absent or unusable —
 * a missing key, a storage that cannot be read from, text that does not parse,
 * text that parses into something that is not a board — hands back the preset
 * and leaves the stored text exactly as it was. A bad blob is not destroyed on
 * load; the next successful save is what replaces it.
 *
 * The guard checks shape and closed sets only: the version, all seven days,
 * all twelve colors, the seven weekdays, strings, booleans, and finite
 * numbers — JSON cannot spell `NaN`, but `1e400` parses to `Infinity`, so
 * "finite" is a real check and not a flourish. It deliberately does not check
 * that a session's task exists or that nothing overlaps: those are the
 * invariants a live edit is refused for, and task 15's import runs them after
 * this guard on the way in. A stored board that breaks them is drawn by the
 * view models as it is rather than hidden, which is the one honest thing to
 * do with minutes a person really has.
 *
 * Decisions recorded here, each pinned by a test:
 *
 * - **Save writes one line of JSON.** The two-space pretty form is the Backup
 *   export, which a person reads in a text area; storage is not read by a
 *   person, so it carries no indentation.
 * - **`saveBoard` returns `Result<null>`.** A save has no product: the caller
 *   already holds the board, and the only fact worth reporting is whether it
 *   landed. `null` says that without inviting a caller to read a value back
 *   that was never made.
 * - **An unreadable storage reads as "no board here".** `getItem` throwing is
 *   handled the same way as a missing key, because `loadBoard` must return a
 *   board and the preset is the board with nothing on it. Only `setItem`
 *   throwing is a refusal, because that is the one the person can act on:
 *   `storage-unavailable` already points at Backup as the way to keep the
 *   in-memory board.
 */

import { COLOR_IDS } from '@/colors/palette'
import { createDefaultBoard, type CreateId } from '@/domain/board'
import {
  BOARD_VERSION,
  DAYS,
  type Board,
  type ColorId,
  type DayId,
  type DayPlan,
  type Goal,
  type OneOff,
  type Result,
  type Session,
  type TravelMinutes,
  type WorkInterval,
} from '@/domain/types'

/** The one key the whole board lives under. */
export const STORAGE_KEY = 'weekly-planner.board'

/** The two calls the app makes on the device's storage, and nothing else. */
export type BoardStorage = Pick<Storage, 'getItem' | 'setItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

const DAY_IDS: ReadonlySet<string> = new Set(DAYS)

function isDayId(value: unknown): value is DayId {
  return isString(value) && DAY_IDS.has(value)
}

const COLOR_ID_SET: ReadonlySet<string> = new Set(COLOR_IDS)

function isColorId(value: unknown): value is ColorId {
  return isString(value) && COLOR_ID_SET.has(value)
}

function isTravel(value: unknown): value is TravelMinutes {
  return (
    isRecord(value) &&
    isFiniteNumber(value.beforeMinutes) &&
    isFiniteNumber(value.afterMinutes)
  )
}

function isWorkInterval(value: unknown): value is WorkInterval {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isFiniteNumber(value.startMinute) &&
    isFiniteNumber(value.endMinute)
  )
}

function isDayPlan(value: unknown): value is DayPlan {
  return (
    isRecord(value) &&
    Array.isArray(value.workIntervals) &&
    value.workIntervals.every(isWorkInterval) &&
    isFiniteNumber(value.commuteBeforeMinutes) &&
    isFiniteNumber(value.commuteAfterMinutes)
  )
}

function isGoal(value: unknown): value is Goal {
  if (
    !isRecord(value) ||
    !isString(value.id) ||
    !isString(value.name) ||
    !isColorId(value.colorId) ||
    !isFiniteNumber(value.defaultActivityMinutes) ||
    !isTravel(value.defaultTravel)
  ) {
    return false
  }
  if (value.kind === 'time') return isFiniteNumber(value.goalMinutes)
  if (value.kind === 'count') return isFiniteNumber(value.goalCount)
  return false
}

function isSession(value: unknown): value is Session {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.goalId) &&
    isDayId(value.day) &&
    isFiniteNumber(value.startMinute) &&
    isFiniteNumber(value.activityMinutes) &&
    isTravel(value.travel) &&
    isBoolean(value.travelFollowsDefault) &&
    isBoolean(value.done)
  )
}

function isOneOff(value: unknown): value is OneOff {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    isColorId(value.colorId) &&
    isDayId(value.day) &&
    isFiniteNumber(value.startMinute) &&
    isFiniteNumber(value.activityMinutes) &&
    isTravel(value.travel) &&
    isBoolean(value.done)
  )
}

/**
 * The hand-written guard, and the only narrowing from stored text to a
 * `Board`. Exported because task 15's import reads pasted text through the
 * same guard, so a board that loads and a board that imports are judged by
 * one shape rather than two that can drift.
 */
export function isBoard(value: unknown): value is Board {
  if (!isRecord(value) || value.version !== BOARD_VERSION) return false
  const days = value.days
  if (!isRecord(days)) return false
  return (
    DAYS.every((day) => isDayPlan(days[day])) &&
    Array.isArray(value.goals) &&
    value.goals.every(isGoal) &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isSession) &&
    Array.isArray(value.oneOffs) &&
    value.oneOffs.every(isOneOff)
  )
}

/**
 * The only place stored text becomes a value. It returns `unknown` on purpose:
 * there is no signature here that could tempt a caller into trusting the text
 * before the guard has said what it is.
 */
function parseStoredText(text: string): unknown {
  return JSON.parse(text)
}

/**
 * What the app opens with. Never writes, never throws: every failure is a
 * board with nothing on it, and the stored text is left for the next
 * successful save to replace.
 */
export function loadBoard(storage: BoardStorage, createId: CreateId): Board {
  let text: string | null
  try {
    text = storage.getItem(STORAGE_KEY)
  } catch {
    // A storage that cannot be read from is, from here, indistinguishable
    // from one with nothing in it: the app opens on the preset either way.
    return createDefaultBoard(createId)
  }
  if (text === null) return createDefaultBoard(createId)

  let parsed: unknown
  try {
    parsed = parseStoredText(text)
  } catch {
    return createDefaultBoard(createId)
  }
  if (!isBoard(parsed)) return createDefaultBoard(createId)
  return parsed
}

/**
 * What the app does after every successful change: the whole board as one
 * line of JSON. A storage that cannot be written to refuses with
 * `storage-unavailable` instead of throwing, so the caller keeps the board it
 * holds and shows the sentence the reason already has.
 */
export function saveBoard(storage: BoardStorage, board: Board): Result<null> {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(board))
    return { ok: true, value: null }
  } catch {
    return { ok: false, reason: 'storage-unavailable' }
  }
}
