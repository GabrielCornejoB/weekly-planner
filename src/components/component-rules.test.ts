/**
 * The rules a dumb component lives by, checked against the components' own
 * source rather than by rendering them.
 *
 * The plan forbids rendering components in tests: there is no jsdom here, no
 * React Testing Library, and no way to tap a phone-sized dialog from Node. So
 * the two things task 16 asks to be true of this folder — it holds no rule, and
 * a modal closes by asking and not by deciding — are checked the only other way
 * available: by reading what the files say.
 *
 * That is not a weaker check than it looks. The rule modules are *unreachable*
 * from a component by import, and a callback is a name in a file, so both of
 * these read like compile-time facts that happen to be made at run time. A
 * component that imported `sessionFootprint` would be caught here on the way in,
 * and one that grew an `onConfirm` would be caught here on the way out, whether
 * anybody ever renders it.
 *
 * The glob is deliberately the whole folder and not a list, so every component
 * added later is covered from the moment it exists rather than from the moment
 * somebody remembers.
 */

import { describe, expect, it } from 'vitest'

/**
 * The source of every component in this folder, as text.
 *
 * `?raw` means the file is read and never executed: no JSX is transformed, no
 * React is loaded, and nothing is rendered. That is the whole reason the module
 * graph of a component folder is a text question here.
 */
const sources: Record<string, string> = import.meta.glob<string>('./*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Every component file, as bare file names, in a stable order. */
function componentNames(): string[] {
  return Object.keys(sources)
    .map((path) => path.replace('./', ''))
    .sort()
}

function sourceOf(name: string): string {
  const path = `./${name}`
  const source = sources[path]
  if (source === undefined) throw new Error(`no component called ${name}`)
  return source
}

/** Every module specifier a file imports, whatever shape the import has. */
function importsOf(name: string): string[] {
  const source = sourceOf(name)
  const froms = [...source.matchAll(/\bfrom\s*'([^']+)'/g)].map((match) => match[1])
  const bare = [...source.matchAll(/^\s*import\s*'([^']+)'/gm)].map((match) => match[1])
  return [...froms, ...bare]
}

/**
 * Every callback a file offers its caller.
 *
 * Read from the props each component declares rather than from every name that
 * starts with `on`: `onClick` and `onChange` are React's own DOM handler names
 * and would be counted here as though the app had asked for them. A declared
 * `onX:` is the thing this app's events table is about — a component cannot be
 * handed anything it did not ask for.
 */
function callbacksOf(name: string): string[] {
  return [...new Set([...sourceOf(name).matchAll(/\bon[A-Z]\w*\s*\??:/g)].map((match) => match[0].replace(/\s*\??:$/, '')))].sort()
}

describe('what a component may import', () => {
  /**
   * The modules that own a rule. A component reaching for one would be deciding
   * something about the board while drawing it, which is the whole mistake this
   * folder exists to prevent: an overlap check in a component is an overlap check
   * that can disagree with the one in the domain.
   *
   * `refusal.ts` is on the list because the sentences are handed down ready-made,
   * and `board.ts` because a component must never build or reset a board. The
   * day names and the view models are not on it: `view.ts` holds the shapes the
   * grid and the list are drawn from, and it is types only that a component needs
   * of it.
   */
  const ruleModules = [
    '@/domain/board',
    '@/domain/goals',
    '@/domain/progress',
    '@/domain/refusal',
    '@/domain/schedule',
    '@/domain/sessions',
    '@/domain/work',
    '@/persistence',
  ]

  it('finds the whole folder', () => {
    expect(componentNames().length).toBeGreaterThan(0)
  })

  it('keeps every rule module out of every component', () => {
    const offences = componentNames().flatMap((name) =>
      importsOf(name)
        .filter((specifier) =>
          ruleModules.some((rule) => specifier === rule || specifier.startsWith(`${rule}/`)),
        )
        .map((specifier) => `${name} imports ${specifier}`),
    )
    expect(offences).toEqual([])
  })
})

describe('what a component may emit', () => {
  /**
   * The callbacks the plan gives each component, from its events table.
   *
   * Read out of the source rather than out of a render, this is still the whole
   * of what a component can do: a component that decides something cannot decide
   * it by calling anything else, because nothing else is named here and nowhere
   * else. It also fails the other way, so a callback the plan promised that
   * nobody wired up cannot be quietly dropped.
   */
  const emits: Record<string, readonly string[]> = {
    ColorSwatches: ['onChange'],
    ConfirmDialog: ['onCancel', 'onConfirm'],
    DaySelect: ['onChange'],
    DurationInput: ['onChange'],
    Modal: ['onClose'],
    RefusalBanner: ['onDismiss'],
  }

  it('covers every component in the folder', () => {
    const componentNamesOnly = componentNames().map((file) => file.replace('.tsx', ''))
    expect(Object.keys(emits).sort()).toEqual(componentNamesOnly)
  })

  it('emits exactly the callbacks the plan names', () => {
    for (const [name, expected] of Object.entries(emits)) {
      expect(callbacksOf(`${name}.tsx`), `${name} should emit only ${expected.join(', ')}`)
        .toEqual([...expected].sort())
    }
  })
})

describe('Modal', () => {
  it('closes by asking and not by deciding', () => {
    const source = sourceOf('Modal.tsx')
    // No state means no way to close itself: there is nothing here that could
    // decide the dialog has had enough, so the orchestrator's word is the only
    // word there is.
    expect(source).not.toMatch(/\buse(State|Reducer)\b/)
    expect(source).toContain('onClick={onClose}')
    expect(source).toContain("'Escape'")
  })

  it('has one tap handler, and it is the Close button', () => {
    // A stray thumb on the dim area behind a form is the reason this is worth
    // stating, so the count of handlers is pinned rather than the markup: one
    // handler in the whole file means no tap anywhere else — not on the dim
    // area, not on the panel — can reach past the button that is there on
    // purpose. The first version of this test looked for the backdrop element by
    // its class names and passed vacuously the moment the element was formatted
    // across lines, which is the failure mode a test written about source text
    // has to be checked for.
    const source = sourceOf('Modal.tsx')
    const handlers = [...source.matchAll(/on(?:Click|PointerDown|MouseDown|TouchStart)\s*=\{/g)]
    expect(handlers).toHaveLength(1)
    expect(source).toContain('onClick={onClose}')
  })
})

describe('component state', () => {
  /**
   * Holding the text somebody is typing is allowed and is all that is allowed.
   *
   * A component that grew `useState` for anything else would be keeping a fact
   * about the board or a decision about a dialog in the one place that has no
   * way to be asked whether it is still true.
   */
  const mayHoldState = ['DurationInput.tsx']

  it('is held only by a form field, and only for its own text', () => {
    const holding = componentNames().filter((name) => /\buseState\b/.test(sourceOf(name)))
    expect(holding).toEqual(mayHoldState)
  })
})
