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
 * Every element a finger can press, as its own complete opening tag.
 *
 * Only the four real controls. The chart's blocks are `div`s that answer a touch,
 * and the drop guide is a `div` that must never answer one, so a sweep over
 * everything pressable-looking would have to make a judgement this file is not in
 * a position to make. What is checked instead is the other half of the phone rule:
 * a control that is a real control is at least a thumb across.
 *
 * This walks the tag by hand rather than matching `<button[^>]*>`, and the reason
 * is a bug this file's own probing found. An event handler contains its own `>`:
 * `onClick={() => onDayHeaderTap(day.day)}` ends the naive match in the middle of
 * the arrow, so the tag came back truncated at `onClick={() =>` with no
 * `className` in it at all — and a control whose classes are never read is a
 * control that cannot fail this check, which is worse than not having the check.
 * The walker tracks quotes and braces so the tag ends where the tag ends.
 */
function controlsOf(source: string): string[] {
  const tags: string[] = []
  const opener = /<(?:button|input|select|textarea)\b/g
  for (let at = opener.exec(source); at !== null; at = opener.exec(source)) {
    const tag = readTag(source, at.index)
    if (tag !== null) tags.push(tag)
  }
  return tags
}

/** One opening tag, from its `<` to the `>` that actually closes it. */
function readTag(source: string, from: number): string | null {
  let quote: string | null = null
  let braces = 0
  for (let index = from; index < source.length; index += 1) {
    const character = source[index]
    if (quote !== null) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '{') braces += 1
    else if (character === '}') braces -= 1
    else if (character === '>' && braces === 0) return source.slice(from, index + 1)
  }
  return null
}

/**
 * The class strings one element wears, following the file's shared constants.
 *
 * The second half is the reason this is a function at all: a control's size is
 * usually written once as `const ACTION = 'min-h-11 …'` and named by nine
 * buttons, so reading the inline class alone would find nine controls with no
 * size and nine shared constants carrying the size, and check neither. Both
 * spellings are followed — a bare `className={ACTION}` and an interpolated
 * `` className={`${ACTION} …`} `` — because the second version of the first probe
 * was caught only after this was widened: a `className={ADD}` is not an
 * interpolation, and a check that only reads `${…}` sees no size on it.
 */
function classesOn(element: string, constants: Map<string, string>): string[] {
  const written = [...element.matchAll(/className="([^"]*)"/g)].map((match) => match[1])
  // Everything inside `className={ … }`, which is where the two other spellings
  // live: a bare constant (`{ADD}`) and a template that builds a string
  // (`` {`h-11 … ${PALETTE[id].solid}`} ``). Reading only the quoted form is what
  // let a probe through that shrank a colour swatch from a thumb to twenty-four
  // pixels: a swatch's class is a template, and a check that reads templates sees
  // nothing at all.
  const expression = element.match(/className=\{([\s\S]*?)\}\s*(?:\/|>)/)
  if (expression === null) return written
  const named = [...expression[1].matchAll(/\b([A-Z][A-Z_0-9]*)\b/g)]
    .map((match) => constants.get(match[1]))
    .filter((value): value is string => value !== undefined)
  return [...written, ...named, expression[1]]
}

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
    'updateOneOff',
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

/**
 * The rules the phone lives by.
 *
 * The plan's done-when for this task is that the default styles target a phone and
 * that no desktop-only affordance is the only way to do anything. Neither is a fact
 * about the JavaScript, and neither can be settled by rendering: this project has
 * no jsdom and the plan forbids rendering components in tests. So they are checked
 * the way this folder's other rules are — by reading what the files say — and each
 * one is chosen because the *absence* of it is a specific, describable failure.
 *
 * These are checks on the class names rather than on how they look, which has a
 * limit worth stating: they say a class was written, not that the browser honoured
 * it. The one way that goes wrong silently is a class Tailwind never emits, and the
 * assembled-class check above is the guard for the only way this project has of
 * causing that by accident.
 */
describe('the phone', () => {
  /**
   * The chart is the thing that scrolls, not the page.
   *
   * This is the load-bearing rule of the whole layout and it is easy to get
   * subtly wrong. A scroll box with no height bound is not a scroll box: it grows
   * to fit the day, the *page* scrolls instead, and the sticky day headers go up
   * with the page — so the product's "day headers stay visible while the day
   * scrolls" is silently false, and it looks fine until you notice the headers are
   * not there. So the box is asked for both halves: a height that is a share of
   * the viewport, and the overflow that makes it scroll.
   */
  it('bounds the chart to the screen so the day scrolls inside it', () => {
    const source = sourceOf('WeekGrid.tsx')
    // The height is a share of the viewport, not a count of pixels: a fixed height
    // is either a wasted screen on a tall phone or a clipped chart on a short one.
    expect(source).toMatch(/h-\[\d+dvh\]/)
    expect(source).toMatch(/overflow-auto/)
    // Both on the same class string, which is the part that is actually true of
    // the rendered box. Read as the file's class constants, one per box.
    const boxes = [...source.matchAll(/const \w+ = '([^']*)'/g)].map((match) => match[1])
    const scrollBox = boxes.filter((box) => box.includes('overflow-auto'))
    expect(scrollBox).toHaveLength(1)
    expect(scrollBox[0]).toMatch(/h-\[\d+dvh\]/)
  })

  /**
   * The day headers stay put, and the hours stay put the other way.
   *
   * The chart scrolls in two directions on a phone: the day up and down, the week
   * sideways. Both of those have something that must not move with them, and both
   * are a `sticky` with nothing behind it. A missing one is not a subtle fault —
   * it is a week whose Friday has no times on it, or a day whose names have
   * scrolled off the top — and neither shows up in a build or a test.
   *
   * The background is asked about in the same breath, because a sticky element
   * with a transparent background does not pin anything: the content it is meant
   * to cover slides over it and both are visible at once.
   */
  it('pins the day headers and the hour gutter, and gives both a background', () => {
    const source = sourceOf('WeekGrid.tsx')
    // The headers stick to the top of the scroll box.
    expect(source).toMatch(/sticky top-0/)
    // The gutter sticks to its left, which is a separate edge and a separate
    // failure: a chart that only pins one of the two still loses the other.
    expect(source).toMatch(/sticky left-0/)
    // Every sticky in this file carries the chart's own white, so nothing shows
    // through the thing that is meant to be on top.
    const stickies = [...source.matchAll(/className="([^"]*sticky[^"]*)"/g)].map((m) => m[1])
    expect(stickies.length).toBeGreaterThan(0)
    const transparent = stickies.filter((className) => !className.includes('bg-white'))
    expect(transparent).toEqual([])
  })

  /**
   * A week is wider than a phone, and the answer is to scroll rather than squeeze.
   *
   * Seven columns and an hour gutter on a 390-pixel screen means each column gets
   * about forty pixels, which is too narrow for a name and too narrow for a thumb
   * to land a quarter hour in. The product's answer is explicit — the grid may
   * scroll horizontally so a column stays wide enough to show a name — so the track
   * asks for a per-column floor and the week under it asks for a floor of its own.
   * Both are floors rather than fixed widths, so a wide screen still gets the whole
   * week spread out rather than seven narrow columns with a gap on the right.
   */
  it('gives every day column a width floor and lets the week scroll sideways', () => {
    const source = sourceOf('WeekGrid.tsx')
    // `minmax(4rem, 1fr)` per column: a floor and room to grow.
    expect(source).toMatch(/grid-cols-\[[^\]]*minmax\(\d+(\.\d+)?rem,\s*1fr\)/)
    // A floor on the week itself, so the columns cannot be squeezed under it.
    expect(source).toMatch(/min-w-\[\d+rem\]/)
  })

  /**
   * Nothing in this app is reachable only by hovering.
   *
   * The product says the page must not depend on a mouse, and the strongest honest
   * version of that is not "hover styles are subtle" but "there are none". A hover
   * rule in a component is a control that exists for some people and not others,
   * and on a touch screen it is worse than that: the first tap fires the handler
   * and *leaves the hover state stuck*, so the control stays visible after the
   * finger is gone. A whole class of bug that cannot happen if the class name is
   * not there.
   *
   * This check is over the components and not only over the chart, because the
   * places a hover would plausibly be added next are the row actions in the list
   * and the swatches in a form.
   */
  it('has no hover anywhere', () => {
    const hovering = componentNames().filter((name) => /\bhover:/.test(sourceOf(name)))
    expect(hovering).toEqual([])
  })

  /**
   * Every control is at least a thumb tall.
   *
   * A 44-pixel target is the smallest thing a person can reliably hit with a
   * finger, and this app is used with a finger on a phone. It is checked rather
   * than assumed because a control's size is spread across three places — a class
   * on the button, a class on a constant it shares, and a `min-h` nobody wrote —
   * and the third is what gets forgotten when someone adds a button.
   *
   * Only *controls* are read, which took one attempt to get right. The first
   * version swept every `h-` in every file and found the colour dot beside each
   * row's name, which is `h-4` because it is a dot and not something to be hit.
   * A check that flags a decoration is a check that gets deleted rather than
   * fixed, so this one reads the class names off the elements a finger can
   * actually press — and it follows the shared constants as well as the inline
   * classes, since nine buttons in the list wear one `ACTION` string and a target
   * that had quietly gone small would otherwise be found nine times over.
   */
  it('gives every control a thumb-sized target', () => {
    const undersized = componentNames().flatMap((name) => {
      const source = sourceOf(name)
      // The class strings a file defines once and hands to several controls.
      const constants = new Map(
        [...source.matchAll(/const (\w+) = '([^']*)'/g)].map((match) => [match[1], match[2]]),
      )
      const problems: string[] = []
      for (const control of controlsOf(source)) {
        for (const className of classesOn(control, constants)) {
          // A `min-h-11` is forty-four pixels. A height *below* eleven is a
          // control that has been told, in the class itself, that it is smaller
          // than a thumb. A control with no height at all is not a failure: it may
          // be sized by its padding, and a shared constant's `min-h-11` is the
          // usual answer.
          for (const match of className.matchAll(/\b(?:min-)?h-(\d+(?:\.\d+)?)\b/g)) {
            if (Number(match[1]) < 11) problems.push(`${name} has a ${Number(match[1]) * 4}px target`)
          }
        }
      }
      return problems
    })
    expect(undersized).toEqual([])
  })

  /**
   * The list is on the page, not behind anything.
   *
   * The product's one firm rule about the phone is that the quotas have to be
   * reachable without guessing where they went, and it allows exactly two shapes:
   * the list beside the grid, or the list open from it. This app ships the first,
   * so the thing worth pinning is that the list is rendered unconditionally — a
   * disclosure, a tab, or a `hidden` that only opens at a wider breakpoint would
   * all pass a test that only asked whether the list exists somewhere in the file.
   *
   * The `hidden` check reads *class tokens* rather than the bare word, which is
   * also the second thing this file got wrong the first time: the plain word
   * matches `aria-hidden`, which every decorative element in this app carries and
   * which is the opposite of a control being hidden. A variant prefix counts too,
   * so `sm:hidden` and `lg:hidden` are caught, which is the whole point — those
   * are the classes that would put the list behind a wider screen.
   */
  it('puts the task list on the page with nothing in front of it', () => {
    const source = sourceOf('TaskList.tsx')
    // The list is a landmark with a name, so it can be jumped to and read out.
    expect(source).toContain('aria-label="Tasks"')
    // It is not hidden at any width, as a class token rather than a substring.
    const hiding = [...source.matchAll(/className="([^"]*)"/g)]
      .flatMap((match) => match[1].split(/\s+/))
      .filter((className) => /(^|:)hidden$/.test(className))
    expect(hiding).toEqual([])
    // And it is not a disclosure: nothing in it collapses.
    expect(source).not.toMatch(/<details|<summary/)
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
