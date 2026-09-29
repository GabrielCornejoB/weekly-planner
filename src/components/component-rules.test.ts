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
    BackupPanel: ['onClose', 'onCopy', 'onImport'],
    BlockFields: ['onChange'],
    ColorSwatches: ['onChange'],
    ConfirmDialog: ['onCancel', 'onConfirm'],
    DayEditor: ['onCancel', 'onSubmit'],
    DaySelect: ['onChange'],
    DurationInput: ['onChange'],
    GoalForm: ['onCancel', 'onSubmit'],
    Modal: ['onClose'],
    OneOffForm: ['onCancel', 'onDelete', 'onSetDone', 'onSubmit'],
    RefusalBanner: ['onDismiss'],
    SessionEditor: ['onCancel', 'onDelete', 'onSetDone', 'onSubmit'],
    TaskList: [
      'onAddGoal',
      'onAddOneOff',
      'onDeleteGoal',
      'onEditGoal',
      'onEditOneOff',
      'onSelectGoal',
    ],
    TimeInput: ['onChange'],
    WeekGrid: ['onBlockDrop', 'onBlockResize', 'onBlockTap', 'onDayHeaderTap', 'onEmptyTap'],
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

/**
 * The rules task 17 states for the planning surfaces in words.
 *
 * The import checks above say a component cannot *reach* a rule module. These
 * say what is true even if that were not so: that the chart draws the geometry
 * it was given rather than computing it, that a form hands a draft up rather
 * than keeping it, and that a panel holds a string without reading it as
 * anything. Each one is a way the split could be quietly undone from the inside,
 * which is the failure the split exists to prevent.
 */
/**
 * An arbitrary-value class with something interpolated inside its brackets.
 *
 * Written with `\x60` and an escaped `]` on purpose. A backtick cannot go
 * literally into this regex — it would end the enclosing template literal — and
 * `[^]]` is a class containing a *closing* bracket, which does not mean what it
 * looks like it means. Both were found by probing the pattern against known
 * cases, and a pattern that cannot be written down is not a check.
 *
 * It is deliberately narrow, and narrow in a way that took three attempts to get
 * right. A naive `/\[[^\]]*\$\{[^\]]*\]/` matches across newlines when `s` is
 * absent, so one interpolation in a class attribute was paired with a
 * *different* class attribute hundreds of lines below and the report named a
 * file that was entirely innocent. The fix is to forbid the characters that
 * could span that far: a quote, a backtick, or a newline between the bracket and
 * the interpolation. A real assembled class is all on one line, and anything
 * longer than that is not a class name.
 *
 * A plain template literal that interpolates whole class names is fine and
 * common here, because each of those names is a literal somewhere in the file.
 */
const ASSEMBLED_CLASS = /\[[^"'\x60\n]*\$\{[^\]\n]*\]/

describe('what a component may not do', () => {
  /**
   * The functions that change a board.
   *
   * Not one of them may be named in a component, and not merely as an import:
   * a call copied into a file would be past the import check while being exactly
   * as wrong. These are the only names in the app that mutate anything.
   */
  const mutations = [
    'addWorkInterval',
    'createGoal',
    'createOneOff',
    'deleteGoal',
    'deleteOneOff',
    'deleteSession',
    'importBoardText',
    'loadBoard',
    'moveOneOff',
    'moveSession',
    'moveWorkInterval',
    'placeOneOff',
    'placeSession',
    'removeWorkInterval',
    'resizeOneOff',
    'resizeSession',
    'resizeWorkInterval',
    'saveBoard',
    'setCommute',
    'setOneOffDone',
    'setOneOffTravel',
    'setSessionDone',
    'setSessionTravel',
    'updateGoal',
  ]

  it('names no mutation', () => {
    const offences = componentNames().flatMap((name) => {
      const source = sourceOf(name)
      return mutations.filter((mutation) => source.includes(mutation)).map((m) => `${name} names ${m}`)
    })
    expect(offences).toEqual([])
  })

  /**
   * The chart is handed its geometry.
   *
   * `topPercent` and `heightPercent` are computed once in the view model, from
   * the block's own stretch, so a rectangle and the numbers that placed it
   * cannot disagree. A grid that called them again would have a second opinion
   * about where a block is, and the one it drew would be the one nobody checked.
   */
  it('leaves the chart with no geometry of its own', () => {
    const source = sourceOf('WeekGrid.tsx')
    expect(source).not.toMatch(/\btopPercent\(/)
    expect(source).not.toMatch(/\bheightPercent\(/)
    // It applies them as strings off the block, which is the whole contract.
    expect(source).toContain('`${block.topPercent}%`')
    expect(source).toContain('`${block.heightPercent}%`')
  })

  it('renders the sentence it was given rather than composing one', () => {
    // A progress sentence is composed in one module and handed down whole, so a
    // row cannot build a second opinion about how much is done and then disagree
    // with the grid. The check is on the *numbers* read off a progress record,
    // because the words can be spelled any number of ways: a component could
    // assemble a correct-looking sentence out of the right figures and still be a
    // second place deciding what a task's progress means.
    const reaching = componentNames().filter((name) =>
      /progress\.(done|placed|goal|unplaced|over)\b/.test(sourceOf(name)),
    )
    expect(reaching).toEqual([])
  })

  it('never builds a class name out of parts', () => {
    // Tailwind emits only the class names it can read whole in the source, so an
    // arbitrary value assembled from pieces survives a dev server and compiles to
    // nothing in a production build. The symptom is a layout that is simply
    // absent, with no error anywhere — and it is the exact trap `palette.ts`
    // records for a color, which is why it is checked from source here too.
    //
    // The first version of this task had `grid-cols-[${GUTTER}_repeat(7,...)]`
    // in the chart. It looked fine, it typechecked, it rendered, and the
    // production build emitted no `grid-cols-[` rule at all: the whole week
    // would have been one auto-width column. Only reading the built CSS found it.
    const assembled = componentNames().filter((name) =>
      ASSEMBLED_CLASS.test(sourceOf(name)),
    )
    expect(assembled).toEqual([])
  })

  it('gives the panel no way to read its text', () => {
    // The backup panel holds the export text and the pasted text, and reads
    // neither as a board. That is what lets "Nothing was replaced." stay true
    // when the person pastes something that is not a board at all: the decision
    // was made before any confirm dialog was opened.
    const panel = sourceOf('BackupPanel.tsx')
    expect(panel).not.toMatch(/\bJSON\./)
    expect(panel).not.toMatch(/\bparse\b/i)
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
   * What a component is allowed to keep, which is its own input and nothing
   * about the board.
   *
   * A component that grew `useState` for anything else would be keeping a fact
   * about the week, or a decision about a dialog, in the one place that has no
   * way to be asked whether it is still true. The two categories below are the
   * only two this folder has ever needed:
   *
   * - a form holding the draft somebody is typing, which the plan allows
   *   explicitly, since emitting the draft on submit is the whole of a form;
   * - the chart holding the one drag currently under a finger, which is where
   *   that finger is rather than anything about a block.
   */
  const mayHoldState = [
    'BackupPanel.tsx',
    'DayEditor.tsx',
    'DurationInput.tsx',
    'GoalForm.tsx',
    'OneOffForm.tsx',
    'SessionEditor.tsx',
    'TimeInput.tsx',
    'WeekGrid.tsx',
  ]

  it('is held only by a form, a field, and the chart', () => {
    const holding = componentNames().filter((name) => /\buseState\b/.test(sourceOf(name)))
    expect(holding).toEqual(mayHoldState)
  })

  it('never names the whole board', () => {
    // A dumb component is handed a view model, a row, a block, or a day, and
    // never the document. The distinction is the point: a component that had
    // the board could read past its own props, and the only thing stopping a
    // rule from creeping in at that point is not having asked for it.
    const offenders = componentNames().filter((name) => /\bBoard\b/.test(sourceOf(name)))
    expect(offenders).toEqual([])
  })
})
