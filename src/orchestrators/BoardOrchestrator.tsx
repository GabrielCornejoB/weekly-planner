/**
 * The one component that knows the whole board.
 *
 * It holds the board, the open dialog, and the one task armed for placing, and
 * it is the only place in the app that knows which of those three is true. It
 * calculates nothing about the week: the two view models it draws arrive from
 * `view.ts` as whole values, every sentence on screen was written in
 * `refusal.ts` or `progress.ts` and is handed down finished, and every change
 * goes out through a flow in `actions.ts` rather than through a mutation here.
 * There is no geometry in this file, no comparison of two minutes, and no rule of
 * any kind — which is what makes it an orchestrator rather than a second place
 * to be wrong.
 *
 * Everything it *does* is wiring, and that is the whole of the plan's division of
 * labour: a dumb component renders and emits, and this one listens and acts.
 *
 * Decisions recorded here:
 *
 * - **The kinds of state are kept apart, and two of them must not survive a
 *   reload.** The board, the refusal, and the storage notice live in one state
 *   object because the door writes all three together and nothing should be able
 *   to save a board while showing a sentence about an older one. The open dialog,
 *   the armed task, and the "tap a slot for a new event" step are separate,
 *   because they are about this moment and not about the week: a reload drops
 *   them, which is right, and folding them into the board's state would make them
 *   savable.
 * - **A dialog is put away by what it produced, not by a timer.** A form closes
 *   when its edit is on the board and stays up when none of it is, so a name that
 *   was refused is still in the box it was typed in, and a half-applied edit
 *   never leaves a form showing values the board has already replaced. That is why
 *   a flow answers with whether the board changed rather than whether every part
 *   of the change landed.
 * - **A block is tapped open; it is not marked done from the chart.** Ticking
 *   something off is the commonest thing a person does with this app, so it is a
 *   button of its own inside the editor with no save: one tap rather than two, and
 *   the editor stays open so the mark can be taken straight back off.
 * - **"Add event" is a step, not a dialog.** The product's own sequence is to add
 *   an event, tap a slot, and submit the form, so the button arms that and says so
 *   in a line with a way out of it. The alternative — a form opened at midnight,
 *   because there was no slot to open it at — is a first impression of a field
 *   that is already wrong.
 * - **The dialog holds ids and a slot, never a block, a name, or a sentence.**
 *   So a dialog can never show a version of the week that the board has moved on
 *   from, and the one thing it carries that is not an id — the imported board —
 *   is the board itself, because a backup has to be held whole until the person
 *   says yes.
 * - **The id source and the storage are read once, here.** Everything below is
 *   handed them, so the preset, a new block, a new task, and a new event all come
 *   from one counter and no two things on a board can share an id.
 * - **The page is a shell, not a layout decision.** Phone-first, with the chart,
 *   the quiet controls, and the list all on screen at once, because the list has
 *   to be reachable without opening a menu. How wide a screen is allowed to be is
 *   the next task's question, and nothing above this file depends on the answer.
 */

import { useMemo, useState, type ReactNode } from 'react'

import { nextColorId } from '@/colors/palette'
import { BackupPanel } from '@/components/BackupPanel'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DayEditor } from '@/components/DayEditor'
import { GoalForm } from '@/components/GoalForm'
import { OneOffForm } from '@/components/OneOffForm'
import { RefusalBanner } from '@/components/RefusalBanner'
import { SessionEditor } from '@/components/SessionEditor'
import { TaskList } from '@/components/TaskList'
import { WeekGrid } from '@/components/WeekGrid'
import { findGoal } from '@/domain/goals'
import { findOneOff, findSession } from '@/domain/sessions'
import { findWorkDay } from '@/domain/work'
import type { Board, DayId, ResizeEdge } from '@/domain/types'
import { DAY_OPTIONS, toGridModel, toTaskListModel, type BlockTarget } from '@/domain/view'
import { exportBoardText, importBoardText } from '@/persistence/transfer'
import type { BoardStorage } from '@/persistence/storage'
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

/**
 * Which dialog is open, and what it needs to be open.
 *
 * A discriminated union rather than one shape with three optional fields, so the
 * illegal combinations do not type-check: there is no reset that names a task, no
 * delete with nothing to delete, and no one-off form without the slot it was
 * opened on. The plan asks for exactly this, and it is why the three
 * confirmations cannot drift into sharing a field that means nothing for them.
 */
type Dialog =
  | { type: 'none' }
  | { type: 'confirm'; action: 'reset' }
  | { type: 'confirm'; action: 'delete-goal'; goalId: string }
  | { type: 'confirm'; action: 'import'; board: Board }
  | { type: 'goal-form'; mode: 'create' }
  | { type: 'goal-form'; mode: 'edit'; goalId: string }
  | { type: 'one-off-form'; mode: 'create'; day: DayId; startMinute: number }
  | { type: 'one-off-form'; mode: 'edit'; oneOffId: string }
  | { type: 'day-editor'; day: DayId }
  | { type: 'session-editor'; sessionId: string }
  | { type: 'backup' }

/** No dialog. Written once, so putting a dialog away is one word everywhere. */
const CLOSED: Dialog = { type: 'none' }

/** The one quiet button, for the two controls that sit below the chart. */
const QUIET = 'min-h-11 rounded-lg border border-stone-300 px-3 text-sm text-stone-700'

/**
 * The seven day names, looked up rather than spelled out here.
 *
 * `DAY_OPTIONS` is imported because a component may not read the day names for
 * itself, and every day is one of the seven, so the lookup always answers. The
 * fallback is the id, which is a fact of the type rather than a thing anybody
 * should ever see on a dialog.
 */
const DAY_NAMES = new Map(DAY_OPTIONS.map((option) => [option.day, option.label]))

function dayName(day: DayId): string {
  return DAY_NAMES.get(day) ?? day
}

/**
 * The one id source in the app.
 *
 * Nothing else mints an id. The preset spends the first ten, and every block,
 * task, and event after that comes from here, so two things on a board can never
 * be handed the same id and a lookup by id always finds the one thing meant.
 */
function newId(): string {
  return crypto.randomUUID()
}

/**
 * `window` is reached here and nowhere else in the app.
 *
 * `loadBoard` and `saveBoard` are handed a storage object rather than reaching
 * for one, so this is the only line that knows the document exists. It is a
 * function rather than a module-level constant because a browser that refuses to
 * hand over `localStorage` should fail when the app asks for it, not while its
 * first file is still being parsed.
 *
 * The refusal is caught here rather than thrown at React, because an app that
 * cannot store anything is still a usable week. A read comes back as "no board
 * here", the preset opens, and every save is refused with the sentence that points
 * at Backup — which are the two paths `loadBoard` and `saveBoard` already handle,
 * so nothing below has to know which storage object it was handed.
 */
function appStorage(): BoardStorage {
  try {
    return window.localStorage
  } catch {
    return {
      getItem: () => null,
      setItem: () => {
        throw new Error('this browser is not storing anything')
      },
    }
  }
}

function appRuntime(): Runtime {
  return { createId: newId, storage: appStorage() }
}

/**
 * The two callbacks a new event cannot act on.
 *
 * `OneOffForm` hides its *Mark done* and *Delete event* buttons when there is no
 * event yet, so nothing can reach these. The props are still required, because a
 * form is handed both of them however it is opened and it is the form — which
 * knows whether there is an event yet — that decides whether there is anything for
 * them to do.
 *
 * Naming them rather than writing two arrow functions inline is the point: a form
 * that later grew a button in this mode would then be a button wired to a
 * function whose name says there is nothing to do, which is a question to answer
 * rather than a bug to find. It does nothing rather than throwing, because a
 * dead button is a smaller fault than a crashed app.
 */
function noEventYet(): void {
  // There is no id yet, so there is nothing to mark done and nothing to delete.
}

export function BoardOrchestrator() {
  // One runtime for the life of the app: the storage object and the id source.
  // `useState` rather than a module constant, and the initializer is pure, so
  // React's double call in development costs a read of storage and nothing else.
  const [runtime] = useState<Runtime>(appRuntime)
  const [state, setState] = useState<BoardState>(() => initialState(runtime))
  const [dialog, setDialog] = useState<Dialog>(CLOSED)
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null)
  const [placingOneOff, setPlacingOneOff] = useState(false)

  // The two models are functions of the board and nothing else, so this is the
  // whole of what drawing them costs: the chart and the list cannot disagree with
  // each other or with the board, because there is one board and one render.
  const grid = useMemo(() => toGridModel(state.board), [state.board])
  const rows = useMemo(() => toTaskListModel(state.board), [state.board])

  /**
   * Hand a dialog's draft to its flow, and put the dialog away if it landed.
   *
   * The closing is decided by the flow rather than by the handler, because only
   * the flow knows whether anything reached the board. A refused draft leaves the
   * form open with everything still typed into it, which is the whole point of a
   * form holding a draft rather than the fields being read on submit.
   */
  function submit(flow: Settled): void {
    setState(flow.state)
    if (flow.ok) setDialog(CLOSED)
  }

  // --- the chart ------------------------------------------------------------

  /**
   * A finger on free time.
   *
   * Two things can want that tap and the more specific one wins: a new event
   * waiting for a slot, or the task armed in the list. With neither armed the tap
   * is nothing, because there is no such thing as placing nothing — and the list
   * says what to do about it, in the row the person tapped `Place on chart` from.
   */
  function onEmptyTap(day: DayId, minute: number): void {
    if (placingOneOff) {
      setPlacingOneOff(false)
      setDialog({ type: 'one-off-form', mode: 'create', day, startMinute: minute })
      return
    }
    if (selectedGoalId === null) return
    setState(placeGoal(state, runtime, selectedGoalId, day, minute).state)
  }

  /**
   * A block was tapped rather than dragged.
   *
   * Work opens the day editor, because a work interval has no editor of its own:
   * its commute, its length, and whether the day has work at all are one day's
   * question. A travel strip reports the block behind it, so the editor that opens
   * is the person's own block rather than five minutes of journey.
   *
   * A block the board no longer holds opens nothing. It cannot happen from a tap
   * on a block the chart has just drawn, so there is no sentence to give: the
   * person tapped something real a moment ago, and the honest answer to a dialog
   * with nothing to edit is no dialog.
   */
  function onBlockTap(target: BlockTarget): void {
    switch (target.kind) {
      case 'work': {
        const day = findWorkDay(state.board, target.id)
        if (day !== null) setDialog({ type: 'day-editor', day })
        return
      }
      case 'session':
        if (findSession(state.board, target.id) !== null) {
          setDialog({ type: 'session-editor', sessionId: target.id })
        }
        return
      case 'one-off':
        if (findOneOff(state.board, target.id) !== null) {
          setDialog({ type: 'one-off-form', mode: 'edit', oneOffId: target.id })
        }
    }
  }

  /** A drop and a resize, both already snapped and both already reported. */
  function onBlockDrop(target: BlockTarget, day: DayId, minute: number): void {
    setState(dropBlock(state, runtime, target, day, minute).state)
  }

  function onBlockResize(target: BlockTarget, edge: ResizeEdge, minute: number): void {
    setState(resizeBlock(state, runtime, target, edge, minute).state)
  }

  function onDayHeaderTap(day: DayId): void {
    setDialog({ type: 'day-editor', day })
  }

  // --- the list -------------------------------------------------------------

  /**
   * Arm a task for placing, or put it away.
   *
   * A toggle, because placing two blocks of one task is ordinary and arming it
   * again for each would be a tap nobody asked for. The armed task is not the
   * board's state and is not saved: a reload should not leave a task armed for a
   * gesture that has not been made.
   */
  function onSelectGoal(id: string): void {
    setSelectedGoalId((current) => (current === id ? null : id))
    setPlacingOneOff(false)
  }

  /**
   * Add an event: the first half of "add an event, tap a slot, submit the form".
   *
   * Nothing opens yet, because there is no slot to open it at, and a form pointed
   * at midnight is a form whose first field is already wrong. The line that
   * appears above the chart says what the next tap is for and offers a way out of
   * it, so a button never leads nowhere.
   */
  function onAddOneOff(): void {
    setPlacingOneOff(true)
    setSelectedGoalId(null)
  }

  function onAddGoal(): void {
    setDialog({ type: 'goal-form', mode: 'create' })
  }

  function onEditGoal(id: string): void {
    setDialog({ type: 'goal-form', mode: 'edit', goalId: id })
  }

  function onEditOneOff(id: string): void {
    setDialog({ type: 'one-off-form', mode: 'edit', oneOffId: id })
  }

  /**
   * Deleting a whole task asks first, and this is only the asking.
   *
   * The question names the task, because "Delete this task?" on a list of seven
   * is a question about a finger. Deleting one block does not come through here:
   * the editors carry a delete button of their own, which is the distinction the
   * product draws between a block and a task.
   */
  function onDeleteGoal(id: string): void {
    setDialog({ type: 'confirm', action: 'delete-goal', goalId: id })
  }

  // --- the three things that throw something away ---------------------------

  function onConfirm(): void {
    if (dialog.type !== 'confirm') return
    if (dialog.action === 'reset') {
      // Nothing survives a reset, and a task that was armed is one of the things
      // that does not: the id it held is one the new board will never have.
      setSelectedGoalId(null)
      setPlacingOneOff(false)
      setState(clearBoard(state, runtime).state)
      setDialog(CLOSED)
      return
    }
    if (dialog.action === 'delete-goal') {
      if (selectedGoalId === dialog.goalId) setSelectedGoalId(null)
      setState(deleteTask(state, runtime, dialog.goalId).state)
      setDialog(CLOSED)
      return
    }
    // The pasted board carries its own ids, so anything armed or waiting for a
    // slot here is stale, and the board itself is only replaced because the
    // person said yes.
    setSelectedGoalId(null)
    setPlacingOneOff(false)
    setState(replaceBoard(state, runtime, dialog.board).state)
    setDialog(CLOSED)
  }

  function onCancelConfirm(): void {
    setDialog(CLOSED)
  }

  // --- backup ---------------------------------------------------------------

  /**
   * A paste has been read as text and nowhere else.
   *
   * A refusal is settled like any other refusal, which shows the sentence and
   * leaves the board exactly as it was: that is what "Nothing was replaced" means,
   * and it is just as true of a file that was not a board as of a person who
   * changed their mind. A board that *is* one is not settled here — replacing the
   * week is asked for first, and the question is only worth asking of something
   * that has already been judged.
   */
  function onImport(raw: string): void {
    const imported = importBoardText(raw)
    if (!imported.ok) {
      setState(settle(state, runtime, imported).state)
      return
    }
    setDialog({ type: 'confirm', action: 'import', board: imported.value })
  }

  /**
   * The copy is the notice's answer.
   *
   * The panel has already put the text on the clipboard by the time it emits this,
   * and the board did not change, so there is nothing to save and nothing to
   * refuse. What is left is to put away the sentence that pointed at Backup as
   * the way to keep a board the browser would not: the person has used it.
   */
  function onCopy(): void {
    setState(dismissMessage(state))
  }

  // --- the dialogs ----------------------------------------------------------

  /**
   * The open dialog, or nothing.
   *
   * One function rather than eleven `useState`s and eleven conditionals in the
   * page, and it is where the plan's three confirmations live: each one is handed
   * a title, a message, and two labels, and none of them is told what it is
   * confirming. The two editors that need a block look it up here, so a dialog
   * cannot show a block the board has since replaced — and if the lookup comes
   * back empty the dialog is not rendered at all, which is the one honest answer
   * to being asked to edit something that is not there.
   */
  function openDialog(): ReactNode {
    switch (dialog.type) {
      case 'none':
        return null
      case 'confirm': {
        if (dialog.action === 'reset') {
          return (
            <ConfirmDialog
              title="Reset the board"
              message="Clear the whole board and go back to the empty week?"
              confirmLabel="Clear the whole board"
              cancelLabel="Keep this board"
              onConfirm={onConfirm}
              onCancel={onCancelConfirm}
            />
          )
        }
        if (dialog.action === 'delete-goal') {
          // The name is read from the board rather than copied into the dialog,
          // so a dialog is never holding a second version of a task.
          const name = findGoal(state.board, dialog.goalId)?.name ?? 'This task'
          return (
            <ConfirmDialog
              title={`Delete ${name}`}
              message={`${name} and every block of it will be removed. This cannot be undone.`}
              confirmLabel="Delete task"
              cancelLabel="Keep task"
              onConfirm={onConfirm}
              onCancel={onCancelConfirm}
            />
          )
        }
        return (
          <ConfirmDialog
            title="Replace the board"
            message="Replace the current board with this backup? The current plan will be discarded."
            confirmLabel="Replace the board"
            cancelLabel="Keep this board"
            onConfirm={onConfirm}
            onCancel={onCancelConfirm}
          />
        )
      }
      case 'goal-form': {
        const goal = dialog.mode === 'edit' ? findGoal(state.board, dialog.goalId) : null
        if (dialog.mode === 'edit' && goal === null) return null
        return (
          <GoalForm
            goal={goal}
            // Only read for a new task, which is the only case the form has a
            // color field to put it in; the task being edited already has one.
            newGoalColorId={goal?.colorId ?? nextColorId(usedColorIds(state.board))}
            onSubmit={(draft) =>
              submit(
                goal === null
                  ? addTask(state, runtime, draft)
                  : editTask(state, runtime, goal.id, draft),
              )
            }
            onCancel={onCancelConfirm}
          />
        )
      }
      case 'one-off-form': {
        if (dialog.mode === 'create') {
          return (
            <OneOffForm
              oneOff={null}
              slot={{ day: dialog.day, startMinute: dialog.startMinute }}
              newOneOffColorId={nextColorId(usedColorIds(state.board))}
              dayOptions={DAY_OPTIONS}
              onSubmit={(edit) => submit(addOneOff(state, runtime, edit))}
              onCancel={onCancelConfirm}
              onSetDone={noEventYet}
              onDelete={noEventYet}
            />
          )
        }
        const oneOff = findOneOff(state.board, dialog.oneOffId)
        if (oneOff === null) return null
        return (
          <OneOffForm
            oneOff={oneOff}
            slot={null}
            newOneOffColorId={oneOff.colorId}
            dayOptions={DAY_OPTIONS}
            onSubmit={(edit) => submit(editOneOff(state, runtime, oneOff.id, edit))}
            onCancel={onCancelConfirm}
            onSetDone={(done) => setState(markBlockDone(state, runtime, { kind: 'one-off', id: oneOff.id }, done).state)}
            onDelete={() => submit(deleteBlock(state, runtime, { kind: 'one-off', id: oneOff.id }))}
          />
        )
      }
      case 'day-editor':
        return (
          <DayEditor
            dayLabel={dayName(dialog.day)}
            plan={state.board.days[dialog.day]}
            onSubmit={(draft) => submit(editDay(state, runtime, dialog.day, draft))}
            onCancel={onCancelConfirm}
          />
        )
      case 'session-editor': {
        const session = findSession(state.board, dialog.sessionId)
        if (session === null) return null
        return (
          <SessionEditor
            session={session}
            dayOptions={DAY_OPTIONS}
            onSubmit={(draft) => submit(editSession(state, runtime, session.id, draft))}
            onCancel={onCancelConfirm}
            onSetDone={(done) => setState(markBlockDone(state, runtime, { kind: 'session', id: session.id }, done).state)}
            onDelete={() => submit(deleteBlock(state, runtime, { kind: 'session', id: session.id }))}
          />
        )
      }
      case 'backup':
        return (
          <BackupPanel
            text={exportBoardText(state.board)}
            onCopy={onCopy}
            onImport={onImport}
            onClose={onCancelConfirm}
          />
        )
    }
  }

  // --- the page -------------------------------------------------------------

  // The two sentences are never both set, so which one is on screen is which one
  // is not null. The banner shows a sentence it was given either way.
  const message = state.refusal ?? state.notice

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-3 p-3">
      <h1 className="text-lg font-semibold text-stone-900">Weekly Planner</h1>

      {message !== null && (
        <RefusalBanner message={message} onDismiss={() => setState(dismissMessage(state))} />
      )}

      {placingOneOff && (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-300 bg-stone-100 px-3 py-2 text-sm text-stone-900">
          <span>Tap a free spot on the chart to put the new event there.</span>
          <button
            type="button"
            onClick={() => setPlacingOneOff(false)}
            className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-700"
          >
            Cancel
          </button>
        </p>
      )}

      <WeekGrid
        model={grid}
        onEmptyTap={onEmptyTap}
        onBlockTap={onBlockTap}
        onBlockDrop={onBlockDrop}
        onBlockResize={onBlockResize}
        onDayHeaderTap={onDayHeaderTap}
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setDialog({ type: 'backup' })}
          className={QUIET}
        >
          Backup
        </button>
        <button
          type="button"
          onClick={() => setDialog({ type: 'confirm', action: 'reset' })}
          className={QUIET}
        >
          Reset board
        </button>
      </div>

      <TaskList
        rows={rows}
        selectedGoalId={selectedGoalId}
        onSelectGoal={onSelectGoal}
        onAddGoal={onAddGoal}
        onEditGoal={onEditGoal}
        onDeleteGoal={onDeleteGoal}
        onEditOneOff={onEditOneOff}
        onAddOneOff={onAddOneOff}
      />

      {openDialog()}
    </main>
  )
}
