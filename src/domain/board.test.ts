import { describe, expect, it } from 'vitest'

import { createDefaultBoard, resetBoard, type CreateId } from '@/domain/board'
import { formatClock, isWithinDay, rangesOverlap } from '@/domain/time'
import { BOARD_VERSION, DAYS, type DayId } from '@/domain/types'

/**
 * A predictable id source, so a test can say what the board is called rather
 * than only that the ids are unique. The app passes `crypto.randomUUID`.
 */
function countingIds(prefix = 'id'): { createId: CreateId; issued: () => string[] } {
  const taken: string[] = []
  const createId: CreateId = () => {
    const id = `${prefix}-${taken.length + 1}`
    taken.push(id)
    return id
  }
  return { createId, issued: () => [...taken] }
}

const WEEKDAYS: DayId[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
const WEEKEND: DayId[] = ['saturday', 'sunday']

/** The two preset intervals, read back as clock text. */
function workText(day: DayId): string[] {
  return createDefaultBoard(countingIds().createId).days[day].workIntervals.map(
    (interval) => `${formatClock(interval.startMinute)}–${formatClock(interval.endMinute)}`,
  )
}

describe('createDefaultBoard', () => {
  it('gives Monday to Friday 8:00–12:00 and 14:00–17:00', () => {
    for (const day of WEEKDAYS) {
      expect(workText(day)).toEqual(['8:00–12:00', '14:00–17:00'])
    }
  })

  it('states those presets in minutes, not just in text', () => {
    const { createId } = countingIds()
    const board = createDefaultBoard(createId)
    for (const day of WEEKDAYS) {
      expect(
        board.days[day].workIntervals.map((interval) => [
          interval.startMinute,
          interval.endMinute,
        ]),
      ).toEqual([
        [480, 720],
        [840, 1020],
      ])
    }
  })

  it('leaves the weekend with no work, which is not the same as a day off rule', () => {
    const { createId } = countingIds()
    const board = createDefaultBoard(createId)
    for (const day of WEEKEND) {
      expect(board.days[day].workIntervals).toEqual([])
    }
  })

  it('has a plan for every day, in week order', () => {
    const { createId } = countingIds()
    const board = createDefaultBoard(createId)
    expect(Object.keys(board.days)).toEqual([...DAYS])
  })

  it('starts every day with no commute, in either direction', () => {
    const { createId } = countingIds()
    const board = createDefaultBoard(createId)
    for (const day of DAYS) {
      expect(board.days[day].commuteBeforeMinutes).toBe(0)
      expect(board.days[day].commuteAfterMinutes).toBe(0)
    }
  })

  it('starts with no tasks, no placed blocks, and no done marks', () => {
    const { createId } = countingIds()
    const board = createDefaultBoard(createId)
    expect(board.goals).toEqual([])
    expect(board.sessions).toEqual([])
    expect(board.oneOffs).toEqual([])
  })

  it('is a version 1 document', () => {
    const { createId } = countingIds()
    expect(createDefaultBoard(createId).version).toBe(BOARD_VERSION)
  })

  it('takes every id from createId, one per work interval, and never repeats', () => {
    const { createId, issued } = countingIds()
    const board = createDefaultBoard(createId)
    // Five weekdays at two intervals each, and nothing else needs an id yet.
    expect(issued()).toEqual([
      'id-1',
      'id-2',
      'id-3',
      'id-4',
      'id-5',
      'id-6',
      'id-7',
      'id-8',
      'id-9',
      'id-10',
    ])
    const placed = DAYS.flatMap((day) => board.days[day].workIntervals.map((i) => i.id))
    expect(placed).toEqual(issued())
    expect(new Set(placed).size).toBe(placed.length)
  })

  it('does not touch crypto or the calendar, so a build is reproducible', () => {
    // The same id source on both sides means the two boards are identical.
    expect(createDefaultBoard(countingIds().createId)).toEqual(
      createDefaultBoard(countingIds().createId),
    )
  })
})

describe('the preset obeys the placement rules it will be measured against', () => {
  const board = createDefaultBoard(countingIds().createId)

  it('keeps every work interval inside 6:00–22:00', () => {
    for (const day of DAYS) {
      for (const interval of board.days[day].workIntervals) {
        expect(isWithinDay(interval)).toBe(true)
      }
    }
  })

  it('gives a day two intervals that do not overlap each other', () => {
    for (const day of WEEKDAYS) {
      const [morning, afternoon] = board.days[day].workIntervals
      expect(rangesOverlap(morning, afternoon)).toBe(false)
    }
  })

  it('leaves 12:00–14:00 free on a weekday, because nothing covers it', () => {
    const hole = { startMinute: 720, endMinute: 840 }
    for (const day of WEEKDAYS) {
      for (const interval of board.days[day].workIntervals) {
        expect(rangesOverlap(interval, hole)).toBe(false)
      }
    }
  })
})

describe('two calls share nothing', () => {
  it('does not mutate the first board when the second is built', () => {
    const { createId: firstIds } = countingIds('first')
    const { createId: secondIds } = countingIds('second')
    const first = createDefaultBoard(firstIds)
    const second = createDefaultBoard(secondIds)
    const secondAtBirth = structuredClone(second)

    // Change the first board the way a work edit will: work hours, commute,
    // and a placed block, so every part of the document is touched.
    first.days.monday.workIntervals.pop()
    first.days.monday.commuteBeforeMinutes = 20
    first.days.saturday.workIntervals.push({
      id: 'extra',
      startMinute: 600,
      endMinute: 660,
    })
    first.goals.push({
      id: 'g1',
      kind: 'time',
      name: 'Study Spanish',
      colorId: 'sky',
      goalMinutes: 300,
      defaultActivityMinutes: 45,
      defaultTravel: { beforeMinutes: 0, afterMinutes: 0 },
    })
    first.sessions.push({
      id: 's1',
      goalId: 'g1',
      day: 'monday',
      startMinute: 750,
      activityMinutes: 45,
      travel: { beforeMinutes: 0, afterMinutes: 0 },
      travelFollowsDefault: true,
      done: false,
    })
    first.oneOffs.push({
      id: 'o1',
      name: 'Dentist',
      colorId: 'rose',
      day: 'tuesday',
      startMinute: 900,
      activityMinutes: 60,
      travel: { beforeMinutes: 0, afterMinutes: 0 },
      done: false,
    })

    expect(second).toEqual(secondAtBirth)
    expect(second.days.monday.workIntervals).toHaveLength(2)
    expect(second.days.saturday.workIntervals).toEqual([])
    expect(second.days.monday.commuteBeforeMinutes).toBe(0)
    expect(second.goals).toEqual([])
    expect(second.sessions).toEqual([])
    expect(second.oneOffs).toEqual([])
  })

  it('hands each board its own day plans and its own interval objects', () => {
    const { createId: firstIds } = countingIds('first')
    const { createId: secondIds } = countingIds('second')
    const first = createDefaultBoard(firstIds)
    const second = createDefaultBoard(secondIds)

    expect(second.days.monday).not.toBe(first.days.monday)
    expect(second.days.monday.workIntervals[0]).not.toBe(first.days.monday.workIntervals[0])
    expect(second.goals).not.toBe(first.goals)

    // A fresh counter each side, so a shared reference would be visible here.
    first.days.monday.workIntervals[0].startMinute = 600
    expect(second.days.monday.workIntervals[0].startMinute).toBe(480)
  })
})

describe('resetBoard', () => {
  it('produces the same blank preset as the first open', () => {
    expect(resetBoard(countingIds('reset').createId)).toEqual(
      createDefaultBoard(countingIds('reset').createId),
    )
  })

  it('discards a board that had tasks, blocks, and commute, and leaves it alone', () => {
    const { createId } = countingIds('first')
    const board = createDefaultBoard(createId)
    board.days.friday.commuteAfterMinutes = 15
    board.goals.push({
      id: 'g1',
      kind: 'count',
      name: 'Gym',
      colorId: 'green',
      goalCount: 3,
      defaultActivityMinutes: 60,
      defaultTravel: { beforeMinutes: 0, afterMinutes: 0 },
    })
    const before = structuredClone(board)

    const cleared = resetBoard(countingIds('reset').createId)

    // Task definitions do not survive reset, and past boards are not kept.
    expect(cleared.goals).toEqual([])
    expect(cleared.days.friday.commuteAfterMinutes).toBe(0)
    // The board it replaced is untouched, so a cancel could still have used it.
    expect(board).toEqual(before)
  })
})
