/**
 * The twelve colors a task or an event can wear, offered as a row of swatches.
 *
 * A swatch is a button that reports a `ColorId`. The color itself is never named
 * here in class terms: the button takes its background from `PALETTE`, which is
 * a table of complete Tailwind class strings, so nothing in this file can
 * assemble a class name out of a hue and a shade and lose it in a production
 * build.
 *
 * Decisions recorded here:
 *
 * - **Twelve buttons, no picker.** A person picking a color is choosing between
 *   twelve known ones, and twelve buttons can all be seen at once. A dropdown
 *   would hide eleven of them behind a tap and put a second choice on every
 *   task; this way the whole palette is one look, which is also the only way to
 *   spot that a color is already in use this week.
 * - **Four across on a phone, six when there is room.** Twelve 44-pixel swatches
 *   in six columns overflow a narrow screen, and a swatch you have to scroll to
 *   is a color nobody chooses. Three rows of four fits, and the wider layout gets
 *   the flatter two rows.
 * - **The selected swatch is marked twice.** `aria-pressed` says it to a screen
 *   reader and the ring says it to an eye, because the product is explicit that
 *   color is never the only thing distinguishing two things — the name is always
 *   shown beside it, and here the choice itself needs a mark that is not a
 *   shade.
 */

import { COLOR_IDS, PALETTE } from '@/colors/palette'
import type { ColorId } from '@/domain/types'

export interface ColorSwatchesProps {
  label: string
  /** The color this item wears now. */
  value: ColorId
  onChange: (colorId: ColorId) => void
}

export function ColorSwatches({ label, value, onChange }: ColorSwatchesProps) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm text-stone-600">{label}</legend>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {COLOR_IDS.map((colorId) => {
          const selected = colorId === value
          return (
            <button
              key={colorId}
              type="button"
              aria-pressed={selected}
              aria-label={`Color: ${colorId}`}
              title={colorId}
              onClick={() => onChange(colorId)}
              className={
                `h-11 rounded-lg ${PALETTE[colorId].solid} ` +
                (selected ? 'ring-2 ring-stone-900 ring-offset-2' : '')
              }
            />
          )
        })}
      </div>
    </fieldset>
  )
}
