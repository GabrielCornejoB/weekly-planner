/**
 * Every task and every one-off, with what has been done of each.
 *
 * The list is the answer to "where am I", so it carries the whole of what the
 * progress module worked out rather than the pieces of it a row happens to
 * want: a goal row is handed its `GoalProgress` whole, and the sentence and the
 * status it renders cannot come from two different calculations. This component
 * does no arithmetic about the week at all. It cannot add up, cannot decide
 * whether something is finished, and cannot work out what a task's blocks are
 * called — it is handed rows and it draws them.
 *
 * The two kinds of row are different cases rather than one row with blanks. A
 * goal has a fraction, a status, and a way to be selected for placing. A one-off
 * has a day, a clock span, and a mark, and deliberately no quota and no way to
 * be selected, because selecting a task is what places that task's defaults and
 * a one-off has none.
 *
 * Decisions recorded here:
 *
 * - **Selecting is a toggle of one row, and the row says so.** `aria-pressed`
 *   says it to a screen reader and a ring says it to an eye, since the product is
 *   explicit that nothing here may be signalled by a shade alone. The person has
 *   to be able to see that a task is armed, because the very next thing they do
 *   is tap the chart and expect it to land.
 * - **A status is a stone treatment and never a hue.** A color on this screen
 *   means a task, and a person looking for the blue thing on the grid would
 *   find a sentence about how much blue is left to do. The four statuses are told
 *   apart by weight and outline instead, and each carries its word, so none of it
 *   rests on seeing a shade.
 * - **Deleting a task asks; deleting nothing here does.** A one-off row has no
 *   delete button at all, and neither has a placed block: the product makes a
 *   whole task or the whole board the thing that confirms, and the row that
 *   carries the delete button is the one the confirmation names.
 * - **The list is on screen from the first open, with nothing in front of it.**
 *   There is no menu, no disclosure, and no tab, because the product's one firm
 *   rule about the phone is that the quotas have to be reachable without guessing
 *   where they went. On a wide screen it scrolls on its own beside the chart, so a
 *   long list does not stretch the page past the week; on a phone it is simply
 *   under the chart with the page's own scroll, and bounding it there would hide
 *   the tasks below the fold behind a second scroll nobody asked for.
 */

import { PALETTE } from '@/colors/palette'
import type { ProgressStatus, TaskListRow } from '@/domain/view'

/** The small quiet button every row's actions use. */
const ACTION =
  'min-h-11 rounded-lg border border-stone-300 px-3 text-sm text-stone-700'

/** The button that adds something, which is the only filled control up here. */
const ADD = 'min-h-11 rounded-lg bg-stone-900 px-3 text-sm font-medium text-white'

/**
 * How each status looks, as a word and a treatment.
 *
 * The word is the point: the treatments are four quiet greys, and four greys
 * that close together are not something to read a week by.
 */
const STATUS: Record<ProgressStatus, { word: string; className: string }> = {
  unplaced: { word: 'Not all placed', className: 'bg-stone-900 text-white' },
  planned: { word: 'Placed', className: 'border border-stone-300 text-stone-600' },
  met: { word: 'Met', className: 'border-2 border-stone-400 text-stone-900' },
  over: { word: 'Over the goal', className: 'border border-dotted border-stone-500 text-stone-700' },
}

export interface TaskListProps {
  /** Goals first, then one-offs, in the order the board holds them. */
  rows: readonly TaskListRow[]
  /** The task armed for placing, or `null`. Selection is not board state. */
  selectedGoalId: string | null
  /** Tapping a task arms it, and tapping it again puts it away. */
  onSelectGoal: (id: string) => void
  onAddGoal: () => void
  onEditGoal: (id: string) => void
  onDeleteGoal: (id: string) => void
  onEditOneOff: (id: string) => void
  onAddOneOff: () => void
}

export function TaskList({
  rows,
  selectedGoalId,
  onSelectGoal,
  onAddGoal,
  onEditGoal,
  onDeleteGoal,
  onEditOneOff,
  onAddOneOff,
}: TaskListProps) {
  return (
    <section
      aria-label="Tasks"
      className="rounded-xl border border-stone-300 bg-white p-3 lg:max-h-[70dvh] lg:overflow-y-auto"
    >
      {/*
       * The two buttons, and the heading they sit beside.
       *
       * They wrap rather than shrink, because a two-line "Add task" is a smaller
       * target than a 44-pixel one and a person on a phone is aiming at a thumb
       * rather than reading a layout. The heading keeps its own line when they do
       * wrap, because the list's name is what a person looks for when they come
       * back to it.
       */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Tasks</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onAddOneOff} className={ADD}>
            Add event
          </button>
          <button type="button" onClick={onAddGoal} className={ADD}>
            Add task
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-sm text-stone-500">
          No tasks yet. Add one, then tap a free spot on the chart.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-stone-200">
          {rows.map((row) =>
            row.kind === 'goal' ? (
              <GoalRow
                key={row.id}
                row={row}
                selected={row.id === selectedGoalId}
                onSelectGoal={onSelectGoal}
                onEditGoal={onEditGoal}
                onDeleteGoal={onDeleteGoal}
              />
            ) : (
              <OneOffRow key={row.id} row={row} onEditOneOff={onEditOneOff} />
            ),
          )}
        </ul>
      )}
    </section>
  )
}

interface GoalRowProps {
  row: Extract<TaskListRow, { kind: 'goal' }>
  selected: boolean
  onSelectGoal: (id: string) => void
  onEditGoal: (id: string) => void
  onDeleteGoal: (id: string) => void
}

function GoalRow({ row, selected, onSelectGoal, onEditGoal, onDeleteGoal }: GoalRowProps) {
  const status = STATUS[row.progress.status]
  return (
    <li className="py-3">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={`mt-1 h-4 w-4 shrink-0 rounded ${PALETTE[row.colorId].solid}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.name}</p>
          <p className="text-sm text-stone-600">{row.progress.sentence}</p>
          <p
            className={`mt-1 inline-block rounded px-2 py-0.5 text-xs ${status.className}`}
          >
            {status.word}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelectGoal(row.id)}
          className={
            selected
              ? `${ACTION} border-2 border-stone-900 font-medium text-stone-900`
              : ACTION
          }
        >
          {selected ? 'Placing this' : 'Place on chart'}
        </button>
        <button type="button" onClick={() => onEditGoal(row.id)} className={ACTION}>
          Edit
        </button>
        <button type="button" onClick={() => onDeleteGoal(row.id)} className={ACTION}>
          Delete
        </button>
      </div>
    </li>
  )
}

interface OneOffRowProps {
  row: Extract<TaskListRow, { kind: 'one-off' }>
  onEditOneOff: (id: string) => void
}

function OneOffRow({ row, onEditOneOff }: OneOffRowProps) {
  return (
    <li className="py-3">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={`mt-1 h-4 w-4 shrink-0 rounded ${PALETTE[row.colorId].solid}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.name}</p>
          <p className="text-sm text-stone-600">
            {row.dayLabel} {row.when}
          </p>
          <p className="mt-1 inline-block rounded border border-stone-300 px-2 py-0.5 text-xs text-stone-600">
            {row.done ? 'Done' : 'Planned'}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => onEditOneOff(row.id)} className={ACTION}>
          Edit
        </button>
      </div>
    </li>
  )
}
