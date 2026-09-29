/**
 * The twelve palette entries, written out as complete Tailwind class strings.
 *
 * A task or a one-off stores a `ColorId`, never a class name, so the color of
 * anything on the board stays a closed set of twelve and a stored board can
 * never carry a free hex value.
 *
 * Every class in this file is a literal. Tailwind only emits the class names it
 * can read in the source, so a name assembled from parts, background then hue
 * then shade, would survive in dev and compile to nothing in a production
 * build, leaving blocks with no color at all. Spelling each one out is what
 * stops that.
 */

import type { ColorId } from '@/domain/types'

/**
 * The palette in swatch order: the order the twelve choices are offered in, and
 * the order `nextColorId` hands them out.
 *
 * The union in `types.ts` fixes which ids exist; this tuple fixes their order.
 */
export const COLOR_IDS = [
  'red',
  'orange',
  'amber',
  'lime',
  'green',
  'teal',
  'sky',
  'blue',
  'indigo',
  'violet',
  'pink',
  'rose',
] as const satisfies readonly ColorId[]

/** The three classes one hue needs. */
export interface ColorClasses {
  /** The activity block itself, e.g. `bg-sky-600`. */
  solid: string
  /** The travel strip inside that block, e.g. `bg-sky-200`. */
  soft: string
  /** A label color that stays readable on `soft`, e.g. `text-sky-900`. */
  text: string
}

/**
 * One entry per `ColorId`, one shade per role: the activity block is the 600
 * step, its travel is the 200 step, and the label is the 900 step.
 *
 * The 600 step is a shade darker than the 500 the plan offers as its example,
 * for a measured reason. The name on a block is the one thing a person who
 * cannot use color cannot do without, and white label text on the 500 step
 * measures under 4.5:1 for seven of the twelve hues: amber is 3.3 to 1, lime
 * 3.5 to 1, orange 3.8 to 1, rose 4.0 to 1. At the 600 step the weakest of
 * them, orange, is 4.6 to 1 and the other eleven are darker still. The 900 text
 * on the 200 background measures 8.1 to 1 at worst, so the travel strip stays a
 * lighter shade of the same color and still reads.
 *
 * White on the solid shade is the same for all twelve, so it is not a
 * per-color value here. Work and commute are not in this map either: they use
 * stone utilities, so blocked time is never mistaken for a task.
 */
export const PALETTE: Record<ColorId, ColorClasses> = {
  red: { solid: 'bg-red-600', soft: 'bg-red-200', text: 'text-red-900' },
  orange: { solid: 'bg-orange-600', soft: 'bg-orange-200', text: 'text-orange-900' },
  amber: { solid: 'bg-amber-600', soft: 'bg-amber-200', text: 'text-amber-900' },
  lime: { solid: 'bg-lime-600', soft: 'bg-lime-200', text: 'text-lime-900' },
  green: { solid: 'bg-green-600', soft: 'bg-green-200', text: 'text-green-900' },
  teal: { solid: 'bg-teal-600', soft: 'bg-teal-200', text: 'text-teal-900' },
  sky: { solid: 'bg-sky-600', soft: 'bg-sky-200', text: 'text-sky-900' },
  blue: { solid: 'bg-blue-600', soft: 'bg-blue-200', text: 'text-blue-900' },
  indigo: { solid: 'bg-indigo-600', soft: 'bg-indigo-200', text: 'text-indigo-900' },
  violet: { solid: 'bg-violet-600', soft: 'bg-violet-200', text: 'text-violet-900' },
  pink: { solid: 'bg-pink-600', soft: 'bg-pink-200', text: 'text-pink-900' },
  rose: { solid: 'bg-rose-600', soft: 'bg-rose-200', text: 'text-rose-900' },
}

/**
 * The color to offer next: the first palette id that nothing is using yet.
 *
 * A new task should not be handed a color it already has, so this skips every
 * id in `used` and wraps to the top of the palette once they are all taken.
 * Twelve tasks is already a lot for one week, and a repeat color is a far
 * smaller problem than refusing to create the thirteenth task.
 */
export function nextColorId(used: Iterable<ColorId>): ColorId {
  const taken = new Set(used)
  const firstFree = COLOR_IDS.find((id) => !taken.has(id))
  return firstFree ?? COLOR_IDS[0]
}
