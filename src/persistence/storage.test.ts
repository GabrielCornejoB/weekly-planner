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
import {
  isBoard,
  loadBoard,
  saveBoard,
  STORAGE_KEY,
  type BoardStorage,
} from '@/persistence/storage'

/**
 * A predictable id source, so the preset a load hands back can be named. The
 * app passes `crypto.randomUUID`.
 */
function countingIds(prefix = 'id'): CreateId {
  const taken: string[] = []
  return () => {
    const id = `${prefix}-${taken.length + 1}`
    taken.push(id)
    return id
  }
}

/** An id source that fails the test if a preset is built for no reason. */
function unusedIds(): CreateId {
  return () => {
    throw new Error('a stored board was loaded, so no id was needed')
  }
}

/** A fixture that would rather fail loudly than hand a test a refused board. */
function unwrap(result: Result<Board>): Board {
  if (!result.ok) throw new Error(`a fixture mutation was refused: ${result.reason}`)
  return result.value
}

/**
 * A week the app could really have on a phone: two tasks, two placed blocks
 * of them, a one-off, weekend work, and a commute. Built through the real
 * mutations and nothing else, so the round trip proves the document the app
 * actually writes comes back — not a hand-typed shape that happens to match.
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

  // Monday work ends at 12:00 and 17:00, so a 20-minute morning commute and a
  // 15-minute evening one fit, and the evening one ends at 17:15 — before the
  // gym visit placed below it.
  board = unwrap(setCommute(board, 'monday', { beforeMinutes: 20, afterMinutes: 15 }))
  // 12:15–13:30: activity 12:25–13:25, travel 15 minutes on each side of it.
  board = unwrap(placeSession(board, study.id, 'monday', 735, createId))
  board = unwrap(
    setSessionTravel(board, board.sessions[0].id, {
      beforeMinutes: 10,
      afterMinutes: 15,
    }),
  )
  // 17:20–18:20: the evening commute ends at 17:15, so this fits after it.
  board = unwrap(placeSession(board, gym.id, 'monday', 1040, createId))
  const gymVisit = board.sessions[board.sessions.length - 1]
  board = unwrap(setSessionDone(board, gymVisit.id, true))

  // Saturday 10:00–11:00, so the week carries work outside the preset too.
  board = unwrap(
    addWorkInterval(board, 'saturday', { startMinute: 600, endMinute: 660 }, createId),
  )
  // Sunday 15:00–16:40: travel 15 minutes before and 5 after a 90-minute one-off.
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

/**
 * The storage the app will not provide in a test: a map that records every
 * write, and can be told to refuse a read or a write the way a browser with
 * storage blocked does.
 */
class FakeStorage implements BoardStorage {
  private readonly map = new Map<string, string>()
  readonly writes: Array<{ key: string; value: string }> = []
  getItemThrows = false
  setItemThrows = false

  getItem(key: string): string | null {
    if (this.getItemThrows) throw new Error('reading storage is blocked')
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.setItemThrows) throw new Error('writing storage is blocked')
    this.writes.push({ key, value })
    this.map.set(key, value)
  }

  seed(text: string): void {
    this.map.set(STORAGE_KEY, text)
  }

  storedText(): string | null {
    return this.map.get(STORAGE_KEY) ?? null
  }
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

/** The saved week as plain JSON values, ready to be broken in one place. */
function blobOf(week: Board): Record<string, unknown> {
  const parsed: unknown = JSON.parse(JSON.stringify(week))
  return record(parsed)
}

/**
 * Every way a stored text can fail the guard: one field of a real saved week
 * broken at a time, so the table reads like the branches of the guard. The
 * first four are not even objects.
 */
function brokenWeeks(): Array<{ name: string; text: string }> {
  const week = realWeek()
  const broken = (breakIt: (blob: Record<string, unknown>) => void): string => {
    const blob = blobOf(week)
    breakIt(blob)
    return JSON.stringify(blob)
  }
  return [
    { name: 'null', text: 'null' },
    { name: 'a bare string', text: '"a planner board"' },
    { name: 'an empty object', text: '{}' },
    { name: 'an array', text: '[]' },
    {
      name: 'a version 2 document',
      text: broken((blob) => {
        blob.version = 2
      }),
    },
    {
      name: 'a week with no Monday plan',
      text: broken((blob) => {
        delete record(blob.days).monday
      }),
    },
    {
      name: 'a day whose work is not a list',
      text: broken((blob) => {
        record(record(blob.days).monday).workIntervals = 'two blocks'
      }),
    },
    {
      name: 'a work interval whose start is words',
      text: broken((blob) => {
        record(items(record(record(blob.days).monday).workIntervals)[0]).startMinute =
          'eight o’clock'
      }),
    },
    {
      name: 'a commute length that is words',
      text: broken((blob) => {
        record(record(blob.days).monday).commuteBeforeMinutes = 'twenty'
      }),
    },
    {
      name: 'a task whose color is not one of the twelve',
      text: broken((blob) => {
        record(items(blob.goals)[0]).colorId = 'fuchsia'
      }),
    },
    {
      name: 'a time task with no minutes quota',
      text: broken((blob) => {
        delete record(items(blob.goals)[0]).goalMinutes
      }),
    },
    {
      name: 'a task whose kind is neither time nor count',
      text: broken((blob) => {
        record(items(blob.goals)[0]).kind = 'money'
      }),
    },
    {
      name: 'a visit task whose quota is words',
      text: broken((blob) => {
        record(items(blob.goals)[1]).goalCount = 'three'
      }),
    },
    {
      name: 'a block on a day that does not exist',
      text: broken((blob) => {
        record(items(blob.sessions)[0]).day = 'someday'
      }),
    },
    {
      name: 'a session with no task',
      text: broken((blob) => {
        delete record(items(blob.sessions)[0]).goalId
      }),
    },
    {
      name: 'a session with no travelFollowsDefault flag',
      text: broken((blob) => {
        delete record(items(blob.sessions)[0]).travelFollowsDefault
      }),
    },
    {
      name: 'a done mark that is words',
      text: broken((blob) => {
        record(items(blob.sessions)[0]).done = 'yes'
      }),
    },
    {
      name: 'a minute of null, the only not-a-number JSON can spell',
      text: broken((blob) => {
        record(items(blob.sessions)[0]).startMinute = null
      }),
    },
    {
      name: 'travel with one side missing',
      text: broken((blob) => {
        delete record(record(items(blob.sessions)[0]).travel).afterMinutes
      }),
    },
    {
      name: 'a one-off with no name',
      text: broken((blob) => {
        delete record(items(blob.oneOffs)[0]).name
      }),
    },
  ]
}

describe('saveBoard', () => {
  it('writes the week as one line of JSON under the plan’s one key', () => {
    const fake = new FakeStorage()
    const week = realWeek()

    const result = saveBoard(fake, week)

    expect(result).toEqual({ ok: true, value: null })
    expect(fake.writes).toHaveLength(1)
    expect(fake.writes[0]?.key).toBe('weekly-planner.board')
    // One line: the two-space pretty form is the Backup export, which a person
    // reads in a text area. Storage is not read by a person.
    expect(fake.writes[0]?.value).not.toContain('\n')
  })

  it('does not change the board it saves', () => {
    const week = realWeek()
    const before = structuredClone(week)

    saveBoard(new FakeStorage(), week)

    expect(week).toEqual(before)
  })

  it('refuses with storage-unavailable instead of throwing when the storage will not take it', () => {
    const fake = new FakeStorage()
    fake.setItemThrows = true

    const result = saveBoard(fake, realWeek())

    expect(result).toEqual({ ok: false, reason: 'storage-unavailable' })
    expect(fake.writes).toEqual([])
  })
})

describe('loadBoard', () => {
  it('round trips a week the app really saved', () => {
    const fake = new FakeStorage()
    const week = realWeek()
    expect(saveBoard(fake, week).ok).toBe(true)

    // A good blob builds no preset, so an id source that throws proves it.
    const loaded = loadBoard(fake, unusedIds())

    expect(loaded).toEqual(week)
    // The parse is a new document, not the same objects handed back.
    expect(loaded).not.toBe(week)
    expect(loaded.days.monday).not.toBe(week.days.monday)
    // Loading never writes, even on the happy path.
    expect(fake.writes).toHaveLength(1)
  })

  it('hands back the preset when nothing is stored, without writing', () => {
    const fake = new FakeStorage()

    const loaded = loadBoard(fake, countingIds('preset'))

    expect(loaded).toEqual(createDefaultBoard(countingIds('preset')))
    expect(fake.writes).toEqual([])
  })

  it('hands back the preset when the stored text is not JSON, without overwriting it', () => {
    const fake = new FakeStorage()
    fake.seed('{ this is not json')

    const loaded = loadBoard(fake, countingIds('preset'))

    expect(loaded).toEqual(createDefaultBoard(countingIds('preset')))
    expect(fake.storedText()).toBe('{ this is not json')
    expect(fake.writes).toEqual([])
  })

  it('hands back the preset when the storage cannot be read, without writing', () => {
    const fake = new FakeStorage()
    fake.getItemThrows = true

    const loaded = loadBoard(fake, countingIds('preset'))

    expect(loaded).toEqual(createDefaultBoard(countingIds('preset')))
    expect(fake.writes).toEqual([])
  })

  for (const { name, text } of brokenWeeks()) {
    it(`hands back the preset for ${name}, without overwriting it`, () => {
      const fake = new FakeStorage()
      fake.seed(text)

      const loaded = loadBoard(fake, countingIds('preset'))

      expect(loaded).toEqual(createDefaultBoard(countingIds('preset')))
      expect(fake.storedText()).toBe(text)
      expect(fake.writes).toEqual([])
    })
  }
})

describe('isBoard', () => {
  it('accepts the boards the app builds', () => {
    expect(isBoard(realWeek())).toBe(true)
    expect(isBoard(createDefaultBoard(countingIds()))).toBe(true)
  })

  it('rejects anything that is not an object', () => {
    expect(isBoard(null)).toBe(false)
    expect(isBoard('a board')).toBe(false)
    expect(isBoard(123)).toBe(false)
  })

  it('rejects minutes that are not finite, which JSON cannot even spell', () => {
    const withInfinity = structuredClone(realWeek())
    withInfinity.days.monday.workIntervals[0].startMinute = Number.POSITIVE_INFINITY
    expect(isBoard(withInfinity)).toBe(false)

    const withNaN = structuredClone(realWeek())
    withNaN.sessions[0].startMinute = Number.NaN
    expect(isBoard(withNaN)).toBe(false)
  })
})
