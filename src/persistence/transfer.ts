/**
 * The Backup transfer: the text a person copies out of the app, and the text
 * they paste back into it.
 *
 * Export is the two-space pretty JSON of the whole `Board`, version included,
 * because a person reads it in a text area. Storage saves one line instead,
 * because storage is not read by a person; both forms are pinned by tests.
 *
 * Import never repairs and never merges. It answers one question — may this
 * text replace the whole board? — and every way the answer can be no comes
 * back as the one refusal whose sentence names the file: `invalid-backup`.
 * The reasons the checks below produce are dropped on purpose. A missing task
 * and an overlap are sentences about the grid, and the person holding a
 * pasted file is not looking at a block; the one honest sentence says what
 * was not replaced. Validation happens before the orchestrator ever opens the
 * confirm dialog, so "Nothing was replaced." stays true even when the person
 * cancels.
 *
 * `JSON.parse` lives in one function that returns `unknown`, and the guard
 * exported by `storage.ts` is the only narrowing — the same guard a stored
 * document is judged by, so a board that loads and a board that imports are
 * judged by one shape rather than two that can drift. Nothing casts parsed
 * text to a `Board`.
 *
 * After the guard, the pasted board is held to the invariants a live board
 * maintains, each through the door the live mutations already go through
 * rather than through a second copy of the rule:
 *
 * - `findGoal`, for every session: a block of a task points at a task that
 *   is on this board.
 * - `checkDayPlan`, for every day, on the day as stored: work that is legal
 *   and clear of the blocks on that day, and a commute attached to that work
 *   and inside the visible day.
 * - `checkFootprintFits`, for every session and one-off, excluding itself:
 *   a block inside the visible day, with travel long enough to mean
 *   something, clear of everything else on the day.
 * - The sweep below, for every day: no two stretches on a day may share a
 *   minute. This is the one invariant the doors cannot see. A door excludes
 *   a block by id — which is how a move is checked without the block being
 *   in its own way — and a pasted file is the only caller in the app that
 *   can hand one door two blocks with the same id. The sweep states the
 *   invariant without an id in sight: `dayOccupancy` already lists every
 *   stretch of the day in clock order, so one walk down the list, touching
 *   allowed, is the whole check.
 *
 * Deliberately not checked: the five-minute typed step, and ids being unique.
 * The plan gives import the type guard and the overlap and reference checks,
 * and this module does exactly those; a step rule would be a rule about a
 * number the person never typed in this dialog, and refusing a file over 1:37
 * would read as the app's own arithmetic being wrong. Nothing downstream
 * breaks: a drag snaps to fifteen, a typed field replaces the minute, and the
 * view models draw whatever is stored rather than repairing it.
 *
 * Nothing here touches a storage object. Parsing and validating text is
 * this module's whole job; replacing memory and saving afterwards is the
 * orchestrator's, and only once the person has confirmed.
 */

import { findGoal } from '@/domain/goals'
import {
  checkDayPlan,
  checkFootprintFits,
  dayOccupancy,
  oneOffFootprint,
  sessionFootprint,
} from '@/domain/schedule'
import { DAYS, type Board, type DayId, type RefusalReason, type Result } from '@/domain/types'
import { isBoard } from '@/persistence/storage'

/**
 * The Backup export: the whole board, version included, as the two-space
 * JSON a person reads in a text area.
 */
export function exportBoardText(board: Board): string {
  return JSON.stringify(board, null, 2)
}

/**
 * The only place pasted text becomes a value. It returns `unknown` on
 * purpose, the same way `storage.ts` isolates its parse: there is no
 * signature here that could tempt a caller into trusting the text before
 * the guard has said what it is.
 */
function parseBackupText(text: string): unknown {
  return JSON.parse(text)
}

/**
 * May this text replace the whole board? The guard judges the shape, the
 * invariants below judge the week, and every failure is the one sentence
 * that names the file.
 */
export function importBoardText(text: string): Result<Board> {
  let parsed: unknown
  try {
    parsed = parseBackupText(text)
  } catch {
    return refusedImport()
  }
  if (!isBoard(parsed)) return refusedImport()
  if (boardRefusal(parsed) !== null) return refusedImport()
  return { ok: true, value: parsed }
}

/**
 * Every way a pasted board can fail is one refusal. `invalid-backup` is the
 * one reason whose sentence names the file rather than the grid.
 */
function refusedImport(): Result<Board> {
  return { ok: false, reason: 'invalid-backup' }
}

/**
 * The invariants a live board maintains, asked of a pasted board through the
 * same doors the live mutations go through. The reason is dropped by the
 * caller on purpose, so it is returned for the record and the debugger
 * alone; a person only ever reads `invalid-backup`.
 */
function boardRefusal(board: Board): RefusalReason | null {
  for (const day of DAYS) {
    const dayRefusal = checkDayPlan(board, day, board.days[day])
    if (dayRefusal !== null) return dayRefusal
    const sharedMinute = sharedMinuteRefusal(board, day)
    if (sharedMinute !== null) return sharedMinute
  }
  for (const session of board.sessions) {
    if (findGoal(board, session.goalId) === null) return 'missing-goal'
    const blockRefusal = checkFootprintFits(
      board,
      session.day,
      sessionFootprint(session),
      { kind: 'session', id: session.id },
    )
    if (blockRefusal !== null) return blockRefusal
  }
  for (const oneOff of board.oneOffs) {
    const blockRefusal = checkFootprintFits(
      board,
      oneOff.day,
      oneOffFootprint(oneOff),
      { kind: 'one-off', id: oneOff.id },
    )
    if (blockRefusal !== null) return blockRefusal
  }
  return null
}

/**
 * No two stretches on a day may share a minute. `dayOccupancy` already holds
 * every stretch in clock order, so the check is one walk down the list
 * holding the latest end seen so far: touching is allowed — an end may equal
 * a start — and any start that comes before that end is a shared minute.
 */
function sharedMinuteRefusal(board: Board, day: DayId): RefusalReason | null {
  let latestEnd = Number.NEGATIVE_INFINITY
  for (const stretch of dayOccupancy(board, day)) {
    if (stretch.startMinute < latestEnd) return 'overlaps'
    latestEnd = Math.max(latestEnd, stretch.endMinute)
  }
  return null
}
