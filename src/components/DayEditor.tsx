/**
 * A day's work intervals and the commute that hangs off them.
 *
 * This is the editor a day header opens, and the only place in the app where
 * work is set. Work is blocked time rather than a task, so it has no name, no
 * color, and no quota anywhere on this form — just intervals, and two lengths.
 *
 * It hands up a whole day at once rather than one change at a time, and that is
 * the shape the domain already wants. A work interval and its commute are not
 * independent facts: the morning commute ends where the first work interval
 * begins, so moving that interval has to move the commute with it. A form that
 * submitted each interval separately would have to know that, and the domain
 * already does.
 *
 * Decisions recorded here:
 *
 * - **An interval keeps its id, or has none at all.** An interval that was
 *   already on this day arrives with the id it came in on, and one the person
 *   just added has no id. That single field is everything the caller needs to
 *   tell "move this one" from "add another", and it is why the form never has to
 *   guess which of two intervals is which.
 * - **Intervals are listed in the order the person put them in, and are not
 *   sorted here.** The domain keeps a day's intervals in clock order so a backup
 *   text reads the way the chart does; a form that reordered them to match would
 *   make a list jump about under the thumb while somebody is editing it.
 * - **A day with no intervals cannot show a commute, and says so instead.** Take
 *   away the last interval and the two commute fields go with it, because a
 *   commute hangs off work and there is nothing left to hang it from. The form
 *   is not making a rule here — it is refusing to submit a combination it has
 *   just put together, and the rule that says so is asked in the domain.
 * - **A new interval starts at 6:00 and lasts a quarter hour.** The two smallest
 *   legal values, where the day begins, so the pair is as close to legal as a
 *   blank form can get and the first refusal the person meets is about where
 *   they put it rather than about a number they never chose.
 */

import { useState } from 'react'

import { DAY_START_MINUTE, MIN_WORK_MINUTES, type DayPlan } from '@/domain/types'

import { DurationInput } from './DurationInput'
import { Modal } from './Modal'
import { TimeInput } from './TimeInput'

/**
 * One work interval as the form holds it.
 *
 * `id` is the interval that is already on this day, or `null` for one the person
 * has just added — the difference between moving something and creating it.
 */
export interface WorkDraft {
  id: string | null
  startMinute: number
  endMinute: number
}

/** The whole day, as this form hands it up. */
export interface DayDraft {
  workIntervals: WorkDraft[]
  commuteBeforeMinutes: number
  commuteAfterMinutes: number
}

const REMOVE =
  'min-h-11 rounded-lg border border-stone-300 px-3 text-sm text-stone-700'

interface DayEditorProps {
  /** The day as its column header spells it. */
  dayLabel: string
  plan: DayPlan
  onSubmit: (draft: DayDraft) => void
  onCancel: () => void
}

export function DayEditor({ dayLabel, plan, onSubmit, onCancel }: DayEditorProps) {
  const [intervals, setIntervals] = useState<WorkDraft[]>(() =>
    plan.workIntervals.map((interval) => ({
      id: interval.id,
      startMinute: interval.startMinute,
      endMinute: interval.endMinute,
    })),
  )
  const [before, setBefore] = useState(plan.commuteBeforeMinutes)
  const [after, setAfter] = useState(plan.commuteAfterMinutes)

  const isDayOff = intervals.length === 0

  function edit(at: number, change: Partial<WorkDraft>) {
    setIntervals((held) => held.map((interval, index) => (index === at ? { ...interval, ...change } : interval)))
  }

  function add() {
    setIntervals((held) => [
      ...held,
      { id: null, startMinute: DAY_START_MINUTE, endMinute: DAY_START_MINUTE + MIN_WORK_MINUTES },
    ])
  }

  function remove(at: number) {
    setIntervals((held) => held.filter((_, index) => index !== at))
  }

  return (
    <Modal title={`${dayLabel} work and travel`} onClose={onCancel}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit({
            workIntervals: intervals.map((interval) => ({ ...interval })),
            // A day off carries no commute, and the form will not offer to put
            // one there. The rule that says so is the domain's; this only avoids
            // submitting the pair that rule refuses.
            commuteBeforeMinutes: isDayOff ? 0 : before,
            commuteAfterMinutes: isDayOff ? 0 : after,
          })
        }}
      >
        {isDayOff ? (
          <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">
            No work on this day, so no commute either. This is a day off.
          </p>
        ) : (
          intervals.map((interval, at) => (
            <fieldset key={interval.id ?? `new-${at}`} className="rounded-lg border border-stone-200 p-2">
              <legend className="px-1 text-xs text-stone-500">
                {interval.id === null ? 'New interval' : 'Interval'}
              </legend>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-24 flex-1">
                  <TimeInput
                    label="Start"
                    minute={interval.startMinute}
                    onChange={(startMinute) => edit(at, { startMinute })}
                  />
                </div>
                <div className="min-w-24 flex-1">
                  <TimeInput
                    label="End"
                    minute={interval.endMinute}
                    onChange={(endMinute) => edit(at, { endMinute })}
                  />
                </div>
                <button type="button" onClick={() => remove(at)} className={REMOVE}>
                  Remove
                </button>
              </div>
            </fieldset>
          ))
        )}

        <button
          type="button"
          onClick={add}
          className={`self-start ${REMOVE}`}
        >
          Add work interval
        </button>

        <DurationInput
          label="Travel to work"
          minutes={before}
          onChange={setBefore}
        />

        <DurationInput label="Travel home" minutes={after} onChange={setAfter} />

        <p className="text-xs text-stone-500">
          {before + after === 0
            ? 'No commute on this day.'
            : 'Travel to work ends where work starts, and travel home starts where work ends.'}
        </p>

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
            Save day
          </button>
        </div>
      </form>
    </Modal>
  )
}
