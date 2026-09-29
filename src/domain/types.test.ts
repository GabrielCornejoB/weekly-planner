import { describe, expect, it } from 'vitest'

import type {
  Board,
  ColorId,
  CountGoal,
  DayId,
  DayPlan,
  Goal,
  RefusalReason,
  Result,
  TimeGoal,
} from '@/domain/types'
import {
  BOARD_VERSION,
  DAYS,
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  DRAG_SNAP_MINUTES,
  MAX_NAME_LENGTH,
  MIN_ACTIVITY_MINUTES,
  MIN_TRAVEL_MINUTES,
  MIN_WORK_MINUTES,
  TYPED_STEP_MINUTES,
} from '@/domain/types'

/**
 * These are the values the rest of the plan is written against. If one of them
 * moves, the geometry, the step rules, and the copy all move with it, so the
 * test states the number rather than restating the intent.
 */
describe('board constants', () => {
  it('pins the visible day to 6:00 through 22:00', () => {
    expect(DAY_START_MINUTE).toBe(360)
    expect(DAY_END_MINUTE).toBe(1320)
    // 960 minutes is the column height every block percentage is taken from.
    expect(DAY_END_MINUTE - DAY_START_MINUTE).toBe(960)
  })

  it('separates the drag step from the typed step', () => {
    expect(DRAG_SNAP_MINUTES).toBe(15)
    expect(TYPED_STEP_MINUTES).toBe(5)
  })

  it('sets the minimum lengths and the name limit', () => {
    expect(MIN_ACTIVITY_MINUTES).toBe(15)
    expect(MIN_WORK_MINUTES).toBe(15)
    expect(MIN_TRAVEL_MINUTES).toBe(5)
    expect(MAX_NAME_LENGTH).toBe(40)
  })

  it('versions the document at 1', () => {
    expect(BOARD_VERSION).toBe(1)
  })
})

describe('DAYS', () => {
  it('is the seven days in order, monday first', () => {
    expect(DAYS).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ])
  })

  it('is the only source of DayId, so a column cannot be named twice', () => {
    const ids: DayId[] = [...DAYS]
    expect(ids).toHaveLength(7)
  })
})

const PALETTE: ColorId[] = [
  'red',
  'orange',
  'amber',
  'lime',
  'green',
  'teal',
  'sky',
  'blue',
  'indigo',
  'violet',
  'pink',
  'rose',
]

/**
 * Compile-time proof that `ColorId` is exactly the twelve ids above: a palette
 * id that is not listed here would leave the switch without a return.
 */
function colorIdLabel(id: ColorId): string {
  switch (id) {
    case 'red':
    case 'orange':
    case 'amber':
    case 'lime':
    case 'green':
    case 'teal':
    case 'sky':
    case 'blue':
    case 'indigo':
    case 'violet':
    case 'pink':
    case 'rose':
      return id
  }
}

describe('ColorId', () => {
  it('is the twelve palette ids and no others', () => {
    expect(PALETTE.map(colorIdLabel)).toEqual(PALETTE)
  })
})

/** The same trick, so `RefusalReason` cannot grow a case quietly. */
function refusalLabel(reason: RefusalReason): string {
  switch (reason) {
    case 'outside-day':
    case 'overlaps':
    case 'too-short':
    case 'not-a-step':
    case 'empty-name':
    case 'name-too-long':
    case 'invalid-quota':
    case 'kind-locked':
    case 'missing-goal':
    case 'missing-work':
    case 'missing-block':
    case 'commute-without-work':
    case 'invalid-backup':
    case 'storage-unavailable':
      return reason
  }
}

describe('RefusalReason', () => {
  it('is the closed set the plan lists, plus the two reasons a block needed', () => {
    // The plan says "at least", and two more reasons earned their place. A work
    // interval that is not on the day being changed, and a placed block that is
    // not on the board at all, have no honest sentence among the rest of them:
    // calling either a missing goal would be nonsense, and calling either an
    // overlap would be a lie. A stale grid drop is a real event, since the grid
    // is where block ids come from.
    const reasons: RefusalReason[] = [
      'outside-day',
      'overlaps',
      'too-short',
      'not-a-step',
      'empty-name',
      'name-too-long',
      'invalid-quota',
      'kind-locked',
      'missing-goal',
      'missing-work',
      'missing-block',
      'commute-without-work',
      'invalid-backup',
      'storage-unavailable',
    ]
    expect(reasons.map(refusalLabel)).toEqual(reasons)
  })
})

function emptyPlan(): DayPlan {
  return { workIntervals: [], commuteBeforeMinutes: 0, commuteAfterMinutes: 0 }
}

const TIME_GOAL: TimeGoal = {
  id: 'g1',
  kind: 'time',
  name: 'Study Spanish',
  colorId: 'sky',
  goalMinutes: 300,
  defaultActivityMinutes: 45,
  defaultTravel: { beforeMinutes: 5, afterMinutes: 5 },
}

const COUNT_GOAL: CountGoal = {
  id: 'g2',
  kind: 'count',
  name: 'Gym',
  colorId: 'green',
  goalCount: 3,
  defaultActivityMinutes: 60,
  defaultTravel: { beforeMinutes: 0, afterMinutes: 0 },
}

const BOARD: Board = {
  version: BOARD_VERSION,
  days: {
    monday: emptyPlan(),
    tuesday: emptyPlan(),
    wednesday: emptyPlan(),
    thursday: emptyPlan(),
    friday: emptyPlan(),
    saturday: emptyPlan(),
    sunday: emptyPlan(),
  },
  goals: [TIME_GOAL, COUNT_GOAL],
  sessions: [],
  oneOffs: [],
}

describe('Goal', () => {
  it('narrows on kind, so a count goal carries no minutes quota', () => {
    const goals: Goal[] = [TIME_GOAL, COUNT_GOAL]
    const quotas = goals.map((goal) =>
      goal.kind === 'time' ? `time ${goal.goalMinutes}` : `count ${goal.goalCount}`,
    )
    expect(quotas).toEqual(['time 300', 'count 3'])
  })
})

describe('Board', () => {
  it('needs every day, and a version of 1', () => {
    expect(Object.keys(BOARD.days)).toEqual([...DAYS])
    expect(BOARD.version).toBe(1)
  })
})

describe('Result', () => {
  it('carries either a value or a refusal reason', () => {
    const ok: Result<number> = { ok: true, value: 2 }
    const refused: Result<number> = { ok: false, reason: 'overlaps' }
    expect(ok).toEqual({ ok: true, value: 2 })
    expect(refused).toEqual({ ok: false, reason: 'overlaps' })
  })
})
