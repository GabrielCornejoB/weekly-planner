import { describe, expect, it } from 'vitest'

// The source of the module under test, as text. Tailwind reads class names out
// of the source and nothing else, so the file's own contents are the thing a
// palette mistake actually shows up in.
import paletteSource from '@/colors/palette?raw'
import { COLOR_IDS, nextColorId, PALETTE, type ColorClasses } from '@/colors/palette'
import type { ColorId } from '@/domain/types'

/** The twelve ids the plan fixes, written out so a rename cannot pass silently. */
const PLAN_IDS: readonly ColorId[] = [
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
]

/** The three roles the map gives every hue. */
const ROLES = ['solid', 'soft', 'text'] as const satisfies readonly (keyof ColorClasses)[]

function classesOf(colorId: ColorId): ColorClasses {
  return PALETTE[colorId]
}

describe('the palette', () => {
  it('holds the twelve ids the plan fixes, in swatch order', () => {
    expect([...COLOR_IDS]).toEqual([...PLAN_IDS])
  })

  it('never repeats an id', () => {
    expect(new Set(COLOR_IDS).size).toBe(12)
  })

  it('has one entry per id, and no entry nobody asked for', () => {
    expect(Object.keys(PALETTE).sort()).toEqual([...PLAN_IDS].sort())
  })

  it('pins all three classes of one hue, using sky as the example', () => {
    expect(classesOf('sky')).toEqual({
      solid: 'bg-sky-600',
      soft: 'bg-sky-200',
      text: 'text-sky-900',
    })
  })

  it('gives every hue one shade per role', () => {
    // The expected names are built here, in a test, on purpose. The map is what
    // ships, and this is the only place a class name is ever computed.
    for (const colorId of COLOR_IDS) {
      expect(classesOf(colorId).solid).toBe(`bg-${colorId}-600`)
      expect(classesOf(colorId).soft).toBe(`bg-${colorId}-200`)
      expect(classesOf(colorId).text).toBe(`text-${colorId}-900`)
    }
  })

  it('keeps every class in the color family of its own key', () => {
    // Guards the copy-and-paste mistake a twelve-entry map invites: a sky entry
    // that quietly borrows teal's classes still has three valid class names.
    for (const colorId of COLOR_IDS) {
      const classes = classesOf(colorId)
      expect(classes.solid.startsWith(`bg-${colorId}-`)).toBe(true)
      expect(classes.soft.startsWith(`bg-${colorId}-`)).toBe(true)
      expect(classes.text.startsWith(`text-${colorId}-`)).toBe(true)
    }
  })

  it('spells every class out instead of interpolating it', () => {
    // Tailwind drops a class it cannot see in the source, so a value like
    // `bg-${hue}-600` compiles to nothing and a block loses its color. A
    // complete literal has one dash-separated name, no glue, and no spaces.
    for (const colorId of COLOR_IDS) {
      for (const role of ROLES) {
        const value = classesOf(colorId)[role]
        expect(value).toMatch(/^(bg|text)-[a-z]+-[0-9]{3}$/)
        expect(value).not.toContain('${')
        expect(value).not.toContain('`')
        expect(value).not.toContain(' ')
      }
    }
  })

  it('leaves every class it ships visible in the source, for Tailwind to find', () => {
    // The checks above look at the finished strings, which cannot tell a literal
    // from a well-formed interpolation that happened to be right. Reading the
    // source can: a class the file does not spell out is a class the build drops.
    for (const colorId of COLOR_IDS) {
      for (const role of ROLES) {
        expect(paletteSource).toContain(`'${classesOf(colorId)[role]}'`)
      }
    }
    expect(paletteSource).not.toContain('${')
  })

  it('never gives two hues the same class', () => {
    const everyClass = COLOR_IDS.flatMap((colorId) =>
      ROLES.map((role) => classesOf(colorId)[role]),
    )
    expect(new Set(everyClass).size).toBe(36)
  })
})

describe('nextColorId', () => {
  it('offers the first palette id when nothing is in use yet', () => {
    expect(nextColorId([])).toBe('red')
  })

  it('skips an id that is already taken', () => {
    expect(nextColorId(['red'])).toBe('orange')
    expect(nextColorId(['red', 'orange', 'amber'])).toBe('lime')
  })

  it('fills the first gap, not the id after the last one used', () => {
    expect(nextColorId(['sky', 'red'])).toBe('orange')
  })

  it('reads any iterable, and is not fooled by a repeat', () => {
    expect(nextColorId(new Set<ColorId>(['red', 'red']))).toBe('orange')
  })

  it('hands out each id exactly once as the board fills up', () => {
    const used: ColorId[] = []
    const offered: ColorId[] = []
    for (let task = 0; task < COLOR_IDS.length; task += 1) {
      const id = nextColorId(used)
      offered.push(id)
      used.push(id)
    }
    expect(offered).toEqual([...COLOR_IDS])
  })

  it('wraps to the top of the palette when all twelve are in use', () => {
    expect(nextColorId([...COLOR_IDS])).toBe('red')
  })

  it('leaves the colors it was handed alone', () => {
    const used: ColorId[] = ['red', 'sky']
    nextColorId(used)
    expect(used).toEqual(['red', 'sky'])
  })
})
