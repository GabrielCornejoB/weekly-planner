/**
 * The four things every placed block is edited with, whichever kind it is.
 *
 * A session and a one-off are the same rectangle on the chart with the same
 * travel, and the product treats them the same way everywhere else: a block is
 * moved, resized, and given travel regardless of whether a task is behind it.
 * Only the name and the color are different between them, and those live on the
 * forms that own them. So the four fields that make a block a block are written
 * once here rather than arranged twice, which is what keeps "a one-off is
 * placed like anything else" true in the editor rather than only on the chart.
 *
 * It holds nothing. Every value is a prop and every change is a callback, so
 * there is no second copy of a block's minutes anywhere and this component
 * cannot disagree with the draft the form above it is holding.
 *
 * Decisions recorded here:
 *
 * - **The start field is the block's first minute, travel included, and it says
 *   so on screen.** That is the convention the whole domain is built on — a
 *   footprint is travel, then activity, then travel — and a field that quietly
 *   meant the activity's start would put a block's travel somewhere the person
 *   did not ask for.
 * - **The two travel fields are separate rather than one "travel" box.** Either
 *   side can be zero on its own, and the product says so outright, so a single
 *   number would have to grow a meaning depending on which side of the activity
 *   somebody was thinking about.
 * - **A change reports only the field that changed.** The form above holds the
 *   draft and merges it, so this component never has to be handed a whole block
 *   back to keep the rest of it.
 */

import type { DayId, TravelMinutes } from '@/domain/types'

import { DaySelect, type DayOption } from './DaySelect'
import { DurationInput } from './DurationInput'
import { TimeInput } from './TimeInput'

/** Where a block sits and how long it is, which is everything the chart draws. */
export interface BlockPlacement {
  day: DayId
  /** The block's first occupied minute. Travel before is inside this number. */
  startMinute: number
  activityMinutes: number
  travel: TravelMinutes
}

interface BlockFieldsProps {
  placement: BlockPlacement
  /** The seven days, handed down because this component may not name them itself. */
  dayOptions: readonly DayOption[]
  onChange: (change: Partial<BlockPlacement>) => void
}

export function BlockFields({ placement, dayOptions, onChange }: BlockFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <DaySelect
        label="Day"
        options={dayOptions}
        value={placement.day}
        onChange={(day) => onChange({ day })}
      />

      <div>
        <TimeInput
          label="Start"
          minute={placement.startMinute}
          onChange={(startMinute) => onChange({ startMinute })}
        />
        <p className="mt-1 text-xs text-stone-500">
          The block starts here. Travel before is inside this time.
        </p>
      </div>

      <DurationInput
        label="Activity length"
        minutes={placement.activityMinutes}
        onChange={(activityMinutes) => onChange({ activityMinutes })}
      />

      <DurationInput
        label="Travel before"
        minutes={placement.travel.beforeMinutes}
        onChange={(beforeMinutes) => onChange({ travel: { ...placement.travel, beforeMinutes } })}
      />

      <DurationInput
        label="Travel after"
        minutes={placement.travel.afterMinutes}
        onChange={(afterMinutes) => onChange({ travel: { ...placement.travel, afterMinutes } })}
      />
    </div>
  )
}
