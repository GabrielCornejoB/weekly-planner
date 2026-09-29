/**
 * A placed block of a task: where it is, how long it is, and whether it is done.
 *
 * There is no name and no color here, and that is not an omission. Both live on
 * the task rather than on the block, which is the reason renaming a task
 * renames every block of it without anything having to visit them. Editing a
 * block changes only what belongs to the block: the day, the time, the activity
 * length, and the travel.
 *
 * It holds the draft and hands all of it up. It saves nothing, refuses nothing,
 * and asks nothing — deleting a block is a button that emits, and the person
 * who presses it is saying it plainly rather than confirming a dialog over one
 * block, which is the distinction the product draws between a block and a whole
 * task.
 *
 * Decisions recorded here:
 *
 * - **The draft carries the minute a resize reports, and not the length.** The
 *   domain's resize takes one end of the *activity*, so the form hands up where
 *   that end now is, worked out from the three numbers the person actually
 *   typed. Adding them here rather than in the orchestrator is deliberate: these
 *   are three fields of one form, and a length has to become a position before
 *   it can be an edge.
 * - **That end is worked out against the travel in this same draft**, which fixes
 *   the order the three changes have to be applied in — travel before the
 *   resize, since the domain measures the activity from the end of the travel
 *   that is on the block at the time. The note is here rather than only in the
 *   orchestrator because it is a property of the draft, not of the caller.
 * - **Marking done is a button of its own, not a checkbox in a form that has
 *   then to be saved.** Ticking a block off is the thing a person does most
 *   often in this app, and on a phone it should be one tap rather than two. It
 *   emits and lets the orchestrator decide what happens to the editor.
 * - **Nothing about the task is shown or asked**, so a block cannot be edited
 *   into a state where its name disagrees with its task's.
 */

import { useState } from 'react'

import type { Session } from '@/domain/types'

import { BlockFields, type BlockPlacement } from './BlockFields'
import type { DayOption } from './DaySelect'
import { Modal } from './Modal'

/**
 * What this form hands up.
 *
 * The four numbers the three changes need, and nothing else: the day and the
 * first minute for a move, the end of the activity for a resize, and the travel
 * on either side. The activity length is not repeated here because it is already
 * implied by the first minute, the travel, and the end — and one copy of a fact
 * is one that cannot be edited out of step with the others.
 */
export interface SessionDraft {
  day: Session['day']
  /** The block's first occupied minute, travel included. */
  startMinute: number
  /** Where the activity ends: the edge a resize reports. */
  activityEndMinute: number
  travel: Session['travel']
}

export interface SessionEditorProps {
  /** The block being edited, as the board holds it. */
  session: Session
  dayOptions: readonly DayOption[]
  onSubmit: (draft: SessionDraft) => void
  onCancel: () => void
  /** Mark it done, or not done again. One tap, and no save. */
  onSetDone: (done: boolean) => void
  /** Delete this block. It is a button, not a confirmation. */
  onDelete: () => void
}

export function SessionEditor({
  session,
  dayOptions,
  onSubmit,
  onCancel,
  onSetDone,
  onDelete,
}: SessionEditorProps) {
  const [placement, setPlacement] = useState<BlockPlacement>(() => ({
    day: session.day,
    startMinute: session.startMinute,
    activityMinutes: session.activityMinutes,
    travel: { ...session.travel },
  }))

  return (
    <Modal title="Edit block" onClose={onCancel}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit({
            day: placement.day,
            startMinute: placement.startMinute,
            // Measured against the travel in this draft, so the three changes
            // land in the order the domain needs: move, then travel, then the
            // edge that is measured from the end of that travel.
            activityEndMinute:
              placement.startMinute + placement.travel.beforeMinutes + placement.activityMinutes,
            travel: { ...placement.travel },
          })
        }}
      >
        <BlockFields
          placement={placement}
          dayOptions={dayOptions}
          onChange={(change) => setPlacement((held) => ({ ...held, ...change }))}
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSetDone(!session.done)}
            className="min-h-11 rounded-lg border border-stone-300 px-3 text-sm text-stone-700"
          >
            {session.done ? 'Mark not done' : 'Mark done'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="min-h-11 rounded-lg border border-stone-300 px-3 text-sm text-stone-700"
          >
            Delete block
          </button>
        </div>

        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-stone-300 px-4 text-sm text-stone-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white"
          >
            Save block
          </button>
        </div>
      </form>
    </Modal>
  )
}
