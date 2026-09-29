import { describe, expect, it } from 'vitest'

import { createDefaultBoard, type CreateId } from '@/domain/board'
import { createGoal } from '@/domain/goals'
import {
  placeOneOff,
  placeSession,
  setOneOffDone,
  setSessionDone,
  setSessionTravel,
} from '@/domain/sessions'
import { type Board, type Result } from '@/domain/types'
import { addWorkInterval, setCommute } from '@/domain/work'
import { exportBoardText, importBoardText } from '@/persistence/transfer'

/**
 * A predictable id source, so the week a test builds can be named. The app
 * passes `crypto.randomUUID`.
 */
function countingIds(prefix = 'id'): CreateId {
  const taken: string[] = []
  return () => {
    const id = `${prefix}-${taken.length + 1}`
    taken.push(id)
    return id
  }
}

/** A fixture that would rather fail loudly than hand a test a refused board. */
function unwrap(result: Result<Board>): Board {
  if (!result.ok) throw new Error(`a fixture mutation was refused: ${result.reason}`)
  return result.value
}

/**
 * A week the app could really have on a phone: two tasks, three placed blocks
 * of them (one whose travel the task no longer dictates, one already done, a
 * second visit on another day), a done one-off, weekend work, and commutes.
 * Built through the real mutations and nothing else, so the round trip proves
 * the document the app actually exports comes back — not a hand-typed shape
 * that happens to match.
 *
 * The week carries touching stretches on purpose: the gym block starts
 * exactly where the evening commute ends, the Saturday commute ends exactly
 * where its work begins, and every block with travel touches its own travel,
 * so the sweep below must read touching as allowed or the round trip itself
 * fails.
 */
function realWeek(): Board {
  const createId = countingIds('real')
  let board = createDefaultBoard(createId)
  board = unwrap(
    createGoal(
      board,
      {
        kind: 'time',
        name: 'Study Spanish',
        colorId: 'sky',
        goalMinutes: 300,
        defaultActivityMinutes: 60,
        defaultTravel: { beforeMinutes: 0, afterMinutes: 0 },
      },
      createId,
    ),
  )
  board = unwrap(
    createGoal(
      board,
      {
        kind: 'count',
        name: 'Gym',
        colorId: 'green',
        goalCount: 3,
        defaultActivityMinutes: 45,
        defaultTravel: { beforeMinutes: 10, afterMinutes: 5 },
      },
      createId,
    ),
  )
  const [study, gym] = board.goals

  // Monday: a 20-minute morning commute, and an evening one ending at 17:15.
  board = unwrap(setCommute(board, 'monday', { beforeMinutes: 20, afterMinutes: 15 }))
  // 12:15–13:40: travel edited to 10 before and 15 after a 60-minute block,
  // so `travelFollowsDefault: false` is on the wire.
  board = unwrap(placeSession(board, study.id, 'monday', 735, createId))
  board = unwrap(
    setSessionTravel(board, board.sessions[0].id, { beforeMinutes: 10, afterMinutes: 15 }),
  )
  // 17:15–18:15: starts exactly where the evening commute ends, and is done.
  board = unwrap(placeSession(board, gym.id, 'monday', 1035, createId))
  board = unwrap(setSessionDone(board, board.sessions[board.sessions.length - 1].id, true))
  // A second gym visit on Wednesday, 12:15–13:15, so two blocks of one task
  // point at one task and that is legal.
  board = unwrap(placeSession(board, gym.id, 'wednesday', 735, createId))

  // Saturday work 10:00–11:00, with a 15-minute commute ending exactly at
  // 10:00, so the week carries weekend work and a touching commute too.
  board = unwrap(
    addWorkInterval(board, 'saturday', { startMinute: 600, endMinute: 660 }, createId),
  )
  board = unwrap(setCommute(board, 'saturday', { beforeMinutes: 15, afterMinutes: 0 }))
  // Sunday 15:00–16:50, already done.
  board = unwrap(
    placeOneOff(
      board,
      'sunday',
      900,
      {
        name: 'Dinner with Maya',
        colorId: 'rose',
        activityMinutes: 90,
        travel: { beforeMinutes: 15, afterMinutes: 5 },
      },
      createId,
    ),
  )
  board = unwrap(setOneOffDone(board, board.oneOffs[0].id, true))
  return board
}

/** Narrows an unknown JSON value to a record. A predicate, so no cast is needed. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The same narrowing as a helper, so fixture surgery has nowhere to throw. */
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('the fixture is not a record')
  return value
}

/** Narrows an unknown JSON value to the list the fixture said it was. */
function items(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('the fixture is not a list')
  return value
}

/** The exported week as plain JSON values, ready to be broken in one place. */
function blobOf(week: Board): Record<string, unknown> {
  const parsed: unknown = JSON.parse(JSON.stringify(week))
  return record(parsed)
}

/** A whole session as plain JSON values, for the one case that needs two more. */
function twinSession(
  goalId: string,
  id: string,
  day: string,
  startMinute: number,
): Record<string, unknown> {
  return {
    id,
    goalId,
    day,
    startMinute,
    activityMinutes: 60,
    travel: { beforeMinutes: 0, afterMinutes: 0 },
    travelFollowsDefault: true,
    done: false,
  }
}

/**
 * Every way a pasted backup can fail. The first eight are not even boards;
 * the rest break one live-board invariant of a real week at a time, and each
 * names the one check that catches it. The compact one-line form is on
 * purpose — a hand-edited file does not keep the app's indentation, and
 * import must not care how the text is spaced.
 */
function brokenBackups(): Array<{ name: string; text: string }> {
  const week = realWeek()
  const broken = (breakIt: (blob: Record<string, unknown>) => void): string => {
    const blob = blobOf(week)
    breakIt(blob)
    return JSON.stringify(blob)
  }
  const studyTaskId = (blob: Record<string, unknown>): string => {
    const id = record(items(blob.goals)[0]).id
    if (typeof id !== 'string') throw new Error('the fixture has no task id')
    return id
  }
  return [
    { name: 'text that is not JSON', text: '{ this is not json' },
    { name: 'an empty string', text: '' },
    { name: 'null', text: 'null' },
    { name: 'a bare string', text: '"a planner board"' },
    { name: 'a number', text: '123' },
    { name: 'a boolean', text: 'true' },
    { name: 'an array', text: '[]' },
    { name: 'an empty object', text: '{}' },
    {
      name: 'a version 2 document',
      text: broken((blob) => {
        blob.version = 2
      }),
    },
    {
      name: 'a session pointing at a task that is not on the board',
      text: broken((blob) => {
        record(items(blob.sessions)[0]).goalId = 'no-such-task'
      }),
    },
    {
      name: 'two work intervals crossing on a day with nothing else on it',
      text: broken((blob) => {
        record(items(record(record(blob.days).tuesday).workIntervals)[0]).endMinute = 900
      }),
    },
    {
      name: 'a block that crosses work',
      text: broken((blob) => {
        record(items(blob.sessions)[0]).startMinute = 700
      }),
    },
    {
      name: 'a commute that lands on a placed block',
      text: broken((blob) => {
        record(record(blob.days).monday).commuteAfterMinutes = 40
      }),
    },
    {
      name: 'two blocks that share one id and one stretch of the day',
      text: broken((blob) => {
        const goalId = studyTaskId(blob)
        const sessions = items(blob.sessions)
        // 12:00–13:00 and 12:30–13:30 on a Tuesday whose hole is 12:00–14:00:
        // each fits alone, both share the id `twin`, so the doors exclude
        // both and only the sweep can see the shared minutes.
        sessions.push(twinSession(goalId, 'twin', 'tuesday', 720))
        sessions.push(twinSession(goalId, 'twin', 'tuesday', 750))
      }),
    },
    {
      name: 'a commute on a day with no work',
      text: broken((blob) => {
        record(record(blob.days).sunday).commuteBeforeMinutes = 30
      }),
    },
    {
      name: 'work that starts before 6:00',
      text: broken((blob) => {
        record(items(record(record(blob.days).tuesday).workIntervals)[0]).startMinute = 300
      }),
    },
    {
      name: 'a work interval of ten minutes',
      text: broken((blob) => {
        record(items(record(record(blob.days).tuesday).workIntervals)[0]).endMinute = 490
      }),
    },
    {
      name: 'a block that ends after 22:00',
      text: broken((blob) => {
        record(items(blob.oneOffs)[0]).startMinute = 1300
      }),
    },
    {
      name: 'three minutes of travel',
      text: broken((blob) => {
        record(record(items(blob.sessions)[1]).travel).beforeMinutes = 3
      }),
    },
    {
      name: 'a block with no activity at all',
      text: broken((blob) => {
        record(items(blob.sessions)[0]).activityMinutes = 0
      }),
    },
  ]
}

describe('exportBoardText', () => {
  it('writes the whole board as the two-space JSON a person reads', () => {
    const week = realWeek()

    const text = exportBoardText(week)

    // The version is on the wire, indented two spaces, in the pretty form a
    // person reads — not the one line storage writes.
    expect(text.startsWith('{\n  "version": 1,\n  "days": {')).toBe(true)
    expect(text).toContain('\n')
    expect(text).not.toBe(JSON.stringify(week))
  })

  it('does not change the board it exports', () => {
    const week = realWeek()
    const before = structuredClone(week)

    exportBoardText(week)

    expect(week).toEqual(before)
  })
})

describe('importBoardText', () => {
  it('round trips a week the app really built', () => {
    const week = realWeek()
    const text = exportBoardText(week)

    const result = importBoardText(text)

    expect(result).toEqual({ ok: true, value: week })
    if (result.ok) {
      // A new document parsed out of the text, not the fixture handed back.
      expect(result.value).not.toBe(week)
      expect(result.value.days.monday).not.toBe(week.days.monday)
      // Key order survives the parse, so exporting the import is the same
      // text again.
      expect(exportBoardText(result.value)).toBe(text)
    }
  })

  it('accepts the boards the app itself builds, an empty week included', () => {
    const createId = countingIds('empty')
    const preset = createDefaultBoard(createId)
    let withTask = unwrap(
      createGoal(
        preset,
        {
          kind: 'count',
          name: 'Gym',
          colorId: 'green',
          goalCount: 3,
          defaultActivityMinutes: 45,
          defaultTravel: { beforeMinutes: 10, afterMinutes: 5 },
        },
        createId,
      ),
    )
    // Friday 12:15–13:15, so a week with one task and one block is tried too.
    withTask = unwrap(placeSession(withTask, withTask.goals[0].id, 'friday', 735, createId))

    for (const week of [preset, withTask, realWeek()]) {
      const result = importBoardText(exportBoardText(week))
      expect(result.ok).toBe(true)
    }
  })

  it('accepts a week where one block ends exactly where the next begins', () => {
    const createId = countingIds('touch')
    let board = createDefaultBoard(createId)
    board = unwrap(
      createGoal(
        board,
        {
          kind: 'time',
          name: 'Study Spanish',
          colorId: 'sky',
          goalMinutes: 300,
          defaultActivityMinutes: 60,
          defaultTravel: { beforeMinutes: 0, afterMinutes: 0 },
        },
        createId,
      ),
    )
    const study = board.goals[0]
    // Tuesday 12:00–13:00 and 13:00–14:00: the blocks touch each other, and
    // the second ends exactly where the afternoon work begins.
    board = unwrap(placeSession(board, study.id, 'tuesday', 720, createId))
    board = unwrap(placeSession(board, study.id, 'tuesday', 780, createId))

    const result = importBoardText(exportBoardText(board))

    expect(result.ok).toBe(true)
  })

  for (const { name, text } of brokenBackups()) {
    it(`refuses ${name}, with the one sentence that names the file`, () => {
      expect(importBoardText(text)).toEqual({ ok: false, reason: 'invalid-backup' })
    })
  }

  it('answers every invalid file with invalid-backup and nothing else', () => {
    const reasons = new Set<string>()
    for (const { text } of brokenBackups()) {
      const result = importBoardText(text)
      reasons.add(result.ok ? 'ok' : result.reason)
    }
    expect(reasons).toEqual(new Set(['invalid-backup']))
  })
})
