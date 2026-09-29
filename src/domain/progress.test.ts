import { describe, expect, it } from 'vitest'

import { createDefaultBoard, type CreateId } from '@/domain/board'
import { findGoal, updateGoal, type TimeGoalDraft } from '@/domain/goals'
import { goalProgress, type GoalProgress, type ProgressStatus } from '@/domain/progress'
import { deleteSession, placeSession, resizeSession, setSessionDone } from '@/domain/sessions'
import {
  type Board,
  type CountGoal,
  type Goal,
  type OneOff,
  type Result,
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

const STUDY = 'g-study'
const GYM = 'g-gym'
const NOTHING: TravelMinutes = { beforeMinutes: 0, afterMinutes: 0 }

/** A five-hour study goal, which is what the product scope's examples use. */
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

/** A three-visit gym goal. */
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

/** A placed block. Nothing below depends on where it sits, only on its numbers. */
function session(id: string, goalId: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    goalId,
    day: 'monday',
    startMinute: 720,
    activityMinutes: 60,
    travel: NOTHING,
    travelFollowsDefault: true,
    done: false,
    ...overrides,
  }
}

function oneOff(overrides: Partial<OneOff> = {}): OneOff {
  return {
    id: 'o1',
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

/** A board with the given tasks and blocks, on the preset days. */
function boardWith(goals: Goal[], sessions: Session[], oneOffs: OneOff[] = []): Board {
  return { ...preset(), goals, sessions, oneOffs }
}

/** A board with one study task and its blocks, which is what most of these need. */
function studyBoard(sessions: Session[], goalOverrides: Partial<TimeGoal> = {}): Board {
  return boardWith([study(goalOverrides)], sessions)
}

function progressOf(board: Board, goalId: string): GoalProgress {
  const goal = findGoal(board, goalId)
  if (goal === null) throw new Error(`no goal ${goalId} on this board`)
  return goalProgress(board, goal)
}

function sentence(board: Board, goalId: string): string {
  return progressOf(board, goalId).sentence
}

/** The value of an allowed change. Fails loudly if the change was refused. */
function ok(result: Result<Board>): Board {
  if (!result.ok) throw new Error(`expected the change to be allowed, got ${result.reason}`)
  return result.value
}

describe('the worked examples in the product scope', () => {
  it('two hours done of five, with two hours still planned', () => {
    const board = studyBoard([
      session('s1', STUDY, { activityMinutes: 120, done: true }),
      session('s2', STUDY, { activityMinutes: 120, startMinute: 1020 }),
    ])
    expect(sentence(board, STUDY)).toBe('2 hours done of 5. 1 hour is not on the grid.')
  })

  it('six hours placed, two of them done', () => {
    const board = studyBoard([
      session('s1', STUDY, { activityMinutes: 120, done: true }),
      session('s2', STUDY, { activityMinutes: 120, startMinute: 840 }),
      session('s3', STUDY, { activityMinutes: 120, startMinute: 1020 }),
    ])
    expect(sentence(board, STUDY)).toBe(
      '2 hours done of 5. Nothing is unplaced. 1 hour more than the goal is on the grid.',
    )
  })

  it('six hours done of five', () => {
    const board = studyBoard([
      session('s1', STUDY, { activityMinutes: 180, done: true }),
      session('s2', STUDY, { activityMinutes: 180, startMinute: 840, done: true }),
    ])
    expect(sentence(board, STUDY)).toBe('6 hours done of 5. Nothing is unplaced.')
  })

  it('one visit done and one planned, of three', () => {
    const board = boardWith(
      [gym()],
      [
        session('s1', GYM, { activityMinutes: 45, done: true }),
        session('s2', GYM, { startMinute: 780 }),
      ],
    )
    expect(sentence(board, GYM)).toBe('1 of 3 done. 1 visit is not on the grid.')
  })

  it('four visits done of three', () => {
    const board = boardWith(
      [gym()],
      ['s1', 's2', 's3', 's4'].map((id) => session(id, GYM, { activityMinutes: 45, done: true })),
    )
    expect(sentence(board, GYM)).toBe('4 of 3 done. Nothing is unplaced.')
  })
})

describe('only a done block is done', () => {
  it('time that is still planned is not progress', () => {
    const board = studyBoard([session('s1', STUDY, { activityMinutes: 240 })])
    expect(progressOf(board, STUDY)).toMatchObject({ done: 0, placed: 240, unplaced: 60 })
    expect(sentence(board, STUDY)).toBe('0 hours done of 5. 1 hour is not on the grid.')
  })

  it('a task with nothing on the grid at all', () => {
    expect(sentence(studyBoard([]), STUDY)).toBe('0 hours done of 5. 5 hours are not on the grid.')
  })

  it('a planned visit is not a visit done', () => {
    const board = boardWith([gym()], [session('s1', GYM), session('s2', GYM, { startMinute: 780 })])
    expect(progressOf(board, GYM)).toMatchObject({ done: 0, placed: 2, unplaced: 1 })
    expect(sentence(board, GYM)).toBe('0 of 3 done. 1 visit is not on the grid.')
  })

  it('a done block on another day still counts', () => {
    const board = studyBoard([session('s1', STUDY, { day: 'sunday', activityMinutes: 60, done: true })])
    expect(progressOf(board, STUDY)).toMatchObject({ done: 60, placed: 60, unplaced: 240 })
  })
})

describe('travel never counts', () => {
  it('a study block with half an hour of travel each way is an hour of progress', () => {
    // Ninety minutes on the grid, sixty of them studying. The travel is real
    // time the week is committed to and none of it is progress.
    const board = studyBoard([
      session('s1', STUDY, {
        activityMinutes: 60,
        travel: { beforeMinutes: 30, afterMinutes: 30 },
        travelFollowsDefault: false,
        done: true,
      }),
    ])
    expect(progressOf(board, STUDY)).toMatchObject({ done: 60, placed: 60, unplaced: 240 })
    expect(sentence(board, STUDY)).toBe('1 hour done of 5. 4 hours are not on the grid.')
  })

  it('travel does not fill the grid up either', () => {
    // Nine hours of door-to-door time and one of activity: what is missing from
    // the grid is four hours of study, not one.
    const board = studyBoard([
      session('s1', STUDY, { activityMinutes: 60, travel: { beforeMinutes: 300, afterMinutes: 240 } }),
    ])
    expect(progressOf(board, STUDY)).toMatchObject({ placed: 60, unplaced: 240, over: 0 })
  })

  it('a long trip to the gym is one visit', () => {
    const board = boardWith(
      [gym()],
      [
        session('s1', GYM, {
          activityMinutes: 45,
          travel: { beforeMinutes: 30, afterMinutes: 30 },
          done: true,
        }),
      ],
    )
    expect(progressOf(board, GYM)).toMatchObject({ done: 1, placed: 1, unplaced: 2 })
  })
})

describe('a visit count counts visits', () => {
  it('two visits of different lengths are two visits', () => {
    const board = boardWith(
      [gym()],
      [
        session('s1', GYM, { activityMinutes: 45, done: true }),
        session('s2', GYM, { activityMinutes: 90, startMinute: 780 }),
      ],
    )
    expect(progressOf(board, GYM)).toMatchObject({ done: 1, placed: 2, unplaced: 1, over: 0 })
    expect(sentence(board, GYM)).toBe('1 of 3 done. 1 visit is not on the grid.')
  })

  it('a visit length is never added up into the count', () => {
    // Forty-five plus ninety is an hour and three quarters. It is two visits,
    // and the sentence says two and never mentions an hour.
    const board = boardWith(
      [gym()],
      [
        session('s1', GYM, { activityMinutes: 45, done: true }),
        session('s2', GYM, { activityMinutes: 90, startMinute: 780, done: true }),
      ],
    )
    const progress = progressOf(board, GYM)
    expect(progress.done).toBe(2)
    expect(progress.sentence).toBe('2 of 3 done. 1 visit is not on the grid.')
    expect(progress.sentence).not.toContain('hour')
  })

  it('two visits on one day are two visits', () => {
    const board = boardWith(
      [gym()],
      [
        session('s1', GYM, { activityMinutes: 45, done: true }),
        session('s2', GYM, { activityMinutes: 45, startMinute: 765, done: true }),
      ],
    )
    expect(progressOf(board, GYM)).toMatchObject({ done: 2, placed: 2, unplaced: 1 })
  })
})

describe('what is not counted at all', () => {
  it("another task's blocks are not this task's", () => {
    const board = boardWith(
      [study(), gym()],
      [session('s1', GYM, { activityMinutes: 600, done: true })],
    )
    expect(progressOf(board, STUDY)).toMatchObject({ done: 0, placed: 0, unplaced: 300 })
  })

  it("a one-off's done mark is a mark, not a total", () => {
    // A finished dentist appointment is three hours of the week, and it belongs
    // to no task, so it moves no quota.
    const board = studyBoard([session('s1', STUDY, { activityMinutes: 60, done: true })])
    const withDentist: Board = { ...board, oneOffs: [oneOff({ activityMinutes: 180, done: true })] }
    expect(progressOf(withDentist, STUDY)).toEqual(progressOf(board, STUDY))
  })

  it('a one-off is not a block of a task, whatever its id says', () => {
    const board: Board = { ...studyBoard([]), oneOffs: [oneOff({ id: STUDY, done: true })] }
    expect(progressOf(board, STUDY)).toMatchObject({ done: 0, placed: 0 })
  })

  it('work is not progress', () => {
    // Monday already holds five and a half hours of work, and none of it is
    // progress on a study goal.
    const board = studyBoard([])
    expect(board.days.monday.workIntervals).toHaveLength(2)
    expect(progressOf(board, STUDY)).toMatchObject({ done: 0, placed: 0, unplaced: 300 })
  })
})

describe('the wording', () => {
  it('an hour and forty minutes is named in hours and minutes, not as a decimal', () => {
    const board = studyBoard([session('s1', STUDY, { activityMinutes: 100, done: true })])
    expect(sentence(board, STUDY)).toBe(
      '1 hour 40 minutes done of 5 hours. 3 hours 20 minutes are not on the grid.',
    )
  })

  it('the short form needs both sides to be whole hours', () => {
    // Whole done, whole goal: the goal is left bare, as the examples read.
    expect(sentence(studyBoard([session('s1', STUDY, { activityMinutes: 120, done: true })]), STUDY)).toBe(
      '2 hours done of 5. 3 hours are not on the grid.',
    )
    // A goal that is not a whole number of hours cannot use the short form, even
    // when the done total is one.
    expect(
      sentence(
        studyBoard([session('s1', STUDY, { activityMinutes: 120, done: true })], { goalMinutes: 100 }),
        STUDY,
      ),
    ).toBe('2 hours done of 1 hour 40 minutes. Nothing is unplaced.')
    // Neither side whole is the case the long form was written for.
    expect(
      sentence(
        studyBoard([session('s1', STUDY, { activityMinutes: 100, done: true })], { goalMinutes: 100 }),
        STUDY,
      ),
    ).toBe('1 hour 40 minutes done of 1 hour 40 minutes. Nothing is unplaced.')
  })

  it('zero is a whole number of hours, so the short form still applies', () => {
    expect(sentence(studyBoard([]), STUDY)).toBe('0 hours done of 5. 5 hours are not on the grid.')
  })

  it('a count goal is never in hours', () => {
    expect(sentence(boardWith([gym()], []), GYM)).toBe('0 of 3 done. 3 visits are not on the grid.')
  })

  it('visits and minutes take a plural measure', () => {
    const cases: Array<[Board, string, string]> = [
      [
        boardWith([gym({ goalCount: 5 })], [session('s1', GYM)]),
        GYM,
        '0 of 5 done. 4 visits are not on the grid.',
      ],
      [
        boardWith([gym({ goalCount: 6 })], [session('s1', GYM, { activityMinutes: 45, done: true })]),
        GYM,
        '1 of 6 done. 5 visits are not on the grid.',
      ],
      [
        studyBoard([session('s1', STUDY, { activityMinutes: 40, done: true })]),
        STUDY,
        '40 minutes done of 5 hours. 4 hours 20 minutes are not on the grid.',
      ],
    ]
    for (const [board, goalId, expected] of cases) {
      expect(sentence(board, goalId), expected).toBe(expected)
    }
  })

  it('a measure of hours and minutes reads as a plural', () => {
    // "1 hour 30 minutes are not on the grid", not "is": English treats a
    // quantity of minutes as plural however many hours are in it.
    const board = studyBoard([session('s1', STUDY, { activityMinutes: 90, done: true })])
    expect(sentence(board, STUDY)).toBe(
      '1 hour 30 minutes done of 5 hours. 3 hours 30 minutes are not on the grid.',
    )
  })

  it('the surplus clause appears while the done total still lags the grid', () => {
    // Three hundred minutes done, so the first clause says the goal is met, and
    // the hundred minutes still on the grid are information it does not carry.
    const board = studyBoard([
      session('s1', STUDY, { activityMinutes: 100, done: true }),
      session('s2', STUDY, { activityMinutes: 200, startMinute: 840, done: true }),
      session('s3', STUDY, { activityMinutes: 100, startMinute: 1020 }),
    ])
    expect(sentence(board, STUDY)).toBe(
      '5 hours done of 5. Nothing is unplaced. 1 hour 40 minutes more than the goal are on the grid.',
    )
  })

  it('the surplus clause is left out once the done total already says it', () => {
    // One minute past the goal. The first clause reads "5 hours 1 minute done of
    // 5 hours", and a third sentence about the surplus would say it again.
    const board = studyBoard([
      session('s1', STUDY, { activityMinutes: 100, done: true }),
      session('s2', STUDY, { activityMinutes: 201, startMinute: 840, done: true }),
    ])
    expect(sentence(board, STUDY)).toBe('5 hours 1 minute done of 5 hours. Nothing is unplaced.')
  })

  it('a visit count gets a surplus clause too', () => {
    const board = boardWith(
      [gym()],
      [
        session('s1', GYM, { done: true }),
        session('s2', GYM, { startMinute: 780, done: true }),
        session('s3', GYM, { startMinute: 840 }),
        session('s4', GYM, { startMinute: 900 }),
      ],
    )
    expect(sentence(board, GYM)).toBe(
      '2 of 3 done. Nothing is unplaced. 1 visit more than the goal is on the grid.',
    )
  })

  it('every sentence ends in a full stop', () => {
    const boards = [
      studyBoard([]),
      studyBoard([session('s1', STUDY, { activityMinutes: 100, done: true })]),
      studyBoard([session('s1', STUDY, { activityMinutes: 400, done: true })]),
      boardWith([gym()], []),
      boardWith([gym()], [session('s1', GYM, { done: true })]),
    ]
    for (const board of boards) {
      for (const goal of board.goals) {
        expect(goalProgress(board, goal).sentence.endsWith('.'), goal.id).toBe(true)
      }
    }
  })
})

describe('the status', () => {
  it('is unplaced while some of the goal is not on the grid', () => {
    const board = studyBoard([session('s1', STUDY, { activityMinutes: 60, done: true })])
    expect(progressOf(board, STUDY).status).toBe('unplaced')
  })

  it('is planned when the week is full but the work is not done', () => {
    const board = studyBoard([
      session('s1', STUDY, { activityMinutes: 180, done: true }),
      session('s2', STUDY, { activityMinutes: 120, startMinute: 840 }),
    ])
    expect(progressOf(board, STUDY)).toMatchObject({ placed: 300, done: 180, unplaced: 0, over: 0 })
    expect(progressOf(board, STUDY).status).toBe('planned')
  })

  it('is met when the whole quota is done', () => {
    const board = studyBoard([
      session('s1', STUDY, { activityMinutes: 180, done: true }),
      session('s2', STUDY, { activityMinutes: 120, startMinute: 840, done: true }),
    ])
    expect(progressOf(board, STUDY)).toMatchObject({ done: 300, unplaced: 0, over: 0 })
    expect(progressOf(board, STUDY).status).toBe('met')
  })

  it('is over when more than the goal is on the grid', () => {
    const board = studyBoard([
      session('s1', STUDY, { activityMinutes: 300, done: true }),
      session('s2', STUDY, { activityMinutes: 60, startMinute: 840, done: true }),
    ])
    expect(progressOf(board, STUDY)).toMatchObject({ placed: 360, over: 60, unplaced: 0 })
    expect(progressOf(board, STUDY).status).toBe('over')
  })

  it('is over when the grid is over even if the done total has not caught up', () => {
    // The week is planned past the goal, which is what the person can act on,
    // even though the done total is sitting exactly on it.
    const board = studyBoard([
      session('s1', STUDY, { activityMinutes: 100, done: true }),
      session('s2', STUDY, { activityMinutes: 200, startMinute: 840, done: true }),
      session('s3', STUDY, { activityMinutes: 100, startMinute: 1020 }),
    ])
    expect(progressOf(board, STUDY)).toMatchObject({ done: 300, placed: 400, unplaced: 0, over: 100 })
    expect(progressOf(board, STUDY).status).toBe('over')
  })

  it('unplaced is the status that is easy to act on', () => {
    // Four of the five hours done and nothing else placed: the week is not ready
    // even though the work is nearly there.
    const board = studyBoard([session('s1', STUDY, { activityMinutes: 240, done: true })])
    expect(progressOf(board, STUDY).status).toBe('unplaced')
  })

  it('produces the four statuses and no others', () => {
    // Every combination of done, placed, and quota the numbers can be in, so a
    // fifth status cannot appear quietly, and so the precedence between them is
    // visible rather than inferred: unplaced first, then over, then met.
    const seen = new Set<ProgressStatus>()
    const quotas = [15, 60, 100, 300]
    for (let placed = 0; placed <= 480; placed += 20) {
      for (let done = 0; done <= placed; done += 20) {
        for (const quota of quotas) {
          const sessions: Session[] = []
          if (done > 0) sessions.push(session('d', STUDY, { activityMinutes: done, done: true }))
          if (placed > done) {
            sessions.push(session('p', STUDY, { activityMinutes: placed - done, startMinute: 840 }))
          }
          const board = studyBoard(sessions, { goalMinutes: quota })
          seen.add(progressOf(board, STUDY).status)
        }
      }
    }
    expect([...seen].sort()).toEqual(['met', 'over', 'planned', 'unplaced'])
  })

  it('works the same way for a count goal', () => {
    const one = session('s1', GYM, { done: true })
    const two = session('s2', GYM, { startMinute: 780, done: true })
    const three = session('s3', GYM, { startMinute: 840, done: true })
    const four = session('s4', GYM, { startMinute: 900, done: true })
    // One visit done of three, one visit still planned, and nothing on the grid
    // beyond the goal.
    const planned = boardWith([gym()], [one, { ...two, done: false }, { ...three, done: false }])
    expect(progressOf(boardWith([gym()], [one]), GYM).status).toBe('unplaced')
    expect(progressOf(planned, GYM)).toMatchObject({ done: 1, placed: 3, unplaced: 0, over: 0 })
    expect(progressOf(planned, GYM).status).toBe('planned')
    expect(progressOf(boardWith([gym()], [one, two, three]), GYM).status).toBe('met')
    expect(progressOf(boardWith([gym()], [one, two, three, four]), GYM).status).toBe('over')
  })
})

describe('the numbers behind the sentence', () => {
  it('never reports a negative unplaced or a negative surplus', () => {
    const board = studyBoard([session('s1', STUDY, { activityMinutes: 600, done: true })])
    expect(progressOf(board, STUDY)).toMatchObject({
      goal: 300,
      placed: 600,
      done: 600,
      unplaced: 0,
      over: 300,
    })
  })

  it('carries the goal id and kind it was asked about', () => {
    const board = boardWith([study(), gym()], [])
    expect(progressOf(board, STUDY)).toMatchObject({ goalId: STUDY, kind: 'time', goal: 300 })
    expect(progressOf(board, GYM)).toMatchObject({ goalId: GYM, kind: 'count', goal: 3 })
  })

  it('cannot be more done than placed', () => {
    // Every done block is a placed block, so there is one surplus to keep and it
    // is measured on the grid.
    const board = studyBoard([
      session('s1', STUDY, { activityMinutes: 100, done: true }),
      session('s2', STUDY, { activityMinutes: 100, startMinute: 840, done: true }),
      session('s3', STUDY, { activityMinutes: 200, startMinute: 1020, done: true }),
    ])
    const progress = progressOf(board, STUDY)
    expect(progress.done).toBe(400)
    expect(progress.done).toBeLessThanOrEqual(progress.placed)
    expect(progress.over).toBe(progress.placed - progress.goal)
  })

  it('reads the board without changing it', () => {
    // Three blocks, deliberately in an order a sort would shuffle, so a reader
    // that sorted the array in place is caught rather than passing by luck.
    const board = studyBoard([
      session('s3', STUDY, { activityMinutes: 60, startMinute: 1020, done: true }),
      session('s1', STUDY, { activityMinutes: 60, done: true }),
      session('s2', STUDY, { activityMinutes: 60, startMinute: 840 }),
    ])
    const atBirth = structuredClone(board)
    goalProgress(board, board.goals[0])
    goalProgress(board, board.goals[0])
    expect(board).toEqual(atBirth)
    expect(board.sessions.map((each) => each.id)).toEqual(['s3', 's1', 's2'])
  })

  it('gives the same answer every time it is asked', () => {
    const board = studyBoard([session('s1', STUDY, { activityMinutes: 100, done: true })])
    expect(goalProgress(board, board.goals[0])).toEqual(goalProgress(board, board.goals[0]))
  })

  it('follows a quota change without touching a block', () => {
    // A quota is a target, not a block: raising it moves the numbers the row
    // reports and nothing on the grid.
    const board = studyBoard([session('s1', STUDY, { activityMinutes: 60, done: true })])
    const draft: TimeGoalDraft = {
      kind: 'time',
      name: 'Study',
      colorId: 'sky',
      goalMinutes: 420,
      defaultActivityMinutes: 60,
      defaultTravel: NOTHING,
    }
    const after = ok(updateGoal(board, STUDY, draft))
    expect(sentence(after, STUDY)).toBe('1 hour done of 7. 6 hours are not on the grid.')
    expect(after.sessions).toEqual(board.sessions)
  })
})

describe('through the real mutations', () => {
  /** A study task on the preset week, with the one id source the app uses. */
  function withTask(): { board: Board; createId: CreateId } {
    const createId = countingIds()
    return { board: { ...createDefaultBoard(createId), goals: [study()] }, createId }
  }

  it('placing a block and marking it done is what moves the sentence', () => {
    const { board, createId } = withTask()
    expect(sentence(board, STUDY)).toBe('0 hours done of 5. 5 hours are not on the grid.')

    const placed = ok(placeSession(board, STUDY, 'monday', 720, createId))
    expect(sentence(placed, STUDY)).toBe('0 hours done of 5. 4 hours are not on the grid.')

    const done = ok(setSessionDone(placed, placed.sessions[0].id, true))
    expect(sentence(done, STUDY)).toBe('1 hour done of 5. 4 hours are not on the grid.')
  })

  it('resizing a done block moves its credit', () => {
    const { board, createId } = withTask()
    const placed = ok(placeSession(board, STUDY, 'monday', 720, createId))
    const done = ok(setSessionDone(placed, placed.sessions[0].id, true))
    // The block sits at 12:00 with no travel, so an end edge at 13:30 is ninety
    // minutes of activity and the block is still done.
    const resized = ok(resizeSession(done, done.sessions[0].id, 'end', 810))
    expect(progressOf(resized, STUDY)).toMatchObject({ done: 90, placed: 90, unplaced: 210 })
    expect(sentence(resized, STUDY)).toBe(
      '1 hour 30 minutes done of 5 hours. 3 hours 30 minutes are not on the grid.',
    )
  })

  it('deleting a done block takes its credit with it', () => {
    const { board, createId } = withTask()
    const placed = ok(placeSession(board, STUDY, 'monday', 720, createId))
    const done = ok(setSessionDone(placed, placed.sessions[0].id, true))
    const emptied = ok(deleteSession(done, done.sessions[0].id))
    expect(sentence(emptied, STUDY)).toBe('0 hours done of 5. 5 hours are not on the grid.')
  })

  it('two blocks of one task are both that task', () => {
    const { board, createId } = withTask()
    const one = ok(placeSession(board, STUDY, 'monday', 720, createId))
    const two = ok(placeSession(one, STUDY, 'friday', 1080, createId))
    const marked = ok(setSessionDone(two, two.sessions[0].id, true))
    expect(progressOf(marked, STUDY)).toMatchObject({ done: 60, placed: 120, unplaced: 180 })
  })
})
