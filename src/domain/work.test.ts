import { describe, expect, it } from 'vitest'

import { createDefaultBoard, type CreateId } from '@/domain/board'
import {
  checkFootprintFits,
  commuteFootprint,
  freeStretches,
  oneOffFootprint,
  type Footprint,
} from '@/domain/schedule'
import { formatClock, snapDragMinute } from '@/domain/time'
import {
  MIN_TRAVEL_MINUTES,
  MIN_WORK_MINUTES,
  type Board,
  type DayPlan,
  type OneOff,
  type RefusalReason,
  type Result,
  type WorkInterval,
} from '@/domain/types'
import {
  addWorkInterval,
  moveWorkInterval,
  removeWorkInterval,
  resizeWorkInterval,
  setCommute,
} from '@/domain/work'

/** A predictable id source. The app passes `crypto.randomUUID`. */
function countingIds(): CreateId {
  let n = 0
  return () => {
    n += 1
    return `id-${n}`
  }
}

/** The preset week: 8:00–12:00 and 14:00–17:00, Monday to Friday. */
function preset(): Board {
  return createDefaultBoard(countingIds())
}

function workInterval(id: string, startMinute: number, endMinute: number): WorkInterval {
  return { id, startMinute, endMinute }
}

function oneOff(id: string, startMinute: number, activityMinutes: number): OneOff {
  return {
    id,
    name: 'Dentist',
    colorId: 'rose',
    day: 'monday',
    startMinute,
    activityMinutes,
    travel: { beforeMinutes: 0, afterMinutes: 0 },
    done: false,
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

/** `8:00–12:00, 14:00–17:00`, so a test states a day the way a person reads it. */
function workOf(plan: DayPlan): string[] {
  return plan.workIntervals.map(
    (interval) => `${formatClock(interval.startMinute)}–${formatClock(interval.endMinute)}`,
  )
}

/** `commute before 7:30–8:00`, read off the footprint rather than off the numbers. */
function commuteOf(plan: DayPlan): string[] {
  const ranges: string[] = []
  for (const stretch of commuteFootprint(plan)) {
    // A commute footprint only ever holds commute stretches, but its type is
    // the whole union, so this is the narrowing the module earns.
    if (stretch.role !== 'commute') continue
    ranges.push(
      `commute ${stretch.direction} ${formatClock(stretch.startMinute)}–${formatClock(stretch.endMinute)}`,
    )
  }
  return ranges
}

function footprintRanges(footprint: Footprint): string {
  return footprint
    .map((stretch) => `${formatClock(stretch.startMinute)}–${formatClock(stretch.endMinute)}`)
    .join(' ')
}

/** The ids the preset gave Monday's two intervals, which tests move and resize. */
function morning(board: Board): string {
  return board.days.monday.workIntervals[0].id
}

function afternoon(board: Board): string {
  return board.days.monday.workIntervals[1].id
}

describe('addWorkInterval', () => {
  it('adds an interval to a day', () => {
    const after = ok(
      addWorkInterval(preset(), 'monday', { startMinute: 1080, endMinute: 1140 }, countingIds()),
    )
    expect(workOf(after.days.monday)).toEqual(['8:00–12:00', '14:00–17:00', '18:00–19:00'])
  })

  it('stores the day’s work in clock order, however the interval was added', () => {
    const after = ok(
      addWorkInterval(preset(), 'monday', { startMinute: 360, endMinute: 420 }, countingIds()),
    )
    expect(workOf(after.days.monday)).toEqual(['6:00–7:00', '8:00–12:00', '14:00–17:00'])
  })

  it('takes the id from the injected source, so tests do not depend on the platform', () => {
    // One source for the whole board, which is what the app passes: a second
    // counter would hand out an id Monday already has.
    const createId = countingIds()
    const after = ok(
      addWorkInterval(
        createDefaultBoard(createId),
        'monday',
        { startMinute: 1080, endMinute: 1140 },
        createId,
      ),
    )
    // The preset spends ten ids: five weekdays at two intervals each.
    expect(after.days.monday.workIntervals[2].id).toBe('id-11')
    const ids = after.days.monday.workIntervals.map((interval) => interval.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('leaves the other days, and the rest of the board, alone', () => {
    const board = preset()
    const after = ok(
      addWorkInterval(board, 'monday', { startMinute: 1080, endMinute: 1140 }, countingIds()),
    )
    expect(after.days.tuesday).toBe(board.days.tuesday)
    expect(after.days.saturday.workIntervals).toEqual([])
    expect(after.goals).toBe(board.goals)
    expect(after.sessions).toBe(board.sessions)
    expect(after.oneOffs).toBe(board.oneOffs)
  })

  it('refuses an interval under a quarter hour, and accepts exactly one', () => {
    const board = preset()
    expect(
      refused(
        addWorkInterval(board, 'saturday', { startMinute: 600, endMinute: 600 + 10 }, countingIds()),
      ),
    ).toBe('too-short')
    const exact = ok(
      addWorkInterval(
        board,
        'saturday',
        { startMinute: 600, endMinute: 600 + MIN_WORK_MINUTES },
        countingIds(),
      ),
    )
    expect(workOf(exact.days.saturday)).toEqual(['10:00–10:15'])
  })

  it('refuses work that leaves the visible day', () => {
    const board = preset()
    expect(
      refused(addWorkInterval(board, 'saturday', { startMinute: 345, endMinute: 420 }, countingIds())),
    ).toBe('outside-day')
    expect(
      refused(addWorkInterval(board, 'saturday', { startMinute: 1260, endMinute: 1325 }, countingIds())),
    ).toBe('outside-day')
  })

  it('accepts work that starts at 6:00 and ends at 22:00', () => {
    const whole = ok(addWorkInterval(preset(), 'saturday', { startMinute: 360, endMinute: 1320 }, countingIds()))
    expect(workOf(whole.days.saturday)).toEqual(['6:00–22:00'])
  })

  it('refuses an interval that would cross work', () => {
    // 11:40–12:40 runs over the end of the morning work.
    expect(
      refused(addWorkInterval(preset(), 'monday', { startMinute: 700, endMinute: 760 }, countingIds())),
    ).toBe('overlaps')
  })

  it('refuses an interval that would cross one just added', () => {
    const first = ok(
      addWorkInterval(preset(), 'saturday', { startMinute: 600, endMinute: 660 }, countingIds()),
    )
    expect(
      refused(addWorkInterval(first, 'saturday', { startMinute: 630, endMinute: 690 }, countingIds())),
    ).toBe('overlaps')
  })

  it('accepts an interval that touches work at both ends', () => {
    // 12:00–14:00 fits the hole exactly, and touching is not crossing.
    const after = ok(
      addWorkInterval(preset(), 'monday', { startMinute: 720, endMinute: 840 }, countingIds()),
    )
    expect(workOf(after.days.monday)).toEqual(['8:00–12:00', '12:00–14:00', '14:00–17:00'])
  })

  it('accepts an hour and forty minutes of work', () => {
    const after = ok(
      addWorkInterval(preset(), 'saturday', { startMinute: 480, endMinute: 580 }, countingIds()),
    )
    expect(workOf(after.days.saturday)).toEqual(['8:00–9:40'])
  })

  it('refuses minutes off the five-minute step, and says so before outside-day', () => {
    const board = preset()
    // 12:01 is inside the day and still not a time a typed field can hold.
    expect(
      refused(addWorkInterval(board, 'monday', { startMinute: 721, endMinute: 780 }, countingIds())),
    ).toBe('not-a-step')
    // 5:57 is off the step and before 6:00 at once, and the step is the answer
    // a person can do something about.
    expect(
      refused(addWorkInterval(board, 'saturday', { startMinute: 357, endMinute: 420 }, countingIds())),
    ).toBe('not-a-step')
  })

  it('refuses a length no board can hold', () => {
    expect(
      refused(addWorkInterval(preset(), 'saturday', { startMinute: 600, endMinute: 570 }, countingIds())),
    ).toBe('too-short')
    expect(
      refused(addWorkInterval(preset(), 'saturday', { startMinute: 600, endMinute: -30 }, countingIds())),
    ).toBe('too-short')
  })
})

describe('moveWorkInterval', () => {
  it('slides an interval to a new start and keeps its length', () => {
    const board = preset()
    // Four hours stays four hours, and it may come to rest against the
    // afternoon work, because touching is not crossing.
    const after = ok(moveWorkInterval(board, 'monday', morning(board), 600))
    expect(workOf(after.days.monday)).toEqual(['10:00–14:00', '14:00–17:00'])
  })

  it('takes the morning commute along when the first start moves', () => {
    const board = ok(setCommute(preset(), 'monday', { beforeMinutes: 30, afterMinutes: 0 }))
    expect(commuteOf(board.days.monday)).toEqual(['commute before 7:30–8:00'])
    // Work now starts at 7:00, so the commute runs 6:30–7:00.
    const after = ok(moveWorkInterval(board, 'monday', morning(board), 420))
    expect(workOf(after.days.monday)).toEqual(['7:00–11:00', '14:00–17:00'])
    expect(commuteOf(after.days.monday)).toEqual(['commute before 6:30–7:00'])
  })

  it('takes the evening commute along when the last end moves', () => {
    const board = ok(setCommute(preset(), 'monday', { beforeMinutes: 0, afterMinutes: 30 }))
    const after = ok(moveWorkInterval(board, 'monday', afternoon(board), 1110))
    expect(workOf(after.days.monday)).toEqual(['8:00–12:00', '18:30–21:30'])
    expect(commuteOf(after.days.monday)).toEqual(['commute after 21:30–22:00'])
  })

  it('refuses a start before 6:00', () => {
    const board = preset()
    expect(refused(moveWorkInterval(board, 'monday', morning(board), 345))).toBe('outside-day')
  })

  it('refuses a start so early that the commute would not fit before 6:00', () => {
    const board = ok(setCommute(preset(), 'monday', { beforeMinutes: 30, afterMinutes: 0 }))
    // 6:30 is the earliest a half-hour commute allows: it fills 6:00–6:30.
    const earliest = ok(moveWorkInterval(board, 'monday', morning(board), 390))
    expect(commuteOf(earliest.days.monday)).toEqual(['commute before 6:00–6:30'])
    // 6:15 would need the commute to start at 5:45.
    expect(refused(moveWorkInterval(board, 'monday', morning(board), 375))).toBe('outside-day')
  })

  it('refuses a move that would run past 22:00', () => {
    const board = preset()
    // Three hours of afternoon work from 19:05 ends at 22:05.
    expect(refused(moveWorkInterval(board, 'monday', afternoon(board), 1145))).toBe('outside-day')
    // From 19:00 it ends exactly at 22:00, which is allowed.
    expect(workOf(ok(moveWorkInterval(board, 'monday', afternoon(board), 1140)).days.monday)).toEqual([
      '8:00–12:00',
      '19:00–22:00',
    ])
  })

  it('refuses a move that would cross the day’s other work', () => {
    const board = preset()
    // 10:05 plus four hours runs into the afternoon work.
    expect(refused(moveWorkInterval(board, 'monday', morning(board), 605))).toBe('overlaps')
  })

  it('refuses a move that would land on a placed session', () => {
    const board = preset()
    board.sessions.push({
      id: 's1',
      goalId: 'goal-study',
      day: 'monday',
      startMinute: 750,
      activityMinutes: 45,
      travel: { beforeMinutes: 0, afterMinutes: 0 },
      travelFollowsDefault: true,
      done: false,
    })
    expect(refused(moveWorkInterval(board, 'monday', morning(board), 750))).toBe('overlaps')
  })

  it('refuses an id that is not on that day, because work never changes days', () => {
    const board = preset()
    expect(refused(moveWorkInterval(board, 'monday', 'not-on-this-day', 600))).toBe('missing-work')
    // The same interval, dropped on Saturday, is not on Saturday either.
    expect(refused(moveWorkInterval(board, 'saturday', morning(board), 600))).toBe('missing-work')
  })

  it('takes a drop the grid produced, since a fifteen-minute snap is on the step', () => {
    const board = preset()
    const dropped = snapDragMinute(428) // a thumb landing at 7:08
    expect(formatClock(dropped)).toBe('7:15')
    expect(workOf(ok(moveWorkInterval(board, 'monday', morning(board), dropped)).days.monday)).toEqual([
      '7:15–11:15',
      '14:00–17:00',
    ])
  })

  it('refuses a start off the step, which only a typed field could produce', () => {
    expect(refused(moveWorkInterval(preset(), 'monday', morning(preset()), 427))).toBe('not-a-step')
  })
})

describe('resizeWorkInterval', () => {
  it('moves the start edge and shortens the interval', () => {
    const board = preset()
    const after = ok(resizeWorkInterval(board, 'monday', morning(board), 'start', 540))
    expect(workOf(after.days.monday)).toEqual(['9:00–12:00', '14:00–17:00'])
  })

  it('moves the start edge the other way and lengthens the interval', () => {
    const board = preset()
    const after = ok(resizeWorkInterval(board, 'monday', morning(board), 'start', 420))
    expect(workOf(after.days.monday)).toEqual(['7:00–12:00', '14:00–17:00'])
  })

  it('moves the end edge and leaves the start where it was', () => {
    const board = preset()
    expect(workOf(ok(resizeWorkInterval(board, 'monday', morning(board), 'end', 780)).days.monday)).toEqual([
      '8:00–13:00',
      '14:00–17:00',
    ])
    expect(workOf(ok(resizeWorkInterval(board, 'monday', morning(board), 'end', 630)).days.monday)).toEqual([
      '8:00–10:30',
      '14:00–17:00',
    ])
  })

  it('takes a typed five-minute edge, which is the only difference from a snap', () => {
    const board = preset()
    const typedEnd = 13 * 60 + 40 // 13:40
    expect(typedEnd % 15).toBe(10) // so no drag could have produced it
    expect(workOf(ok(resizeWorkInterval(board, 'monday', morning(board), 'end', typedEnd)).days.monday)).toEqual([
      '8:00–13:40',
      '14:00–17:00',
    ])
  })

  it('moves the commute when the outer edge it hangs from is resized', () => {
    const board = ok(setCommute(preset(), 'monday', { beforeMinutes: 30, afterMinutes: 30 }))
    expect(commuteOf(board.days.monday)).toEqual([
      'commute before 7:30–8:00',
      'commute after 17:00–17:30',
    ])
    // Work now starts at 10:00, so the morning commute is 9:30–10:00.
    const later = ok(resizeWorkInterval(board, 'monday', morning(board), 'start', 600))
    expect(commuteOf(later.days.monday)).toEqual([
      'commute before 9:30–10:00',
      'commute after 17:00–17:30',
    ])
    // And when the last end moves, the evening one follows it.
    const longer = ok(resizeWorkInterval(board, 'monday', afternoon(board), 'end', 1140))
    expect(commuteOf(longer.days.monday)).toEqual([
      'commute before 7:30–8:00',
      'commute after 19:00–19:30',
    ])
  })

  it('refuses an interval under a quarter hour, from either edge', () => {
    const board = preset()
    // The end edge down to 8:10 leaves ten minutes of work.
    expect(refused(resizeWorkInterval(board, 'monday', morning(board), 'end', 490))).toBe('too-short')
    // The start edge up to 11:50 leaves the same ten minutes.
    expect(refused(resizeWorkInterval(board, 'monday', morning(board), 'start', 710))).toBe('too-short')
    // Fifteen minutes exactly is the shortest there is.
    expect(workOf(ok(resizeWorkInterval(board, 'monday', morning(board), 'end', 495)).days.monday)[0]).toBe(
      '8:00–8:15',
    )
  })

  it('refuses a resize that leaves the visible day', () => {
    const board = preset()
    expect(refused(resizeWorkInterval(board, 'monday', morning(board), 'start', 345))).toBe('outside-day')
    expect(refused(resizeWorkInterval(board, 'monday', afternoon(board), 'end', 1325))).toBe('outside-day')
  })

  it('refuses a resize that would cross the day’s other work', () => {
    const board = preset()
    // Growing the morning to 15:00 would run over the afternoon work.
    expect(refused(resizeWorkInterval(board, 'monday', morning(board), 'end', 900))).toBe('overlaps')
  })

  it('refuses a resize that would land on a placed session', () => {
    const board = preset()
    board.sessions.push({
      id: 's1',
      goalId: 'goal-study',
      day: 'monday',
      startMinute: 750,
      activityMinutes: 45,
      travel: { beforeMinutes: 0, afterMinutes: 0 },
      travelFollowsDefault: true,
      done: false,
    })
    // Growing the morning to 13:30 would swallow the 12:30 appointment.
    expect(refused(resizeWorkInterval(board, 'monday', morning(board), 'end', 810))).toBe('overlaps')
  })

  it('refuses a resize that would push the commute out of the day', () => {
    const board = ok(setCommute(preset(), 'monday', { beforeMinutes: 30, afterMinutes: 0 }))
    // Work at 6:00 would need the commute to start at 5:30.
    expect(refused(resizeWorkInterval(board, 'monday', morning(board), 'start', 360))).toBe('outside-day')
  })

  it('refuses an edge off the five-minute step', () => {
    const board = preset()
    expect(refused(resizeWorkInterval(board, 'monday', morning(board), 'end', 781))).toBe('not-a-step')
    expect(refused(resizeWorkInterval(board, 'monday', morning(board), 'start', -15))).toBe('too-short')
  })

  it('refuses an id that is not on that day', () => {
    const board = preset()
    expect(refused(resizeWorkInterval(board, 'monday', 'not-on-this-day', 'end', 780))).toBe('missing-work')
    expect(refused(resizeWorkInterval(board, 'sunday', morning(board), 'start', 420))).toBe('missing-work')
  })
})

describe('removeWorkInterval', () => {
  it('removes one interval, which is how a person leaves at 12:00', () => {
    const board = preset()
    const after = ok(removeWorkInterval(board, 'monday', afternoon(board)))
    expect(workOf(after.days.monday)).toEqual(['8:00–12:00'])
    // The afternoon joins the lunch hole, and nothing else moved.
    expect(freeStretches(after, 'monday')).toEqual([
      { startMinute: 360, endMinute: 480 },
      { startMinute: 720, endMinute: 1320 },
    ])
  })

  it('leaves the remaining work and the commute exactly as they were', () => {
    const board = ok(setCommute(preset(), 'monday', { beforeMinutes: 30, afterMinutes: 30 }))
    const after = ok(removeWorkInterval(board, 'monday', afternoon(board)))
    expect(workOf(after.days.monday)).toEqual(['8:00–12:00'])
    // The evening commute now hangs off the morning, because that is the last
    // work end on the day.
    expect(commuteOf(after.days.monday)).toEqual([
      'commute before 7:30–8:00',
      'commute after 12:00–12:30',
    ])
  })

  it('takes the commute with the last interval, because a commute hangs off work', () => {
    const board = preset()
    board.days.monday = {
      workIntervals: [workInterval('w1', 480, 720)],
      commuteBeforeMinutes: 30,
      commuteAfterMinutes: 45,
    }
    const after = ok(removeWorkInterval(board, 'monday', 'w1'))
    expect(after.days.monday.workIntervals).toEqual([])
    expect(after.days.monday.commuteBeforeMinutes).toBe(0)
    expect(after.days.monday.commuteAfterMinutes).toBe(0)
    expect(commuteOf(after.days.monday)).toEqual([])
  })

  it('leaves a legal day behind, so a day off can be given work again', () => {
    const working = ok(
      addWorkInterval(preset(), 'saturday', { startMinute: 570, endMinute: 630 }, countingIds()),
    )
    expect(workOf(working.days.saturday)).toEqual(['9:30–10:30'])
    const off = ok(removeWorkInterval(working, 'saturday', working.days.saturday.workIntervals[0].id))
    expect(off.days.saturday.workIntervals).toEqual([])
    // A day off is a day the plan rules allow, so the change is not merely
    // tolerated: it can be undone by putting work back.
    const again = ok(
      addWorkInterval(off, 'saturday', { startMinute: 1020, endMinute: 1080 }, countingIds()),
    )
    expect(workOf(again.days.saturday)).toEqual(['17:00–18:00'])
    expect(freeStretches(again, 'saturday')).toEqual([
      { startMinute: 360, endMinute: 1020 },
      { startMinute: 1080, endMinute: 1320 },
    ])
  })

  it('makes a workday a day off, commute and all, in two removals', () => {
    const board = ok(setCommute(preset(), 'monday', { beforeMinutes: 30, afterMinutes: 30 }))
    const dayOff = ok(removeWorkInterval(board, 'monday', morning(board)))
    // One interval is left, and the evening commute has moved onto it.
    expect(workOf(dayOff.days.monday)).toEqual(['14:00–17:00'])
    expect(commuteOf(dayOff.days.monday)).toEqual([
      'commute before 13:30–14:00',
      'commute after 17:00–17:30',
    ])
    const empty = ok(removeWorkInterval(dayOff, 'monday', dayOff.days.monday.workIntervals[0].id))
    expect(empty.days.monday).toEqual({
      workIntervals: [],
      commuteBeforeMinutes: 0,
      commuteAfterMinutes: 0,
    })
    // Which means the whole day is free again.
    expect(freeStretches(empty, 'monday')).toEqual([{ startMinute: 360, endMinute: 1320 }])
  })

  it('removes work even when a session sits in the stretch it frees', () => {
    const board = preset()
    board.oneOffs.push(oneOff('o1', 750, 45))
    const after = ok(removeWorkInterval(board, 'monday', morning(board)))
    expect(workOf(after.days.monday)).toEqual(['14:00–17:00'])
    // The appointment splits what is left of the morning.
    expect(freeStretches(after, 'monday')).toEqual([
      { startMinute: 360, endMinute: 750 },
      { startMinute: 795, endMinute: 840 },
      { startMinute: 1020, endMinute: 1320 },
    ])
  })

  it('refuses an id that is not on that day', () => {
    const board = preset()
    expect(refused(removeWorkInterval(board, 'monday', 'not-on-this-day'))).toBe('missing-work')
    expect(refused(removeWorkInterval(board, 'sunday', morning(board)))).toBe('missing-work')
  })
})

describe('setCommute', () => {
  it('sets one direction without touching the other', () => {
    const board = ok(setCommute(preset(), 'monday', { beforeMinutes: 30, afterMinutes: 45 }))
    expect(commuteOf(board.days.monday)).toEqual([
      'commute before 7:30–8:00',
      'commute after 17:00–17:45',
    ])
    const cleared = ok(setCommute(board, 'monday', { beforeMinutes: 0, afterMinutes: 45 }))
    expect(commuteOf(cleared.days.monday)).toEqual(['commute after 17:00–17:45'])
    expect(cleared.days.monday.commuteAfterMinutes).toBe(45)
  })

  it('gives the two directions different lengths', () => {
    const board = ok(setCommute(preset(), 'monday', { beforeMinutes: 15, afterMinutes: 50 }))
    expect(commuteOf(board.days.monday)).toEqual([
      'commute before 7:45–8:00',
      'commute after 17:00–17:50',
    ])
  })

  it('refuses a commute on a day with no work', () => {
    expect(refused(setCommute(preset(), 'saturday', { beforeMinutes: 30, afterMinutes: 0 }))).toBe(
      'commute-without-work',
    )
    expect(refused(setCommute(preset(), 'sunday', { beforeMinutes: 0, afterMinutes: 30 }))).toBe(
      'commute-without-work',
    )
  })

  it('allows clearing a commute on a day with no work, because there is nothing to clear', () => {
    const board = ok(setCommute(preset(), 'saturday', { beforeMinutes: 0, afterMinutes: 0 }))
    expect(board.days.saturday.commuteBeforeMinutes).toBe(0)
    expect(board.days.saturday.commuteAfterMinutes).toBe(0)
  })

  it('refuses a commute that would hit a placed session', () => {
    const board = preset()
    board.oneOffs.push(oneOff('o1', 390, 60))
    expect(refused(setCommute(board, 'monday', { beforeMinutes: 60, afterMinutes: 0 }))).toBe('overlaps')
    // One that stops short of the appointment is fine.
    const shorter = ok(setCommute(board, 'monday', { beforeMinutes: 30, afterMinutes: 0 }))
    expect(commuteOf(shorter.days.monday)).toEqual(['commute before 7:30–8:00'])
  })

  it('refuses a commute that would reach before 6:00 or past 22:00', () => {
    const board = preset()
    expect(refused(setCommute(board, 'monday', { beforeMinutes: 150, afterMinutes: 0 }))).toBe('outside-day')
    expect(refused(setCommute(board, 'monday', { beforeMinutes: 0, afterMinutes: 305 }))).toBe('outside-day')
  })

  it('accepts a commute that lands exactly on the day edges', () => {
    const board = ok(setCommute(preset(), 'monday', { beforeMinutes: 120, afterMinutes: 300 }))
    expect(commuteOf(board.days.monday)).toEqual([
      'commute before 6:00–8:00',
      'commute after 17:00–22:00',
    ])
  })

  it('refuses a commute under five minutes, and accepts five', () => {
    const board = preset()
    // The floor is asked before the step, so three minutes is too short rather
    // than off the grid: the sentence that explains the rule is the one shown.
    expect(refused(setCommute(board, 'monday', { beforeMinutes: 3, afterMinutes: 0 }))).toBe('too-short')
    expect(refused(setCommute(board, 'monday', { beforeMinutes: 0, afterMinutes: 1 }))).toBe('too-short')
    const five = ok(setCommute(board, 'monday', { beforeMinutes: MIN_TRAVEL_MINUTES, afterMinutes: 0 }))
    expect(five.days.monday.commuteBeforeMinutes).toBe(5)
    expect(commuteOf(five.days.monday)).toEqual(['commute before 7:55–8:00'])
  })

  it('refuses commute minutes off the five-minute step, once past the floor', () => {
    const board = preset()
    expect(refused(setCommute(board, 'monday', { beforeMinutes: 7, afterMinutes: 0 }))).toBe('not-a-step')
    expect(refused(setCommute(board, 'monday', { beforeMinutes: 0, afterMinutes: 12.5 }))).toBe('not-a-step')
  })

  it('refuses a negative commute', () => {
    expect(refused(setCommute(preset(), 'monday', { beforeMinutes: -30, afterMinutes: 0 }))).toBe('too-short')
  })
})

/**
 * The examples the product scope says the model has to allow, worked as the
 * sequence of changes a person would actually make.
 */
describe('the product scope examples', () => {
  it('allows leaving at 12:00, by removing 14:00–17:00', () => {
    const board = preset()
    const after = ok(removeWorkInterval(board, 'monday', afternoon(board)))
    expect(workOf(after.days.monday)).toEqual(['8:00–12:00'])
    expect(commuteOf(after.days.monday)).toEqual([])
  })

  it('allows starting earlier than 8:00, as long as the commute still fits', () => {
    const board = ok(setCommute(preset(), 'monday', { beforeMinutes: 30, afterMinutes: 0 }))
    const after = ok(moveWorkInterval(board, 'monday', morning(board), 420))
    expect(workOf(after.days.monday)).toEqual(['7:00–11:00', '14:00–17:00'])
    expect(commuteOf(after.days.monday)).toEqual(['commute before 6:30–7:00'])
    // But not so early that the commute would reach before 6:00.
    expect(refused(moveWorkInterval(board, 'monday', morning(board), 360))).toBe('outside-day')
  })

  it('allows an 8:00–10:00 appointment, so morning work is 10:00–12:00', () => {
    const board = preset()
    const shortened = ok(resizeWorkInterval(board, 'monday', morning(board), 'start', 600))
    expect(workOf(shortened.days.monday)).toEqual(['10:00–12:00', '14:00–17:00'])
    // The appointment is a one-off in the free time the change left behind.
    const appointment = oneOff('o1', 480, 120)
    const footprint = oneOffFootprint(appointment)
    expect(footprintRanges(footprint)).toBe('8:00–10:00')
    expect(checkFootprintFits(shortened, 'monday', footprint)).toBeNull()
  })

  it('allows a 9:30–10:30 appointment, which splits the morning in two', () => {
    const board = preset()
    const shortened = ok(resizeWorkInterval(board, 'monday', morning(board), 'end', 570))
    const split = ok(
      addWorkInterval(shortened, 'monday', { startMinute: 630, endMinute: 720 }, countingIds()),
    )
    expect(workOf(split.days.monday)).toEqual(['8:00–9:30', '10:30–12:00', '14:00–17:00'])
    // The appointment sits in the hole the two intervals leave between them.
    expect(freeStretches(split, 'monday')).toEqual([
      { startMinute: 360, endMinute: 480 },
      { startMinute: 570, endMinute: 630 },
      { startMinute: 720, endMinute: 840 },
      { startMinute: 1020, endMinute: 1320 },
    ])
    expect(checkFootprintFits(split, 'monday', oneOffFootprint(oneOff('o1', 570, 60)))).toBeNull()
  })

  it('allows a weekend to gain work, and to lose it again', () => {
    const board = preset()
    const working = ok(
      addWorkInterval(board, 'saturday', { startMinute: 570, endMinute: 630 }, countingIds()),
    )
    expect(workOf(working.days.saturday)).toEqual(['9:30–10:30'])
    const off = ok(removeWorkInterval(working, 'saturday', working.days.saturday.workIntervals[0].id))
    expect(off.days.saturday.workIntervals).toEqual([])
    expect(freeStretches(off, 'saturday')).toEqual([{ startMinute: 360, endMinute: 1320 }])
  })
})

describe('the board a change is made on', () => {
  const CHANGES: Array<[string, (board: Board) => Result<Board>]> = [
    [
      'addWorkInterval',
      (board) => addWorkInterval(board, 'monday', { startMinute: 1080, endMinute: 1140 }, countingIds()),
    ],
    [
      'moveWorkInterval',
      (board) => moveWorkInterval(board, 'monday', board.days.monday.workIntervals[0].id, 600),
    ],
    [
      'resizeWorkInterval',
      (board) =>
        resizeWorkInterval(board, 'monday', board.days.monday.workIntervals[0].id, 'end', 780),
    ],
    [
      'removeWorkInterval',
      (board) => removeWorkInterval(board, 'monday', board.days.monday.workIntervals[1].id),
    ],
    ['setCommute', (board) => setCommute(board, 'monday', { beforeMinutes: 30, afterMinutes: 30 })],
  ]

  for (const [name, change] of CHANGES) {
    it(`${name} leaves the board it was given exactly as it found it`, () => {
      const board = preset()
      const atBirth = structuredClone(board)
      expect(change(board).ok).toBe(true)
      expect(board).toEqual(atBirth)
    })

    it(`${name} hands back a new board with the day it changed rebuilt`, () => {
      const board = preset()
      const after = ok(change(board))
      expect(after).not.toBe(board)
      expect(after.days).not.toBe(board.days)
      expect(after.days.monday).not.toBe(board.days.monday)
      // No interval of the day that changed is shared with the board it came
      // from, so nothing on the result can be edited through the input.
      for (const [index, interval] of after.days.monday.workIntervals.entries()) {
        expect(interval).not.toBe(board.days.monday.workIntervals[index])
      }
      expect(after.version).toBe(1)
    })
  }

  it('does not touch a board it refuses, for every reason it can refuse', () => {
    const board = preset()
    const atBirth = structuredClone(board)
    const cases: Array<[RefusalReason, () => Result<Board>]> = [
      ['too-short', () => addWorkInterval(board, 'saturday', { startMinute: 600, endMinute: 605 }, countingIds())],
      ['outside-day', () => addWorkInterval(board, 'saturday', { startMinute: 345, endMinute: 420 }, countingIds())],
      ['not-a-step', () => moveWorkInterval(board, 'monday', board.days.monday.workIntervals[0].id, 427)],
      ['overlaps', () => moveWorkInterval(board, 'monday', board.days.monday.workIntervals[0].id, 605)],
      ['missing-work', () => removeWorkInterval(board, 'monday', 'not-on-this-day')],
      ['commute-without-work', () => setCommute(board, 'saturday', { beforeMinutes: 30, afterMinutes: 0 })],
    ]
    for (const [reason, run] of cases) expect(refused(run())).toBe(reason)
    expect(board).toEqual(atBirth)
  })

  it('refuses with the reasons the day rules own, and no others', () => {
    // The reasons work can produce are the six the board already had a word
    // for. Nothing here invents a reason of its own, and each of the six is
    // reachable.
    const seen = new Set<RefusalReason>()
    const board = preset()
    const note = (result: Result<Board>) => {
      if (!result.ok) seen.add(result.reason)
    }
    note(addWorkInterval(board, 'saturday', { startMinute: 600, endMinute: 605 }, countingIds()))
    note(addWorkInterval(board, 'saturday', { startMinute: 345, endMinute: 420 }, countingIds()))
    note(addWorkInterval(board, 'saturday', { startMinute: 601, endMinute: 660 }, countingIds()))
    note(moveWorkInterval(board, 'monday', 'not-on-this-day', 600))
    note(moveWorkInterval(board, 'monday', board.days.monday.workIntervals[0].id, 605))
    note(resizeWorkInterval(board, 'monday', board.days.monday.workIntervals[0].id, 'end', 900))
    note(removeWorkInterval(board, 'monday', 'not-on-this-day'))
    note(setCommute(board, 'saturday', { beforeMinutes: 30, afterMinutes: 0 }))
    note(setCommute(board, 'monday', { beforeMinutes: 1, afterMinutes: 0 }))
    expect([...seen].toSorted()).toEqual([
      'commute-without-work',
      'missing-work',
      'not-a-step',
      'outside-day',
      'overlaps',
      'too-short',
    ])
  })

  it('lets two changes be made from one board without seeing each other', () => {
    const board = ok(setCommute(preset(), 'monday', { beforeMinutes: 30, afterMinutes: 0 }))
    const atBirth = structuredClone(board)
    const later = ok(moveWorkInterval(board, 'monday', morning(board), 420))
    const emptied = ok(removeWorkInterval(board, 'monday', afternoon(board)))
    expect(later.days.monday.workIntervals).toHaveLength(2)
    expect(emptied.days.monday.workIntervals).toHaveLength(1)
    expect(board).toEqual(atBirth)
  })
})
