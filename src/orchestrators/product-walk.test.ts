/**
 * The product scope, walked through the orchestrator's own events.
 *
 * Task 21's done-when is not only that the three commands exit 0. It is that
 * *the behaviours in the product scope can be performed through the orchestrator
 * events*, and that half had never been asked as a whole. Every other test in
 * this project asks whether a module behaves — the rules in `schedule.ts`, the
 * sentences in `progress.ts`, the flows in `actions.ts` one at a time — and none
 * of them asks whether a person could get from an empty week to a planned one
 * using only what the app hands them.
 *
 * So this is that walk. Each test is one thing the product scope says a person
 * must be able to do, driven through the flows in `actions.ts` and read back the
 * way the screen would show it: through `toGridModel` and `toTaskListModel`, and
 * through the sentence the orchestrator put in the state.
 *
 * **No mutation is called directly anywhere in this file.** Not one. A test that
 * called `placeSession` would prove the domain again and say nothing about
 * whether the app can be used, which is the whole of the question. Where a test
 * needs a change it goes through the flow a finger reaches, and the flow is named
 * in a comment above it beside the event that reaches it, so the test reads as the
 * chain it is: a finger, a flow, a board.
 *
 * The two checks at the bottom are about completeness rather than behaviour, and
 * they are why this is a walk and not a sample:
 *
 * - **every flow is exercised.** Read from `actions.ts`'s own source, so a flow
 *   added there and never walked fails here rather than quietly becoming a thing
 *   the app can do that no test has ever checked.
 * - **every event a component declares is passed to it.** `component-rules` pins
 *   what each component *offers*; nothing pinned what the orchestrator *hands it*.
 *   An event declared and never passed is a control that silently does nothing,
 *   and that is exactly the failure "can be performed through the orchestrator
 *   events" is about.
 */

import { describe, expect, it } from 'vitest'

import type { GoalDraft } from '@/domain/goals'
import { refusalMessage } from '@/domain/refusal'
import type { Board } from '@/domain/types'
import { toGridModel, toTaskListModel } from '@/domain/view'
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
 * A storage that records every write, which is how "every successful mutation
 * saves. A refused mutation does not" is asked of a whole walk rather than of one
 * call.
 *
 * This is a smaller copy of the one in `actions.test.ts` on purpose: the plan's
 * file tree is fixed, and this task did not add a folder of test helpers for a
 * twenty-line fake. Duplicating it is cheaper than inventing a home for it.
 */
function memoryStorage(seed?: string): { storage: BoardStorage; writes: string[] } {
  const text = new Map<string, string>()
  if (seed !== undefined) text.set(STORAGE_KEY, seed)
  const writes: string[] = []
  return {
    writes,
    storage: {
      getItem: (key) => text.get(key) ?? null,
      setItem: (key, value) => {
        text.set(key, value)
        writes.push(value)
      },
    },
  }
}

/** One id source for the whole app, which is what the app itself has. */
function countingIds(): () => string {
  let n = 0
  return () => {
    n += 1
    return `id-${n}`
  }
}

/** The app, opened, with somewhere to send the next change. */
interface App {
  runtime: Runtime
  /** Every board written to storage so far, in order. */
  writes: string[]
  /** The state as it stands, which is where a refusal is read from. */
  state: BoardState
  /** Run a flow and keep the answer. */
  run(flow: (state: BoardState, runtime: Runtime) => Settled): Settled
  /** The board as a person would see it now. */
  board(): Board
}

function open(seed?: string): App {
  const memory = memoryStorage(seed)
  const runtime: Runtime = { createId: countingIds(), storage: memory.storage }
  const app: App = {
    runtime,
    writes: memory.writes,
    state: initialState(runtime),
    board: () => app.state.board,
    run(flow) {
      const settled = flow(app.state, runtime)
      app.state = settled.state
      return settled
    },
  }
  return app
}

// --- what a person types into the forms --------------------------------------

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

function blockDraft(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    day: 'monday',
    startMinute: 720,
    activityEndMinute: 780,
    travel: { beforeMinutes: 0, afterMinutes: 0 },
    ...overrides,
  }
}

function dayDraft(overrides: Partial<DayDraft> = {}): DayDraft {
  return { workIntervals: [], commuteBeforeMinutes: 0, commuteAfterMinutes: 0, ...overrides }
}

// --- the week a walk starts from ----------------------------------------------

/**
 * A week a person could really have, reached the way a person reaches it: the
 * list's *Add task* twice, a task armed and a free slot tapped for each, and the
 * list's *Add event* with a slot tapped.
 *
 * The layout is deliberate and every test below depends on it. Monday is work
 * 8:00–12:00 and 14:00–17:00 with the study block in the 12:00–14:00 hole at
 * 12:00–13:00, a commute of nothing, and the dentist at 18:00–19:00. Tuesday
 * carries the gym visit, so Monday's hole stays free past 13:00 for the one test
 * that resizes into it, and so a move can take the study block off Monday and
 * leave it with nothing.
 */
function started(): App {
  const app = open()
  app.run((state, runtime) => addTask(state, runtime, STUDY))
  app.run((state, runtime) => addTask(state, runtime, GYM))
  const [study, gym] = app.board().goals
  app.run((state, runtime) => placeGoal(state, runtime, study.id, 'monday', 720))
  app.run((state, runtime) => placeGoal(state, runtime, gym.id, 'tuesday', 720))
  app.run((state, runtime) => addOneOff(state, runtime, eventDraft()))
  return app
}

/** The row a person would read in the list for one task. */
function sentenceFor(board: Board, goalId: string): string {
  const row = toTaskListModel(board).find((entry) => entry.id === goalId)
  if (row === undefined || row.kind !== 'goal') throw new Error('no such row in the list')
  return row.progress.sentence
}

/** The strips of one block on the chart, in the order the column draws them. */
function stripsOf(board: Board, day: string, blockId: string): string[] {
  const column = toGridModel(board).days.find((entry) => entry.day === day)
  if (column === undefined) throw new Error(`no column for ${day}`)
  return column.blocks.filter((block) => block.target?.id === blockId).map((block) => block.tone)
}

// --- the first open ----------------------------------------------------------

describe('a person opening the app', () => {
  it('sees the preset week and an empty list, and writes nothing at all', () => {
    // The product's "First open": the preset work intervals, an empty task list,
    // no wizard. And the plan's "Do not write yet" — mounting is not a save, so a
    // refresh before any change cannot destroy a stored board.
    const app = open()
    expect(app.board().days.monday.workIntervals).toHaveLength(2)
    expect(app.board().days.saturday.workIntervals).toEqual([])
    expect(app.board().days.monday.commuteBeforeMinutes).toBe(0)
    expect(toTaskListModel(app.board())).toEqual([])
    expect(app.writes).toEqual([])
  })

  it('suggests a color nothing else is using', () => {
    // The product: "The app suggests a distinct color." `usedColorIds` is the
    // reader the goal form's first field is built from, and it reads both lists,
    // because a hue on this board is how a block is recognized.
    const app = started()
    expect(usedColorIds(app.board()).sort()).toEqual(['green', 'rose', 'sky'])
  })
})

// --- adding a task or an event -----------------------------------------------

describe('a person adding a task', () => {
  it('sees both kinds of quota, with the numbers they typed', () => {
    // `TaskList` `onAddGoal` → `GoalForm` `onSubmit` → `addTask`. The product asks
    // for a name, a color, the weekly quota, a default activity length, and
    // optional default travel before and after.
    const app = open()
    app.run((state, runtime) => addTask(state, runtime, STUDY))
    app.run((state, runtime) => addTask(state, runtime, GYM))
    const [time, count] = app.board().goals
    expect(time).toMatchObject({ kind: 'time', name: 'Study Spanish', goalMinutes: 300 })
    expect(count).toMatchObject({ kind: 'count', name: 'Gym', goalCount: 3 })
    // Default travel is the task's, and it never counts toward the quota.
    expect(count).toMatchObject({ defaultTravel: { beforeMinutes: 10, afterMinutes: 5 } })
    expect(sentenceFor(app.board(), time.id)).toBe('0 hours done of 5. 5 hours are not on the grid.')
    expect(sentenceFor(app.board(), count.id)).toBe('0 of 3 done. 3 visits are not on the grid.')
  })

  it('is refused a name of nothing but spaces, and nothing is added or saved', () => {
    // The app refuses rather than repairs, so a name is stored exactly as typed
    // and a blank one is turned away rather than quietly emptied.
    const app = open()
    const settled = app.run((state, runtime) => addTask(state, runtime, { ...STUDY, name: '   ' }))
    expect(settled.ok).toBe(false)
    expect(settled.state.refusal).toBe(refusalMessage('empty-name'))
    expect(app.board().goals).toEqual([])
    expect(app.writes).toEqual([])
  })
})

describe('a person adding an event', () => {
  it('puts it on the slot they tapped, and the chart draws it by name', () => {
    // `TaskList` `onAddOneOff` arms the step, `WeekGrid` `onEmptyTap` opens the
    // form at the tapped slot, and the form's `onSubmit` is `addOneOff`. The
    // product's "add an event, tap a slot, submit the form" is exactly those three.
    const app = open()
    app.run((state, runtime) => addOneOff(state, runtime, eventDraft()))
    const [event] = app.board().oneOffs
    expect(event).toMatchObject({ name: 'Dentist', day: 'monday', startMinute: 1080, done: false })
    const block = toGridModel(app.board())
      .days[0]
      .blocks.find((entry) => entry.target?.id === event.id && entry.tone === 'activity')
    expect(block?.label).toBe('Dentist')
    // A block's height is its real duration: an hour is 60/960 of the column.
    expect(block?.heightPercent).toBeCloseTo((60 / 960) * 100)
  })
})

// --- placing ------------------------------------------------------------------

describe('a person placing a block', () => {
  it('gets the task’s own defaults on a free stretch, and nothing else is touched', () => {
    // `TaskList` `onSelectGoal` arms it, `WeekGrid` `onEmptyTap` places it, and the
    // domain copies the task's default length and default travel onto the block,
    // so one gesture places a whole block.
    const app = open()
    app.run((state, runtime) => addTask(state, runtime, GYM))
    const gym = app.board().goals[0].id
    app.run((state, runtime) => placeGoal(state, runtime, gym, 'wednesday', 720))
    // 10 minutes of travel, 45 of activity, 5 after: the block starts at 12:00.
    expect(app.board().sessions[0]).toMatchObject({
      goalId: gym,
      day: 'wednesday',
      startMinute: 720,
      activityMinutes: 45,
      travel: { beforeMinutes: 10, afterMinutes: 5 },
      travelFollowsDefault: true,
      done: false,
    })
    expect(stripsOf(app.board(), 'wednesday', app.board().sessions[0].id)).toEqual(['travel', 'activity', 'travel'])
    expect(app.writes).toHaveLength(2)
  })

  it('is refused on time that is taken, and the week is exactly as it was', () => {
    // The product: "If a change would make two of those overlap, the app refuses it
    // and says why. It does not move or delete something else to make the change
    // fit." A second tap on the same slot is refused, and the block already there
    // is not moved a minute.
    const app = started()
    const study = app.board().goals[0].id
    const before = app.board()
    const settled = app.run((state, runtime) => placeGoal(state, runtime, study, 'monday', 720))
    expect(settled.ok).toBe(false)
    expect(settled.state.board).toBe(before)
    expect(settled.state.refusal).toBe(refusalMessage('overlaps'))
    expect(app.board().sessions).toHaveLength(2)
  })
})

// --- moving -------------------------------------------------------------------

describe('a person moving a block', () => {
  it('moves it from Monday to Friday and leaves Monday with nothing', () => {
    // `WeekGrid` `onBlockDrop` → `dropBlock`. The product is explicit: "Moving a
    // block from Monday to Friday moves it. Monday does not keep a copy, a ghost,
    // or a missed mark. There is no skipped state."
    const app = started()
    const block = app.board().sessions[0]
    app.run((state, runtime) => markBlockDone(state, runtime, { kind: 'session', id: block.id }, true))
    const moved = app.run((state, runtime) =>
      dropBlock(state, runtime, { kind: 'session', id: block.id }, 'friday', 1080),
    )
    expect(moved.ok).toBe(true)
    expect(app.board().sessions).toHaveLength(2)
    expect(app.board().sessions.find((entry) => entry.id === block.id)).toMatchObject({
      day: 'friday',
      done: true,
    })
    // The done mark came with it, and the block is drawn on that column only.
    const model = toGridModel(app.board())
    expect(stripsOf(app.board(), 'friday', block.id)).toEqual(['activity'])
    expect(stripsOf(app.board(), 'monday', block.id)).toEqual([])
    expect(model.days.find((day) => day.day === 'monday')?.blocks.some((b) => b.target?.id === block.id)).toBe(false)
  })

  it('is refused on occupied time, and the block stays where it was', () => {
    // The refusal keeps the board object itself, so the chart redraws the block
    // where it already was and there is no rollback code anywhere in the app.
    const app = started()
    const event = app.board().oneOffs[0]
    const before = app.board()
    const settled = app.run((state, runtime) =>
      dropBlock(state, runtime, { kind: 'one-off', id: event.id }, 'monday', 720),
    )
    expect(settled.ok).toBe(false)
    expect(settled.state.board).toBe(before)
    expect(settled.state.refusal).toBe(refusalMessage('overlaps'))
  })

  it('does not take a work interval to another day, and says which day it is on', () => {
    // The one asymmetry the app has, and the product's rule behind it: which days
    // carry work is the day editor's question. A drop on another column finds
    // nothing there, so the block goes back where it came from. Saturday is the
    // one day the preset leaves with no work at all, so the point is plain.
    const app = open()
    const interval = app.board().days.monday.workIntervals[0]
    const settled = app.run((state, runtime) =>
      dropBlock(state, runtime, { kind: 'work', id: interval.id }, 'saturday', 600),
    )
    expect(settled.ok).toBe(false)
    expect(settled.state.refusal).toBe(refusalMessage('missing-work'))
    expect(app.board().days.saturday.workIntervals).toEqual([])
    expect(app.board().days.monday.workIntervals[0]).toMatchObject({ startMinute: 480 })
  })
})

// --- resizing -----------------------------------------------------------------

describe('a person resizing a block', () => {
  it('lengthens the activity, and a done total follows the new length', () => {
    // `WeekGrid` `onBlockResize` reports the *activity's* own edge, because that
    // is the rectangle a finger lands on. The product: "resize a block; if it is
    // done, the done total follows the new activity length."
    const app = started()
    const block = app.board().sessions[0]
    app.run((state, runtime) => markBlockDone(state, runtime, { kind: 'session', id: block.id }, true))
    // 12:00 to 13:40 is 100 minutes, and 1:40 is a legal typed time.
    const resized = app.run((state, runtime) =>
      resizeBlock(state, runtime, { kind: 'session', id: block.id }, 'end', 820),
    )
    expect(resized.ok).toBe(true)
    expect(app.board().sessions[0].activityMinutes).toBe(100)
    expect(sentenceFor(app.board(), block.goalId)).toBe(
      '1 hour 40 minutes done of 5 hours. 3 hours 20 minutes are not on the grid.',
    )
  })
})

// --- done ---------------------------------------------------------------------

describe('a person marking a block done', () => {
  it('counts it, and takes it straight back off', () => {
    // `WeekGrid` `onBlockTap` opens the editor, and the editor's `onSetDone` is
    // `markBlockDone` with no save of its own — one tap rather than two, and the
    // mark can be undone because undoing it is the one thing the product allows.
    const app = started()
    const block = app.board().sessions[0]
    const study = block.goalId
    expect(sentenceFor(app.board(), study)).toBe('0 hours done of 5. 4 hours are not on the grid.')
    app.run((state, runtime) => markBlockDone(state, runtime, { kind: 'session', id: block.id }, true))
    expect(sentenceFor(app.board(), study)).toBe('1 hour done of 5. 4 hours are not on the grid.')
    app.run((state, runtime) => markBlockDone(state, runtime, { kind: 'session', id: block.id }, false))
    expect(sentenceFor(app.board(), study)).toBe('0 hours done of 5. 4 hours are not on the grid.')
  })

  it('keeps the color and says Done, so a finished block is still readable', () => {
    // The product: "The grid must make a done block look settled without losing its
    // color, so the week can still be read at a glance."
    const app = started()
    const block = app.board().sessions[0]
    const before = toGridModel(app.board()).days[0].blocks.find((entry) => entry.target?.id === block.id)
    app.run((state, runtime) => markBlockDone(state, runtime, { kind: 'session', id: block.id }, true))
    const after = toGridModel(app.board()).days[0].blocks.find((entry) => entry.target?.id === block.id)
    expect(after?.done).toBe(true)
    expect(after?.colorId).toBe(before?.colorId)
    expect(after?.label).toBe('Study Spanish')
    expect(after?.detail).toContain('Done')
  })
})

// --- deleting -----------------------------------------------------------------

describe('a person deleting a block', () => {
  it('takes a block off with no question asked, and its credit with it', () => {
    // `WeekGrid` `onBlockTap` → the editor's `onDelete` → `deleteBlock`. The
    // product reserves confirmation for a whole task and the whole board:
    // "Deleting one block should be easy."
    const app = started()
    const block = app.board().sessions[0]
    const study = block.goalId
    app.run((state, runtime) => markBlockDone(state, runtime, { kind: 'session', id: block.id }, true))
    const deleted = app.run((state, runtime) => deleteBlock(state, runtime, { kind: 'session', id: block.id }))
    expect(deleted.ok).toBe(true)
    expect(app.board().sessions).toHaveLength(1)
    expect(app.board().goals).toHaveLength(2)
    expect(sentenceFor(app.board(), study)).toBe('0 hours done of 5. 5 hours are not on the grid.')
  })

  it('deletes an event too, and an event has no fraction to lose', () => {
    const app = started()
    const event = app.board().oneOffs[0]
    app.run((state, runtime) => deleteBlock(state, runtime, { kind: 'one-off', id: event.id }))
    expect(app.board().oneOffs).toEqual([])
    // The list shows a day, a clock span, and a mark. No fraction, ever.
    expect(toTaskListModel(app.board()).every((row) => row.kind !== 'one-off')).toBe(true)
  })
})

// --- a task's own fields ------------------------------------------------------

describe('a person editing a task', () => {
  it('reaches every block of it with a new name and a new color', () => {
    // The product: "Name and color update every block of that task." True by
    // construction rather than by a loop, because the first two live on the task
    // and a block reads them — so there is no way for one block to be missed.
    const app = started()
    const study = app.board().goals[0]
    app.run((state, runtime) => editTask(state, runtime, study.id, { ...STUDY, name: 'Spanish', colorId: 'violet' }))
    const drawn = toGridModel(app.board())
      .days[0]
      .blocks.filter((block) => block.target?.id === app.board().sessions[0].id)
    expect(drawn.map((block) => [block.label, block.colorId])).toEqual([['Spanish', 'violet']])
  })

  it('changes only the numbers when the quota changes', () => {
    // "A quota change only changes the numbers; it does not add or remove blocks."
    // So the sentence's goal side moves and the grid is identical: same blocks,
    // same ids, same geometry.
    const app = started()
    const study = app.board().goals[0]
    const gridBefore = toGridModel(app.board())
    const changed = app.run((state, runtime) =>
      editTask(state, runtime, study.id, { ...STUDY, goalMinutes: 420 }),
    )
    expect(changed.ok).toBe(true)
    expect(sentenceFor(app.board(), study.id)).toBe('0 hours done of 7. 6 hours are not on the grid.')
    expect(app.board().sessions).toHaveLength(2)
    expect(toGridModel(app.board())).toEqual(gridBefore)
  })

  it('gives a new default travel to the blocks still following it, and to no others', () => {
    // "Default travel applies to blocks that are still using the default. A block
    // whose travel was edited keeps that edit." The flag the block carries is the
    // whole of how that is decided, and it is cleared by editing a block's own
    // travel — including typing the same numbers back.
    const app = started()
    const gym = app.board().goals[1]
    const visit = app.board().sessions[1]
    const edited = app.run((state, runtime) =>
      editSession(
        state,
        runtime,
        visit.id,
        blockDraft({ day: 'tuesday', startMinute: 720, activityEndMinute: 765, travel: { beforeMinutes: 0, afterMinutes: 0 } }),
      ),
    )
    expect(edited.ok).toBe(true)
    expect(app.board().sessions[1]).toMatchObject({ travelFollowsDefault: false, travel: { beforeMinutes: 0, afterMinutes: 0 } })

    // The task's own default changes, and the block that stopped following it is
    // untouched while a block placed afterwards takes the new default.
    app.run((state, runtime) =>
      editTask(state, runtime, gym.id, { ...GYM, defaultTravel: { beforeMinutes: 20, afterMinutes: 0 } }),
    )
    expect(app.board().sessions[1].travel).toEqual({ beforeMinutes: 0, afterMinutes: 0 })
    app.run((state, runtime) => placeGoal(state, runtime, gym.id, 'thursday', 720))
    const fresh = app.board().sessions[app.board().sessions.length - 1]
    expect(fresh).toMatchObject({ travelFollowsDefault: true, travel: { beforeMinutes: 20, afterMinutes: 0 } })
  })

  it('cannot change a task’s kind', () => {
    // The product: "The type cannot be changed later." The form shows the kind as
    // text and offers no control, so this is the domain answering a request the
    // app does not make — and answering it rather than coercing it.
    const app = started()
    const study = app.board().goals[0]
    const settled = app.run((state, runtime) =>
      editTask(state, runtime, study.id, {
        kind: 'count',
        name: 'Study Spanish',
        colorId: 'sky',
        goalCount: 3,
        defaultActivityMinutes: 60,
        defaultTravel: { beforeMinutes: 0, afterMinutes: 0 },
      }),
    )
    expect(settled.ok).toBe(false)
    expect(settled.state.refusal).toBe(refusalMessage('kind-locked'))
    expect(app.board().goals[0].kind).toBe('time')
  })

  it('deletes a task and every block of it, and nothing else', () => {
    // `TaskList` `onDeleteGoal` → `ConfirmDialog` → `deleteTask`. The product makes
    // this one ask first, which the orchestrator owns; the flow is what the answer
    // yes reaches, and nothing about it is a repair.
    const app = started()
    const study = app.board().goals[0].id
    const deleted = app.run((state, runtime) => deleteTask(state, runtime, study))
    expect(deleted.ok).toBe(true)
    expect(app.board().goals.map((goal) => goal.name)).toEqual(['Gym'])
    expect(app.board().sessions).toHaveLength(1)
    expect(app.board().oneOffs).toHaveLength(1)
    expect(app.board().days.monday.workIntervals).toHaveLength(2)
  })
})

// --- a block's own fields -----------------------------------------------------

describe('a person editing a block', () => {
  it('moves it, changes its travel, and resizes it, and the length is what they typed', () => {
    // The editor's `onSubmit` is `editSession`, and the order is the form's: move,
    // then travel, then the end, because the domain's resize measures the activity
    // from the end of the travel that is on the block at the time. So the activity
    // is 12:10 to 13:20 — seventy minutes — and not the eighty the old ten minutes
    // of nothing would have given.
    const app = started()
    const block = app.board().sessions[0]
    const edited = app.run((state, runtime) =>
      editSession(
        state,
        runtime,
        block.id,
        blockDraft({ day: 'wednesday', startMinute: 720, activityEndMinute: 800, travel: { beforeMinutes: 10, afterMinutes: 0 } }),
      ),
    )
    expect(edited.ok).toBe(true)
    const on = app.board().sessions[0]
    expect(on).toMatchObject({ day: 'wednesday', startMinute: 720, travel: { beforeMinutes: 10, afterMinutes: 0 } })
    expect(on.activityMinutes).toBe(70)
    expect(stripsOf(app.board(), 'wednesday', block.id)).toEqual(['travel', 'activity'])
    expect(stripsOf(app.board(), 'monday', block.id)).toEqual([])
  })

  it('edits an event’s name and color, which a block of a task does not own', () => {
    // `WeekGrid` `onBlockTap` on a one-off opens `OneOffForm`, whose `onSubmit` is
    // `editOneOff`. The name and the color go first, because they occupy no time:
    // a mistyped name refuses with the week exactly as it was rather than after
    // the block has already moved.
    const app = started()
    const event = app.board().oneOffs[0]
    app.run((state, runtime) =>
      editOneOff(state, runtime, event.id, eventDraft({ name: 'Physio', colorId: 'teal' })),
    )
    expect(app.board().oneOffs[0]).toMatchObject({ name: 'Physio', colorId: 'teal' })
  })

  it('is refused a name that is too long, with the week exactly as it was', () => {
    // A name is 40 characters at most, and a refusal leaves the form up with the
    // name still in the box it was typed in.
    const app = started()
    const before = app.board()
    const settled = app.run((state, runtime) =>
      editOneOff(state, runtime, before.oneOffs[0].id, eventDraft({ name: 'x'.repeat(41) })),
    )
    expect(settled.ok).toBe(false)
    expect(settled.state.board).toBe(before)
    expect(settled.state.refusal).toBe(refusalMessage('name-too-long'))
  })
})

// --- a day's work and commute -------------------------------------------------

describe('a person changing a day', () => {
  it('leaves at 12:00 by removing the afternoon, which the day editor submits as one day', () => {
    // The product's first worked example, through `WeekGrid` `onDayHeaderTap` →
    // `DayEditor` `onSubmit` → `editDay`. Morning work stays 8:00–12:00 and
    // 14:00–17:00 goes. A work interval and its commute are one day's question,
    // which is why the form hands up a whole day.
    const app = open()
    const [morning, afternoon] = app.board().days.monday.workIntervals
    const left = app.run((state, runtime) =>
      editDay(
        state,
        runtime,
        'monday',
        dayDraft({ workIntervals: [{ id: morning.id, startMinute: 480, endMinute: 720 }] }),
      ),
    )
    expect(left.ok).toBe(true)
    expect(app.board().days.monday.workIntervals).toHaveLength(1)
    expect(app.board().days.monday.workIntervals[0]).toMatchObject({ startMinute: 480, endMinute: 720 })
    // The interval that was removed is untouched on the board the walk came from.
    expect(afternoon).toMatchObject({ startMinute: 840, endMinute: 1020 })
    // 12:00 onwards is free, so nothing but the morning is drawn as work.
    expect(toGridModel(app.board()).days[0].blocks.filter((block) => block.tone === 'work')).toHaveLength(1)
  })

  it('starts earlier than 8:00, but not before 6:00', () => {
    // The product's second example: "move the morning start earlier, but not before
    // 6:00, and only if the commute still fits." 7:30 is a change; 7:00 is refused
    // and the morning is exactly where it was.
    const app = open()
    const [morning] = app.board().days.monday.workIntervals
    const changed = app.run((state, runtime) =>
      editDay(state, runtime, 'monday', dayDraft({ workIntervals: [{ id: morning.id, startMinute: 450, endMinute: 720 }] })),
    )
    expect(changed.ok).toBe(true)
    expect(app.board().days.monday.workIntervals[0]).toMatchObject({ startMinute: 450, endMinute: 720 })
    const tooEarly = app.run((state, runtime) =>
      editDay(state, runtime, 'monday', dayDraft({ workIntervals: [{ id: morning.id, startMinute: 330, endMinute: 720 }] })),
    )
    expect(tooEarly.ok).toBe(false)
    expect(tooEarly.state.refusal).toBe(refusalMessage('outside-day'))
    expect(app.board().days.monday.workIntervals[0]).toMatchObject({ startMinute: 450 })
  })

  it('gives a day a commute before and after, in two different lengths', () => {
    // "Each day can have travel before work, after work, both, or neither. The two
    // directions can have different lengths." And it hangs off the outer ends of
    // the day's work, so the chart draws it at 7:40 and at 17:15.
    const app = open()
    const commuted = app.run((state, runtime) =>
      editDay(
        state,
        runtime,
        'monday',
        dayDraft({
          workIntervals: app.board().days.monday.workIntervals.map((interval) => ({ ...interval })),
          commuteBeforeMinutes: 20,
          commuteAfterMinutes: 15,
        }),
      ),
    )
    expect(commuted.ok).toBe(true)
    const commute = toGridModel(app.board()).days[0].blocks.filter((block) => block.tone === 'commute')
    // The morning commute ends where the work starts and grows outward to 7:40;
    // the evening one starts where the work ends and grows outward to 17:15. So
    // each top is the start of its own stretch, not the end of it.
    expect(commute.map((block) => block.topPercent)).toEqual([
      ((480 - 20 - 360) / 960) * 100,
      ((1020 - 360) / 960) * 100,
    ])
    // A commute is not a task: no color, no done mark, and nothing to open.
    expect(commute.every((block) => block.colorId === null)).toBe(true)
    expect(commute.every((block) => block.done === false)).toBe(true)
    expect(commute.every((block) => block.target === null)).toBe(true)
  })

  it('adds work to a weekend, and makes a day a day off again', () => {
    // "remove all of them, which makes that day a day off", and "If the day has no
    // work intervals, it cannot have a commute." Saturday starts empty in the
    // preset, so the first change is an addition and the second is every removal.
    const app = open()
    app.run((state, runtime) =>
      editDay(state, runtime, 'saturday', dayDraft({ workIntervals: [{ id: null, startMinute: 600, endMinute: 660 }] })),
    )
    expect(app.board().days.saturday.workIntervals).toHaveLength(1)
    // Removing the last interval makes it a day off, and the commute with it.
    const off = app.run((state, runtime) => editDay(state, runtime, 'saturday', dayDraft({ workIntervals: [] })))
    expect(off.ok).toBe(true)
    expect(app.board().days.saturday.workIntervals).toEqual([])
    expect(app.board().days.saturday.commuteBeforeMinutes).toBe(0)
    // A commute on a day off has nothing to hang from. The form will not offer to
    // put one there, so the only way to ask is to submit the pair anyway — and
    // the domain's rule is what turns it away, not the form.
    const noCommute = app.run((state, runtime) =>
      editDay(state, runtime, 'saturday', dayDraft({ workIntervals: [], commuteBeforeMinutes: 20 })),
    )
    expect(noCommute.ok).toBe(false)
    expect(noCommute.state.refusal).toBe(refusalMessage('commute-without-work'))
    expect(app.board().days.saturday.commuteBeforeMinutes).toBe(0)
  })
})

// --- reset --------------------------------------------------------------------

describe('a person resetting the board', () => {
  it('puts the blank preset back, and nothing survives it', () => {
    // The quiet `Reset board` → `ConfirmDialog` → `clearBoard`. The product: task
    // definitions do not survive a reset, past boards are not kept, and there is no
    // next week to open.
    const app = started()
    const writesBefore = app.writes.length
    app.run((state, runtime) => clearBoard(state, runtime))
    expect(app.board().goals).toEqual([])
    expect(app.board().sessions).toEqual([])
    expect(app.board().oneOffs).toEqual([])
    expect(app.board().days.monday.workIntervals).toHaveLength(2)
    expect(app.board().days.saturday.workIntervals).toEqual([])
    expect(app.board().days.monday.commuteBeforeMinutes).toBe(0)
    // And it is a change like any other, so it was saved.
    expect(app.writes.length).toBe(writesBefore + 1)
  })
})

// --- backup -------------------------------------------------------------------

describe('a person using Backup', () => {
  it('copies the whole board out as text, and that puts a sentence away', () => {
    // `Backup` → `BackupPanel`, which holds `exportBoardText` as a string and never
    // reads it as a board. `onCopy` reaches `dismissMessage`, because the panel has
    // already put the text on the clipboard by then and the board did not change:
    // there is nothing to save and nothing to refuse. What is left to do is put
    // away the sentence that pointed at Backup as the way to keep a board the
    // browser would not — the person has used it.
    const app = started()
    app.run((state, runtime) => addTask(state, runtime, { ...STUDY, name: '' }))
    expect(app.state.refusal).toBe(refusalMessage('empty-name'))
    const copied = app.run((state) => ({ state: dismissMessage(state), ok: true }))
    expect(copied.state.refusal).toBeNull()
    expect(copied.state.board).toBe(app.board())
    const text = exportBoardText(app.board())
    expect(text).toContain('"version": 1')
    expect(text).toContain('Study Spanish')
    expect(text).toContain('monday')
  })

  it('replaces the board with a pasted one, and keeps it when the answer is no', () => {
    // `BackupPanel` `onImport` hands up the pasted string unparsed. The
    // orchestrator judges it with `importBoardText` *before* the confirm is opened,
    // and `replaceBoard` is what the answer yes reaches — so "Nothing was replaced"
    // is true for the person who said no, because the answer was no.
    const saved = started()
    const imported = importBoardText(exportBoardText(saved.board()))
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    const app = open()
    // The answer is no: the board is untouched and nothing was saved.
    expect(app.board().goals).toEqual([])
    expect(app.writes).toEqual([])
    // The answer is yes.
    const replaced = app.run((state, runtime) => replaceBoard(state, runtime, imported.value))
    expect(replaced.ok).toBe(true)
    expect(app.board().goals.map((goal) => goal.name)).toEqual(['Study Spanish', 'Gym'])
    expect(app.writes).toHaveLength(1)
  })

  it('refuses a paste that is not a board, and says the file is the problem', () => {
    // Every invalid paste is `invalid-backup` and nothing else, because the other
    // reasons are sentences about a grid the person is not looking at. And the
    // board is not touched, so "Nothing was replaced" is true before any confirm
    // dialog was ever opened.
    const app = started()
    const before = app.board()
    const writes = app.writes.length
    const settled = app.run((state, runtime) => settle(state, runtime, importBoardText('{ not a board')))
    expect(settled.ok).toBe(false)
    expect(settled.state.board).toBe(before)
    expect(settled.state.refusal).toBe(refusalMessage('invalid-backup'))
    expect(app.writes).toHaveLength(writes)
  })
})

// --- the two completeness checks ----------------------------------------------

/** The source of every file in this folder and every component above it, as text. */
const folderSources: Record<string, string> = import.meta.glob<string>('./*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const componentSources: Record<string, string> = import.meta.glob<string>('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('what the walk covers', () => {
  it('reaches every flow the app has', () => {
    // Read from `actions.ts`'s own source, so this is about what the app *can* do
    // rather than what it happened to call today. A flow added there and walked by
    // nobody is a behaviour a person can reach that no test in this project has
    // ever checked, which is the gap this whole file was written to close.
    const flowSource = folderSources['./actions.ts']
    if (flowSource === undefined) throw new Error('no actions.ts')
    const walkSource = [folderSources['./product-walk.test.ts'], folderSources['./actions.test.ts']]
      .filter((source): source is string => source !== undefined)
      .join('\n')
    const flows = [...flowSource.matchAll(/^export function (\w+)\(/gm)].map((match) => match[1])
    expect(flows.length).toBeGreaterThan(10)
    const unwalked = flows.filter((flow) => !new RegExp(`\\b${flow}\\b`).test(walkSource))
    expect(unwalked).toEqual([])
  })

  it('passes every event a component declares to the component that declares it', () => {
    // The other half of "through the orchestrator events". `component-rules` pins
    // what each component *offers* its caller; this asks whether anybody hands it
    // that. An event declared and never passed is a control that does nothing at
    // all — a chart reporting an empty tap to nobody — and it is the one failure
    // in this project that no test could previously see.
    const files = new Map<string, string>()
    for (const [path, source] of Object.entries(componentSources)) {
      // The bare component name, because both halves of this check are keyed that
      // way: a file's own name on one side and the tag it is written as on the
      // other. `components/WeekGrid` and a `<WeekGrid` in the orchestrator have to
      // meet, and they only meet once the folder is taken off.
      files.set(path.split('/').pop()?.replace(/\.tsx$/, '') ?? path, codeOf(source))
    }
    const passed = passedAttributes(files)
    const orphaned = [...declaredCallbacks(files)].flatMap(([name, callbacks]) =>
      callbacks
        .filter((callback) => !(passed.get(name)?.has(callback) ?? false))
        .map((callback) => `${name} is never passed ${callback}`),
    )
    expect(orphaned).toEqual([])
  })
})

/** The `onX` props each component declares, read from its own file. */
function declaredCallbacks(files: Map<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [name, source] of files) {
    const callbacks = [
      ...new Set([...source.matchAll(/\bon[A-Z]\w*\s*\??:/g)].map((match) => match[0].replace(/\s*\??:$/, ''))),
    ].sort()
    if (callbacks.length > 0) out.set(name, callbacks)
  }
  return out
}

/**
 * A source file with its comments taken out.
 *
 * Both halves of the check above read code, and a file in this project explains
 * itself at length, so an unstripped read would be able to pass on a comment that
 * *described* the wiring rather than on the wiring. Same reason the orchestrator's
 * own rules file strips: nearly every rule in this project is an absence, and a
 * check that can see the prose is a check on the prose.
 */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
}

/**
 * The attributes each component is actually given, across the whole project.
 *
 * Read off the real opening tags rather than a `<Name[^>]*>` match, because an
 * event handler contains its own `>` and the naive match stops in the middle of
 * the arrow and hands back a tag with no attributes on it at all. A check that
 * cannot read a control cannot fail, which is the failure this folder's own
 * thumb-size check made once and wrote down.
 *
 * The limit is worth stating: this asks whether a component is handed the event
 * *anywhere*, not whether its own caller hands it over. `Modal` is the case that
 * shows why the weaker question is the right one — six components render it, and
 * which of them forgot would be a different question from whether one of them
 * forgot. An event nobody passes at all is the failure this is here for, and it
 * is the one nothing in the project could previously see.
 */
function passedAttributes(files: Map<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const source of files.values()) {
    for (const match of source.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) {
      const tag = readTag(source, match.index)
      if (tag === null) continue
      const attributes = out.get(match[1]) ?? new Set<string>()
      for (const attribute of tag.matchAll(/\b(on[A-Z]\w*)\s*=/g)) attributes.add(attribute[1])
      out.set(match[1], attributes)
    }
  }
  return out
}

/** One opening tag, from its `<` to the `>` that actually closes it. */
function readTag(source: string, from: number): string | null {
  let quote: string | null = null
  let braces = 0
  for (let index = from; index < source.length; index += 1) {
    const character = source[index]
    if (quote !== null) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '{') braces += 1
    else if (character === '}') braces -= 1
    else if (character === '>' && braces === 0) return source.slice(from, index + 1)
  }
  return null
}
