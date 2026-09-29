import { describe, expect, it } from 'vitest'

import { createDefaultBoard, type CreateId } from '@/domain/board'
import {
  checkCommute,
  checkDayPlan,
  checkFootprintFits,
  commuteFootprint,
  dayOccupancy,
  footprintRange,
  freeStretches,
  oneOffFootprint,
  placedOccupancy,
  sessionFootprint,
  workFootprint,
  type Footprint,
  type OccupiedStretch,
} from '@/domain/schedule'
import { formatClock } from '@/domain/time'
import {
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  MIN_TRAVEL_MINUTES,
  MIN_WORK_MINUTES,
  type Board,
  type DayPlan,
  type OneOff,
  type Session,
  type TravelMinutes,
  type WorkInterval,
} from '@/domain/types'

/** A predictable id source. The app passes `crypto.randomUUID`. */
function countingIds(): CreateId {
  let n = 0
  return () => {
    n += 1
    return `id-${n}`
  }
}

const NO_TRAVEL: TravelMinutes = { beforeMinutes: 0, afterMinutes: 0 }

function interval(id: string, startMinute: number, endMinute: number): WorkInterval {
  return { id, startMinute, endMinute }
}

function plan(
  workIntervals: WorkInterval[],
  commuteBeforeMinutes = 0,
  commuteAfterMinutes = 0,
): DayPlan {
  return { workIntervals, commuteBeforeMinutes, commuteAfterMinutes }
}

function session(
  id: string,
  startMinute: number,
  activityMinutes: number,
  overrides: Partial<Session> = {},
): Session {
  return {
    id,
    goalId: 'goal-study',
    day: 'monday',
    startMinute,
    activityMinutes,
    travel: { ...NO_TRAVEL },
    travelFollowsDefault: true,
    done: false,
    ...overrides,
  }
}

function oneOff(
  id: string,
  startMinute: number,
  activityMinutes: number,
  overrides: Partial<OneOff> = {},
): OneOff {
  return {
    id,
    name: 'Dentist',
    colorId: 'rose',
    day: 'monday',
    startMinute,
    activityMinutes,
    travel: { ...NO_TRAVEL },
    done: false,
    ...overrides,
  }
}

/** The preset week: 8:00–12:00 and 14:00–17:00, Monday to Friday. */
function preset(): Board {
  return createDefaultBoard(countingIds())
}

/** A board with one extra thing on Monday, built from the preset. */
function withMonday(
  build: (board: Board) => void,
  changes: (day: DayPlan) => DayPlan = (day) => day,
): Board {
  const board = preset()
  board.days.monday = changes(board.days.monday)
  build(board)
  return board
}

/** `work 8:00–12:00`, or `travel after 8:30–9:00` where a direction matters. */
function shape(stretch: OccupiedStretch): string {
  const range = `${formatClock(stretch.startMinute)}–${formatClock(stretch.endMinute)}`
  if (stretch.role === 'commute' || stretch.role === 'travel') {
    return `${stretch.role} ${stretch.direction} ${range}`
  }
  return `${stretch.role} ${range}`
}

function shapes(footprint: Footprint): string[] {
  return footprint.map(shape)
}

function ranges(footprint: Footprint): [number, number][] {
  return footprint.map((stretch) => [stretch.startMinute, stretch.endMinute])
}

/** Which block holds a stretch: `work:w1`, `session:s1`, or `commute`. */
function owner(stretch: OccupiedStretch): string {
  if (!('target' in stretch)) return 'commute'
  return `${stretch.target.kind}:${stretch.target.id}`
}

function owners(footprint: Footprint): string[] {
  return footprint.map(owner)
}

describe('workFootprint', () => {
  it('is one solid stretch with no travel of its own', () => {
    expect(shapes(workFootprint(interval('w1', 480, 720)))).toEqual(['work 8:00–12:00'])
  })

  it('knows which work interval holds it, so a refusal can say what is in the way', () => {
    expect(owners(workFootprint(interval('w1', 480, 720)))).toEqual(['work:w1'])
  })

  it('keeps the interval it was given, without copying it', () => {
    const morning = interval('w1', 480, 720)
    const [stretch] = workFootprint(morning)
    expect(stretch.startMinute).toBe(480)
    expect(stretch.endMinute).toBe(720)
    expect(morning).toEqual({ id: 'w1', startMinute: 480, endMinute: 720 })
  })
})

describe('commuteFootprint', () => {
  it('ends the morning commute at the first work start and starts the evening one at the last work end', () => {
    const footprint = commuteFootprint(plan([interval('w1', 480, 720), interval('w2', 840, 1020)], 30, 45))
    expect(shapes(footprint)).toEqual([
      'commute before 7:30–8:00',
      'commute after 17:00–17:45',
    ])
  })

  it('attaches to the outer ends only, so a middle work fragment gets no commute', () => {
    // An appointment splits the morning: 8:00–9:30, then 10:30–12:00.
    const footprint = commuteFootprint(plan([interval('w1', 480, 570), interval('w2', 630, 720)], 20, 0))
    expect(shapes(footprint)).toEqual(['commute before 7:40–8:00'])
    // Nothing sits in the 9:30–10:30 hole, because there is no work to commute to.
    expect(ranges(footprint)).not.toContainEqual([570, 630])
  })

  it('reads the earliest start and the latest end, not the stored order', () => {
    // A day whose intervals were not saved in clock order still commutes
    // around its real edges.
    const footprint = commuteFootprint(plan([interval('w2', 840, 1020), interval('w1', 480, 720)], 20, 30))
    expect(shapes(footprint)).toEqual([
      'commute before 7:40–8:00',
      'commute after 17:00–17:30',
    ])
  })

  it('emits nothing at all when there is no commute, rather than a zero-length stretch', () => {
    expect(commuteFootprint(plan([interval('w1', 480, 720)], 0, 0))).toEqual([])
  })

  it('answers each direction on its own', () => {
    expect(shapes(commuteFootprint(plan([interval('w1', 480, 720)], 15, 0)))).toEqual([
      'commute before 7:45–8:00',
    ])
    expect(shapes(commuteFootprint(plan([interval('w1', 480, 720)], 0, 15)))).toEqual([
      'commute after 12:00–12:15',
    ])
  })

  it('grows outward from the work edge, never inward', () => {
    const [before] = commuteFootprint(plan([interval('w1', 480, 720)], 60, 0))
    expect(before).toMatchObject({ startMinute: 420, endMinute: 480 })
    const [after] = commuteFootprint(plan([interval('w1', 480, 720)], 0, 60))
    expect(after).toMatchObject({ startMinute: 720, endMinute: 780 })
  })

  it('has no footprint on a day with no work, which is why checkCommute exists', () => {
    expect(commuteFootprint(plan([], 30, 30))).toEqual([])
  })

  it('has no target, because a commute belongs to the day rather than to a block', () => {
    const [stretch] = commuteFootprint(plan([interval('w1', 480, 720)], 30, 0))
    expect('target' in stretch).toBe(false)
  })
})

describe('checkCommute', () => {
  it('accepts a commute in either direction on a day that has work', () => {
    expect(checkCommute(plan([interval('w1', 480, 720)]), { beforeMinutes: 30, afterMinutes: 45 })).toBeNull()
    expect(checkCommute(plan([interval('w1', 480, 720)]), { beforeMinutes: 0, afterMinutes: 0 })).toBeNull()
  })

  it('refuses a commute on a day with no work', () => {
    expect(checkCommute(plan([], 30, 0), { beforeMinutes: 30, afterMinutes: 0 })).toBe(
      'commute-without-work',
    )
    expect(checkCommute(plan([], 0, 30), { beforeMinutes: 0, afterMinutes: 30 })).toBe(
      'commute-without-work',
    )
    expect(checkCommute(plan([], 30, 30), { beforeMinutes: 30, afterMinutes: 30 })).toBe(
      'commute-without-work',
    )
  })

  it('accepts no commute on a day with no work, because a day off is free', () => {
    expect(checkCommute(plan([]), NO_TRAVEL)).toBeNull()
  })

  it('says nothing about length or fit, which the footprint checks own', () => {
    // Three minutes is a later refusal, and a commute that would cross 6:00 is
    // an overlap decision, not a question about where a commute attaches.
    expect(checkCommute(plan([interval('w1', 480, 720)]), { beforeMinutes: 3, afterMinutes: 0 })).toBeNull()
  })
})

describe('sessionFootprint', () => {
  it('is travel before, then the activity, then travel after', () => {
    const footprint = sessionFootprint(
      session('s1', 750, 45, { travel: { beforeMinutes: 15, afterMinutes: 10 } }),
    )
    expect(shapes(footprint)).toEqual([
      'travel before 12:30–12:45',
      'activity 12:45–13:30',
      'travel after 13:30–13:40',
    ])
  })

  it('starts at the first minute it occupies, so travel before sits inside the stored start', () => {
    // The board says the session starts at 12:30; with twenty minutes of travel
    // the first occupied minute is 12:30 and the activity is the 12:50 after it.
    const footprint = sessionFootprint(
      session('s1', 750, 45, { travel: { beforeMinutes: 20, afterMinutes: 0 } }),
    )
    expect(ranges(footprint)).toEqual([
      [750, 770],
      [770, 815],
    ])
    expect(footprintRange(footprint)).toEqual({ startMinute: 750, endMinute: 815 })
  })

  it('is just the activity when there is no travel', () => {
    expect(shapes(sessionFootprint(session('s1', 750, 45)))).toEqual(['activity 12:30–13:15'])
  })

  it('counts travel as occupied time but not as activity length', () => {
    const withTravel = sessionFootprint(
      session('s1', 750, 45, { travel: { beforeMinutes: 20, afterMinutes: 15 } }),
    )
    const activity = withTravel.filter((stretch) => stretch.role === 'activity')
    expect(activity).toHaveLength(1)
    const occupied = footprintRange(withTravel)
    // One hour and twenty minutes on the grid, of which forty-five is the work.
    expect(occupied.endMinute - occupied.startMinute).toBe(80)
    expect(activity[0].endMinute - activity[0].startMinute).toBe(45)
  })

  it('attributes every stretch to the session', () => {
    const footprint = sessionFootprint(
      session('s1', 750, 45, { travel: { beforeMinutes: 15, afterMinutes: 10 } }),
    )
    expect(owners(footprint)).toEqual(['session:s1', 'session:s1', 'session:s1'])
  })

  it('hands out a fresh array and fresh stretches, so a board cannot be edited through a footprint', () => {
    const placed = session('s1', 750, 45)
    const first = sessionFootprint(placed)
    const second = sessionFootprint(placed)
    expect(first).not.toBe(second)
    expect(first[0]).not.toBe(second[0])
    expect(first).toEqual(second)
  })
})

describe('oneOffFootprint', () => {
  it('takes the same shape as a session, with no goal behind it', () => {
    const footprint = oneOffFootprint(
      oneOff('o1', 750, 60, { travel: { beforeMinutes: 10, afterMinutes: 10 } }),
    )
    expect(shapes(footprint)).toEqual([
      'travel before 12:30–12:40',
      'activity 12:40–13:40',
      'travel after 13:40–13:50',
    ])
    expect(owners(footprint)).toEqual(['one-off:o1', 'one-off:o1', 'one-off:o1'])
  })
})

describe('footprintRange', () => {
  it('is the outer range of a footprint, which is what has to fit in the day', () => {
    expect(footprintRange([])).toEqual({ startMinute: DAY_START_MINUTE, endMinute: DAY_START_MINUTE })
    expect(footprintRange(sessionFootprint(session('s1', 750, 45)))).toEqual({
      startMinute: 750,
      endMinute: 795,
    })
  })
})

describe('dayOccupancy', () => {
  it('lists the commute, the work, and every placed block on that day', () => {
    const board = withMonday(
      (b) => {
        b.sessions.push(session('s1', 750, 45))
        b.oneOffs.push(oneOff('o1', 1080, 30))
      },
      (day) => ({ ...day, commuteBeforeMinutes: 30, commuteAfterMinutes: 30 }),
    )
    expect(shapes(dayOccupancy(board, 'monday'))).toEqual([
      'commute before 7:30–8:00',
      'work 8:00–12:00',
      'activity 12:30–13:15',
      'work 14:00–17:00',
      'commute after 17:00–17:30',
      'activity 18:00–18:30',
    ])
  })

  it('leaves other days out, and their commute with them', () => {
    const board = withMonday(
      (b) => {
        b.sessions.push(session('s1', 750, 45, { day: 'monday' }))
        b.oneOffs.push(oneOff('o1', 1080, 30, { day: 'monday' }))
      },
      (day) => ({ ...day, commuteBeforeMinutes: 30 }),
    )
    expect(dayOccupancy(board, 'tuesday')).toHaveLength(2)
    expect(shapes(dayOccupancy(board, 'tuesday'))).toEqual(['work 8:00–12:00', 'work 14:00–17:00'])
  })

  it('is ordered by start minute, whatever order the board stored things in', () => {
    const board = preset()
    board.oneOffs.push(oneOff('o1', 1080, 30))
    board.sessions.push(session('s1', 750, 45))
    board.sessions.push(session('s2', 420, 30))
    const starts = dayOccupancy(board, 'monday').map((stretch) => stretch.startMinute)
    expect(starts).toEqual([...starts].toSorted((a, b) => a - b))
  })

  it('drops the named block and nothing else, so a move is not refused against itself', () => {
    const board = preset()
    board.sessions.push(session('s1', 750, 45))
    expect(owners(dayOccupancy(board, 'monday', { kind: 'session', id: 's1' }))).toEqual([
      'work:id-1',
      'work:id-2',
    ])
  })

  it('keeps a second session of the same task on the same day in the way', () => {
    const board = preset()
    board.sessions.push(session('s1', 750, 45))
    board.sessions.push(session('s2', 750, 45))
    expect(owners(dayOccupancy(board, 'monday', { kind: 'session', id: 's1' }))).toContain('session:s2')
  })

  it('keeps the commute when a block is excluded, since it hangs off the day', () => {
    const board = withMonday(() => {}, (day) => ({ ...day, commuteBeforeMinutes: 30 }))
    const ownersWithException = owners(dayOccupancy(board, 'monday', { kind: 'work', id: 'w-id-1' }))
    expect(ownersWithException).toContain('commute')
  })

  it('builds new stretch objects every call', () => {
    const board = preset()
    expect(dayOccupancy(board, 'monday')).not.toBe(dayOccupancy(board, 'monday'))
    expect(dayOccupancy(board, 'monday')).toEqual(dayOccupancy(board, 'monday'))
  })
})

describe('placedOccupancy', () => {
  it('is the blocks alone, with no work and no commute', () => {
    const board = withMonday(
      (b) => {
        b.sessions.push(session('s1', 750, 45))
        b.oneOffs.push(oneOff('o1', 1080, 30))
      },
      (day) => ({ ...day, commuteBeforeMinutes: 30, commuteAfterMinutes: 30 }),
    )
    expect(shapes(placedOccupancy(board, 'monday'))).toEqual([
      'activity 12:30–13:15',
      'activity 18:00–18:30',
    ])
  })

  it('includes the travel attached to a block', () => {
    const board = preset()
    board.oneOffs.push(
      oneOff('o1', 750, 45, { travel: { beforeMinutes: 15, afterMinutes: 15 } }),
    )
    expect(shapes(placedOccupancy(board, 'monday'))).toEqual([
      'travel before 12:30–12:45',
      'activity 12:45–13:30',
      'travel after 13:30–13:45',
    ])
  })
})

describe('freeStretches', () => {
  it('is the three gaps the preset weekday leaves', () => {
    expect(freeStretches(preset(), 'monday')).toEqual([
      { startMinute: 360, endMinute: 480 },
      { startMinute: 720, endMinute: 840 },
      { startMinute: 1020, endMinute: 1320 },
    ])
  })

  it('is the whole visible day when nothing is on it', () => {
    expect(freeStretches(preset(), 'saturday')).toEqual([
      { startMinute: DAY_START_MINUTE, endMinute: DAY_END_MINUTE },
    ])
  })

  it('takes the commute out of the stretch it sits in', () => {
    const board = withMonday(() => {}, (day) => ({ ...day, commuteBeforeMinutes: 30 }))
    // The commute is 7:30–8:00, so the pre-work hour is 6:00–7:30.
    expect(freeStretches(board, 'monday')[0]).toEqual({ startMinute: 360, endMinute: 450 })
  })

  it('takes a block and its travel out of the stretch', () => {
    const board = preset()
    board.sessions.push(
      session('s1', 1080, 45, { travel: { beforeMinutes: 15, afterMinutes: 10 } }),
    )
    // 18:00–18:15 travel, 18:15–19:00 activity, 19:00–19:10 travel.
    expect(freeStretches(board, 'monday')).toEqual([
      { startMinute: 360, endMinute: 480 },
      { startMinute: 720, endMinute: 840 },
      { startMinute: 1020, endMinute: 1080 },
      { startMinute: 1150, endMinute: 1320 },
    ])
  })

  it('joins two touching stretches rather than leaving a zero-width gap between them', () => {
    const board = withMonday(() => {}, () =>
      plan([interval('w1', 480, 720), interval('w2', 720, 840), interval('w3', 840, 1020)]),
    )
    expect(freeStretches(board, 'monday')).toEqual([
      { startMinute: 360, endMinute: 480 },
      { startMinute: 1020, endMinute: 1320 },
    ])
  })

  it('hands a stretch back when the block sitting on it is excluded', () => {
    const board = preset()
    board.sessions.push(session('s1', 750, 45))
    // The appointment splits the 12:00–14:00 gap into two shorter ones.
    expect(freeStretches(board, 'monday')[1]).toEqual({ startMinute: 720, endMinute: 750 })
    expect(freeStretches(board, 'monday')[2]).toEqual({ startMinute: 795, endMinute: 840 })
    expect(freeStretches(board, 'monday', { kind: 'session', id: 's1' })[1]).toEqual({
      startMinute: 720,
      endMinute: 840,
    })
  })

  it('never reaches outside 6:00–22:00', () => {
    for (const day of ['monday', 'saturday'] as const) {
      for (const stretch of freeStretches(preset(), day)) {
        expect(stretch.startMinute).toBeGreaterThanOrEqual(DAY_START_MINUTE)
        expect(stretch.endMinute).toBeLessThanOrEqual(DAY_END_MINUTE)
      }
    }
  })
})

describe('checkFootprintFits', () => {
  it('accepts a block that fits in the 12:00–14:00 hole', () => {
    const footprint = sessionFootprint(session('s1', 750, 45))
    expect(checkFootprintFits(preset(), 'monday', footprint)).toBeNull()
  })

  it('refuses a block that would cross work', () => {
    // 11:40–12:40 runs into the lunch break.
    const footprint = sessionFootprint(session('s1', 700, 60))
    expect(checkFootprintFits(preset(), 'monday', footprint)).toBe('overlaps')
  })

  it('accepts a block that ends at 22:00', () => {
    expect(checkFootprintFits(preset(), 'saturday', sessionFootprint(session('s1', 1290, 30)))).toBeNull()
    // And on a weekday, after the afternoon work.
    expect(
      checkFootprintFits(preset(), 'monday', sessionFootprint(session('s1', 1290, 30, { day: 'monday' }))),
    ).toBeNull()
  })

  it('refuses a block that starts before 6:00 or ends after 22:00', () => {
    expect(checkFootprintFits(preset(), 'saturday', sessionFootprint(session('s1', 355, 15)))).toBe(
      'outside-day',
    )
    expect(checkFootprintFits(preset(), 'saturday', sessionFootprint(session('s1', 1305, 20)))).toBe(
      'outside-day',
    )
  })

  it('accepts a block that touches work without crossing it', () => {
    // Starting exactly when the morning work ends is legal.
    expect(checkFootprintFits(preset(), 'monday', sessionFootprint(session('s1', 720, 60)))).toBeNull()
    // And ending exactly when the morning work starts is legal too.
    expect(checkFootprintFits(preset(), 'monday', sessionFootprint(session('s1', 420, 60)))).toBeNull()
  })

  it('refuses on the travel even when the activity itself would fit', () => {
    // The activity sits inside the hole; the hour of travel after it does not.
    const footprint = sessionFootprint(
      session('s1', 750, 60, { travel: { beforeMinutes: 0, afterMinutes: 60 } }),
    )
    expect(checkFootprintFits(preset(), 'monday', footprint)).toBe('overlaps')
    // Without the travel the same block fits.
    expect(checkFootprintFits(preset(), 'monday', sessionFootprint(session('s1', 750, 60)))).toBeNull()
  })

  it('refuses on the travel that pushes a block past 22:00', () => {
    const withTravel = sessionFootprint(
      session('s1', 1260, 40, { travel: { beforeMinutes: 0, afterMinutes: 30 } }),
    )
    expect(checkFootprintFits(preset(), 'saturday', withTravel)).toBe('outside-day')
    expect(checkFootprintFits(preset(), 'saturday', sessionFootprint(session('s1', 1260, 40)))).toBeNull()
  })

  it('refuses a footprint with nothing in it, or with a stretch of no length', () => {
    expect(checkFootprintFits(preset(), 'saturday', [])).toBe('too-short')
    expect(
      checkFootprintFits(preset(), 'saturday', [
        { role: 'work', target: { kind: 'work', id: 'w1' }, startMinute: 600, endMinute: 600 },
      ]),
    ).toBe('too-short')
  })

  it('refuses travel shorter than five minutes, and accepts five', () => {
    const tooShort = sessionFootprint(
      session('s1', 750, 45, { travel: { beforeMinutes: MIN_TRAVEL_MINUTES - 2, afterMinutes: 0 } }),
    )
    expect(checkFootprintFits(preset(), 'saturday', tooShort)).toBe('too-short')
    const longEnough = sessionFootprint(
      session('s1', 750, 45, { travel: { beforeMinutes: MIN_TRAVEL_MINUTES, afterMinutes: 0 } }),
    )
    expect(checkFootprintFits(preset(), 'saturday', longEnough)).toBeNull()
  })

  it('leaves the minimum activity length to the mutation, which knows the block kind', () => {
    // Ten minutes is below MIN_ACTIVITY_MINUTES but the check does not own that
    // rule; task 10's place and resize refuse it.
    expect(checkFootprintFits(preset(), 'saturday', sessionFootprint(session('s1', 750, 10)))).toBeNull()
  })

  it('accepts a second session of the same task on the same day', () => {
    const board = preset()
    board.sessions.push(session('s1', 1080, 45))
    const second = sessionFootprint(session('s2', 1140, 45))
    expect(second[0]).toMatchObject({ startMinute: 1140 })
    expect(checkFootprintFits(board, 'monday', second)).toBeNull()
    // The same task on the same stretch is refused, because it is the same time.
    expect(checkFootprintFits(board, 'monday', sessionFootprint(session('s2', 1080, 45)))).toBe(
      'overlaps',
    )
  })

  it('judges a move against everything except the block being moved', () => {
    const board = preset()
    board.sessions.push(session('s1', 1080, 45))
    // Growing in place would collide with itself if it were still in the way.
    const longer = sessionFootprint(session('s1', 1080, 90))
    expect(checkFootprintFits(board, 'monday', longer)).toBe('overlaps')
    expect(checkFootprintFits(board, 'monday', longer, { kind: 'session', id: 's1' })).toBeNull()
  })

  it('does not touch the board it was asked about', () => {
    const board = preset()
    board.sessions.push(session('s1', 750, 45))
    const atBirth = structuredClone(board)
    checkFootprintFits(board, 'monday', sessionFootprint(session('s2', 700, 60)))
    checkFootprintFits(board, 'monday', sessionFootprint(session('s3', 355, 15)))
    expect(board).toEqual(atBirth)
  })
})

describe('checkDayPlan', () => {
  it('accepts the preset weekday', () => {
    const board = preset()
    expect(checkDayPlan(board, 'monday', board.days.monday)).toBeNull()
  })

  it('accepts touching work intervals and refuses overlapping ones', () => {
    const board = preset()
    const touching = plan([interval('w1', 480, 720), interval('w2', 720, 840)])
    expect(checkDayPlan(board, 'monday', touching)).toBeNull()
    const overlapping = plan([interval('w1', 480, 720), interval('w2', 700, 840)])
    expect(checkDayPlan(board, 'monday', overlapping)).toBe('overlaps')
  })

  it('refuses a work interval under a quarter hour', () => {
    const board = preset()
    const short = plan([interval('w1', 480, 480 + MIN_WORK_MINUTES - 5)])
    expect(checkDayPlan(board, 'monday', short)).toBe('too-short')
    const exactly = plan([interval('w1', 480, 480 + MIN_WORK_MINUTES)])
    expect(checkDayPlan(board, 'monday', exactly)).toBeNull()
  })

  it('refuses work that leaves the visible day', () => {
    const board = preset()
    expect(checkDayPlan(board, 'monday', plan([interval('w1', 355, 720)]))).toBe('outside-day')
    expect(checkDayPlan(board, 'monday', plan([interval('w1', 480, 1325)]))).toBe('outside-day')
  })

  it('compares work against work inside the plan, not against the day already stored', () => {
    // Replacing 8:00–12:00 and 14:00–17:00 with one 10:00–15:00 interval overlaps
    // both stored intervals and nothing in the plan it replaces them with.
    const board = preset()
    expect(checkDayPlan(board, 'monday', plan([interval('w-new', 600, 900)]))).toBeNull()
  })

  it('refuses a commute on a day with no work', () => {
    const board = preset()
    expect(checkDayPlan(board, 'saturday', plan([], 30, 0))).toBe('commute-without-work')
    expect(checkDayPlan(board, 'saturday', plan([]))).toBeNull()
  })

  it('refuses a commute change because a session is in the way', () => {
    // A session in the pre-work hour, then a longer commute that would reach it.
    const board = withMonday((b) => {
      b.sessions.push(session('s1', 390, 60))
    })
    expect(checkDayPlan(board, 'monday', { ...board.days.monday, commuteBeforeMinutes: 60 })).toBe(
      'overlaps',
    )
    // A commute that stops short of it is fine.
    expect(checkDayPlan(board, 'monday', { ...board.days.monday, commuteBeforeMinutes: 30 })).toBeNull()
  })

  it('refuses a commute that would reach before 6:00 or past 22:00', () => {
    const board = preset()
    const day = board.days.monday
    expect(checkDayPlan(board, 'monday', { ...day, commuteBeforeMinutes: 150 })).toBe('outside-day')
    expect(checkDayPlan(board, 'monday', { ...day, commuteAfterMinutes: 301 })).toBe('outside-day')
    expect(checkDayPlan(board, 'monday', { ...day, commuteBeforeMinutes: 120, commuteAfterMinutes: 300 })).toBeNull()
  })

  it('refuses a commute shorter than five minutes, and accepts five', () => {
    const board = preset()
    const day = board.days.monday
    expect(checkDayPlan(board, 'monday', { ...day, commuteBeforeMinutes: 3 })).toBe('too-short')
    expect(checkDayPlan(board, 'monday', { ...day, commuteBeforeMinutes: MIN_TRAVEL_MINUTES })).toBeNull()
  })

  it('refuses work or commute that would land on a placed block', () => {
    const board = withMonday((b) => {
      b.sessions.push(session('s1', 750, 45))
    })
    // 11:00–14:00 runs over the appointment in the hole.
    expect(checkDayPlan(board, 'monday', plan([interval('w1', 660, 840)]))).toBe('overlaps')
    // Work that stops before it is allowed.
    expect(checkDayPlan(board, 'monday', plan([interval('w1', 480, 600)]))).toBeNull()
  })

  it('allows leaving at 12:00, which is the removal of the afternoon interval', () => {
    const board = preset()
    expect(checkDayPlan(board, 'monday', plan([interval('w1', 480, 720)]))).toBeNull()

    const after = withMonday(() => {}, () => plan([interval('w1', 480, 720)]))
    expect(freeStretches(after, 'monday')).toEqual([
      { startMinute: 360, endMinute: 480 },
      { startMinute: 720, endMinute: 1320 },
    ])
  })

  it('allows starting later than 8:00, so an 8:00–10:00 appointment fits the hole', () => {
    // Appointment 8:00–10:00, back at work 10:00–12:00 and 14:00–17:00.
    const board = preset()
    const morningOnly = plan([interval('w1', 600, 720), interval('w2', 840, 1020)])
    expect(checkDayPlan(board, 'monday', morningOnly)).toBeNull()

    const after = withMonday(() => {}, () => morningOnly)
    const appointment = oneOff('o1', 480, 120)
    expect(checkFootprintFits(after, 'monday', oneOffFootprint(appointment))).toBeNull()
  })

  it('allows the split morning an appointment creates, and the hole inside it', () => {
    // Appointment 9:30–10:30: 8:00–9:30, 10:30–12:00, 14:00–17:00.
    const board = preset()
    const split = plan([
      interval('w1', 480, 570),
      interval('w2', 630, 720),
      interval('w3', 840, 1020),
    ])
    expect(checkDayPlan(board, 'monday', split)).toBeNull()

    const after = withMonday(() => {}, () => split)
    expect(freeStretches(after, 'monday')).toEqual([
      { startMinute: 360, endMinute: 480 },
      { startMinute: 570, endMinute: 630 },
      { startMinute: 720, endMinute: 840 },
      { startMinute: 1020, endMinute: 1320 },
    ])
  })

  it('allows a weekend to gain work', () => {
    const board = preset()
    expect(checkDayPlan(board, 'saturday', plan([interval('w1', 600, 660)]))).toBeNull()
    const after = withMonday(() => {})
    after.days.saturday = plan([interval('w1', 600, 660)])
    expect(freeStretches(after, 'saturday')).toEqual([
      { startMinute: 360, endMinute: 600 },
      { startMinute: 660, endMinute: 1320 },
    ])
  })

  it('leaves a day off alone', () => {
    const board = preset()
    expect(checkDayPlan(board, 'sunday', plan([]))).toBeNull()
  })

  it('does not touch the board or the plan it was asked about', () => {
    const board = preset()
    const atBirth = structuredClone(board)
    const candidate = plan([interval('w1', 480, 720), interval('w2', 700, 840)], 30, 30)
    const candidateAtBirth = structuredClone(candidate)
    checkDayPlan(board, 'monday', candidate)
    expect(board).toEqual(atBirth)
    expect(candidate).toEqual(candidateAtBirth)
  })
})
