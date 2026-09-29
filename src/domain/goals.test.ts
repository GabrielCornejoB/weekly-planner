import { describe, expect, it } from 'vitest'

import { createDefaultBoard, type CreateId } from '@/domain/board'
import {
  createGoal,
  deleteGoal,
  findGoal,
  updateGoal,
  type CountGoalDraft,
  type GoalDraft,
  type TimeGoalDraft,
} from '@/domain/goals'
import { sessionFootprint, type Footprint } from '@/domain/schedule'
import { formatClock } from '@/domain/time'
import {
  MAX_NAME_LENGTH,
  MIN_ACTIVITY_MINUTES,
  type Board,
  type OneOff,
  type RefusalReason,
  type Result,
  type Session,
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

function timeDraft(overrides: Partial<TimeGoalDraft> = {}): TimeGoalDraft {
  return {
    kind: 'time',
    name: 'Study',
    colorId: 'sky',
    goalMinutes: 300,
    defaultActivityMinutes: 60,
    defaultTravel: { beforeMinutes: 10, afterMinutes: 0 },
    ...overrides,
  }
}

function countDraft(overrides: Partial<CountGoalDraft> = {}): CountGoalDraft {
  return {
    kind: 'count',
    name: 'Gym',
    colorId: 'lime',
    goalCount: 3,
    defaultActivityMinutes: 45,
    defaultTravel: { beforeMinutes: 0, afterMinutes: 0 },
    ...overrides,
  }
}

function studyGoal(): TimeGoalDraft & { kind: 'time' } {
  return timeDraft()
}

function session(
  id: string,
  goalId: string,
  day: Session['day'],
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

/**
 * A board with two tasks and four placed blocks, so every rule about where a
 * field lives has something to be wrong about.
 *
 * `s1` is a study block still using the task's default travel. `s2` is a study
 * block whose travel was edited for a different day, and is already done. `s3`
 * is a gym visit, which has a duration the visit count does not care about.
 */
function boardWithTasks(): Board {
  return {
    ...preset(),
    goals: [
      { id: 'g-study', ...studyGoal() },
      { id: 'g-gym', ...countDraft() },
    ],
    sessions: [
      session('s1', 'g-study', 'monday'),
      session('s2', 'g-study', 'tuesday', {
        startMinute: 1140,
        activityMinutes: 45,
        travel: { beforeMinutes: 20, afterMinutes: 5 },
        travelFollowsDefault: false,
        done: true,
      }),
      session('s3', 'g-gym', 'monday', {
        startMinute: 1140,
        activityMinutes: 45,
        travel: { beforeMinutes: 0, afterMinutes: 0 },
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

/**
 * The name a placed block shows, read the way the grid reads it. A session
 * carries no name of its own, so this is the whole of the "changing the name
 * changes every block" rule: there is nothing else for it to be true of.
 */
function labelOf(board: Board, target: Session): string {
  const goal = findGoal(board, target.goalId)
  if (goal === null) throw new Error(`no goal behind ${target.id}`)
  return goal.name
}

function colorOf(board: Board, target: Session): string {
  const goal = findGoal(board, target.goalId)
  if (goal === null) throw new Error(`no goal behind ${target.id}`)
  return goal.colorId
}

function sessionIds(board: Board): string[] {
  return board.sessions.map((placed) => placed.id)
}

/** `12:00–12:10 12:10–13:10`, so a test states a block the way the grid draws it. */
function footprintRanges(footprint: Footprint): string {
  return footprint
    .map((stretch) => `${formatClock(stretch.startMinute)}–${formatClock(stretch.endMinute)}`)
    .join(' ')
}

/** The stretches one session holds, read off its footprint rather than its numbers. */
function stretchesOf(board: Board, id: string): string {
  const placed = board.sessions.find((candidate) => candidate.id === id)
  if (placed === undefined) throw new Error(`no session ${id}`)
  return footprintRanges(sessionFootprint(placed))
}

describe('findGoal', () => {
  it('finds either kind of goal', () => {
    const board = boardWithTasks()
    expect(findGoal(board, 'g-study')).toEqual({ id: 'g-study', ...studyGoal() })
    expect(findGoal(board, 'g-gym')).toEqual({ id: 'g-gym', ...countDraft() })
  })

  it('returns null for a goal that is not there', () => {
    expect(findGoal(boardWithTasks(), 'g-nope')).toBeNull()
  })
})

describe('createGoal', () => {
  it('adds a time goal with everything the draft asked for', () => {
    const after = ok(createGoal(preset(), timeDraft(), countingIds()))
    expect(after.goals).toEqual([
      { id: 'id-1', ...timeDraft() },
    ])
  })

  it('adds a count goal, which carries no minutes quota at all', () => {
    const after = ok(createGoal(preset(), countDraft(), countingIds()))
    const goal = after.goals[0]
    if (goal.kind !== 'count') throw new Error(`expected a count goal, got a ${goal.kind} goal`)
    expect(goal.goalCount).toBe(3)
    // The shape itself proves it: a count goal has nowhere to put minutes, so
    // a draft that carried one would not have compiled.
    expect('goalMinutes' in goal).toBe(false)
  })

  it('takes the id from the injected source, so tests do not depend on the platform', () => {
    // One source for the whole board, which is what the app passes: a second
    // counter would hand out an id Monday's work already has.
    const createId = countingIds()
    const after = ok(createGoal(createDefaultBoard(createId), timeDraft(), createId))
    // The preset spends ten ids: five weekdays at two intervals each.
    expect(after.goals[0].id).toBe('id-11')
  })

  it('mints no id when the draft is refused, so a refused change costs nothing', () => {
    let spent = 0
    const createId: CreateId = () => {
      spent += 1
      return `id-${spent}`
    }
    expect(refused(createGoal(preset(), timeDraft({ name: '' }), createId))).toBe('empty-name')
    expect(spent).toBe(0)
  })

  it('appends, in the order the tasks were made, and never sorts them', () => {
    let board = ok(createGoal(preset(), timeDraft(), countingIds()))
    board = ok(createGoal(board, countDraft(), countingIds()))
    board = ok(createGoal(board, timeDraft({ name: 'Reading' }), countingIds()))
    expect(board.goals.map((goal) => goal.name)).toEqual(['Study', 'Gym', 'Reading'])
  })

  it('stores the name exactly as it was typed', () => {
    // The app refuses rather than repairs, so nothing is trimmed behind a
    // person's back. Only a name of nothing at all is refused.
    const after = ok(createGoal(preset(), timeDraft({ name: '  Study  ' }), countingIds()))
    expect(after.goals[0].name).toBe('  Study  ')
  })

  it('does not keep the draft’s travel object, so the form cannot reach the board', () => {
    const draft = timeDraft()
    const after = ok(createGoal(preset(), draft, countingIds()))
    expect(after.goals[0].defaultTravel).not.toBe(draft.defaultTravel)
    draft.defaultTravel.beforeMinutes = 45
    expect(after.goals[0].defaultTravel.beforeMinutes).toBe(10)
  })

  it('leaves the rest of the board alone', () => {
    const board = preset()
    const after = ok(createGoal(board, timeDraft(), countingIds()))
    expect(after).not.toBe(board)
    expect(after.version).toBe(1)
    // Nothing about the days, the blocks, or the one-offs changed, so none of
    // them is rebuilt.
    expect(after.days).toBe(board.days)
    expect(after.sessions).toBe(board.sessions)
    expect(after.oneOffs).toBe(board.oneOffs)
  })

  it('refuses a name that is nothing, or nothing but spaces', () => {
    expect(refused(createGoal(preset(), timeDraft({ name: '' }), countingIds()))).toBe('empty-name')
    expect(refused(createGoal(preset(), timeDraft({ name: '   ' }), countingIds()))).toBe('empty-name')
  })

  it('refuses a name too long for a block, and takes one exactly on the limit', () => {
    const longest = 'x'.repeat(MAX_NAME_LENGTH)
    expect(ok(createGoal(preset(), timeDraft({ name: longest }), countingIds())).goals[0].name).toBe(
      longest,
    )
    expect(
      refused(createGoal(preset(), timeDraft({ name: `${longest}x` }), countingIds())),
    ).toBe('name-too-long')
  })

  it('measures the limit on the name it stores, spaces and all', () => {
    // Forty-four typed characters trim to exactly the limit, and the name that
    // reaches the board is the typed one, so it is still over the limit. A
    // limit measured after a trim would let a name through that no block could
    // hold, which is the thing the limit is for.
    const padded = `  ${'x'.repeat(MAX_NAME_LENGTH)}  `
    expect(padded.trim().length).toBe(MAX_NAME_LENGTH)
    expect(refused(createGoal(preset(), timeDraft({ name: padded }), countingIds()))).toBe(
      'name-too-long',
    )
  })

  it('refuses a time budget under one shortest activity', () => {
    expect(
      refused(
        createGoal(preset(), timeDraft({ goalMinutes: MIN_ACTIVITY_MINUTES - 1 }), countingIds()),
      ),
    ).toBe('invalid-quota')
    expect(
      ok(createGoal(preset(), timeDraft({ goalMinutes: MIN_ACTIVITY_MINUTES }), countingIds())).goals[0],
    ).toMatchObject({ goalMinutes: MIN_ACTIVITY_MINUTES })
  })

  it('refuses a visit count under one, or a fraction of a visit', () => {
    expect(refused(createGoal(preset(), countDraft({ goalCount: 0 }), countingIds()))).toBe(
      'invalid-quota',
    )
    expect(refused(createGoal(preset(), countDraft({ goalCount: 1.5 }), countingIds()))).toBe(
      'invalid-quota',
    )
    expect(ok(createGoal(preset(), countDraft({ goalCount: 1 }), countingIds())).goals[0]).toMatchObject(
      { goalCount: 1 },
    )
  })

  it('refuses a default activity shorter than the shortest block', () => {
    expect(
      refused(
        createGoal(preset(), timeDraft({ defaultActivityMinutes: 10 }), countingIds()),
      ),
    ).toBe('too-short')
    expect(
      ok(
        createGoal(
          preset(),
          timeDraft({ defaultActivityMinutes: MIN_ACTIVITY_MINUTES }),
          countingIds(),
        ),
      ).goals[0],
    ).toMatchObject({ defaultActivityMinutes: MIN_ACTIVITY_MINUTES })
  })

  it('holds the default activity to the typed step, and lets 1:40 through', () => {
    expect(
      refused(createGoal(preset(), timeDraft({ defaultActivityMinutes: 17 }), countingIds())),
    ).toBe('not-a-step')
    // 1 hour 40 minutes is 100 minutes, and a block may be that long.
    expect(
      ok(createGoal(preset(), timeDraft({ defaultActivityMinutes: 100 }), countingIds())).goals[0],
    ).toMatchObject({ defaultActivityMinutes: 100 })
  })

  it('reports the fields in the order a person would fix them', () => {
    // A form can be wrong in several ways at once and only one sentence is
    // shown, so the order is part of the rule rather than an accident of how the
    // checks happen to be written. Name, then quota, then the default block,
    // then travel.
    const wrongEverything = timeDraft({
      name: '',
      goalMinutes: 0,
      defaultActivityMinutes: 17,
      defaultTravel: { beforeMinutes: 2, afterMinutes: 0 },
    })
    expect(refused(createGoal(preset(), wrongEverything, countingIds()))).toBe('empty-name')

    const noQuota = timeDraft({ goalMinutes: 0, defaultActivityMinutes: 17 })
    expect(refused(createGoal(preset(), noQuota, countingIds()))).toBe('invalid-quota')

    const noBlock = timeDraft({
      defaultActivityMinutes: 10,
      defaultTravel: { beforeMinutes: 7, afterMinutes: 0 },
    })
    expect(refused(createGoal(preset(), noBlock, countingIds()))).toBe('too-short')
  })

  it('asks the travel floor before the step, exactly as a commute is asked', () => {
    // Every whole number under five is also off the five-minute step, so the
    // order is what decides whether a person is told the rule or told about
    // arithmetic. `work.ts` asks the same way, through the same function.
    expect(
      refused(
        createGoal(preset(), timeDraft({ defaultTravel: { beforeMinutes: 3, afterMinutes: 0 } }), countingIds()),
      ),
    ).toBe('too-short')
    expect(
      refused(
        createGoal(preset(), timeDraft({ defaultTravel: { beforeMinutes: 0, afterMinutes: 7 } }), countingIds()),
      ),
    ).toBe('not-a-step')
  })

  it('takes no travel at all, or a real trip on either side', () => {
    const neither = ok(
      createGoal(preset(), timeDraft({ defaultTravel: { beforeMinutes: 0, afterMinutes: 0 } }), countingIds()),
    )
    expect(neither.goals[0].defaultTravel).toEqual({ beforeMinutes: 0, afterMinutes: 0 })
    const both = ok(
      createGoal(preset(), timeDraft({ defaultTravel: { beforeMinutes: 15, afterMinutes: 5 } }), countingIds()),
    )
    expect(both.goals[0].defaultTravel).toEqual({ beforeMinutes: 15, afterMinutes: 5 })
  })
})

describe('updateGoal', () => {
  it('changes the name every block of that task shows', () => {
    const board = boardWithTasks()
    const after = ok(updateGoal(board, 'g-study', timeDraft({ name: 'Revision' })))
    expect(after.goals[0].name).toBe('Revision')
    // A block reads the name off the goal, so both study blocks show the new
    // one. The gym block is another task and is not affected.
    expect(after.sessions.map((placed) => labelOf(after, placed))).toEqual([
      'Revision',
      'Revision',
      'Gym',
    ])
  })

  it('changes the color every block of that task is drawn in', () => {
    const board = boardWithTasks()
    const after = ok(updateGoal(board, 'g-study', timeDraft({ colorId: 'violet' })))
    expect(colorOf(after, after.sessions[0])).toBe('violet')
    expect(colorOf(after, after.sessions[2])).toBe('lime')
    // A one-off owns its own color and was never a session of the task.
    expect(after.oneOffs[0].colorId).toBe('rose')
  })

  it('touches no session at all when only the numbers change', () => {
    const board = boardWithTasks()
    const after = ok(
      updateGoal(
        board,
        'g-study',
        timeDraft({ name: 'Revision', colorId: 'violet', goalMinutes: 480, defaultActivityMinutes: 90 }),
      ),
    )
    // Every block keeps its own object: a block's length is the block's, and a
    // change of quota or of the default for *future* blocks adds and removes
    // nothing from the week.
    expect(after.sessions).toBe(board.sessions)
    for (const [index, placed] of after.sessions.entries()) {
      expect(placed).toBe(board.sessions[index])
    }
    expect(stretchesOf(after, 's1')).toBe(stretchesOf(board, 's1'))
    expect(stretchesOf(after, 's2')).toBe(stretchesOf(board, 's2'))
    expect(stretchesOf(after, 's3')).toBe(stretchesOf(board, 's3'))
  })

  it('locks the kind, in both directions', () => {
    const board = boardWithTasks()
    const atBirth = structuredClone(board)
    expect(refused(updateGoal(board, 'g-study', countDraft()))).toBe('kind-locked')
    expect(refused(updateGoal(board, 'g-gym', timeDraft()))).toBe('kind-locked')
    expect(board).toEqual(atBirth)
  })

  it('says which task is missing before it says anything about the draft', () => {
    const board = boardWithTasks()
    // A form pointed at a goal that is not there has no task to be wrong about.
    expect(refused(updateGoal(board, 'g-nope', timeDraft({ name: '' })))).toBe('missing-goal')
    // And the kind comes before the other fields: a form that submitted the
    // wrong kind has nothing else worth saying until the kind is put right.
    expect(refused(updateGoal(board, 'g-study', countDraft({ name: '' })))).toBe('kind-locked')
  })

  it('carries a new default travel to the blocks that still follow it', () => {
    const board = boardWithTasks()
    const after = ok(
      updateGoal(board, 'g-study', timeDraft({ defaultTravel: { beforeMinutes: 15, afterMinutes: 5 } })),
    )
    // Read off the footprint, so this is the shape the grid would draw: the
    // block starts at the same minute and its travel grew around it.
    expect(stretchesOf(after, 's1')).toBe('12:00–12:15 12:15–13:15 13:15–13:20')
    expect(after.sessions[0].startMinute).toBe(720)
    expect(after.sessions[0].activityMinutes).toBe(60)
    expect(after.sessions[0].done).toBe(false)
  })

  it('carries a change to the after side on its own', () => {
    // Either side is a real length with its own value, so comparing only the
    // before side would silently drop a change to the trip home.
    const board = boardWithTasks()
    const after = ok(
      updateGoal(board, 'g-study', timeDraft({ defaultTravel: { beforeMinutes: 10, afterMinutes: 5 } })),
    )
    expect(stretchesOf(after, 's1')).toBe('12:00–12:10 12:10–13:10 13:10–13:15')
    expect(after.sessions[0].travel).toEqual({ beforeMinutes: 10, afterMinutes: 5 })
  })

  it('leaves a block whose travel was edited exactly as it was', () => {
    const board = boardWithTasks()
    const after = ok(
      updateGoal(board, 'g-study', timeDraft({ defaultTravel: { beforeMinutes: 15, afterMinutes: 5 } })),
    )
    // `s2` is 20 before and 5 after, edited for a different day, and stays so:
    // the default applies to blocks that are still using it.
    expect(stretchesOf(after, 's2')).toBe('19:00–19:20 19:20–20:05 20:05–20:10')
    expect(after.sessions[1]).toBe(board.sessions[1])
  })

  it('clears the travel of a following block when the default is cleared', () => {
    const board = boardWithTasks()
    const after = ok(
      updateGoal(board, 'g-study', timeDraft({ defaultTravel: { beforeMinutes: 0, afterMinutes: 0 } })),
    )
    expect(after.sessions[0].travel).toEqual({ beforeMinutes: 0, afterMinutes: 0 })
    expect(stretchesOf(after, 's1')).toBe('12:00–13:00')
  })

  it('leaves the blocks of another task alone', () => {
    const board = boardWithTasks()
    const after = ok(
      updateGoal(board, 'g-study', timeDraft({ defaultTravel: { beforeMinutes: 15, afterMinutes: 5 } })),
    )
    expect(after.sessions[2]).toBe(board.sessions[2])
    expect(after.goals[1]).toBe(board.goals[1])
  })

  it('does not rewrite a following block that already has the new travel', () => {
    const board = boardWithTasks()
    // `s3` follows the gym default, and the gym default is not what changed;
    // asking for the travel it already has must leave it alone.
    const after = ok(updateGoal(board, 'g-gym', countDraft({ defaultTravel: { beforeMinutes: 0, afterMinutes: 0 } })))
    expect(after.sessions).toBe(board.sessions)
  })

  it('keeps the goal’s own id and its place in the list', () => {
    const board = boardWithTasks()
    const after = ok(updateGoal(board, 'g-gym', countDraft({ name: 'Swim' })))
    expect(after.goals.map((goal) => goal.id)).toEqual(['g-study', 'g-gym'])
    expect(after.goals[1].name).toBe('Swim')
    // And the two kinds keep their own shape through an edit.
    expect(after.goals[0]).toEqual({ id: 'g-study', ...studyGoal() })
  })

  it('refuses exactly what create refuses, so the two doors cannot disagree', () => {
    const bad: Array<[string, GoalDraft, RefusalReason]> = [
      ['empty name', timeDraft({ name: '' }), 'empty-name'],
      ['blank name', countDraft({ name: '  ' }), 'empty-name'],
      ['long name', timeDraft({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) }), 'name-too-long'],
      ['tiny time budget', timeDraft({ goalMinutes: 5 }), 'invalid-quota'],
      ['no visits', countDraft({ goalCount: 0 }), 'invalid-quota'],
      ['half a visit', countDraft({ goalCount: 2.5 }), 'invalid-quota'],
      ['short default block', timeDraft({ defaultActivityMinutes: 0 }), 'too-short'],
      ['off-step default block', countDraft({ defaultActivityMinutes: 16 }), 'not-a-step'],
      ['smear of travel', timeDraft({ defaultTravel: { beforeMinutes: 2, afterMinutes: 0 } }), 'too-short'],
      ['off-step travel', timeDraft({ defaultTravel: { beforeMinutes: 0, afterMinutes: 8 } }), 'not-a-step'],
    ]
    for (const [what, draft, reason] of bad) {
      expect(refused(createGoal(preset(), draft, countingIds())), `create: ${what}`).toBe(reason)
      const board = boardWithTasks()
      const id = draft.kind === 'time' ? 'g-study' : 'g-gym'
      expect(refused(updateGoal(board, id, draft)), `update: ${what}`).toBe(reason)
      // An edit is that form submitted again, so a refused edit changes nothing.
      expect(board, `update left the board alone: ${what}`).toEqual(structuredClone(board))
    }
  })
})

describe('deleteGoal', () => {
  it('removes the goal and every block of it', () => {
    const after = ok(deleteGoal(boardWithTasks(), 'g-study'))
    expect(after.goals.map((goal) => goal.id)).toEqual(['g-gym'])
    // A block whose task is gone would have no name, no color, and no quota to
    // count against, so it goes with the task.
    expect(sessionIds(after)).toEqual(['s3'])
  })

  it('leaves another task and its blocks exactly as they were', () => {
    const board = boardWithTasks()
    const after = ok(deleteGoal(board, 'g-study'))
    expect(after.goals[0]).toBe(board.goals[1])
    expect(after.sessions[0]).toBe(board.sessions[2])
  })

  it('leaves the one-offs, which are not blocks of any task', () => {
    const after = ok(deleteGoal(boardWithTasks(), 'g-gym'))
    expect(after.oneOffs).toHaveLength(1)
    expect(after.oneOffs[0].name).toBe('Dentist')
  })

  it('leaves the days alone, because a task is not work', () => {
    const board = boardWithTasks()
    const after = ok(deleteGoal(board, 'g-study'))
    expect(after.days).toBe(board.days)
    expect(after.days.monday.workIntervals).toHaveLength(2)
  })

  it('refuses a goal that is not there, rather than deleting nothing quietly', () => {
    const board = boardWithTasks()
    const atBirth = structuredClone(board)
    expect(refused(deleteGoal(board, 'g-nope'))).toBe('missing-goal')
    expect(board).toEqual(atBirth)
  })
})

describe('the board a change is made on', () => {
  /** The id of the goal each change rebuilt, or null when it rebuilt none. */
  const CHANGES: Array<[string, string | null, (board: Board) => Result<Board>]> = [
    ['createGoal', null, (board) => createGoal(board, timeDraft(), countingIds())],
    ['createGoal of a count', null, (board) => createGoal(board, countDraft(), countingIds())],
    [
      'updateGoal',
      'g-study',
      (board) => updateGoal(board, 'g-study', timeDraft({ name: 'Revision' })),
    ],
    [
      'updateGoal default travel',
      'g-study',
      (board) =>
        updateGoal(board, 'g-study', timeDraft({ defaultTravel: { beforeMinutes: 15, afterMinutes: 5 } })),
    ],
    ['deleteGoal', null, (board) => deleteGoal(board, 'g-study')],
  ]

  for (const [name, rebuilt, change] of CHANGES) {
    it(`${name} leaves the board it was given exactly as it found it`, () => {
      const board = boardWithTasks()
      const atBirth = structuredClone(board)
      expect(change(board).ok).toBe(true)
      expect(board).toEqual(atBirth)
    })

    it(`${name} hands back a new board, with only the goal it changed rebuilt`, () => {
      const board = boardWithTasks()
      const after = ok(change(board))
      expect(after).not.toBe(board)
      expect(after.version).toBe(1)
      // The days and the one-offs are shared: a task is neither work nor a
      // one-off, so nothing about them can have changed.
      expect(after.days).toBe(board.days)
      expect(after.oneOffs).toBe(board.oneOffs)
      expect(after.goals).not.toBe(board.goals)

      for (const goal of after.goals) {
        const before = board.goals.find((candidate) => candidate.id === goal.id)
        if (before === undefined) {
          // A goal this change added is new all the way down: not a copy of
          // anything the input held, not even the travel the draft carried.
          expect(board.goals).not.toContain(goal)
        } else if (goal.id === rebuilt) {
          // And the one it changed cannot be reached through the board it came
          // from, so an edit cannot be made through the old value.
          expect(goal).not.toBe(before)
        } else {
          expect(goal).toBe(before)
        }
      }
    })
  }

  it('does not touch a board it refuses, for every reason it can refuse', () => {
    const board = boardWithTasks()
    const atBirth = structuredClone(board)
    const cases: Array<[RefusalReason, () => Result<Board>]> = [
      ['empty-name', () => createGoal(board, timeDraft({ name: '  ' }), countingIds())],
      [
        'name-too-long',
        () => createGoal(board, timeDraft({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) }), countingIds()),
      ],
      ['invalid-quota', () => createGoal(board, timeDraft({ goalMinutes: 0 }), countingIds())],
      ['too-short', () => createGoal(board, countDraft({ defaultActivityMinutes: 5 }), countingIds())],
      ['not-a-step', () => createGoal(board, timeDraft({ defaultActivityMinutes: 17 }), countingIds())],
      ['kind-locked', () => updateGoal(board, 'g-study', countDraft())],
      ['missing-goal', () => deleteGoal(board, 'g-nope')],
    ]
    for (const [reason, run] of cases) expect(refused(run())).toBe(reason)
    expect(board).toEqual(atBirth)
  })

  it('refuses with the reasons the goal rules own, and no others', () => {
    // Goals own six of the thirteen reasons the board has words for: the four
    // that are about a field being wrong, the lock on the kind, and a task that
    // is not there. Nothing here invents a reason of its own, and each of the
    // six is reachable.
    const seen = new Set<RefusalReason>()
    const board = boardWithTasks()
    const note = (result: Result<Board>) => {
      if (!result.ok) seen.add(result.reason)
    }
    note(createGoal(board, timeDraft({ name: '' }), countingIds()))
    note(createGoal(board, timeDraft({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) }), countingIds()))
    note(createGoal(board, countDraft({ goalCount: 0 }), countingIds()))
    note(createGoal(board, timeDraft({ defaultActivityMinutes: 0 }), countingIds()))
    note(createGoal(board, timeDraft({ defaultActivityMinutes: 17 }), countingIds()))
    note(updateGoal(board, 'g-gym', timeDraft()))
    note(deleteGoal(board, 'g-nope'))
    expect([...seen].toSorted()).toEqual([
      'empty-name',
      'invalid-quota',
      'kind-locked',
      'missing-goal',
      'name-too-long',
      'not-a-step',
      'too-short',
    ])
  })

  it('lets two changes be made from one board without seeing each other', () => {
    const board = boardWithTasks()
    const atBirth = structuredClone(board)
    const renamed = ok(updateGoal(board, 'g-study', timeDraft({ name: 'Revision' })))
    const deleted = ok(deleteGoal(board, 'g-study'))
    expect(renamed.goals.map((goal) => goal.id)).toEqual(['g-study', 'g-gym'])
    expect(renamed.sessions).toHaveLength(3)
    expect(deleted.goals.map((goal) => goal.id)).toEqual(['g-gym'])
    expect(board).toEqual(atBirth)
  })
})
