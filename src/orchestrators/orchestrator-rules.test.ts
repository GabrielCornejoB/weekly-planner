/**
 * The rules the orchestrator lives by, checked against its own source.
 *
 * The plan forbids rendering components in tests — there is no jsdom here, no
 * React Testing Library, and no way to tap a phone-sized chart from Node — so the
 * behaviour of the app is proved by calling the functions in `actions.ts` (see
 * `actions.test.ts`) and the *wiring* is checked here, by reading what the two
 * files say. The wiring is the whole of what is left: which dialog opens, which
 * flow a draft is handed to, and whether a form stays up.
 *
 * It is not a weaker check than it looks. The things pinned below are facts about
 * what this folder can *do*, not about what it does today: a folder that cannot
 * name a mutation cannot grow a second path around the door, and a folder that
 * cannot write a refusal has no way to decide whether a change is legal even if
 * somebody wanted it to.
 *
 * The glob is the whole folder rather than a list, so a file added later is
 * covered from the moment it exists.
 */

import { describe, expect, it } from 'vitest'

/**
 * The source of every file in this folder, as text.
 *
 * `?raw` means the file is read and never executed: no JSX is transformed, no
 * React is loaded, and nothing is rendered. That is the whole reason the module
 * graph of an orchestrator is a text question here.
 */
const sources: Record<string, string> = import.meta.glob<string>('./*.ts{,x}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function fileNames(): string[] {
  return Object.keys(sources)
    .filter((path) => !path.includes('.test.'))
    .map((path) => path.replace('./', ''))
    .sort()
}

function sourceOf(name: string): string {
  const source = sources[`./${name}`]
  if (source === undefined) throw new Error(`no file called ${name}`)
  return source
}

/**
 * The file with its comments taken out.
 *
 * Nearly every check below is an absence, and a file in this project explains
 * itself at length — so a check that read the prose as well would either fail on a
 * comment that *describes* the rule or, worse, pass because the comment said the
 * words the check was looking for. Every one of them is about what the code can
 * do, so every one of them reads the code.
 *
 * That makes the stripper load-bearing, and a stripper that ate too much would
 * make every absence below pass vacuously. The next test is the guard against
 * exactly that, and it is here rather than at the end because a reader who
 * changes the stripper should meet it immediately.
 */
function codeOf(name: string): string {
  return sourceOf(name)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
}

/** Every module specifier a file imports, whatever shape the import has. */
function importsOf(name: string): string[] {
  const source = sourceOf(name)
  const froms = [...source.matchAll(/\bfrom\s*'([^']+)'/g)].map((match) => match[1])
  const bare = [...source.matchAll(/^\s*import\s*'([^']+)'/gm)].map((match) => match[1])
  return [...froms, ...bare]
}

/** The body of one exported function, so a rule can be asked of it alone. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`)
  if (start < 0) throw new Error(`no exported function called ${name}`)
  const end = source.indexOf('\nexport function ', start + 1)
  return source.slice(start, end < 0 ? source.length : end)
}

const ORCHESTRATOR = 'BoardOrchestrator.tsx'
const ACTIONS = 'actions.ts'

describe('the folder', () => {
  it('is the orchestrator and the flows it hands work to', () => {
    // The glob is the folder, so this is what stops a third file being added
    // without somebody deciding what it is for.
    expect(fileNames()).toEqual([ACTIONS, ORCHESTRATOR].sort())
  })

  it('reads code, not prose, and strips the comments without eating the code', () => {
    // The guard for every absence below. A stripper that removed too much would
    // leave these files looking empty, and "this file does not contain a refusal"
    // would be true of a file that is all refusal.
    expect(codeOf(ACTIONS)).toContain('export function settle(')
    expect(codeOf(ORCHESTRATOR)).toContain('export function BoardOrchestrator(')
    // A phrase that only ever appears in a comment, and the code it explains.
    expect(sourceOf(ACTIONS)).toContain('the whole of the plan')
    expect(codeOf(ACTIONS)).not.toContain('the whole of the plan')
  })
})

describe('what the orchestrator may name', () => {
  /**
   * The functions that change a board.
   *
   * Not one of them may be named in the component, and not merely as an import: a
   * call copied in would be past an import check while being exactly as wrong.
   * Every change has to go out through a flow in `actions.ts`, which is the only
   * place a save is remembered.
   *
   * The four persistence calls are not on the list, and that is the plan's own
   * doing: it hands `loadBoard`, `saveBoard`, `exportBoardText`, and
   * `importBoardText` to the orchestrator and to nobody else, because the Backup
   * panel holds a string and never reads it as a board. `importBoardText` judges a
   * paste rather than changing anything, so calling it is a reader, not a change.
   */
  const mutations = [
    'addWorkInterval',
    'createGoal',
    'deleteGoal',
    'deleteOneOff',
    'deleteSession',
    'moveOneOff',
    'moveSession',
    'moveWorkInterval',
    'placeOneOff',
    'placeSession',
    'removeWorkInterval',
    'resizeOneOff',
    'resizeSession',
    'resizeWorkInterval',
    'resizeWorkIntervalOnAnyDay',
    'setCommute',
    'setOneOffDone',
    'setOneOffTravel',
    'setSessionDone',
    'setSessionTravel',
    'updateGoal',
    'updateOneOff',
  ]

  it('names no mutation in the component', () => {
    const code = codeOf(ORCHESTRATOR)
    const offences = mutations.filter((mutation) => code.includes(mutation))
    expect(offences).toEqual([])
  })

  /**
   * The questions only the domain may answer.
   *
   * Everything here is a rule or a measurement: whether a footprint fits, what a
   * day holds, what a minute is called, how much has been done. The orchestrator is
   * handed finished answers — a view model, a sentence, a `Result` — and if it could
   * ask these itself it would be a second place deciding something about the week,
   * and the one place with no test above it.
   */
  const rules = [
    'checkActivityMinutes',
    'checkCommute',
    'checkDayPlan',
    'checkFootprintFits',
    'checkMinute',
    'checkName',
    'checkTravelMinutes',
    'commuteFootprint',
    'dayOccupancy',
    'footprintRange',
    'formatClock',
    'formatDuration',
    'freeStretches',
    'goalProgress',
    'heightPercent',
    'isOnTypedStep',
    'isWithinDay',
    'oneOffFootprint',
    'placedOccupancy',
    'rangesOverlap',
    'sessionFootprint',
    'snapDragMinute',
    'topPercent',
    'workFootprint',
  ]

  it('names no rule and no measurement', () => {
    const offences = [ACTIONS, ORCHESTRATOR].flatMap((name) =>
      rules.filter((rule) => codeOf(name).includes(rule)).map((rule) => `${name} names ${rule}`),
    )
    expect(offences).toEqual([])
  })

  it('never asks a module that owns a rule', () => {
    // `view.ts` is allowed, because a view model is finished text and finished
    // percentages. `schedule.ts` is not, and neither is the progress module: those
    // are the two a rule is most likely to creep in from, since both answer
    // questions the orchestrator would rather ask than pass a view model along.
    const offences = [ACTIONS, ORCHESTRATOR].flatMap((name) =>
      importsOf(name)
        .filter((specifier) => specifier === '@/domain/schedule' || specifier === '@/domain/progress')
        .map((specifier) => `${name} imports ${specifier}`),
    )
    expect(offences).toEqual([])
  })
})

describe('what the orchestrator may not decide', () => {
  /**
   * It cannot write a refusal.
   *
   * This is the load-bearing rule of the whole folder, and it is enforced by what
   * is *absent* rather than by what is reviewed: there is no `ok: false` and no
   * `reason:` in the code of either file, so there is no way for the orchestrator
   * to say "no" to anything. Every refusal it shows was produced by a domain
   * mutation and worded by `refusal.ts`, and that is not a convention this folder
   * follows — it is a sentence the folder cannot write.
   *
   * The two `{ ok: true, … }` results in `actions.ts` are the shape of a success
   * rather than a judgement, for the two changes the domain has no door for: a
   * reset, and an import the person has confirmed.
   */
  it('invents no refusal', () => {
    // The door is where the two words appear, and it is the one function allowed
    // them: it is *reporting* the refusal a domain mutation handed back, which is
    // the opposite of deciding one. Every other line of the folder, taken on its
    // own, has no way to say no.
    const door = bodyOf(codeOf(ACTIONS), 'settle')
    expect(door).toMatch(/ok:\s*false/)
    expect(door).toMatch(/\.reason\b/)
    for (const name of [ACTIONS, ORCHESTRATOR]) {
      const code = codeOf(name).replace(door, ' ')
      expect(code, name).not.toMatch(/ok:\s*false/)
      expect(code, name).not.toMatch(/\breason:/)
    }
  })

  /**
   * There is one door, and only the door writes a state.
   *
   * `settle` is the single place a change is saved and a refusal is shown, so a
   * flow that bypassed it would be a change nobody remembered to save, and a flow
   * that built a state of its own would be the same. The component may not name
   * the two message fields at all, which is what makes "only the door writes a
   * state" checkable from the file that would otherwise be tempted.
   */
  it('has one door, and nothing else writes a state', () => {
    const component = codeOf(ORCHESTRATOR)
    for (const field of ['refusal:', 'notice:']) {
      expect(component, field).not.toContain(field)
    }
    expect(component).not.toMatch(/\{\s*\.\.\.state/)
    // Two spreadings of a state in the flow layer: the refusal branch of the door
    // and the one function whose whole job is putting a message away. A third
    // would be a third place that can build a state.
    expect([...codeOf(ACTIONS).matchAll(/\{\s*\.\.\.state/g)]).toHaveLength(2)
    expect(codeOf(ACTIONS)).toContain('export function settle(')
  })

  /**
   * Every flow reaches the door, directly or through `runSteps`.
   *
   * A flow is one of the app's changes, and the only two ways to change the board
   * are a domain function handed to `settle` or handed to `runSteps`, which hands
   * it to `settle`. A flow that did neither would still compile, would still draw
   * on screen, and would silently stop saving — which is the failure this catches.
   */
  it('sends every flow through the door', () => {
    const source = codeOf(ACTIONS)
    const flows = [...source.matchAll(/export function (\w+)\(/g)].map((match) => match[1])
    expect(flows.length).toBeGreaterThan(10)
    // The three that are not changes: opening the board, putting a message away,
    // and reading which colors are in use.
    const notChanges = ['initialState', 'dismissMessage', 'usedColorIds']
    for (const flow of flows) {
      if (notChanges.includes(flow)) continue
      const body = bodyOf(source, flow)
      const through = body.includes('settle(') || body.includes('runSteps(')
      expect(through, flow).toBe(true)
    }
  })
})

describe('what the orchestrator may hold', () => {
  /**
   * Five pieces of state, and no more.
   *
   * The board, the refusal, and the storage notice are one object because the door
   * writes all three together. The open dialog, the armed task, and the step
   * waiting for a slot are separate, because they are about this moment and must
   * not be saved with the week. A sixth would be a fact about the week living
   * somewhere the door does not write, which is the one thing this split is for.
   */
  it('holds the board, the dialog, the armed task, the step, and the runtime', () => {
    const code = codeOf(ORCHESTRATOR)
    // Four of the five are typed (`useState<BoardState>(`) and one is not
    // (`useState(false)`), so the count is of the call rather than the parenthesis.
    expect([...code.matchAll(/useState[<(]/g)]).toHaveLength(5)
    for (const held of ['runtime', 'state', 'dialog', 'selectedGoalId', 'placingOneOff']) {
      expect(code, held).toContain(held)
    }
  })

  /**
   * One id source and one storage object, reached in one place each.
   *
   * The preset spends the first ten ids and every block, task, and event after that
   * comes from the same counter, so two things on a board can never share an id
   * and a lookup by id always finds the one thing meant. A second call to
   * `crypto.randomUUID` anywhere in the app would quietly break that, and nothing
   * else about it would look wrong.
   */
  it('mints ids and reaches storage once each', () => {
    const code = codeOf(ORCHESTRATOR)
    expect([...code.matchAll(/crypto\.randomUUID/g)]).toHaveLength(1)
    expect([...code.matchAll(/localStorage/g)]).toHaveLength(1)
  })
})

describe('the copy the plan fixes', () => {
  it('asks the two questions the plan spells out, word for word', () => {
    // A confirm dialog that drifted into its own wording would be a fourth voice in
    // an app whose other sentences are all written once. The third confirmation
    // names the task, so it is built from a name rather than pinned here.
    const code = codeOf(ORCHESTRATOR)
    expect(code).toContain('Clear the whole board and go back to the empty week?')
    expect(code).toContain(
      'Replace the current board with this backup? The current plan will be discarded.',
    )
    expect(code).toContain('and every block of it will be removed')
  })

  it('offers Backup as a text button below the chart, not in the day headers', () => {
    // The plan is specific: quiet, below the grid, and nowhere a person would
    // think it was a seventh day. The label is looked for as a button's own text
    // between its tags, so neither the import of the panel nor a `'backup'` dialog
    // state can be mistaken for the control.
    const code = codeOf(ORCHESTRATOR)
    const chart = code.indexOf('<WeekGrid')
    const backup = code.search(/>\s*Backup\s*</)
    expect(chart).toBeGreaterThan(-1)
    expect(backup).toBeGreaterThan(chart)
  })
})
