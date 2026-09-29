import { describe, expect, it } from 'vitest'

import { createDefaultBoard, type CreateId } from '@/domain/board'
import {
  deleteOneOff,
  deleteSession,
  findOneOff,
  findSession,
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
  type OneOffDraft,
} from '@/domain/sessions'
import { dayOccupancy, oneOffFootprint, sessionFootprint, type Footprint } from '@/domain/schedule'
import { formatClock, formatDuration } from '@/domain/time'
import {
  MAX_NAME_LENGTH,
  MIN_ACTIVITY_MINUTES,
  MIN_TRAVEL_MINUTES,
  type Board,
  type DayId,
  type OneOff,
  type RefusalReason,
  type Result,
  type Session,
  type TravelMinutes,
} from '@/domain/types'

/** A predictable id source. The app passes `crypto.randomUUID`. */
function countingIds(): CreateId {
  let n = 0
  return () => {
    n += 1
    return `id-${n}`
  }
}

/** The same, but it can be asked how many ids it has handed out. */
function tallyingIds(): { createId: CreateId; issued: () => number } {
  let n = 0
  return {
    createId: () => {
      n += 1
      return `id-${n}`
    },
    issued: () => n,
  }
}

/** The preset week: 8:00–12:00 and 14:00–17:00, Monday to Friday. */
function preset(): Board {
  return createDefaultBoard(countingIds())
}

const STUDY = 'g-study'
const GYM = 'g-gym'
const NOTHING: TravelMinutes = { beforeMinutes: 0, afterMinutes: 0 }

function session(
  id: string,
  goalId: string,
  day: DayId,
  overrides: Partial<Session> = {},
): Session {
  return {
    id,
    goalId,
    day,
    startMinute: 720,
    activityMinutes: 60,
    travel: { beforeMinutes: 10, afterMinutes: 0 },
    travelFollowsDefault: true,
    done: false,
    ...overrides,
  }
}

function dentist(): OneOff {
  return {
    id: 'o1',
    name: 'Dentist',
    colorId: 'rose',
    day: 'monday',
    startMinute: 1080,
    activityMinutes: 60,
    travel: { beforeMinutes: 0, afterMinutes: 0 },
    done: false,
  }
}

function oneOffDraft(overrides: Partial<OneOffDraft> = {}): OneOffDraft {
  return { name: 'Barber', colorId: 'teal', activityMinutes: 30, travel: NOTHING, ...overrides }
}

/**
 * A board with two tasks and three placed blocks, so every rule about where a
 * field lives and what a footprint covers has something to be wrong about.
 *
 * Monday is the day under test. Its work is 8:00–12:00 and 14:00–17:00, so it
 * reads as 6:00–8:00 free, work, `s1` at 12:00–13:10, 13:10–14:00 free, work,
 * the dentist at 18:00–19:00, and 19:00–22:00 free. `s2` is a study block on
 * Tuesday whose travel was edited for that day and which is already done.
 */
function boardWithBlocks(): Board {
  return {
    ...preset(),
    goals: [
      {
        id: STUDY,
        kind: 'time',
        name: 'Study',
        colorId: 'sky',
        goalMinutes: 300,
        defaultActivityMinutes: 60,
        defaultTravel: { beforeMinutes: 10, afterMinutes: 0 },
      },
      {
        id: GYM,
        kind: 'count',
        name: 'Gym',
        colorId: 'lime',
        goalCount: 3,
        defaultActivityMinutes: 45,
        defaultTravel: NOTHING,
      },
    ],
    sessions: [
      session('s1', STUDY, 'monday'),
      session('s2', STUDY, 'tuesday', {
        startMinute: 1140,
        activityMinutes: 45,
        travel: { beforeMinutes: 20, afterMinutes: 5 },
        travelFollowsDefault: false,
        done: true,
      }),
    ],
    oneOffs: [dentist()],
  }
}

/** The value of an allowed change. Fails loudly if the change was refused. */
function ok(result: Result<Board>): Board {
  if (!result.ok) throw new Error(`expected the change to be allowed, got ${result.reason}`)
  return result.value
}

/** The reason a change was refused. Fails loudly if it was allowed. */
function refused(result: Result<Board>): RefusalReason {
  if (result.ok) throw new Error('expected the change to be refused')
  return result.reason
}

/** The session with that id, failing loudly rather than returning a nullable. */
function sessionAt(board: Board, id: string): Session {
  const found = findSession(board, id)
  if (found === null) throw new Error(`no session ${id} on this board`)
  return found
}

/** The one-off with that id, failing loudly rather than returning a nullable. */
function oneOffAt(board: Board, id: string): OneOff {
  const found = findOneOff(board, id)
  if (found === null) throw new Error(`no one-off ${id} on this board`)
  return found
}

/** What the grid would draw for one block, as `role start–end` in clock text. */
function stretchesOf(footprint: Footprint): string[] {
  return footprint.map(
    (stretch) =>
      `${stretch.role} ${formatClock(stretch.startMinute)}–${formatClock(stretch.endMinute)}`,
  )
}

/**
 * The placed blocks holding a day, in order, so a move can be shown to leave
 * nothing behind. Work is left out: it has a target of its own and is not what
 * these tests are about.
 */
function holdingIds(board: Board, day: DayId): string[] {
  return dayOccupancy(board, day).flatMap((stretch) =>
    'target' in stretch && stretch.target.kind !== 'work' ? [stretch.target.id] : [],
  )
}

/** The activity minutes a board has marked done. Task 11 sums this for real. */
function doneActivityMinutes(board: Board): number {
  const minutes = board.sessions
    .filter((s) => s.done)
    .map((s) => s.activityMinutes)
    .concat(board.oneOffs.filter((o) => o.done).map((o) => o.activityMinutes))
  return minutes.reduce((total, each) => total + each, 0)
}

/** A board with a one-off on Monday evening, for the one-off mutations. */
function boardWithOneOff(): Board {
  return ok(
    placeOneOff(
      boardWithBlocks(),
      'monday',
      1140,
      oneOffDraft({ activityMinutes: 30, travel: { beforeMinutes: 10, afterMinutes: 0 } }),
      countingIds(),
    ),
  )
}

describe('placeSession', () => {
  it('starts the block at the task default length and the task default travel', () => {
    const after = ok(placeSession(boardWithBlocks(), STUDY, 'monday', 1140, countingIds()))
    const placed = after.sessions[2]
    expect(placed.activityMinutes).toBe(60)
    expect(placed.travel).toEqual({ beforeMinutes: 10, afterMinutes: 0 })
    // Read back through the footprint rather than off the numbers, so the test
    // states the shape the grid draws.
    expect(stretchesOf(sessionFootprint(placed))).toEqual([
      'travel 19:00–19:10',
      'activity 19:10–20:10',
    ])
  })

  it('follows the default travel from the moment it is placed, and is not done', () => {
    const placed = ok(placeSession(boardWithBlocks(), STUDY, 'monday', 1140, countingIds())).sessions[2]
    expect(placed.travelFollowsDefault).toBe(true)
    expect(placed.done).toBe(false)
  })

  it('records the first minute the block occupies, which is the minute that was tapped', () => {
    const placed = ok(placeSession(boardWithBlocks(), STUDY, 'monday', 1140, countingIds())).sessions[2]
    // Travel before comes first, so a tap at 19:00 is the top of the travel strip
    // and the activity starts ten minutes later.
    expect(placed.startMinute).toBe(1150 - 10)
    expect(sessionFootprint(placed)[1].startMinute).toBe(1150)
  })

  it('copies no name and no color, because the grid reads those off the task', () => {
    const placed = ok(placeSession(boardWithBlocks(), STUDY, 'monday', 1140, countingIds())).sessions[2]
    expect(Object.keys(placed)).toEqual([
      'id',
      'goalId',
      'day',
      'startMinute',
      'activityMinutes',
      'travel',
      'travelFollowsDefault',
      'done',
    ])
  })

  it('copies the default travel by value, so the board holds nothing of the task object', () => {
    const before = boardWithBlocks()
    const after = ok(placeSession(before, STUDY, 'monday', 1140, countingIds()))
    expect(after.sessions[2].travel).not.toBe(before.goals[0].defaultTravel)
    expect(after.sessions[2].travel).toEqual(before.goals[0].defaultTravel)
  })

  it('appends, and leaves the blocks already there in the order they were placed', () => {
    const before = boardWithBlocks()
    const after = ok(placeSession(before, GYM, 'monday', 1020, countingIds()))
    expect(after.sessions.map((s) => s.id)).toEqual(['s1', 's2', 'id-1'])
    expect(after.sessions.slice(0, 2)).toEqual(before.sessions)
  })

  it('refuses a task that is not on the board, and mints no id for it', () => {
    const ids = tallyingIds()
    expect(refused(placeSession(boardWithBlocks(), 'nope', 'monday', 1140, ids.createId))).toBe(
      'missing-goal',
    )
    // The change cannot happen, so the uuid source is not spent on it.
    expect(ids.issued()).toBe(0)
  })

  it('asks the minute before the task, since a minute is a property of the request', () => {
    // A bad minute and an unknown task at once: the minute is the sentence that
    // is useful either way.
    expect(
      refused(placeSession(boardWithBlocks(), 'nope', 'monday', 357, countingIds())),
    ).toBe('not-a-step')
    expect(refused(placeSession(boardWithBlocks(), STUDY, 'monday', -5, countingIds()))).toBe(
      'too-short',
    )
  })

  it('spends its id when the fit check refuses, because that check needs the id', () => {
    const ids = tallyingIds()
    const board = boardWithBlocks()
    // 10:00 is inside the morning work, so the block would cross it.
    expect(refused(placeSession(board, STUDY, 'monday', 600, ids.createId))).toBe('overlaps')
    expect(ids.issued()).toBe(1)
    // And the refused change put nothing on the board.
    expect(ok(placeSession(board, GYM, 'monday', 1140, ids.createId)).sessions).toHaveLength(3)
    expect(ids.issued()).toBe(2)
  })

  it('refuses a block that would cross work', () => {
    expect(refused(placeSession(boardWithBlocks(), STUDY, 'monday', 600, countingIds()))).toBe(
      'overlaps',
    )
  })

  it('refuses a block that would leave the visible day', () => {
    // 5:55 is on the five-minute step, so the honest answer is the day edge.
    expect(refused(placeSession(boardWithBlocks(), STUDY, 'monday', 355, countingIds()))).toBe(
      'outside-day',
    )
  })

  it('accepts a block that fits the 12:00 to 14:00 hole, and refuses one that does not', () => {
    // The gym task has no travel, so 45 minutes at 13:15 ends exactly at work.
    expect(placeSession(boardWithBlocks(), GYM, 'monday', 795, countingIds()).ok).toBe(true)
    expect(refused(placeSession(boardWithBlocks(), GYM, 'monday', 800, countingIds()))).toBe('overlaps')
  })

  it('accepts a block that starts at 6:00 and one that ends at 22:00', () => {
    expect(placeSession(boardWithBlocks(), GYM, 'saturday', 360, countingIds()).ok).toBe(true)
    const atTheEnd = ok(placeSession(boardWithBlocks(), GYM, 'saturday', 1275, countingIds()))
    expect(stretchesOf(sessionFootprint(atTheEnd.sessions[2]))).toEqual(['activity 21:15–22:00'])
  })

  it('allows a second block of the same task on the same day', () => {
    // A visit count of three is three visits, and a person may do two of them on
    // a Tuesday. Nothing here counts, so nothing here deduplicates.
    const first = ok(placeSession(boardWithBlocks(), GYM, 'monday', 1140, countingIds()))
    expect(first.sessions.filter((s) => s.goalId === GYM && s.day === 'monday')).toHaveLength(1)
    const second = ok(placeSession(first, GYM, 'monday', 1020, countingIds()))
    expect(second.sessions.filter((s) => s.goalId === GYM && s.day === 'monday')).toHaveLength(2)
  })

  it('keeps each visit its own length, and lets one be resized without touching the other', () => {
    // One id source for both placements, so the two visits are two blocks rather
    // than one block named twice.
    const ids = countingIds()
    const first = ok(placeSession(boardWithBlocks(), GYM, 'monday', 1140, ids))
    const both = ok(placeSession(first, GYM, 'monday', 1020, ids))
    const [evening, afterWork] = both.sessions.filter((s) => s.goalId === GYM)
    expect(new Set([evening.id, afterWork.id]).size).toBe(2)
    expect([evening.activityMinutes, afterWork.activityMinutes]).toEqual([45, 45])
    // The second gym visit starts at 17:00 with no travel, so an end at 18:00
    // makes it an hour, and the dentist at 18:00 may be touched but not crossed.
    const resized = ok(resizeSession(both, afterWork.id, 'end', 1080))
    expect(resized.sessions.filter((s) => s.goalId === GYM).map((s) => s.activityMinutes)).toEqual([
      45, 60,
    ])
    expect(refused(resizeSession(resized, afterWork.id, 'end', 1085))).toBe('overlaps')
  })

  it('refuses travel that is occupied time even when the activity alone would fit', () => {
    // A block at 11:55 with five minutes of travel before it: the activity starts
    // at 12:00 and is inside the free hole, and the travel is not.
    const board = boardWithBlocks()
    const withTravel: Board = {
      ...board,
      goals: [{ ...board.goals[0], defaultTravel: { beforeMinutes: 5, afterMinutes: 0 } }, board.goals[1]],
    }
    expect(refused(placeSession(withTravel, STUDY, 'monday', 715, countingIds()))).toBe('overlaps')
  })
})

describe('moveSession', () => {
  it('moves a block from Monday to Friday, and Monday keeps nothing', () => {
    const after = ok(moveSession(boardWithBlocks(), 's1', 'friday', 1140))
    expect(sessionAt(after, 's1').day).toBe('friday')
    expect(holdingIds(after, 'monday')).not.toContain('s1')
    expect(holdingIds(after, 'friday')).toContain('s1')
    // The footprint arrived whole: 19:00 to 20:10 on the new day.
    expect(stretchesOf(sessionFootprint(sessionAt(after, 's1')))).toEqual([
      'travel 19:00–19:10',
      'activity 19:10–20:10',
    ])
  })

  it('frees the whole old span on the day it left', () => {
    const after = ok(moveSession(boardWithBlocks(), 's1', 'friday', 1140))
    // The dentist is still there, so the only difference is the study block.
    expect(holdingIds(after, 'monday')).toEqual(['o1'])
  })

  it('keeps a done block done, because the product scope says a done block can be moved', () => {
    const after = ok(moveSession(boardWithBlocks(), 's2', 'friday', 1140))
    expect(sessionAt(after, 's2').done).toBe(true)
    expect(holdingIds(after, 'tuesday')).not.toContain('s2')
  })

  it('keeps the length, the travel, the flag, and the task it was carrying', () => {
    const after = ok(moveSession(boardWithBlocks(), 's2', 'monday', 1150))
    const moved = sessionAt(after, 's2')
    expect(moved.activityMinutes).toBe(45)
    expect(moved.travel).toEqual({ beforeMinutes: 20, afterMinutes: 5 })
    expect(moved.travelFollowsDefault).toBe(false)
    expect(moved.goalId).toBe(STUDY)
    expect(stretchesOf(sessionFootprint(moved))).toEqual([
      'travel 19:10–19:30',
      'activity 19:30–20:15',
      'travel 20:15–20:20',
    ])
  })

  it('moves within a day, and does not compare the block against itself', () => {
    const after = ok(moveSession(boardWithBlocks(), 's1', 'monday', 730))
    expect(stretchesOf(sessionFootprint(sessionAt(after, 's1')))).toEqual([
      'travel 12:10–12:20',
      'activity 12:20–13:20',
    ])
  })

  it('refuses a day the block will not fit on', () => {
    // Friday is the same shape as Monday, and 8:00 to 12:00 is work there too.
    expect(refused(moveSession(boardWithBlocks(), 's1', 'friday', 600))).toBe('overlaps')
  })

  it('refuses a move that would run into another block of the same task', () => {
    // `s2` is the only study block on Tuesday and it is not the block being
    // moved, so it stays in the way: the exclusion is by id, never by task.
    expect(refused(moveSession(boardWithBlocks(), 's1', 'tuesday', 1140))).toBe('overlaps')
  })

  it('refuses a minute off the step before it looks for the block', () => {
    expect(refused(moveSession(boardWithBlocks(), 'nope', 'monday', 1157))).toBe('not-a-step')
    expect(refused(moveSession(boardWithBlocks(), 's1', 'monday', 1157))).toBe('not-a-step')
  })

  it('refuses a block that is not on the board', () => {
    expect(refused(moveSession(boardWithBlocks(), 'nope', 'monday', 1140))).toBe('missing-block')
  })

  it('keeps the list in the order the blocks were placed, not in the order of the days', () => {
    // A backup text reads in the order the person made it, and the grid's order
    // comes from the occupancy rather than from the array, so nothing sorts this
    // list. Moving the first block to Friday would reveal a sort by day.
    const after = ok(moveSession(boardWithBlocks(), 's1', 'friday', 1140))
    expect(after.sessions.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(after.sessions.map((s) => s.day)).toEqual(['friday', 'tuesday'])
  })
})

describe('resizeSession', () => {
  it('moves the end of the activity and leaves the start where it was', () => {
    const after = ok(resizeSession(boardWithBlocks(), 's1', 'end', 800))
    const resized = sessionAt(after, 's1')
    // The activity ran 12:10 to 13:10 and now runs to 13:20, so it is 70 minutes.
    expect(stretchesOf(sessionFootprint(resized))).toEqual([
      'travel 12:00–12:10',
      'activity 12:10–13:20',
    ])
    expect(resized.startMinute).toBe(720)
    expect(resized.activityMinutes).toBe(70)
  })

  it('moves the start of the activity and carries the travel with it', () => {
    const after = ok(resizeSession(boardWithBlocks(), 's1', 'start', 745))
    const resized = sessionAt(after, 's1')
    // The activity now starts at 12:25, and the ten minutes of travel stay
    // attached to the outside of it, so the block's first minute moved to 12:15.
    expect(stretchesOf(sessionFootprint(resized))).toEqual([
      'travel 12:15–12:25',
      'activity 12:25–13:10',
    ])
    expect(resized.startMinute).toBe(735)
    expect(resized.activityMinutes).toBe(45)
  })

  it('asks for an end in five-minute steps, so 1:40 is a legal length', () => {
    const resized = sessionAt(ok(resizeSession(boardWithBlocks(), 's1', 'end', 830)), 's1')
    expect(resized.activityMinutes).toBe(100)
    expect(formatDuration(resized.activityMinutes)).toBe('1 hour 40 minutes')
  })

  it('changes the minutes progress will sum, and leaves the done mark alone', () => {
    // `s2` is the done study block on Tuesday: 19:00 to 19:40 with twenty minutes
    // of travel before it, so its activity is 19:20 to 20:05.
    expect(doneActivityMinutes(boardWithBlocks())).toBe(45)
    const after = ok(resizeSession(boardWithBlocks(), 's2', 'end', 1220))
    const resized = sessionAt(after, 's2')
    expect(resized.done).toBe(true)
    expect(resized.activityMinutes).toBe(60)
    expect(doneActivityMinutes(after)).toBe(60)
  })

  it('refuses an activity shorter than the shortest activity there is, on either edge', () => {
    // The activity runs 12:10 to 13:10, so an end at 12:20 leaves ten minutes and
    // a start at 13:05 leaves five.
    expect(refused(resizeSession(boardWithBlocks(), 's1', 'end', 740))).toBe('too-short')
    expect(refused(resizeSession(boardWithBlocks(), 's1', 'start', 785))).toBe('too-short')
  })

  it('refuses an end dragged past the other end rather than folding the block over', () => {
    // Without the length check the footprint check would be asked about a
    // ten-minute sliver sitting exactly where the travel was, and would allow it.
    expect(refused(resizeSession(boardWithBlocks(), 's1', 'start', 800))).toBe('too-short')
    expect(refused(resizeSession(boardWithBlocks(), 's1', 'end', 710))).toBe('too-short')
  })

  it('refuses a resize that would run into work, with the travel included', () => {
    // Work starts at 14:00 and the travel is part of the block, so the activity
    // may run to 14:00 exactly and not one minute past.
    expect(resizeSession(boardWithBlocks(), 's1', 'end', 840).ok).toBe(true)
    expect(refused(resizeSession(boardWithBlocks(), 's1', 'end', 850))).toBe('overlaps')
  })

  it('refuses a resize that would leave the visible day', () => {
    const board = ok(
      placeOneOff(boardWithBlocks(), 'saturday', 1260, oneOffDraft({ activityMinutes: 60 }), countingIds()),
    )
    expect(resizeOneOff(board, 'id-1', 'end', 1320).ok).toBe(true)
    expect(refused(resizeOneOff(board, 'id-1', 'end', 1325))).toBe('outside-day')
  })

  it('refuses a minute off the step, and a block that is not on the board', () => {
    expect(refused(resizeSession(boardWithBlocks(), 's1', 'end', 797))).toBe('not-a-step')
    expect(refused(resizeSession(boardWithBlocks(), 'nope', 'end', 800))).toBe('missing-block')
  })

  it('leaves the flag, the task, the travel, the day, and the done mark alone', () => {
    const after = ok(resizeSession(boardWithBlocks(), 's2', 'end', 1220))
    const resized = sessionAt(after, 's2')
    expect(resized.travelFollowsDefault).toBe(false)
    expect(resized.goalId).toBe(STUDY)
    expect(resized.done).toBe(true)
    expect(resized.day).toBe('tuesday')
    expect(resized.travel).toEqual({ beforeMinutes: 20, afterMinutes: 5 })
  })
})

describe('setSessionTravel', () => {
  it('sets the block own travel and stops it following the default', () => {
    const after = ok(setSessionTravel(boardWithBlocks(), 's1', { beforeMinutes: 20, afterMinutes: 5 }))
    const edited = sessionAt(after, 's1')
    expect(edited.travelFollowsDefault).toBe(false)
    expect(stretchesOf(sessionFootprint(edited))).toEqual([
      'travel 12:00–12:20',
      'activity 12:20–13:20',
      'travel 13:20–13:25',
    ])
  })

  it('clears the flag even when the numbers typed back are the same', () => {
    // The person edited it, so it no longer follows the task default.
    const edited = sessionAt(ok(setSessionTravel(boardWithBlocks(), 's1', { beforeMinutes: 10, afterMinutes: 0 })), 's1')
    expect(edited.travelFollowsDefault).toBe(false)
    expect(edited.travel).toEqual({ beforeMinutes: 10, afterMinutes: 0 })
  })

  it('clears the flag when the travel is cleared to nothing', () => {
    const edited = sessionAt(ok(setSessionTravel(boardWithBlocks(), 's1', NOTHING)), 's1')
    expect(edited.travelFollowsDefault).toBe(false)
    expect(stretchesOf(sessionFootprint(edited))).toEqual(['activity 12:00–13:00'])
  })

  it('leaves the done mark and the day alone', () => {
    const edited = sessionAt(ok(setSessionTravel(boardWithBlocks(), 's2', NOTHING)), 's2')
    expect(edited.done).toBe(true)
    expect(edited.day).toBe('tuesday')
  })

  it('asks the floor before the step, the same as a commute and a task default', () => {
    const board = boardWithBlocks()
    expect(refused(setSessionTravel(board, 's1', { beforeMinutes: 3, afterMinutes: 0 }))).toBe('too-short')
    expect(refused(setSessionTravel(board, 's1', { beforeMinutes: 7, afterMinutes: 0 }))).toBe('not-a-step')
    expect(refused(setSessionTravel(board, 's1', { beforeMinutes: 0, afterMinutes: 2 }))).toBe('too-short')
  })

  it('accepts no travel at all, since travel is optional', () => {
    expect(setSessionTravel(boardWithBlocks(), 's1', NOTHING).ok).toBe(true)
  })

  it('refuses travel that would push the block into something already there', () => {
    // The block's activity is 12:10 to 13:10 and work starts at 14:00, so 60
    // minutes before it is the most that fits and 65 is one minute too many.
    expect(setSessionTravel(boardWithBlocks(), 's1', { beforeMinutes: 60, afterMinutes: 0 }).ok).toBe(
      true,
    )
    expect(refused(setSessionTravel(boardWithBlocks(), 's1', { beforeMinutes: 65, afterMinutes: 0 }))).toBe(
      'overlaps',
    )
  })

  it('refuses a block that is not on the board', () => {
    expect(refused(setSessionTravel(boardWithBlocks(), 'nope', NOTHING))).toBe('missing-block')
  })
})

describe('setSessionDone and deleteSession', () => {
  it('marks a block done and not done again', () => {
    const done = ok(setSessionDone(boardWithBlocks(), 's1', true))
    expect(sessionAt(done, 's1').done).toBe(true)
    expect(sessionAt(ok(setSessionDone(done, 's1', false)), 's1').done).toBe(false)
  })

  it('marks a block done even once the day has filled up around it', () => {
    // Nothing is re-checked, because no minute moved: the mark is the person
    // saying they did the thing, not something the geometry gets to argue with.
    const broken: Board = {
      ...boardWithBlocks(),
      sessions: [session('s1', STUDY, 'monday', { startMinute: 600, activityMinutes: 60 })],
    }
    expect(refused(resizeSession(broken, 's1', 'end', 700))).toBe('overlaps')
    expect(setSessionDone(broken, 's1', true).ok).toBe(true)
  })

  it('takes the credit away when a done block is deleted', () => {
    const before = boardWithBlocks()
    expect(doneActivityMinutes(before)).toBe(45)
    const after = ok(deleteSession(before, 's2'))
    expect(findSession(after, 's2')).toBeNull()
    expect(doneActivityMinutes(after)).toBe(0)
  })

  it('deletes one block and leaves the tasks and the other blocks alone', () => {
    const after = ok(deleteSession(boardWithBlocks(), 's1'))
    expect(after.sessions.map((s) => s.id)).toEqual(['s2'])
    expect(after.goals.map((g) => g.id)).toEqual([STUDY, GYM])
    expect(after.oneOffs.map((o) => o.id)).toEqual(['o1'])
  })

  it('frees the span the block held, on the day it was on', () => {
    const after = ok(deleteSession(boardWithBlocks(), 's1'))
    expect(holdingIds(after, 'monday')).toEqual(['o1'])
    expect(placeSession(after, GYM, 'monday', 720, countingIds()).ok).toBe(true)
  })

  it('refuses a block that is not on the board', () => {
    expect(refused(setSessionDone(boardWithBlocks(), 'nope', true))).toBe('missing-block')
    expect(refused(deleteSession(boardWithBlocks(), 'nope'))).toBe('missing-block')
  })
})

describe('placeOneOff', () => {
  it('stores the name, the color, the length, and the travel, with no task behind it', () => {
    const after = ok(
      placeOneOff(
        boardWithBlocks(),
        'monday',
        1140,
        oneOffDraft({ name: 'Barber', colorId: 'teal', activityMinutes: 30 }),
        countingIds(),
      ),
    )
    expect(after.oneOffs[1]).toEqual({
      id: 'id-1',
      name: 'Barber',
      colorId: 'teal',
      day: 'monday',
      startMinute: 1140,
      activityMinutes: 30,
      travel: NOTHING,
      done: false,
    })
  })

  it('has no quota, no task, and no travel flag, because there is no task to follow', () => {
    const placed = oneOffAt(boardWithOneOff(), 'id-1')
    const keys = Object.keys(placed)
    expect(keys).not.toContain('goalId')
    expect(keys).not.toContain('travelFollowsDefault')
    expect(keys).not.toContain('goalMinutes')
    expect(keys).not.toContain('goalCount')
  })

  it('asks the draft in the same order a goal draft is asked', () => {
    const board = boardWithBlocks()
    const empty = oneOffDraft({ name: '   ', activityMinutes: 3 })
    expect(refused(placeOneOff(board, 'monday', 1140, empty, countingIds()))).toBe('empty-name')
    const short = oneOffDraft({ activityMinutes: 3 })
    expect(refused(placeOneOff(board, 'monday', 1140, short, countingIds()))).toBe('too-short')
    const offStep = oneOffDraft({ activityMinutes: 16 })
    expect(refused(placeOneOff(board, 'monday', 1140, offStep, countingIds()))).toBe('not-a-step')
    const badTravel = oneOffDraft({ travel: { beforeMinutes: 3, afterMinutes: 0 } })
    expect(refused(placeOneOff(board, 'monday', 1140, badTravel, countingIds()))).toBe('too-short')
  })

  it('refuses a name that could not be shown on a block, by the rule a task is held to', () => {
    const board = boardWithBlocks()
    const long = oneOffDraft({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) })
    expect(refused(placeOneOff(board, 'monday', 1140, long, countingIds()))).toBe('name-too-long')
    const exact = oneOffDraft({ name: 'x'.repeat(MAX_NAME_LENGTH) })
    expect(placeOneOff(board, 'monday', 1140, exact, countingIds()).ok).toBe(true)
  })

  it('refuses a one-off that would not fit, exactly as it refuses a session', () => {
    const board = boardWithBlocks()
    expect(refused(placeOneOff(board, 'monday', 600, oneOffDraft(), countingIds()))).toBe('overlaps')
    expect(refused(placeOneOff(board, 'monday', 355, oneOffDraft(), countingIds()))).toBe('outside-day')
    expect(refused(placeOneOff(board, 'monday', 357, oneOffDraft(), countingIds()))).toBe('not-a-step')
  })

  it('draws the travel on the block, in the same order as a session', () => {
    const placed = oneOffAt(
      boardWithOneOff(),
      'id-1',
    )
    expect(stretchesOf(oneOffFootprint(placed))).toEqual([
      'travel 19:00–19:10',
      'activity 19:10–19:40',
    ])
  })
})

describe('the one-off mutations', () => {
  it('moves, resizes, takes travel, takes a done mark, and deletes, like a session', () => {
    const placed = boardWithOneOff()
    const moved = ok(moveOneOff(placed, 'id-1', 'friday', 1140))
    expect(oneOffAt(moved, 'id-1').day).toBe('friday')
    expect(holdingIds(moved, 'monday')).not.toContain('id-1')

    // On Friday the block runs 19:00 to 19:40, so an end at 20:00 makes it 50.
    const resized = ok(resizeOneOff(moved, 'id-1', 'end', 1200))
    expect(oneOffAt(resized, 'id-1').activityMinutes).toBe(50)

    const travelled = ok(setOneOffTravel(resized, 'id-1', { beforeMinutes: 0, afterMinutes: 15 }))
    expect(oneOffAt(travelled, 'id-1').travel).toEqual({ beforeMinutes: 0, afterMinutes: 15 })

    const done = ok(setOneOffDone(travelled, 'id-1', true))
    expect(oneOffAt(done, 'id-1').done).toBe(true)

    const deleted = ok(deleteOneOff(done, 'id-1'))
    expect(findOneOff(deleted, 'id-1')).toBeNull()
    expect(deleted.oneOffs).toHaveLength(1)
  })

  it('never puts a one-off in the sessions, or a session in the one-offs', () => {
    // The two kinds are told apart in one place, and this is the check that the
    // place is right: a block edited through the one-off door is still a one-off.
    let board = boardWithOneOff()
    for (const change of [
      (b: Board) => moveOneOff(b, 'id-1', 'friday', 1140),
      (b: Board) => resizeOneOff(b, 'id-1', 'end', 1200),
      (b: Board) => setOneOffTravel(b, 'id-1', { beforeMinutes: 0, afterMinutes: 15 }),
      (b: Board) => setOneOffDone(b, 'id-1', true),
    ]) {
      board = ok(change(board))
      expect(board.sessions.map((s) => s.id)).toEqual(['s1', 's2'])
      expect(board.oneOffs.map((o) => o.id)).toEqual(['o1', 'id-1'])
    }
  })

  it('refuses a one-off that is not on the board, with the one reason a block needs', () => {
    const placed = boardWithOneOff()
    expect([
      refused(moveOneOff(placed, 'nope', 'monday', 1140)),
      refused(resizeOneOff(placed, 'nope', 'end', 1200)),
      refused(setOneOffTravel(placed, 'nope', NOTHING)),
      refused(setOneOffDone(placed, 'nope', true)),
      refused(deleteOneOff(placed, 'nope')),
    ]).toEqual(['missing-block', 'missing-block', 'missing-block', 'missing-block', 'missing-block'])
  })

  it('refuses what a session is refused for, at the same lengths', () => {
    const placed = boardWithOneOff()
    expect(refused(moveOneOff(placed, 'id-1', 'friday', 600))).toBe('overlaps')
    expect(refused(moveOneOff(placed, 'id-1', 'monday', 1157))).toBe('not-a-step')
    // The activity runs 19:10 to 19:40, so an end at 19:10 leaves nothing.
    expect(refused(resizeOneOff(placed, 'id-1', 'end', 1150))).toBe('too-short')
    expect(refused(resizeOneOff(placed, 'id-1', 'end', 1157))).toBe('not-a-step')
    expect(refused(setOneOffTravel(placed, 'id-1', { beforeMinutes: 3, afterMinutes: 0 }))).toBe('too-short')
    expect(refused(setOneOffTravel(placed, 'id-1', { beforeMinutes: 0, afterMinutes: 7 }))).toBe('not-a-step')
  })
})

describe('the reasons this module can produce', () => {
  it('is exactly the eight the plan can be asked for here', () => {
    const board = boardWithBlocks()
    const placed = boardWithOneOff()
    const reasons: RefusalReason[] = [
      refused(placeSession(board, 'nope', 'monday', 1140, countingIds())),
      refused(placeSession(board, STUDY, 'monday', 357, countingIds())),
      refused(placeSession(board, STUDY, 'monday', -5, countingIds())),
      refused(placeSession(board, STUDY, 'monday', 355, countingIds())),
      refused(placeSession(board, STUDY, 'monday', 600, countingIds())),
      refused(placeOneOff(board, 'monday', 1140, oneOffDraft({ name: '  ' }), countingIds())),
      refused(
        placeOneOff(
          board,
          'monday',
          1140,
          oneOffDraft({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) }),
          countingIds(),
        ),
      ),
      refused(resizeOneOff(placed, 'id-1', 'end', 1150)),
      refused(resizeOneOff(placed, 'id-1', 'end', 1157)),
      refused(setOneOffTravel(placed, 'id-1', { beforeMinutes: 3, afterMinutes: 0 })),
      refused(setOneOffTravel(placed, 'id-1', { beforeMinutes: 0, afterMinutes: 7 })),
      refused(moveOneOff(placed, 'nope', 'monday', 1140)),
    ]
    // Neither a reason invented here nor a branch left unreachable: the count is
    // asserted as well as the set, so one case added to the union fails this too.
    expect([...new Set(reasons)].toSorted()).toEqual([
      'empty-name',
      'missing-block',
      'missing-goal',
      'name-too-long',
      'not-a-step',
      'outside-day',
      'overlaps',
      'too-short',
    ])
    expect(reasons.length).toBe(12)
  })
})

describe('immutability', () => {
  const changes: Array<[string, (board: Board) => Result<Board>]> = [
    ['place a session', (b) => placeSession(b, STUDY, 'monday', 1140, countingIds())],
    ['place a one-off', (b) => placeOneOff(b, 'monday', 1140, oneOffDraft(), countingIds())],
    ['move a session', (b) => moveSession(b, 's1', 'friday', 1140)],
    ['move a one-off', (b) => moveOneOff(b, 'o1', 'friday', 1140)],
    ['resize a session', (b) => resizeSession(b, 's1', 'end', 800)],
    ['resize a one-off', (b) => resizeOneOff(b, 'o1', 'end', 1200)],
    ['set session travel', (b) => setSessionTravel(b, 's1', { beforeMinutes: 15, afterMinutes: 0 })],
    ['set one-off travel', (b) => setOneOffTravel(b, 'o1', { beforeMinutes: 0, afterMinutes: 15 })],
    ['mark a session done', (b) => setSessionDone(b, 's1', true)],
    ['mark a one-off done', (b) => setOneOffDone(b, 'o1', true)],
    ['delete a session', (b) => deleteSession(b, 's1')],
    ['delete a one-off', (b) => deleteOneOff(b, 'o1')],
  ]

  it('never writes to the board it was given, for every change', () => {
    for (const [name, change] of changes) {
      const before = boardWithBlocks()
      const snapshot = structuredClone(before)
      ok(change(before))
      expect(before, name).toEqual(snapshot)
    }
  })

  it('leaves the board exactly as it was when a change is refused', () => {
    const refusals: Array<[string, (board: Board) => Result<Board>]> = [
      ['unknown task', (b) => placeSession(b, 'nope', 'monday', 1140, countingIds())],
      ['minute off the step', (b) => moveSession(b, 's1', 'monday', 1157)],
      ['overlaps work', (b) => placeOneOff(b, 'monday', 600, oneOffDraft(), countingIds())],
      ['too short', (b) => resizeSession(b, 's1', 'end', 725)],
      ['no such block', (b) => deleteSession(b, 'nope')],
    ]
    for (const [name, change] of refusals) {
      const before = boardWithBlocks()
      const snapshot = structuredClone(before)
      const result = change(before)
      // The caller's rule: keep what you had unless the change was allowed.
      const after = result.ok ? result.value : before
      expect(after, name).toBe(before)
      expect(before, name).toEqual(snapshot)
    }
  })

  it('shares everything the change did not touch, and rebuilds only the block it changed', () => {
    const before = boardWithBlocks()
    const after = ok(moveSession(before, 's1', 'monday', 1150))
    expect(after.days).toBe(before.days)
    expect(after.goals).toBe(before.goals)
    expect(after.oneOffs).toBe(before.oneOffs)
    expect(after.sessions).not.toBe(before.sessions)
    expect(after.sessions[0]).not.toBe(before.sessions[0])
    expect(after.sessions[1]).toBe(before.sessions[1])
    // And nothing on the new board can be reached through the old one.
    expect(after.sessions[0].startMinute).toBe(1150)
    expect(before.sessions[0].startMinute).toBe(720)
  })

  it('shares the day plans and the other kind of block by reference, not by copy', () => {
    const before = boardWithBlocks()
    const after = ok(setSessionDone(before, 's1', true))
    expect(after.days).toBe(before.days)
    expect(after.goals).toBe(before.goals)
    expect(after.oneOffs).toBe(before.oneOffs)
    expect(after.sessions).not.toBe(before.sessions)
  })

  it('gives every travel its own object, so no two minutes on the board are one object', () => {
    const before = boardWithBlocks()
    const after = ok(placeSession(before, STUDY, 'monday', 1140, countingIds()))
    const travels = [
      ...after.goals.map((g) => g.defaultTravel),
      ...after.sessions.map((s) => s.travel),
      ...after.oneOffs.map((o) => o.travel),
    ]
    expect(new Set(travels).size).toBe(travels.length)
    expect(travels).toContain(after.sessions[2].travel)
  })

  it('copies the travel out of a form draft rather than keeping the form object', () => {
    // The form still holds its draft after submitting, so a board that kept the
    // object would be holding a piece of a dialog.
    const draft = oneOffDraft({ travel: { beforeMinutes: 10, afterMinutes: 5 } })
    const after = ok(placeOneOff(boardWithBlocks(), 'monday', 1140, draft, countingIds()))
    expect(after.oneOffs[1].travel).not.toBe(draft.travel)
    expect(after.oneOffs[1].travel).toEqual({ beforeMinutes: 10, afterMinutes: 5 })
  })
})

describe('the lengths this module holds to', () => {
  it('refuses a block under the shortest activity, from every door that can make one', () => {
    expect(MIN_ACTIVITY_MINUTES).toBe(15)
    const board = boardWithBlocks()
    expect(
      refused(placeOneOff(board, 'monday', 1140, oneOffDraft({ activityMinutes: 14 }), countingIds())),
    ).toBe('too-short')
    expect(
      placeOneOff(board, 'monday', 1140, oneOffDraft({ activityMinutes: 15 }), countingIds()).ok,
    ).toBe(true)
    // The study block's activity runs 12:10 to 13:10, so an end at 12:25 leaves
    // a legal fifteen minutes and 12:20 leaves ten.
    expect(resizeSession(board, 's1', 'end', 745).ok).toBe(true)
    expect(refused(resizeSession(board, 's1', 'end', 740))).toBe('too-short')
  })

  it('refuses travel under the shortest trip, and accepts the shortest one', () => {
    expect(MIN_TRAVEL_MINUTES).toBe(5)
    expect(refused(setSessionTravel(boardWithBlocks(), 's1', { beforeMinutes: 4, afterMinutes: 0 }))).toBe(
      'too-short',
    )
    expect(setSessionTravel(boardWithBlocks(), 's1', { beforeMinutes: 5, afterMinutes: 0 }).ok).toBe(
      true,
    )
  })
})
