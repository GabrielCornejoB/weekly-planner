/**
 * Which day something is on, as a list the person taps.
 *
 * A native select rather than seven buttons: a day is a closed set of seven, the
 * phone already has a control for exactly this shape, and a picker is one tap
 * where a row of seven is seven decisions to read before the first one.
 *
 * The days themselves are handed in. This component does not know that a week
 * runs Monday to Sunday or what any of them are called — the orchestrator passes
 * the seven options it was given, in the order they should appear — so a day
 * could be renamed, reordered, or cut down to a subset without this file
 * changing.
 *
 * Decisions recorded here:
 *
 * - **The shape of an option is written out here rather than imported.** A dumb
 *   component does not get to know where its data came from, and the view model
 *   that builds these options is not a component's to reach for. The two shapes
 *   are the same by construction rather than by sharing a name: the orchestrator
 *   passing its options to this prop is what makes the compiler check them, so a
 *   day that grew a field would be caught here rather than shown as a blank.
 * - **A choice is looked up rather than believed.** The browser hands back a
 *   string, and only a day that is one of the offered options can leave this
 *   component, which is what lets it report a `DayId` without an assertion.
 */

import { useId } from 'react'

import type { DayId } from '@/domain/types'

/** A day and the name to put on it. */
export interface DayOption {
  day: DayId
  label: string
}

export interface DaySelectProps {
  label: string
  /** The days to offer, in the order they should appear. */
  options: readonly DayOption[]
  value: DayId
  onChange: (day: DayId) => void
}

export function DaySelect({ label, options, value, onChange }: DaySelectProps) {
  const id = useId()

  // The value off a select is a string, and a day is one of seven names rather
  // than a free one. Looking the choice up among the options that were offered
  // means this component can only ever report a day it is actually showing, and
  // it needs no assertion to say so.
  function choose(chosen: string) {
    const option = options.find((candidate) => candidate.day === chosen)
    if (option !== undefined) onChange(option.day)
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-stone-600">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => choose(event.target.value)}
        className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900"
      >
        {options.map((option) => (
          <option key={option.day} value={option.day}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
