/**
 * The orchestrator's behaviour, called rather than rendered.
 *
 * The plan forbids rendering components in tests: there is no jsdom here, no
 * React Testing Library, and no way to drag a finger down a column from Node. So
 * every behaviour of this app that matters is a pure function of a state in
 * `actions.ts`, and this file is where those are proved. What is left in
 * `BoardOrchestrator.tsx` is wiring — which dialog opens, which flow a draft is
 * handed to, whether a form stays up — and `orchestrator-rules.test.ts` checks
 * the wiring's own rules against the source.
 *
 * The fixtures are built through the real mutations and nothing else, so a test
 * states a week a person could really have on a phone rather than a hand-typed
 * shape that happens to pass a check. The storage is a fake that records every
 * write, because the plan's "every successful mutation saves. A refused mutation
 * does not" is a claim about calls, not about memory.
 */

import { describe, expect, it } from 'vitest'

import { createDefaultBoard, resetBoard, type CreateId } from '@/domain/board'
import { createGoal, type GoalDraft } from '@/domain/goals'
import { goalProgress } from '@/domain/progress'
import { refusalMessage } from '@/domain/refusal'
import {
  placeOneOff,
  placeSession,
  setOneOffDone,
  setSessionDone,
  setSessionTravel,
} from '@/domain/sessions'
import { formatClock, formatDuration } from '@/domain/time'
import { commuteFootprint } from '@/domain/schedule'
import type { Board, DayId, RefusalReason, Result } from '@/domain/types'
import { addWorkInterval, setCommute } from '@/domain/work'
import { STORAGE_KEY, type BoardStorage } from '@/persistence/storage'
import { exportBoardText, importBoardText } from '@/persistence/transfer'

import type { DayDraft } from '@/components/DayEditor'
import type { OneOffEdit } from '@/components/OneOffForm'
import type { SessionDraft } from '@/components/SessionEditor'
import {
  addOneOff,
  addTask,
  clearBoard,
  deleteBlock,
  deleteTask,
  dismissMessage,
  dropBlock,
  editDay,
  editOneOff,
  editSession,
  editTask,
  initialState,
  markBlockDone,
  placeGoal,
  replaceBoard,
  resizeBlock,
  settle,
  usedColorIds,
  type BoardState,
  type Runtime,
  type Settled,
} from '@/orchestrators/actions'

// --- the app's two edges ----------------------------------------------------

/**
 * One id source for the whole board, shared by the preset and everything placed
 * after it, which is what the app does. A second source here would hand a new
 * block an id the board already has.
 */
function countingIds(): CreateId {
  let n = 0
  return () => {
    n += 1
    return `id-${n}`
  }
}

/** A storage that records every write and can be told to refuse them. */
class FakeStorage implements BoardStorage {
  private readonly map = new Map<string, string>()
  readonly writes: string[] = []
  refusesWrites = false

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.refusesWrites) throw new Error('storage is full')
    this.writes.push(value)
    this.map.set(key, value)
  }

  seed(text: string): void {
    this.map.set(STORAGE_KEY, text)
  }
}

/** A runtime whose two edges are both visible to the test that made it. */
function harness(board?: Board): {
  runtime: Runtime
  storage: FakeStorage
  createId: CreateId
  state: BoardState
} {
  const storage = new FakeStorage()
  const createId = countingIds()
  const runtime: Runtime = { createId, storage }
  if (board !== undefined) {
    storage.seed(exportBoardText(board))
  }
  return { runtime, storage, createId, state: initialState(runtime) }
}

/** A fixture that would rather fail loudly than hand a test a refused board. */
function unwrap(result: Result<Board>): Board {
  if (!result.ok) throw new Error(`a fixture change was refused: ${result.reason}`)
  return result.value
}

/** The state the flows are handed: a week, and no sentence about it. */
function holding(board: Board): BoardState {
  return { board, refusal: null, notice: null }
}

// --- a week a person could really have --------------------------------------

const STUDY: GoalDraft = {
  kind: 'time',
  name: 'Study Spanish',
  colorId: 'sky',
  goalMinutes: 300,
  defaultActivityMinutes: 60,
  defaultTravel: { beforeMinutes: 0, afterMinutes: 0 },
}

const GYM: GoalDraft = {
  kind: 'count',
  name: 'Gym',
  colorId: 'green',
  goalCount: 3,
  defaultActivityMinutes: 45,
  defaultTravel: { beforeMinutes: 10, afterMinutes: 5 },
}

/**
 * A week built through the real mutations: two tasks, a placed block of each, a
 * custom travel on the first, a done mark on the second, a one-off, a commute,
 * and work on a weekend day.
 *
 * The Monday layout is deliberate and everything below depends on it: work
 * 8:00–12:00 and 14:00–17:00, a 20-minute commute to work so 7:40–8:00 is
 * taken, the study block in the 12:00–14:00 hole, and the gym visit after the
 * 15-minute evening commute that ends at 17:15.
 */
function week(createId: CreateId = countingIds()): Board {
  let board = createDefaultBoard(createId)
  board = unwrap(createGoal(board, STUDY, createId))
  board = unwrap(createGoal(board, GYM, createId))
  const [study, gym] = board.goals
  board = unwrap(setCommute(board, 'monday', { beforeMinutes: 20, afterMinutes: 15 }))
  // 12:15 start, 10 minutes of travel, so the activity is 12:25–13:25.
  board = unwrap(placeSession(board, study.id, 'monday', 735, createId))
  board = unwrap(
    setSessionTravel(board, board.sessions[0].id, { beforeMinutes: 10, afterMinutes: 15 }),
  )
  // 17:20, after the evening commute ends at 17:15. 10 minutes of travel, so the
  // activity is 17:30–18:15.
  board = unwrap(placeSession(board, gym.id, 'monday', 1040, createId))
  const visit = board.sessions[board.sessions.length - 1]
  board = unwrap(setSessionDone(board, visit.id, true))
  board = unwrap(
    placeOneOff(
      board,
      'saturday',
      1080,
      { name: 'Dentist', colorId: 'rose', activityMinutes: 60, travel: { beforeMinutes: 0, afterMinutes: 0 } },
      createId,
    ),
  )
  board = unwrap(setOneOffDone(board, board.oneOffs[0].id, true))
  board = unwrap(addWorkInterval(board, 'saturday', { startMinute: 600, endMinute: 660 }, createId))
  return board
}

/** The ids of the two placed blocks, named the way a test wants to talk about them. */
function placed(weekToRead: Board): { study: string; gym: string } {
  return { study: weekToRead.sessions[0].id, gym: weekToRead.sessions[1].id }
}

/** A one-off draft, so a test states only the fields it is about. */
function eventDraft(overrides: Partial<OneOffEdit> = {}): OneOffEdit {
  return {
    name: 'Dentist',
    colorId: 'rose',
    activityMinutes: 60,
    travel: { beforeMinutes: 0, afterMinutes: 0 },
    day: 'monday',
    startMinute: 1080,
    activityEndMinute: 1140,
    ...overrides,
  }
}

/** A block draft, so a test states only the fields it is about. */
function blockDraft(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return { day: 'monday', startMinute: 735, activityEndMinute: 805, travel: { beforeMinutes: 10, afterMinutes: 15 }, ...overrides }
}

/** A day draft, so a test states only the fields it is about. */
function dayDraft(overrides: Partial<DayDraft> = {}): DayDraft {
  return { workIntervals: [], commuteBeforeMinutes: 0, commuteAfterMinutes: 0, ...overrides }
}

// --- opening ----------------------------------------------------------------

describe('initialState', () => {
  it('opens on the preset and writes nothing', () => {
    // The plan's "do not write yet": a first open shows the preset, and the
    // stored text is not replaced until a change has actually been made.
    const { state, storage } = harness()
    expect(state.board.days.monday.workIntervals).toHaveLength(2)
    expect(state.board.goals).toEqual([])
    expect(storage.writes).toEqual([])
  })

  it('opens on what was stored, and still writes nothing', () => {
    const saved = week()
    const { state, storage } = harness(saved)
    expect(state.board).toEqual(saved)
    expect(storage.writes).toEqual([])
  })

  it('opens on the preset when the stored text is not a board, without destroying it', () => {
    const storage = new FakeStorage()
    storage.seed('{ this is not a board')
    const state = initialState({ createId: countingIds(), storage })
    expect(state.board.days.monday.workIntervals).toHaveLength(2)
    expect(storage.writes).toEqual([])
    expect(storage.getItem(STORAGE_KEY)).toBe('{ this is not a board')
  })
})

// --- the door ---------------------------------------------------------------

describe('settle', () => {
  it('saves a change that landed and puts the older sentence away', () => {
    const { runtime, storage, state } = harness()
    const withSentence = { ...state, refusal: 'an older refusal' }
    const after = settle(withSentence, runtime, { ok: true, value: week() })
    expect(after.ok).toBe(true)
    expect(after.state.refusal).toBeNull()
    expect(after.state.notice).toBeNull()
    expect(storage.writes).toHaveLength(1)
  })

  it('keeps the board and shows the sentence when a change is refused, and saves nothing', () => {
    const { runtime, storage, state } = harness(week())
    const atBirth = state.board
    const after = settle(state, runtime, { ok: false, reason: 'overlaps' })
    expect(after.ok).toBe(false)
    // The same object, not a copy: nothing about the week moved, not even a
    // field, and the chart is redrawn from the board it already had.
    expect(after.state.board).toBe(atBirth)
    expect(after.state.refusal).toBe(refusalMessage('overlaps'))
    expect(storage.writes).toEqual([])
  })

  it('keeps the board in memory and shows a notice when the save cannot land', () => {
    // The plan's own answer: the change is not thrown away, and Backup is how a
    // person keeps a board their browser will not.
    const { runtime, storage, state } = harness(week())
    storage.refusesWrites = true
    const after = settle(state, runtime, { ok: true, value: week() })
    expect(after.ok).toBe(true)
    expect(after.state.board.goals).toHaveLength(2)
    expect(after.state.refusal).toBeNull()
    expect(after.state.notice).toBe(refusalMessage('storage-unavailable'))
  })

  it('never shows both sentences at once', () => {
    const { runtime, storage, state } = harness(week())
    storage.refusesWrites = true
    const afterSave = settle(state, runtime, { ok: true, value: week() })
    expect(afterSave.state.refusal).toBeNull()
    expect(afterSave.state.notice).not.toBeNull()
    // A refusal afterwards takes the banner over; a success takes it back.
    const afterRefusal = settle(afterSave.state, runtime, { ok: false, reason: 'too-short' })
    expect(afterRefusal.state.refusal).not.toBeNull()
    expect(afterRefusal.state.notice).toBeNull()
  })

  it('writes a board that comes back as the same board', () => {
    const { runtime, storage, state } = harness()
    const saved = week()
    settle(state, runtime, { ok: true, value: saved })
    expect(initialState(runtime).board).toEqual(saved)
    expect(storage.writes).toHaveLength(1)
  })
})

// --- placing ----------------------------------------------------------------

describe('placeGoal', () => {
  it('puts the task’s own defaults on a free stretch, and saves once', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const study = board.goals[0]
    // Thursday has work 8:00–12:00 and 14:00–17:00, so the hole is 12:00–14:00.
    const after = placeGoal(holding(board), runtime, study.id, 'thursday', 720)
    expect(after.ok).toBe(true)
    const placedBlock = after.state.board.sessions[after.state.board.sessions.length - 1]
    expect(placedBlock).toMatchObject({
      goalId: study.id,
      day: 'thursday',
      startMinute: 720,
      activityMinutes: 60,
      travelFollowsDefault: true,
      done: false,
    })
    expect(storage.writes).toHaveLength(1)
  })

  it('refuses a free tap that is not free, and saves nothing', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    // Monday 13:00 is inside the study block, which runs 12:15–13:40.
    const after = placeGoal(holding(board), runtime, board.goals[1].id, 'monday', 780)
    expect(after.ok).toBe(false)
    expect(after.state.refusal).toBe(refusalMessage('overlaps'))
    expect(after.state.board).toBe(board)
    expect(storage.writes).toEqual([])
  })

  it('refuses a task that is not on the board, in the domain’s own words', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const after = placeGoal(holding(board), runtime, 'not-on-this-board', 'thursday', 720)
    expect(after.state.refusal).toBe(refusalMessage('missing-goal'))
    expect(storage.writes).toEqual([])
  })
})

// --- moving and resizing ----------------------------------------------------

describe('dropBlock', () => {
  it('moves a placed block to another day and leaves nothing behind', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const { gym } = placed(board)
    // Friday has the same work as Monday, and nothing else on it.
    const after = dropBlock(holding(board), runtime, { kind: 'session', id: gym }, 'friday', 720)
    expect(after.ok).toBe(true)
    const moved = after.state.board.sessions.find((session) => session.id === gym)
    expect(moved).toMatchObject({ day: 'friday', startMinute: 720, done: true })
    expect(after.state.board.sessions).toHaveLength(2)
    expect(goalProgress(after.state.board, board.goals[1]).done).toBe(1)
    expect(storage.writes).toHaveLength(1)
  })

  it('moves a one-off the same way', () => {
    const board = week()
    const { runtime } = harness(board)
    const dentist = board.oneOffs[0]
    const after = dropBlock(
      holding(board),
      runtime,
      { kind: 'one-off', id: dentist.id },
      'sunday',
      1080,
    )
    expect(after.ok).toBe(true)
    expect(after.state.board.oneOffs[0].day).toBe('sunday')
  })

  it('does not save a refused drop, and hands back the very board it was given', () => {
    // The plan's done-when, as a test. A dropped block that does not fit is
    // refused, so the board is the same object, nothing is written, and the chart
    // redraws the block where it was.
    const board = week()
    const { runtime, storage } = harness(board)
    const { study } = placed(board)
    // Friday 8:00 is inside Friday's morning work.
    const after = dropBlock(holding(board), runtime, { kind: 'session', id: study }, 'friday', 480)
    expect(after.ok).toBe(false)
    expect(after.state.board).toBe(board)
    expect(after.state.board.sessions[0].day).toBe('monday')
    expect(storage.writes).toEqual([])
  })

  it('refuses to move work to another day, and leaves it on its own', () => {
    // Work does not change days: which days carry work is the day editor's
    // question, so a drop on another column finds nothing there.
    const board = week()
    const { runtime, storage } = harness(board)
    const morning = board.days.monday.workIntervals[0]
    const after = dropBlock(
      holding(board),
      runtime,
      { kind: 'work', id: morning.id },
      'tuesday',
      720,
    )
    expect(after.ok).toBe(false)
    expect(after.state.refusal).toBe(refusalMessage('missing-work'))
    expect(after.state.board).toBe(board)
    expect(storage.writes).toEqual([])
  })

  it('moves work inside its own day', () => {
    const board = week()
    const { runtime } = harness(board)
    // Friday carries the preset's work and nothing else, so 13:00–16:00 is free
    // between the two intervals.
    const afternoon = board.days.friday.workIntervals[1]
    const after = dropBlock(
      holding(board),
      runtime,
      { kind: 'work', id: afternoon.id },
      'friday',
      780,
    )
    expect(after.ok).toBe(true)
    expect(after.state.board.days.friday.workIntervals[1]).toMatchObject({
      startMinute: 780,
      endMinute: 960,
    })
  })
})

describe('resizeBlock', () => {
  it('resizes the activity, and the travel keeps its own length', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const { study } = placed(board)
    // The activity runs 12:25–13:25. Its end is dragged to 13:40, so the activity
    // becomes seventy-five minutes; the fifteen minutes of travel after it do not
    // move, because travel is attached to the outside of the activity.
    const after = resizeBlock(holding(board), runtime, { kind: 'session', id: study }, 'end', 820)
    expect(after.ok).toBe(true)
    const block = after.state.board.sessions[0]
    expect(block).toMatchObject({
      startMinute: 735,
      activityMinutes: 75,
      travel: { beforeMinutes: 10, afterMinutes: 15 },
    })
    expect(storage.writes).toHaveLength(1)
  })

  it('resizes work without being told which day it is on', () => {
    const board = week()
    const { runtime } = harness(board)
    const morning = board.days.monday.workIntervals[0]
    const after = resizeBlock(holding(board), runtime, { kind: 'work', id: morning.id }, 'end', 690)
    expect(after.ok).toBe(true)
    expect(after.state.board.days.monday.workIntervals[0].endMinute).toBe(690)
  })

  it('refuses an activity dragged past its own end, and saves nothing', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const { study } = placed(board)
    // The activity starts at 12:25, so an end at 12:20 is negative minutes.
    const after = resizeBlock(holding(board), runtime, { kind: 'session', id: study }, 'end', 740)
    expect(after.ok).toBe(false)
    expect(after.state.refusal).toBe(refusalMessage('too-short'))
    expect(storage.writes).toEqual([])
  })

  it('refuses a stale block id, in the domain’s words', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const after = resizeBlock(holding(board), runtime, { kind: 'session', id: 'gone' }, 'end', 900)
    expect(after.state.refusal).toBe(refusalMessage('missing-block'))
    expect(storage.writes).toEqual([])
  })
})

// --- done marks and deleting a block ---------------------------------------

describe('markBlockDone', () => {
  it('marks a block done and saves, and marks it not done again and saves', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const { study } = placed(board)
    const done = markBlockDone(holding(board), runtime, { kind: 'session', id: study }, true)
    expect(done.ok).toBe(true)
    expect(done.state.board.sessions[0].done).toBe(true)
    const undone = markBlockDone(done.state, runtime, { kind: 'session', id: study }, false)
    expect(undone.state.board.sessions[0].done).toBe(false)
    expect(storage.writes).toHaveLength(2)
  })

  it('counts a done block toward its task and takes the credit back with it', () => {
    const board = week()
    const { runtime } = harness(board)
    const { study } = placed(board)
    const study_ = board.goals[0]
    const done = markBlockDone(holding(board), runtime, { kind: 'session', id: study }, true)
    expect(goalProgress(done.state.board, study_).done).toBe(60)
    const undone = markBlockDone(done.state, runtime, { kind: 'session', id: study }, false)
    expect(goalProgress(undone.state.board, study_).done).toBe(0)
  })

  it('marks a one-off done, which is a mark and nothing more', () => {
    const board = week()
    const { runtime } = harness(board)
    const dentist = board.oneOffs[0]
    const after = markBlockDone(holding(board), runtime, { kind: 'one-off', id: dentist.id }, false)
    expect(after.ok).toBe(true)
    expect(after.state.board.oneOffs[0].done).toBe(false)
  })
})

describe('deleteBlock', () => {
  it('deletes one block, taking its credit with it, and saves once', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const { gym } = placed(board)
    const after = deleteBlock(holding(board), runtime, { kind: 'session', id: gym })
    expect(after.ok).toBe(true)
    expect(after.state.board.sessions.map((session) => session.id)).toEqual([placed(board).study])
    expect(goalProgress(after.state.board, board.goals[1]).done).toBe(0)
    expect(after.state.board.oneOffs).toHaveLength(1)
    expect(storage.writes).toHaveLength(1)
  })

  it('deletes a one-off and leaves every session alone', () => {
    const board = week()
    const { runtime } = harness(board)
    const after = deleteBlock(holding(board), runtime, { kind: 'one-off', id: board.oneOffs[0].id })
    expect(after.state.board.oneOffs).toEqual([])
    expect(after.state.board.sessions).toHaveLength(2)
  })

  it('refuses a block that is not there, and saves nothing', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const after = deleteBlock(holding(board), runtime, { kind: 'session', id: 'gone' })
    expect(after.state.refusal).toBe(refusalMessage('missing-block'))
    expect(storage.writes).toEqual([])
  })
})

// --- editing a block --------------------------------------------------------

describe('editSession', () => {
  it('applies a move, a travel, and the new end in the order the form needs', () => {
    // The order is the whole point. The form has already measured the end against
    // the travel in its own draft, and the domain measures the activity from the
    // end of the travel that is on the block at the time, so the travel has to be
    // there before the end is applied to it. A different order would read this
    // end against the old ten minutes of travel and make the activity eighty-five
    // minutes instead of seventy-five.
    const board = week()
    const { runtime } = harness(board)
    const { study } = placed(board)
    // The form would hand up an end of 735 + 20 + 75 = 830 for this draft.
    const after = editSession(
      holding(board),
      runtime,
      study,
      blockDraft({
        activityEndMinute: 830,
        travel: { beforeMinutes: 20, afterMinutes: 5 },
      }),
    )
    expect(after.ok).toBe(true)
    expect(after.state.board.sessions[0]).toMatchObject({
      startMinute: 735,
      activityMinutes: 75,
      travel: { beforeMinutes: 20, afterMinutes: 5 },
    })
  })

  it('saves once per change, and each one lands', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const { study } = placed(board)
    // Thursday's hole runs 12:00 to 14:00, so 12:00 to 13:20 is free all day.
    const after = editSession(
      holding(board),
      runtime,
      study,
      blockDraft({ day: 'thursday', startMinute: 720, activityEndMinute: 800, travel: { beforeMinutes: 0, afterMinutes: 0 } }),
    )
    expect(after.ok).toBe(true)
    expect(after.state.board.sessions[0]).toMatchObject({
      day: 'thursday',
      startMinute: 720,
      activityMinutes: 80,
    })
    expect(storage.writes).toHaveLength(3)
  })

  it('keeps a done block done through an edit', () => {
    const board = week()
    const { runtime } = harness(board)
    const { gym } = placed(board)
    const after = editSession(holding(board), runtime, gym, blockDraft({ startMinute: 1040, activityEndMinute: 1110, travel: { beforeMinutes: 10, afterMinutes: 5 } }))
    expect(after.state.board.sessions[1].done).toBe(true)
  })

  it('stops at the first refusal, keeps what landed, and says why', () => {
    // The move to Thursday lands. The travel of three minutes is refused, and the
    // end is never applied — measured from a travel that is not on the block, it
    // would be a different length entirely.
    const board = week()
    const { runtime, storage } = harness(board)
    const { study } = placed(board)
    const after = editSession(
      holding(board),
      runtime,
      study,
      blockDraft({
        day: 'thursday',
        startMinute: 720,
        travel: { beforeMinutes: 3, afterMinutes: 0 },
        activityEndMinute: 800,
      }),
    )
    expect(after.ok).toBe(true)
    expect(after.state.refusal).toBe(refusalMessage('too-short'))
    const block = after.state.board.sessions[0]
    expect(block.day).toBe('thursday')
    expect(block.startMinute).toBe(720)
    expect(block.travel).toEqual({ beforeMinutes: 10, afterMinutes: 15 })
    expect(block.activityMinutes).toBe(60)
    // The move is saved; the travel that was refused never reached storage.
    expect(storage.writes).toHaveLength(1)
  })

  it('changes nothing at all when the first change is refused', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const { study } = placed(board)
    // Friday 8:00 is inside Friday's morning work, so the move is refused and
    // the travel and the end are not attempted.
    const after = editSession(
      holding(board),
      runtime,
      study,
      blockDraft({ day: 'friday', startMinute: 480, travel: { beforeMinutes: 30, afterMinutes: 0 }, activityEndMinute: 900 }),
    )
    expect(after.ok).toBe(false)
    expect(after.state.board).toBe(board)
    expect(storage.writes).toEqual([])
  })
})

describe('editOneOff', () => {
  it('applies the same three changes in the same order, with no task behind it', () => {
    const board = week()
    const { runtime } = harness(board)
    const dentist = board.oneOffs[0]
    // Saturday has work 10:00–11:00 and this event at 18:00, so 11:00 is free and
    // twenty minutes of travel before a seventy-five-minute activity ends at
    // 12:35, which is free too.
    const after = editOneOff(
      holding(board),
      runtime,
      dentist.id,
      eventDraft({
        day: 'saturday',
        startMinute: 660,
        activityEndMinute: 755,
        activityMinutes: 75,
        travel: { beforeMinutes: 20, afterMinutes: 0 },
      }),
    )
    expect(after.ok).toBe(true)
    expect(after.state.board.oneOffs[0]).toMatchObject({
      day: 'saturday',
      startMinute: 660,
      activityMinutes: 75,
      travel: { beforeMinutes: 20, afterMinutes: 0 },
      // A block that was already done stays done through an edit.
      done: true,
    })
  })

  it('leaves the sessions list exactly as it was', () => {
    const board = week()
    const { runtime } = harness(board)
    const after = editOneOff(holding(board), runtime, board.oneOffs[0].id, eventDraft({ startMinute: 1140, activityEndMinute: 1200 }))
    expect(after.state.board.sessions).toBe(board.sessions)
  })

  it('refuses a name that is too long and changes nothing at all', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const long = 'x'.repeat(41)
    const after = editOneOff(
      holding(board),
      runtime,
      board.oneOffs[0].id,
      // Sunday has nothing on it, so the name is the only thing wrong, and it is
      // the first change attempted, so the move never happens either.
      eventDraft({ name: long, day: 'sunday', startMinute: 600, activityEndMinute: 660 }),
    )
    expect(after.state.refusal).toBe(refusalMessage('name-too-long'))
    expect(after.state.board).toBe(board)
    expect(storage.writes).toEqual([])
  })

  it('renames an event and recolours it, which a one-off owns and a session does not', () => {
    const board = week()
    const { runtime } = harness(board)
    const after = editOneOff(
      holding(board),
      runtime,
      board.oneOffs[0].id,
      eventDraft({ name: 'Physio', colorId: 'violet' }),
    )
    expect(after.ok).toBe(true)
    expect(after.state.board.oneOffs[0]).toMatchObject({ name: 'Physio', colorId: 'violet' })
  })
})

// --- editing a day ----------------------------------------------------------

describe('editDay', () => {
  /**
   * A day’s work intervals as a draft carries them: the same ids, copied, so the
   * flow can tell "move this one" from "add another". The ids are the board's
   * own, and they are the whole of what makes a removal a removal rather than a
   * change of shape.
   */
  function intervalsOf(boardToRead: Board, day: DayId): DayDraft['workIntervals'] {
    return boardToRead.days[day].workIntervals.map((interval) => ({ ...interval }))
  }

  it('takes away the intervals the person removed, and adds the ones they added', () => {
    const board = week()
    const { runtime } = harness(board)
    const after = editDay(
      holding(board),
      runtime,
      'monday',
      dayDraft({
        // The afternoon goes and 16:00–17:00 takes its place. The fifteen-minute
        // evening commute is dropped in the same breath, and a shorter commute
        // goes first — see the test below the two for what that is for.
        workIntervals: [
          ...intervalsOf(board, 'monday').slice(0, 1),
          { id: null, startMinute: 960, endMinute: 1020 },
        ],
        commuteBeforeMinutes: 20,
        commuteAfterMinutes: 0,
      }),
    )
    expect(after.ok).toBe(true)
    expect(after.state.board.days.monday.workIntervals).toHaveLength(2)
    expect(after.state.board.days.monday.workIntervals[1]).toMatchObject({
      startMinute: 960,
      endMinute: 1020,
    })
  })

  it('removes before it adds, so an addition is not refused against a removed interval', () => {
    // 16:00–17:00 is inside the afternoon interval, which runs 14:00–17:00.
    // Removing first is what frees the afternoon for it; adding first would be
    // refused for an overlap the person was in the middle of undoing.
    const board = week()
    const { runtime } = harness(board)
    const after = editDay(
      holding(board),
      runtime,
      'monday',
      dayDraft({
        workIntervals: [
          ...intervalsOf(board, 'monday').slice(0, 1),
          { id: null, startMinute: 960, endMinute: 1020 },
        ],
        commuteBeforeMinutes: 20,
        commuteAfterMinutes: 0,
      }),
    )
    expect(after.ok).toBe(true)
    expect(after.state.board.days.monday.workIntervals[1]).toMatchObject({
      startMinute: 960,
      endMinute: 1020,
    })
  })

  it('moves and resizes what is staying, and the length is the one that was typed', () => {
    // Friday carries the preset's work and nothing else, so the morning can start
    // at 9:00 and finish at 10:30 without reaching anything. The move keeps the
    // length it had and the resize puts the end where it was typed, so the two
    // steps together are one interval of ninety minutes.
    const board = week()
    const { runtime } = harness(board)
    const intervals = intervalsOf(board, 'friday')
    const after = editDay(
      holding(board),
      runtime,
      'friday',
      dayDraft({
        workIntervals: [{ ...intervals[0], startMinute: 540, endMinute: 630 }, intervals[1]],
        commuteBeforeMinutes: 0,
        commuteAfterMinutes: 0,
      }),
    )
    expect(after.ok).toBe(true)
    expect(after.state.board.days.friday.workIntervals[0]).toMatchObject({
      startMinute: 540,
      endMinute: 630,
    })
  })

  it('refuses a day whose work would push the commute off the day, and says so', () => {
    // The product's own example: start earlier than 8:00, "but not before 6:00,
    // and only if the commute still fits". A twenty-minute commute ending at 6:00
    // would begin at 5:40, so the move is refused. The draft's commute is the one
    // already on the day, so nothing at all is applied and the refusal leaves the
    // week exactly as it was last saved.
    const board = week()
    const { runtime, storage } = harness(board)
    const intervals = intervalsOf(board, 'monday')
    const after = editDay(
      holding(board),
      runtime,
      'monday',
      dayDraft({
        workIntervals: [{ ...intervals[0], startMinute: 360 }, intervals[1]],
        commuteBeforeMinutes: 20,
        commuteAfterMinutes: 15,
      }),
    )
    expect(after.ok).toBe(false)
    expect(after.state.refusal).toBe(refusalMessage('outside-day'))
    expect(after.state.board).toBe(board)
    expect(storage.writes).toEqual([])
  })

  it('shortens the commute before it moves the work it hangs off', () => {
    // The same edit with the commute cleared in the same breath, and it lands in
    // one save: "start earlier, and stop commuting" is one thing a person means,
    // and the app does not make them save it twice to say it. A shorter commute
    // occupies a subset of the minutes the old one did, so applying it first
    // cannot be the reason the move is refused.
    const board = week()
    const { runtime } = harness(board)
    const intervals = intervalsOf(board, 'monday')
    const after = editDay(
      holding(board),
      runtime,
      'monday',
      dayDraft({
        workIntervals: [{ ...intervals[0], startMinute: 360 }, intervals[1]],
        commuteBeforeMinutes: 0,
        commuteAfterMinutes: 0,
      }),
    )
    expect(after.ok).toBe(true)
    expect(after.state.board.days.monday.workIntervals[0].startMinute).toBe(360)
    expect(after.state.board.days.monday.commuteBeforeMinutes).toBe(0)
  })

  it('lengthens the commute after the work it hangs off has moved', () => {
    // A longer commute has no subset argument, so it goes last, where it is
    // checked against the day that will actually exist. On Friday the afternoon
    // is asked to finish at 16:00, so ninety minutes home runs to 17:30 — free,
    // and hanging off the new end rather than the old one.
    const board = week()
    const { runtime } = harness(board)
    const intervals = intervalsOf(board, 'friday')
    const after = editDay(
      holding(board),
      runtime,
      'friday',
      dayDraft({
        workIntervals: [intervals[0], { ...intervals[1], endMinute: 960 }],
        commuteBeforeMinutes: 0,
        commuteAfterMinutes: 90,
      }),
    )
    expect(after.ok).toBe(true)
    const plan = after.state.board.days.friday
    expect(plan.commuteAfterMinutes).toBe(90)
    expect(plan.workIntervals[1].endMinute).toBe(960)
    const stretches = commuteFootprint(plan).filter((stretch) => stretch.role === 'commute')
    expect(stretches).toHaveLength(1)
    expect(formatClock(stretches[0].startMinute)).toBe('16:00')
  })

  it('refuses a commute that would reach into a block, and leaves the work edit that landed', () => {
    // The afternoon is shortened to finish at 16:00, so a commute home of ninety
    // minutes runs to 17:30 and lands on the gym visit, which starts at 17:20 with
    // its own travel. The work edit reached the board and the commute did not, and
    // the sentence on screen is the one that says which.
    const board = week()
    const { runtime, storage } = harness(board)
    const intervals = intervalsOf(board, 'monday')
    const after = editDay(
      holding(board),
      runtime,
      'monday',
      dayDraft({
        workIntervals: [intervals[0], { ...intervals[1], endMinute: 960 }],
        commuteBeforeMinutes: 20,
        commuteAfterMinutes: 90,
      }),
    )
    expect(after.ok).toBe(true)
    expect(after.state.refusal).toBe(refusalMessage('overlaps'))
    expect(after.state.board.days.monday.workIntervals[1].endMinute).toBe(960)
    expect(after.state.board.days.monday.commuteAfterMinutes).toBe(15)
    expect(storage.writes).toHaveLength(1)
  })

  it('empties a day, which takes the commute with it', () => {
    const board = week()
    const { runtime } = harness(board)
    const after = editDay(holding(board), runtime, 'monday', dayDraft())
    expect(after.ok).toBe(true)
    expect(after.state.board.days.monday.workIntervals).toEqual([])
    expect(after.state.board.days.monday.commuteBeforeMinutes).toBe(0)
    expect(after.state.board.days.monday.commuteAfterMinutes).toBe(0)
  })

  it('refuses a work interval that is too short, and leaves the day alone', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const after = editDay(
      holding(board),
      runtime,
      'monday',
      dayDraft({
        workIntervals: [...intervalsOf(board, 'monday'), { id: null, startMinute: 1200, endMinute: 1210 }],
        // The commute is the one already on the day, so it is applied last and
        // the too-short interval is the first thing refused.
        commuteBeforeMinutes: 20,
        commuteAfterMinutes: 15,
      }),
    )
    expect(after.ok).toBe(false)
    expect(after.state.refusal).toBe(refusalMessage('too-short'))
    expect(after.state.board).toBe(board)
    expect(storage.writes).toEqual([])
  })
})

// --- tasks ------------------------------------------------------------------

describe('addTask', () => {
  it('adds a task at the end of the list, and saves', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const after = addTask(holding(board), runtime, { ...GYM, name: 'Swimming' })
    expect(after.ok).toBe(true)
    expect(after.state.board.goals.map((goal) => goal.name)).toEqual([
      'Study Spanish',
      'Gym',
      'Swimming',
    ])
    expect(storage.writes).toHaveLength(1)
  })

  it('refuses an empty name, in the domain’s words, and mints no id', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const after = addTask(holding(board), runtime, { ...GYM, name: '   ' })
    expect(after.state.refusal).toBe(refusalMessage('empty-name'))
    expect(storage.writes).toEqual([])
  })

  it('refuses a time budget below one shortest block', () => {
    const board = week()
    const { runtime } = harness(board)
    const after = addTask(holding(board), runtime, { ...STUDY, goalMinutes: 10 })
    expect(after.state.refusal).toBe(refusalMessage('invalid-quota'))
  })
})

describe('editTask', () => {
  it('renames a task, and every block of it is renamed with it', () => {
    const board = week()
    const { runtime } = harness(board)
    const study = board.goals[0]
    const after = editTask(holding(board), runtime, study.id, { ...STUDY, name: 'Study French' })
    expect(after.ok).toBe(true)
    expect(after.state.board.goals[0].name).toBe('Study French')
    // The block holds no name at all: the grid reads it off the task, so renaming
    // the task renames the block without anything visiting the block.
    expect(after.state.board.sessions[0].goalId).toBe(study.id)
  })

  it('carries a new default travel to the blocks that still follow it, and to no others', () => {
    const board = week()
    const { runtime } = harness(board)
    const study = board.goals[0]
    const after = editTask(holding(board), runtime, study.id, {
      ...STUDY,
      defaultTravel: { beforeMinutes: 5, afterMinutes: 5 },
    })
    expect(after.ok).toBe(true)
    // The gym visit follows its own task, and the study block's travel was edited
    // for one day, so neither is touched.
    expect(after.state.board.sessions[0].travel).toEqual({ beforeMinutes: 10, afterMinutes: 15 })
    expect(after.state.board.sessions[1].travel).toEqual({ beforeMinutes: 10, afterMinutes: 5 })
  })

  it('refuses to change what kind of task it is, and saves nothing', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const gym = board.goals[1]
    // A count draft submitted for a time goal: the shape compiles, because a
    // form owns a whole draft, and the domain is what says no.
    const asTime: GoalDraft = {
      kind: 'time',
      name: gym.name,
      colorId: gym.colorId,
      goalMinutes: 180,
      defaultActivityMinutes: 45,
      defaultTravel: { beforeMinutes: 0, afterMinutes: 0 },
    }
    const after = editTask(holding(board), runtime, gym.id, asTime)
    expect(after.state.refusal).toBe(refusalMessage('kind-locked'))
    expect(storage.writes).toEqual([])
  })

  it('changes only the numbers when the quota changes, and the blocks do not move', () => {
    const board = week()
    const { runtime } = harness(board)
    const study = board.goals[0]
    const atBirth = board.sessions
    const after = editTask(holding(board), runtime, study.id, { ...STUDY, goalMinutes: 420 })
    expect(after.ok).toBe(true)
    expect(after.state.board.sessions).toBe(atBirth)
    expect(goalProgress(after.state.board, after.state.board.goals[0]).goal).toBe(420)
  })
})

describe('deleteTask', () => {
  it('takes the task and every block of it, and leaves the one-offs alone', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const study = board.goals[0]
    const after = deleteTask(holding(board), runtime, study.id)
    expect(after.ok).toBe(true)
    expect(after.state.board.goals.map((goal) => goal.name)).toEqual(['Gym'])
    expect(after.state.board.sessions.map((session) => session.goalId)).toEqual([board.goals[1].id])
    expect(after.state.board.oneOffs).toHaveLength(1)
    expect(storage.writes).toHaveLength(1)
  })

  it('refuses a task that is not there, and saves nothing', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const after = deleteTask(holding(board), runtime, 'gone')
    expect(after.state.refusal).toBe(refusalMessage('missing-goal'))
    expect(storage.writes).toEqual([])
  })
})

// --- one-offs ---------------------------------------------------------------

describe('addOneOff', () => {
  it('puts a new event in the slot it was opened on, and saves', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const after = addOneOff(
      holding(board),
      runtime,
      eventDraft({ day: 'thursday', startMinute: 720, activityEndMinute: 780, name: 'Call Mum' }),
    )
    expect(after.ok).toBe(true)
    const added = after.state.board.oneOffs[after.state.board.oneOffs.length - 1]
    expect(added).toMatchObject({ name: 'Call Mum', day: 'thursday', startMinute: 720, done: false })
    expect(storage.writes).toHaveLength(1)
  })

  it('keeps its own travel object rather than the form’s', () => {
    const board = week()
    const { runtime } = harness(board)
    const draft = eventDraft({
      day: 'sunday',
      startMinute: 600,
      activityEndMinute: 670,
      travel: { beforeMinutes: 10, afterMinutes: 10 },
    })
    const after = addOneOff(holding(board), runtime, draft)
    expect(after.ok).toBe(true)
    const added = after.state.board.oneOffs[after.state.board.oneOffs.length - 1]
    expect(added.travel).not.toBe(draft.travel)
    expect(added.travel).toEqual({ beforeMinutes: 10, afterMinutes: 10 })
  })

  it('refuses a slot that is not free, and saves nothing', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    // Thursday 9:00 is inside Thursday's morning work.
    const after = addOneOff(holding(board), runtime, eventDraft({ day: 'thursday', startMinute: 540, activityEndMinute: 600 }))
    expect(after.state.refusal).toBe(refusalMessage('overlaps'))
    expect(after.state.board).toBe(board)
    expect(storage.writes).toEqual([])
  })
})

// --- reset and import -------------------------------------------------------

describe('clearBoard', () => {
  it('puts the board back to the preset and saves it', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const after = clearBoard(holding(board), runtime)
    expect(after.ok).toBe(true)
    expect(after.state.board).toEqual(createDefaultBoard(countingIds()))
    expect(storage.writes).toHaveLength(1)
    // Nothing survives a reset, and the in-memory board is the saved one.
    expect(initialState(runtime).board.goals).toEqual([])
  })
})

describe('import', () => {
  it('refuses a paste that is not a board, keeps the week, and saves nothing', () => {
    // "Nothing was replaced" has to be true of a file that was not a board, and
    // it is only true because this is settled as a refusal rather than asked
    // about afterwards.
    const board = week()
    const { runtime, storage } = harness(board)
    const imported = importBoardText('{ not a board')
    expect(imported.ok).toBe(false)
    const after = settle(holding(board), runtime, imported)
    expect(after.ok).toBe(false)
    expect(after.state.board).toBe(board)
    expect(after.state.refusal).toBe(refusalMessage('invalid-backup'))
    expect(storage.writes).toEqual([])
  })

  it('refuses a board that could not go on the chart, and names the file', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const broken = week().sessions.slice(0, 1).map((session) => ({ ...session, day: 'saturday', startMinute: 600 }))
    const text = JSON.stringify({ ...week(), sessions: broken })
    const imported = importBoardText(text)
    expect(imported.ok).toBe(false)
    const after = settle(holding(board), runtime, imported)
    expect(after.state.refusal).toBe(refusalMessage('invalid-backup'))
    expect(storage.writes).toEqual([])
  })

  it('replaces the whole board on a confirm, and saves once', () => {
    const board = week()
    const { runtime, storage } = harness(board)
    const other = resetBoard(countingIds())
    const after = replaceBoard(holding(board), runtime, other)
    expect(after.ok).toBe(true)
    expect(after.state.board).toEqual(other)
    expect(storage.writes).toHaveLength(1)
    expect(initialState(runtime).board.goals).toEqual([])
  })

  it('brings back a real week through the text the panel would have shown', () => {
    const board = week()
    const { runtime } = harness(board)
    const text = exportBoardText(board)
    const imported = importBoardText(text)
    if (!imported.ok) throw new Error('a board the app wrote should import')
    const after = replaceBoard(holding(resetBoard(countingIds())), runtime, imported.value)
    expect(after.state.board).toEqual(board)
  })
})

// --- messages and colors ----------------------------------------------------

describe('dismissMessage', () => {
  it('puts away whichever sentence is on screen', () => {
    expect(dismissMessage({ board: week(), refusal: 'a refusal', notice: null }).refusal).toBeNull()
    expect(dismissMessage({ board: week(), refusal: null, notice: 'a notice' }).notice).toBeNull()
  })
})

describe('usedColorIds', () => {
  it('names the colors of every task and every event, so a new one starts distinct', () => {
    const board = week()
    expect(usedColorIds(board)).toEqual(['sky', 'green', 'rose'])
  })

  it('is nothing on an empty week', () => {
    expect(usedColorIds(createDefaultBoard(countingIds()))).toEqual([])
  })
})

// --- the properties the whole folder rests on -------------------------------

describe('what the flows must not do', () => {
  /**
   * The state a flow was handed is the caller's, and none of them may write to
   * it. The domain's own non-mutation tests cover a single mutation; this is the
   * sweep over every flow, because a sequence of them is where a slip would
   * actually be made.
   */
  it('leaves the state it was given exactly as it was', () => {
    const board = week()
    const { runtime } = harness(board)
    const { study, gym } = placed(board)
    const day = 'monday'
    const intervals = board.days[day].workIntervals.map((interval) => ({ ...interval }))
    const atBirth = structuredClone(holding(board))

    const calls: Array<() => Settled> = [
      () => placeGoal(holding(board), runtime, board.goals[0].id, 'thursday', 720),
      () => dropBlock(holding(board), runtime, { kind: 'session', id: study }, 'friday', 720),
      () => dropBlock(holding(board), runtime, { kind: 'work', id: intervals[0].id }, 'tuesday', 720),
      () => resizeBlock(holding(board), runtime, { kind: 'session', id: study }, 'end', 835),
      () => markBlockDone(holding(board), runtime, { kind: 'session', id: gym }, false),
      () => deleteBlock(holding(board), runtime, { kind: 'one-off', id: board.oneOffs[0].id }),
      () => editSession(holding(board), runtime, study, blockDraft({ day: 'thursday', startMinute: 780, activityEndMinute: 870 })),
      () => editOneOff(holding(board), runtime, board.oneOffs[0].id, eventDraft({ day: 'sunday', startMinute: 600, activityEndMinute: 660 })),
      () => editDay(holding(board), runtime, day, dayDraft({ workIntervals: intervals, commuteBeforeMinutes: 30, commuteAfterMinutes: 0 })),
      () => addTask(holding(board), runtime, { ...GYM, name: 'Swimming' }),
      () => editTask(holding(board), runtime, board.goals[0].id, { ...STUDY, name: 'French' }),
      () => deleteTask(holding(board), runtime, board.goals[0].id),
      () => addOneOff(holding(board), runtime, eventDraft({ day: 'sunday', startMinute: 600, activityEndMinute: 660 })),
      () => clearBoard(holding(board), runtime),
      () => replaceBoard(holding(board), runtime, resetBoard(countingIds())),
    ]

    for (const call of calls) {
      expect(call().state.board).toBeDefined()
    }
    expect(holding(board)).toEqual(atBirth)
  })

  /**
   * Every refusal the app can show is a sentence the domain wrote, and the set
   * of sentences is the domain's own.
   *
   * It is a sweep rather than a list because the failure it guards against is a
   * flow that phrases a refusal in its own words: one flow with its own voice
   * would be a sentence nobody else can get, and a person reading two refusals
   * would not be able to tell that they came from the same rule.
   */
  it('shows a sentence from `refusal.ts` for every reason it can be refused for', () => {
    const board = week()
    const { runtime } = harness(board)
    const { study } = placed(board)
    const intervals = board.days.monday.workIntervals.map((interval) => ({ ...interval }))
    const refusals = [
      placeGoal(holding(board), runtime, 'gone', 'thursday', 720).state.refusal,
      placeGoal(holding(board), runtime, board.goals[0].id, 'thursday', 722).state.refusal,
      dropBlock(holding(board), runtime, { kind: 'work', id: intervals[0].id }, 'tuesday', 720).state.refusal,
      resizeBlock(holding(board), runtime, { kind: 'session', id: study }, 'end', 740).state.refusal,
      deleteBlock(holding(board), runtime, { kind: 'session', id: 'gone' }).state.refusal,
      addTask(holding(board), runtime, { ...GYM, name: '' }).state.refusal,
      editTask(holding(board), runtime, board.goals[0].id, { ...STUDY, kind: 'count', goalCount: 2 } as GoalDraft).state.refusal,
      deleteTask(holding(board), runtime, 'gone').state.refusal,
      editDay(holding(board), runtime, 'monday', dayDraft({ workIntervals: [{ ...intervals[0], endMinute: intervals[0].startMinute + 5 }], commuteBeforeMinutes: 0, commuteAfterMinutes: 0 })).state.refusal,
    ]
    const sentences = refusals.filter((sentence): sentence is string => sentence !== null)
    expect(sentences.length).toBe(refusals.length)
    const everySentence = ([
      'outside-day',
      'overlaps',
      'too-short',
      'not-a-step',
      'empty-name',
      'name-too-long',
      'invalid-quota',
      'kind-locked',
      'missing-goal',
      'commute-without-work',
      'invalid-backup',
      'storage-unavailable',
      'missing-work',
      'missing-block',
    ] satisfies RefusalReason[]).map(refusalMessage)
    for (const sentence of sentences) {
      expect(everySentence).toContain(sentence)
    }
  })

  /**
   * One id source for the whole board, which is the app's single
   * `crypto.randomUUID` handed to every flow. Two things on a board sharing an id
   * would make every lookup by id in the app ambiguous.
   */
  it('never hands the same id to two things', () => {
    const { runtime } = harness()
    let state = initialState(runtime)
    state = addTask(state, runtime, STUDY).state
    state = placeGoal(state, runtime, state.board.goals[0].id, 'thursday', 720).state
    state = addOneOff(state, runtime, eventDraft({ day: 'sunday', startMinute: 600, activityEndMinute: 660 })).state
    state = editDay(state, runtime, 'monday', dayDraft({
      workIntervals: state.board.days.monday.workIntervals.map((interval) => ({ ...interval })),
      commuteBeforeMinutes: 0,
      commuteAfterMinutes: 0,
    })).state
    const ids = [
      ...state.board.goals.map((goal) => goal.id),
      ...state.board.sessions.map((session) => session.id),
      ...state.board.oneOffs.map((oneOff) => oneOff.id),
      ...Object.values(state.board.days).flatMap((plan) => plan.workIntervals.map((interval) => interval.id)),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the shape of a week a person reads', () => {
  it('shows the same minutes the chart draws, in words rather than numbers', () => {
    // A last check that the two views cannot tell different stories: the block a
    // move, travel, and resize sequence produced is the block the list and the
    // chart are both reading, and the numbers that place it are the numbers its
    // own fields hold.
    const board = week()
    const { runtime } = harness(board)
    const { study } = placed(board)
    const after = editSession(holding(board), runtime, study, blockDraft({ activityEndMinute: 830, travel: { beforeMinutes: 20, afterMinutes: 5 } }))
    expect(after.ok).toBe(true)
    const block = after.state.board.sessions[0]
    expect(formatClock(block.startMinute)).toBe('12:15')
    expect(formatDuration(block.activityMinutes)).toBe('1 hour 15 minutes')
    expect(block.travel.beforeMinutes).toBe(20)
    // The block runs 12:15 to 13:55: its own start, its travel, its activity, and
    // the travel after it, which is the whole of what a footprint is.
    const end = block.startMinute + block.travel.beforeMinutes + block.activityMinutes + block.travel.afterMinutes
    expect(formatClock(end)).toBe('13:55')
  })
})
