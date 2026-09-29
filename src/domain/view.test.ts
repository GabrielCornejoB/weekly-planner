import { describe, expect, it } from 'vitest'

import { createDefaultBoard, type CreateId } from '@/domain/board'
import { deleteGoal, updateGoal } from '@/domain/goals'
import { moveSession, placeSession, resizeSession, setSessionDone } from '@/domain/sessions'
import { moveWorkInterval, removeWorkInterval } from '@/domain/work'
import {
  toGridModel,
  toTaskListModel,
  DAY_OPTIONS,
  type GridBlockView,
  type GridDayView,
  type GridModel,
  type OneOffListRow,
  type TaskListRow,
} from '@/domain/view'
import {
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  type Board,
  type CountGoal,
  type DayId,
  type DayPlan,
  type OneOff,
  type Session,
  type TimeGoal,
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

/** The preset week: 8:00–12:00 and 14:00–17:00, Monday to Friday. */
function preset(): Board {
  return createDefaultBoard(countingIds())
}

const NOTHING: TravelMinutes = { beforeMinutes: 0, afterMinutes: 0 }
const STUDY = 'g-study'
const GYM = 'g-gym'
const DENTIST = 'o-dentist'

/** Monday with a commute, named work intervals, and the usual two intervals. */
const MONDAY_PLAN: DayPlan = {
  workIntervals: [
    { id: 'w-am', startMinute: 480, endMinute: 720 },
    { id: 'w-pm', startMinute: 840, endMinute: 1020 },
  ],
  commuteBeforeMinutes: 20,
  commuteAfterMinutes: 15,
}

function study(overrides: Partial<TimeGoal> = {}): TimeGoal {
  return {
    id: STUDY,
    kind: 'time',
    name: 'Study',
    colorId: 'sky',
    goalMinutes: 300,
    defaultActivityMinutes: 60,
    defaultTravel: NOTHING,
    ...overrides,
  }
}

function gym(overrides: Partial<CountGoal> = {}): CountGoal {
  return {
    id: GYM,
    kind: 'count',
    name: 'Gym',
    colorId: 'lime',
    goalCount: 3,
    defaultActivityMinutes: 45,
    defaultTravel: NOTHING,
    ...overrides,
  }
}

function dentist(overrides: Partial<OneOff> = {}): OneOff {
  return {
    id: DENTIST,
    name: 'Dentist',
    colorId: 'rose',
    day: 'monday',
    startMinute: 1080,
    activityMinutes: 60,
    travel: NOTHING,
    done: false,
    ...overrides,
  }
}

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    goalId: STUDY,
    day: 'monday',
    startMinute: 720,
    activityMinutes: 100,
    travel: { beforeMinutes: 10, afterMinutes: 5 },
    travelFollowsDefault: true,
    done: true,
    ...overrides,
  }
}

/**
 * One week with something of everything on it: a commute both ways, two work
 * intervals, a done study block with travel on each side, a plain study block on
 * Tuesday, and a one-off with no travel.
 */
function fixture(): Board {
  const base = preset()
  return {
    ...base,
    days: { ...base.days, monday: MONDAY_PLAN },
    goals: [study(), gym()],
    sessions: [
      session('s-mon'),
      session('s-tue', {
        day: 'tuesday',
        startMinute: 750,
        activityMinutes: 60,
        travel: NOTHING,
        done: false,
      }),
    ],
    oneOffs: [dentist()],
  }
}

function allBlocks(model: GridModel): GridBlockView[] {
  return model.days.flatMap((day) => day.blocks)
}

function column(model: GridModel, day: DayId): GridDayView {
  const found = model.days.find((entry) => entry.day === day)
  if (found === undefined) throw new Error(`the model has no ${day} column`)
  return found
}

function block(model: GridModel, id: string): GridBlockView {
  const found = allBlocks(model).find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`the model has no block ${id}`)
  return found
}

/** The activity rectangle of a placed block, which is drawn as its own strip. */
function activity(model: GridModel, id: string): GridBlockView {
  return block(model, `${id}:activity`)
}

function row(rows: TaskListRow[], id: string): TaskListRow {
  const found = rows.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`the list has no row ${id}`)
  return found
}

function goalRow(rows: TaskListRow[], id: string): TaskListRow & { kind: 'goal' } {
  const found = row(rows, id)
  if (found.kind !== 'goal') throw new Error(`row ${id} is not a goal row`)
  return found
}

function oneOffRow(rows: TaskListRow[], id: string): OneOffListRow {
  const found = row(rows, id)
  if (found.kind !== 'one-off') throw new Error(`row ${id} is not a one-off row`)
  return found
}

describe('grid geometry', () => {
  it('a 15-minute block is 15/960 of its column, not 15 out of 15', () => {
    const board = {
      ...preset(),
      goals: [study()],
      sessions: [
        session('s-short', { activityMinutes: 15, travel: NOTHING, startMinute: 720, done: false }),
      ],
    }
    const short = activity(toGridModel(board), 'session:s-short')
    expect(short.heightPercent).toBeCloseTo((15 / 960) * 100, 10)
    // A quarter of an hour is a fiftieth of a sixteen-hour column. The other two
    // numbers are the wrong answers this is here to rule out: dividing by the
    // snap step, which would make fifteen minutes fill the column, and reporting
    // a fraction where a percentage belongs.
    expect(short.heightPercent).toBeCloseTo(1.5625, 10)
    expect(short.heightPercent).not.toBe(100)
    expect(short.heightPercent).not.toBeLessThan(1)
  })

  it('a 100-minute block is 100/960 of its column', () => {
    const long = activity(toGridModel(fixture()), 'session:s-mon')
    expect(long.heightPercent).toBeCloseTo((100 / 960) * 100, 10)
    expect(long.heightPercent).toBeCloseTo((15 / 960) * 100 * (100 / 15), 10)
  })

  it('the top of a block is its first minute measured from 6:00', () => {
    const model = toGridModel(fixture())
    // The study activity starts at 12:10, with ten minutes of travel before it.
    expect(activity(model, 'session:s-mon').topPercent).toBeCloseTo(((730 - 360) / 960) * 100, 10)
    expect(block(model, 'session:s-mon:before').topPercent).toBeCloseTo(37.5, 10)
    expect(block(model, 'work:w-am').topPercent).toBeCloseTo(12.5, 10)
  })

  it('a block at 6:00 starts at the top of the column', () => {
    const board = {
      ...fixture(),
      sessions: [session('s-early', { startMinute: 360, travel: NOTHING, done: false })],
    }
    expect(activity(toGridModel(board), 'session:s-early').topPercent).toBe(0)
  })

  it('a block ending at 22:00 ends at the foot of the column', () => {
    const board = {
      ...fixture(),
      oneOffs: [dentist({ startMinute: 1020, activityMinutes: 300 })],
    }
    const late = activity(toGridModel(board), `one-off:${DENTIST}`)
    expect(late.topPercent + late.heightPercent).toBeCloseTo(100, 10)
  })

  it('work is as tall as the work really is', () => {
    const model = toGridModel(fixture())
    const morning = block(model, 'work:w-am')
    expect(morning.heightPercent).toBeCloseTo((240 / 960) * 100, 10)
    const afternoon = block(model, 'work:w-pm')
    expect(afternoon.heightPercent).toBeCloseTo((180 / 960) * 100, 10)
  })

  it('a block with travel is three strips that add up to its whole footprint', () => {
    const model = toGridModel(fixture())
    const strips = column(model, 'monday').blocks.filter(
      (entry) => entry.target?.kind === 'session' && entry.target.id === 's-mon',
    )
    expect(strips.map((entry) => entry.tone)).toEqual(['travel', 'activity', 'travel'])
    const total = strips.reduce((sum, entry) => sum + entry.heightPercent, 0)
    expect(total).toBeCloseTo((115 / 960) * 100, 10)
  })

  it('the strips of one block sit in clock order and touch each other', () => {
    const model = toGridModel(fixture())
    const strips = allBlocks(model)
      .filter((entry) => entry.target?.id === 's-mon')
      .toSorted((a, b) => a.topPercent - b.topPercent)
    expect(strips).toHaveLength(3)
    for (const [index, strip] of strips.entries()) {
      const previous = strips[index - 1]
      if (previous !== undefined) {
        expect(strip.topPercent).toBeCloseTo(previous.topPercent + previous.heightPercent, 10)
      }
    }
  })

  it('a commute is drawn where it attaches, not where the day starts', () => {
    const model = toGridModel(fixture())
    const before = block(model, 'commute:monday:before')
    expect(before.topPercent).toBeCloseTo(((460 - 360) / 960) * 100, 10)
    expect(before.heightPercent).toBeCloseTo((20 / 960) * 100, 10)
    const after = block(model, 'commute:monday:after')
    expect(after.topPercent).toBeCloseTo(((1020 - 360) / 960) * 100, 10)
    expect(after.heightPercent).toBeCloseTo((15 / 960) * 100, 10)
  })

  it('every rectangle in a real week sits inside its column', () => {
    for (const entry of allBlocks(toGridModel(fixture()))) {
      expect(entry.topPercent).toBeGreaterThanOrEqual(0)
      expect(entry.heightPercent).toBeGreaterThan(0)
      expect(entry.topPercent + entry.heightPercent).toBeLessThanOrEqual(100 + Number.EPSILON)
    }
  })

  it('nothing is clamped: a block past the end of the day keeps its geometry', () => {
    const board = {
      ...fixture(),
      oneOffs: [dentist({ startMinute: 1200, activityMinutes: 300 })],
    }
    const late = activity(toGridModel(board), `one-off:${DENTIST}`)
    // 20:00 to 25:00, which is not a time. The picture says so rather than
    // quietly pulling the block back inside the column, because a view model
    // that repairs a geometry can disagree with the one drawn next to it.
    expect(late.topPercent).toBeCloseTo(87.5, 10)
    expect(late.topPercent + late.heightPercent).toBeGreaterThan(100)
  })
})

describe('what a touch may do', () => {
  it('work is draggable and resizable', () => {
    const work = block(toGridModel(fixture()), 'work:w-am')
    expect(work.draggable).toBe(true)
    expect(work.resizable).toBe(true)
  })

  it('an activity is draggable and resizable', () => {
    const strip = activity(toGridModel(fixture()), 'session:s-mon')
    expect(strip.tone).toBe('activity')
    expect(strip.draggable).toBe(true)
    expect(strip.resizable).toBe(true)
  })

  it('a commute belongs to the day, so it is neither draggable nor resizable', () => {
    const commute = block(toGridModel(fixture()), 'commute:monday:before')
    expect(commute.draggable).toBe(false)
    expect(commute.resizable).toBe(false)
    expect(commute.target).toBeNull()
  })

  it('a travel strip opens the block that owns it, and is not dragged on its own', () => {
    const model = toGridModel(fixture())
    const travel = column(model, 'monday').blocks.find(
      (entry) => entry.tone === 'travel' && entry.target?.id === 's-mon',
    )
    if (travel === undefined) throw new Error('the study block lost its travel')
    expect(travel.draggable).toBe(false)
    expect(travel.resizable).toBe(false)
    expect(travel.target).toEqual({ kind: 'session', id: 's-mon' })
  })

  it('a done block is still dragged and still resized', () => {
    const strip = activity(toGridModel(fixture()), 'session:s-mon')
    expect(strip.done).toBe(true)
    expect(strip.draggable).toBe(true)
    expect(strip.resizable).toBe(true)
  })

  it('every rectangle is one of the four tones', () => {
    const tones = new Set(allBlocks(toGridModel(fixture())).map((entry) => entry.tone))
    expect([...tones].toSorted()).toEqual(['activity', 'commute', 'travel', 'work'])
  })
})

describe('names, colors, and second lines', () => {
  it('a work rectangle is called Work and shows its clock range', () => {
    const work = block(toGridModel(fixture()), 'work:w-am')
    expect(work.label).toBe('Work')
    expect(work.detail).toBe('8:00–12:00')
    expect(work.colorId).toBeNull()
  })

  it('a commute and a travel strip are both called Travel and say nothing else', () => {
    const model = toGridModel(fixture())
    const commute = block(model, 'commute:monday:before')
    const travel = column(model, 'monday').blocks.find(
      (entry) => entry.tone === 'travel' && entry.target?.id === 's-mon',
    )
    if (travel === undefined) throw new Error('the study block lost its travel')
    expect(commute.label).toBe('Travel')
    expect(travel.label).toBe('Travel')
    expect(commute.detail).toBeNull()
    expect(travel.detail).toBeNull()
  })

  it('an activity shows the name of its task, not an id', () => {
    const strip = activity(toGridModel(fixture()), 'session:s-mon')
    expect(strip.label).toBe('Study')
    expect(strip.label).not.toContain(STUDY)
  })

  it('a one-off shows its own name', () => {
    expect(activity(toGridModel(fixture()), `one-off:${DENTIST}`).label).toBe('Dentist')
  })

  it('an activity shows how long it is', () => {
    expect(activity(toGridModel(fixture()), 'session:s-tue').detail).toBe('1 hour')
    const board = {
      ...fixture(),
      sessions: [session('s-long', { done: false, travel: NOTHING })],
    }
    expect(activity(toGridModel(board), 'session:s-long').detail).toBe('1 hour 40 minutes')
  })

  it('a done activity says Done and still shows its length', () => {
    const done = activity(toGridModel(fixture()), 'session:s-mon')
    expect(done.detail).toBe('Done · 1 hour 40 minutes')
    expect(done.detail).toContain('1 hour 40 minutes')
  })

  it('a travel strip wears its block color and work and commute wear none', () => {
    const model = toGridModel(fixture())
    expect(block(model, 'session:s-mon:before').colorId).toBe('sky')
    expect(activity(model, 'session:s-mon').colorId).toBe('sky')
    expect(block(model, 'work:w-am').colorId).toBeNull()
    expect(block(model, 'commute:monday:before').colorId).toBeNull()
  })

  it('a travel strip of a done block is done, and a commute never is', () => {
    const model = toGridModel(fixture())
    // The Tuesday block has no travel at all, and work is not a task, so the done
    // study block and its two strips are the only done things in the week.
    expect(column(model, 'monday').blocks.filter((entry) => entry.done).map((e) => e.id)).toEqual([
      'session:s-mon:before',
      'session:s-mon:activity',
      'session:s-mon:after',
    ])
    expect(block(model, 'session:s-mon:before').target).toEqual({ kind: 'session', id: 's-mon' })
    expect(allBlocks(model).filter((entry) => entry.tone === 'commute').every((e) => !e.done)).toBe(
      true,
    )
  })

  it('renaming a task renames every one of its blocks on the grid', () => {
    // The name and the hue live on the goal, so one edit reaches both of the
    // study blocks and leaves the one-off's own name alone.
    const renamed = updateGoal(fixture(), STUDY, {
      kind: 'time',
      name: 'Reading',
      colorId: 'rose',
      goalMinutes: 300,
      defaultActivityMinutes: 60,
      defaultTravel: NOTHING,
    })
    if (!renamed.ok) throw new Error('the rename was refused')
    const model = toGridModel(renamed.value)
    expect(activity(model, 'session:s-mon').label).toBe('Reading')
    expect(activity(model, 'session:s-tue').label).toBe('Reading')
    expect(activity(model, 'session:s-mon').colorId).toBe('rose')
    expect(activity(model, `one-off:${DENTIST}`).label).toBe('Dentist')
  })

  it('a session whose task is gone is still drawn, and says what is wrong', () => {
    const board: Board = { ...fixture(), goals: [gym()] }
    const orphan = activity(toGridModel(board), 'session:s-mon')
    expect(orphan.tone).toBe('activity')
    expect(orphan.label).toBe('Task not on this board')
    expect(orphan.colorId).toBeNull()
    expect(orphan.done).toBe(true)
    expect(orphan.heightPercent).toBeCloseTo((100 / 960) * 100, 10)
  })
})

describe('keys', () => {
  it('every key in a real week is unique', () => {
    const ids = allBlocks(toGridModel(fixture())).map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('a work interval and a session may share a raw id without sharing a key', () => {
    const board = fixture()
    const clashing: Board = {
      ...board,
      days: {
        ...board.days,
        monday: {
          workIntervals: [{ id: 's-tue', startMinute: 480, endMinute: 720 }],
          commuteBeforeMinutes: 0,
          commuteAfterMinutes: 0,
        },
      },
      sessions: [session('s-tue', { day: 'monday', startMinute: 720, travel: NOTHING })],
    }
    const ids = allBlocks(toGridModel(clashing)).map((entry) => entry.id)
    expect(ids).toContain('work:s-tue')
    expect(ids).toContain('session:s-tue:activity')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('one block drawn as three strips is three keys, not one', () => {
    const ids = allBlocks(toGridModel(fixture()))
      .filter((entry) => entry.target?.id === 's-mon')
      .map((entry) => entry.id)
    expect(ids).toEqual(['session:s-mon:before', 'session:s-mon:activity', 'session:s-mon:after'])
  })

  it('the two directions of a commute are two different rectangles', () => {
    const ids = column(toGridModel(fixture()), 'monday').blocks
      .filter((entry) => entry.tone === 'commute')
      .map((entry) => entry.id)
    expect(ids).toEqual(['commute:monday:before', 'commute:monday:after'])
  })
})

describe('the shape of the week', () => {
  it('seven days, in order, with their names and no dates', () => {
    const model = toGridModel(fixture())
    expect(model.days.map((day) => day.day)).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ])
    expect(model.days.map((day) => day.label)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ])
  })

  it('the day options are the same seven, in the same order', () => {
    expect(DAY_OPTIONS.map((option) => option.label)).toEqual(
      toGridModel(fixture()).days.map((day) => day.label),
    )
  })

  it('the preset has work on the weekdays and nothing else', () => {
    const model = toGridModel(preset())
    expect(allBlocks(model)).toHaveLength(10)
    for (const day of model.days.slice(0, 5)) {
      expect(day.blocks.map((entry) => entry.tone)).toEqual(['work', 'work'])
    }
    expect(model.days.slice(5).map((day) => day.blocks)).toEqual([[], []])
  })

  it('a weekend column exists even when nothing is in it', () => {
    const model = toGridModel(preset())
    expect(column(model, 'saturday').label).toBe('Saturday')
    expect(column(model, 'saturday').blocks).toEqual([])
  })

  it('rectangles are listed in clock order down each column', () => {
    const model = toGridModel(fixture())
    for (const day of model.days) {
      const tops = day.blocks.map((entry) => entry.topPercent)
      expect(tops).toEqual(tops.toSorted((a, b) => a - b))
    }
    expect(column(model, 'monday').blocks.map((entry) => entry.id)).toEqual([
      'commute:monday:before',
      'work:w-am',
      'session:s-mon:before',
      'session:s-mon:activity',
      'session:s-mon:after',
      'work:w-pm',
      'commute:monday:after',
      `one-off:${DENTIST}:activity`,
    ])
  })

  it('a column is found by its day, not by the order the board lists blocks', () => {
    const board: Board = {
      ...preset(),
      sessions: [
        session('s-sat', { day: 'saturday', startMinute: 600, travel: NOTHING, done: false }),
        session('s-sun', { day: 'sunday', startMinute: 600, travel: NOTHING, done: false }),
      ],
    }
    expect(activity(toGridModel(board), 'session:s-sat').day).toBe('saturday')
    expect(activity(toGridModel(board), 'session:s-sun').day).toBe('sunday')
    expect(board.sessions.map((entry) => entry.id)).toEqual(['s-sat', 's-sun'])
  })

  it('hour lines run from 6:00 to 22:00 and half hours are faint', () => {
    const { lines } = toGridModel(fixture())
    const major = lines.filter((line) => line.major)
    const minor = lines.filter((line) => !line.major)
    expect(major).toHaveLength(17)
    expect(minor).toHaveLength(16)
    expect(major[0]).toEqual({ minute: 360, label: '6:00', major: true, topPercent: 0 })
    expect(major[major.length - 1]?.label).toBe('22:00')
    expect(major[major.length - 1]?.topPercent).toBe(100)
    expect(minor[0]).toEqual({ minute: 390, label: null, major: false, topPercent: 3.125 })
    expect(minor[minor.length - 1]?.minute).toBe(1290)
  })

  it('there is no line every fifteen minutes', () => {
    for (const line of toGridModel(fixture()).lines) {
      expect(line.minute % 30).toBe(0)
    }
  })
})

describe('the task list', () => {
  it('a goal row carries the sentence and the status progress derived', () => {
    const board = fixture()
    const rows = toTaskListModel(board)
    const studyRow = goalRow(rows, STUDY)
    expect(studyRow.kind).toBe('goal')
    expect(studyRow.name).toBe('Study')
    expect(studyRow.colorId).toBe('sky')
    expect(studyRow.progress.goalId).toBe(STUDY)
    expect(studyRow.progress.sentence).toBe(
      '1 hour 40 minutes done of 5 hours. 2 hours 20 minutes are not on the grid.',
    )
    expect(studyRow.progress.done).toBe(100)
    expect(studyRow.progress.placed).toBe(160)
    expect(studyRow.progress.goal).toBe(300)
    expect(studyRow.progress.unplaced).toBe(140)
  })

  it('a goal with unplaced time is unplaced', () => {
    const rows = toTaskListModel(fixture())
    expect(goalRow(rows, STUDY).progress.status).toBe('unplaced')
  })

  it('all four statuses are reachable, and there is no fifth', () => {
    const visit = (id: string, goalId: string, minute: number, done: boolean): Session => ({
      id,
      goalId,
      day: 'saturday',
      startMinute: minute,
      activityMinutes: 60,
      travel: NOTHING,
      travelFollowsDefault: true,
      done,
    })
    const board: Board = {
      ...preset(),
      goals: [
        // 100 of 300 minutes placed: still an unplanned week.
        study({ id: 'g-low', goalMinutes: 300 }),
        // All 60 minutes placed, none done: planned.
        study({ id: 'g-read', name: 'Reading', goalMinutes: 60 }),
        // 120 of 60 minutes placed: over.
        study({ id: 'g-walk', name: 'Walk', goalMinutes: 60 }),
        // Three visits, all done: met.
        gym(),
      ],
      sessions: [
        visit('s-low', 'g-low', 480, true),
        visit('s-read', 'g-read', 540, false),
        visit('s-walk-1', 'g-walk', 600, false),
        visit('s-walk-2', 'g-walk', 660, false),
        visit('s-gym-1', GYM, 720, true),
        visit('s-gym-2', GYM, 780, true),
        visit('s-gym-3', GYM, 840, true),
      ],
    }
    const statuses = toTaskListModel(board).map((entry) =>
      entry.kind === 'goal' ? entry.progress.status : 'no-status',
    )
    expect(new Set(statuses)).toEqual(new Set(['unplaced', 'planned', 'over', 'met']))
  })

  it('goals come first, then one-offs, each in the order the board holds them', () => {
    const board: Board = {
      ...preset(),
      goals: [study({ id: 'g-z', name: 'Zebra' }), study({ id: 'g-a', name: 'Apple' })],
      oneOffs: [dentist({ id: 'o-1', name: 'Dinner' }), dentist({ id: 'o-2', name: 'Cinema' })],
    }
    expect(toTaskListModel(board).map((entry) => entry.name)).toEqual([
      'Zebra',
      'Apple',
      'Dinner',
      'Cinema',
    ])
  })

  it('a one-off row has a day, a clock span, and a done mark, and no quota at all', () => {
    const row = oneOffRow(toTaskListModel(fixture()), DENTIST)
    expect(row.kind).toBe('one-off')
    expect(row.name).toBe('Dentist')
    expect(row.colorId).toBe('rose')
    expect(row.day).toBe('monday')
    expect(row.dayLabel).toBe('Monday')
    expect(row.when).toBe('18:00–19:00')
    expect(row.done).toBe(false)
    expect('progress' in row).toBe(false)
  })

  it('a one-off clock span covers its travel, not just its activity', () => {
    const board = {
      ...fixture(),
      oneOffs: [
        dentist({
          id: 'o-trip',
          name: 'Pool',
          startMinute: 1200,
          activityMinutes: 60,
          travel: { beforeMinutes: 15, afterMinutes: 10 },
        }),
      ],
    }
    expect(oneOffRow(toTaskListModel(board), 'o-trip').when).toBe('20:00–21:25')
  })

  it('a one-off row follows the board, travel and all', () => {
    const board = fixture()
    const rows = toTaskListModel(board)
    expect(oneOffRow(rows, DENTIST).when).toBe('18:00–19:00')
    const moved: Board = {
      ...board,
      oneOffs: [dentist({ startMinute: 480, activityMinutes: 30 })],
    }
    expect(oneOffRow(toTaskListModel(moved), DENTIST).when).toBe('8:00–8:30')
  })

  it('every row is a case of the one union, told apart by kind', () => {
    const rows = toTaskListModel(fixture())
    for (const entry of rows) {
      expect(entry.id).not.toBe('')
      if (entry.kind === 'goal') {
        expect(entry.id).not.toBe('');
        expect(entry.progress.goalId).toBe(entry.id)
        expect(entry.progress.sentence.endsWith('.')).toBe(true)
      } else {
        expect(entry.when).toMatch(/^\d{1,2}:\d{2}–\d{1,2}:\d{2}$/)
      }
    }
    expect(rows.filter((entry) => entry.kind === 'goal')).toHaveLength(2)
    expect(rows.filter((entry) => entry.kind === 'one-off')).toHaveLength(1)
  })

  it('a row carries exactly its own fields, so there is no second opinion to read', () => {
    const rows = toTaskListModel(fixture())
    // A goal row nests the whole record rather than copying a sentence and a
    // status out of it, so a `status` of its own cannot sit beside
    // `progress.status` and quietly disagree with it.
    expect(Object.keys(goalRow(rows, STUDY)).toSorted()).toEqual([
      'colorId',
      'id',
      'kind',
      'name',
      'progress',
    ])
    expect(Object.keys(oneOffRow(rows, DENTIST)).toSorted()).toEqual([
      'colorId',
      'day',
      'dayLabel',
      'done',
      'id',
      'kind',
      'name',
      'when',
    ])
  })
})

describe('purity', () => {
  it('neither model changes the board', () => {
    const board = fixture()
    const snapshot = structuredClone(board)
    toGridModel(board)
    toTaskListModel(board)
    expect(board).toEqual(snapshot)
  })

  it('two calls agree', () => {
    const board = fixture()
    expect(toGridModel(board)).toEqual(toGridModel(board))
    expect(toTaskListModel(board)).toEqual(toTaskListModel(board))
  })

  it('the model hands back its own arrays, not the board lists', () => {
    const board = fixture()
    const model = toGridModel(board)
    const rows = toTaskListModel(board)
    expect(model.days).not.toBe(board.days)
    expect(rows).not.toBe(board.goals)
    expect(rows[0]).not.toBe(board.goals[0])
  })

  it('the model does not sort the board lists on its way past', () => {
    const board: Board = {
      ...fixture(),
      sessions: [
        session('s-fri', { day: 'friday', startMinute: 720, travel: NOTHING }),
        session('s-mon2', { day: 'monday', startMinute: 840, travel: NOTHING }),
      ],
    }
    toGridModel(board)
    toTaskListModel(board)
    expect(board.sessions.map((entry) => entry.id)).toEqual(['s-fri', 's-mon2'])
  })
})

describe('through the real mutations', () => {
  it('a renamed task renames its blocks with no help from the view model', () => {
    const board = fixture()
    const renamed = updateGoal(board, STUDY, {
      kind: 'time',
      name: 'Write',
      colorId: 'violet',
      goalMinutes: 600,
      defaultActivityMinutes: 60,
      defaultTravel: NOTHING,
    })
    if (!renamed.ok) throw new Error('the rename was refused')
    const strip = activity(toGridModel(renamed.value), 'session:s-mon')
    expect(strip.label).toBe('Write')
    expect(strip.colorId).toBe('violet')
    expect(goalRow(toTaskListModel(renamed.value), STUDY).progress.sentence).toBe(
      '1 hour 40 minutes done of 10 hours. 7 hours 20 minutes are not on the grid.',
    )
  })

  it('deleting a task takes its row with it, and its blocks with that', () => {
    const removed = deleteGoal(fixture(), STUDY)
    if (!removed.ok) throw new Error('the delete was refused')
    expect(toTaskListModel(removed.value).map((entry) => entry.id)).toEqual([GYM, DENTIST])
    expect(allBlocks(toGridModel(removed.value)).map((entry) => entry.id)).not.toContain(
      'session:s-mon:activity',
    )
  })

  it('marking a block done changes the row the list shows', () => {
    const marked = setSessionDone(fixture(), 's-tue', true)
    if (!marked.ok) throw new Error('the mark was refused')
    expect(goalRow(toTaskListModel(marked.value), STUDY).progress.done).toBe(160)
    expect(goalRow(toTaskListModel(marked.value), STUDY).progress.sentence).toBe(
      '2 hours 40 minutes done of 5 hours. 2 hours 20 minutes are not on the grid.',
    )
  })

  it('placing a block through the mutation shows up on the grid and in the list', () => {
    const placed = placeSession(fixture(), STUDY, 'saturday', 480, countingIds())
    if (!placed.ok) throw new Error('the place was refused')
    const strip = activity(toGridModel(placed.value), 'session:id-1')
    expect(strip.tone).toBe('activity')
    expect(strip.label).toBe('Study')
    expect(strip.detail).toBe('1 hour')
    expect(goalRow(toTaskListModel(placed.value), STUDY).progress.placed).toBe(220)
  })

  it('a resize moves the activity strip and keeps the travel attached to it', () => {
    const board = fixture()
    // The study activity runs 12:10 to 13:50. Dragging its start edge to 13:00
    // leaves fifty minutes of activity. The travel before it keeps its ten
    // minutes and stays glued to the new left edge — a block is contiguous, so
    // there is nothing else it could do — and the travel after it does not move
    // at all. This is why a grid resize reports the activity's edge rather than
    // the block's first minute.
    const resized = resizeSession(board, 's-mon', 'start', 780)
    if (!resized.ok) throw new Error('the resize was refused')
    const before = toGridModel(board)
    const after = toGridModel(resized.value)
    const next = activity(after, 'session:s-mon')
    expect(next.topPercent).toBeCloseTo(((780 - 360) / 960) * 100, 10)
    expect(next.heightPercent).toBeCloseTo((50 / 960) * 100, 10)
    expect(activity(before, 'session:s-mon').heightPercent).toBeCloseTo((100 / 960) * 100, 10)

    const travelBefore = block(after, 'session:s-mon:before')
    expect(travelBefore.heightPercent).toBe(block(before, 'session:s-mon:before').heightPercent)
    expect(travelBefore.topPercent).toBeCloseTo(((770 - 360) / 960) * 100, 10)
    expect(travelBefore.topPercent + travelBefore.heightPercent).toBeCloseTo(next.topPercent, 10)
    expect(block(after, 'session:s-mon:after')).toEqual(block(before, 'session:s-mon:after'))
  })

  it('moving a block takes it off the old day and does not leave a ghost', () => {
    const moved = moveSession(fixture(), 's-tue', 'friday', 720)
    if (!moved.ok) throw new Error('the move was refused')
    const model = toGridModel(moved.value)
    const tuesday = column(model, 'tuesday').blocks
    expect(tuesday.filter((entry) => entry.target?.id === 's-tue')).toEqual([])
    expect(tuesday.every((entry) => entry.tone === 'work')).toBe(true)
    expect(activity(model, 'session:s-tue').day).toBe('friday')
  })

  it('moving the first work start moves the commute with it', () => {
    const board = fixture()
    const moved = moveWorkInterval(board, 'monday', 'w-am', 420)
    if (!moved.ok) throw new Error('the work move was refused')
    const model = toGridModel(moved.value)
    const commute = block(model, 'commute:monday:before')
    expect(commute.topPercent).toBeCloseTo(((400 - 360) / 960) * 100, 10)
    expect(block(model, 'work:w-am').topPercent).toBeCloseTo(6.25, 10)
  })

  it('emptying a day takes its commute with it', () => {
    // Saturday has no work and so no commute, which is not the case worth
    // looking at; this is a weekday emptied while nothing is placed on it.
    const base = preset()
    let board: Board = { ...base, days: { ...base.days, monday: MONDAY_PLAN } }
    expect(column(toGridModel(board), 'monday').blocks.map((entry) => entry.tone)).toEqual([
      'commute',
      'work',
      'work',
      'commute',
    ])
    for (const id of ['w-am', 'w-pm']) {
      const removed = removeWorkInterval(board, 'monday', id)
      if (!removed.ok) throw new Error('the removal was refused')
      board = removed.value
    }
    expect(column(toGridModel(board), 'monday').blocks).toEqual([])
  })
})

describe('the day it draws', () => {
  it('starts at 6:00 and ends at 22:00, and the model agrees with the constants', () => {
    const { lines } = toGridModel(fixture())
    expect(lines[0]?.minute).toBe(DAY_START_MINUTE)
    expect(lines[lines.length - 1]?.minute).toBe(DAY_END_MINUTE)
  })
})
