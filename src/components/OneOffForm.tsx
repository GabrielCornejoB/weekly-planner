/**
 * A one-off event: a name, a color, and a place on the week.
 *
 * Where it goes and how long it is, this form shares with a block of a task —
 * the product treats the two the same way on the chart and the same way in
 * every rule, and only the name and the color are different, because those are
 * the two fields a one-off owns itself and a session does not.
 *
 * Creating one and editing one are the same form. The slot it opens on is
 * whatever the person tapped, so a new event arrives with its day and its time
 * already filled in and the form is simply the same form pointed at a block that
 * does not exist yet. That is why there is one component rather than two, and
 * why nothing here has to know which of the two it is.
 *
 * Decisions recorded here:
 *
 * - **The draft extends the domain's own one-off draft rather than restating
 *   it.** The name, color, activity length, and travel are exactly what a
 *   one-off is, and the day and the first minute are added on top because a
 *   placed event has to be somewhere. Copying the four fields into a second
 *   shape is how a form and a mutation end up disagreeing about what an event
 *   is, and this one cannot: the draft *is* the domain's type, widened.
 * - **The activity end is worked out here rather than in the orchestrator**, for
 *   the same reason `SessionEditor` does it: a resize reports an edge, an editor
 *   holds a length, and turning one into the other is a fact about this form's
 *   own three fields.
 * - **Deleting asks nothing and marking done is one tap**, exactly as it is for
 *   a block of a task. The product reserves confirmation for a whole task and
 *   the whole board, and a single event is neither. Both buttons appear only once
 *   the event exists, though: a new event has nothing to mark and nothing to
 *   delete, and offering either would be two controls that do nothing. That is
 *   why the props are still required — a form is handed both of them however it
 *   is opened, and it is the form, which knows whether there is an event yet,
 *   that decides whether there is anything for them to do.
 */

import { useState } from 'react'

import type { DayId, OneOff } from '@/domain/types'
import type { OneOffDraft } from '@/domain/view'

import { BlockFields, type BlockPlacement } from './BlockFields'
import { ColorSwatches } from './ColorSwatches'
import type { DayOption } from './DaySelect'
import { Modal } from './Modal'

/**
 * What this form hands up: the event itself, plus the slot it was put in.
 *
 * The four fields below the fold are the domain's own one-off draft, so the
 * object can be handed straight to the mutation that places an event, and the
 * two above it are the position the person tapped.
 */
export interface OneOffEdit extends OneOffDraft {
  day: DayId
  /** The block's first occupied minute, travel included. */
  startMinute: number
  /** Where the activity ends: the edge a resize reports. */
  activityEndMinute: number
}

interface OneOffFormProps {
  /** The event being edited, or `null` when the person has just tapped a slot. */
  oneOff: OneOff | null
  /** Where a new event goes: the day and minute the chart was tapped. */
  slot: { day: DayId; startMinute: number } | null
  /** The color a new event starts on. */
  newOneOffColorId: OneOff['colorId']
  dayOptions: readonly DayOption[]
  onSubmit: (draft: OneOffEdit) => void
  onCancel: () => void
  onSetDone: (done: boolean) => void
  onDelete: () => void
}

export function OneOffForm({
  oneOff,
  slot,
  newOneOffColorId,
  dayOptions,
  onSubmit,
  onCancel,
  onSetDone,
  onDelete,
}: OneOffFormProps) {
  const [name, setName] = useState(oneOff === null ? '' : oneOff.name)
  const [colorId, setColorId] = useState(oneOff === null ? newOneOffColorId : oneOff.colorId)
  const [placement, setPlacement] = useState<BlockPlacement>(() => ({
    day: oneOff?.day ?? slot?.day ?? dayOptions[0]?.day ?? 'monday',
    startMinute: oneOff?.startMinute ?? slot?.startMinute ?? 0,
    activityMinutes: oneOff?.activityMinutes ?? 60,
    travel: { ...(oneOff?.travel ?? { beforeMinutes: 0, afterMinutes: 0 }) },
  }))

  return (
    <Modal title={oneOff === null ? 'Add an event' : 'Edit event'} onClose={onCancel}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit({
            name,
            colorId,
            activityMinutes: placement.activityMinutes,
            travel: { ...placement.travel },
            day: placement.day,
            startMinute: placement.startMinute,
            activityEndMinute:
              placement.startMinute + placement.travel.beforeMinutes + placement.activityMinutes,
          })
        }}
      >
        <div>
          <label htmlFor="one-off-name" className="mb-1 block text-sm text-stone-600">
            Name
          </label>
          <input
            id="one-off-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900"
          />
        </div>

        <ColorSwatches label="Color" value={colorId} onChange={setColorId} />

        <BlockFields
          placement={placement}
          dayOptions={dayOptions}
          onChange={(change) => setPlacement((held) => ({ ...held, ...change }))}
        />

        {oneOff !== null && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSetDone(!oneOff.done)}
              className="min-h-11 rounded-lg border border-stone-300 px-3 text-sm text-stone-700"
            >
              {oneOff.done ? 'Mark not done' : 'Mark done'}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="min-h-11 rounded-lg border border-stone-300 px-3 text-sm text-stone-700"
            >
              Delete event
            </button>
          </div>
        )}

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
            {oneOff === null ? 'Add event' : 'Save event'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
