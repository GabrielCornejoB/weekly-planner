# Weekly Planner — Technical PRD and Implementation Plan

This is the build plan for the first version. Product behavior lives in [docs/product-scope.md](docs/product-scope.md). This file does not reopen those rules. It locks the technical decisions and lists the tasks that create the app.

A Ralph loop works one task at a time. Mark a finished task by adding `[done]` to its heading, for example `### 1. Scaffold the client app [done]`. Append what you did to `progress.txt`. When every task is done, output `<promise>COMPLETE</promise>`.

Do the tasks in order. A later task may assume the earlier ones exist.

## Decisions

| Topic | Decision |
| --- | --- |
| Runtime | Client-only single-page app. No server, no SSR, no SEO work, no database. |
| Stack | Vite, React, and TypeScript. Function components only. |
| Styles | Tailwind CSS v4, through the official Vite plugin. No SCSS, no `tailwind.config.js`, no PostCSS config. |
| Color | A task or one-off stores a `ColorId` from a fixed Tailwind palette. Not a free hex value. |
| Persistence | One JSON document in `localStorage`. |
| Backup | A quiet Backup control. Copy exports that same document. Import replaces the whole board after confirmation. |
| Logic | Schedule rules are pure TypeScript functions. Components do not own them. |
| Components | Dumb components render and emit callback events. One orchestrator owns state and calls the rules. |
| Tests | Vitest, Node environment. Test functions and types of behavior. Do not render components. |
| Types | `strict` TypeScript. No `any`, no `as any`, no `@ts-ignore`. Object shapes are interfaces. Closed sets are string unions. |
| Libraries | React and React DOM are the only runtime dependencies. |

The earlier request to minify SCSS is superseded by the Tailwind choice. Vite still minifies the JavaScript and the CSS it emits.

## Do not add

- a backend, router, state library, date library, drag library, or validation library
- shadcn, Radix, icon fonts, or a webfont
- React Testing Library, jsdom, Playwright, or component tests
- Prettier, unless formatting becomes a real problem
- dark mode, reminders, sync, or a second board
- features listed as out of scope in the product scope

A modal does not need a library. Escape calls `onClose`. The orchestrator decides what that means.

## Architecture

```text
src/
  main.tsx
  App.tsx                      mounts the orchestrator
  index.css                    @import "tailwindcss"
  domain/
    types.ts
    time.ts                    clock, duration, snap, geometry
    board.ts                   preset and reset
    schedule.ts                footprints, free time, overlap
    work.ts                    work intervals and commute
    goals.ts
    sessions.ts                sessions and one-offs
    progress.ts                quotas and the sentences in the list
    view.ts                    grid and list view models
    refusal.ts                 sentences for the reason codes in types.ts
  persistence/
    storage.ts                 localStorage load and save
    transfer.ts                export text, import validation
  colors/
    palette.ts                 ColorId to complete Tailwind class strings
  orchestrators/
    BoardOrchestrator.tsx
  components/
    Modal.tsx
    ConfirmDialog.tsx
    RefusalBanner.tsx
    ColorSwatches.tsx
    DurationInput.tsx
    DaySelect.tsx
    WeekGrid.tsx
    TaskList.tsx
    GoalForm.tsx
    OneOffForm.tsx
    DayEditor.tsx
    SessionEditor.tsx
    BackupPanel.tsx
    component-rules.test.ts   checks the rules this folder lives by, from source
```

Tests sit next to the module they cover: `time.test.ts` beside `time.ts`.

`App.tsx` only renders `BoardOrchestrator`. It contains no schedule rules.

### Who may import what

Dumb components may import types, `colors/palette.ts`, and pure display helpers from `domain/time.ts`. They may not import mutation modules, `schedule.ts`, `progress.ts`, or persistence.

`refusal.ts` and `board.ts` are on the forbidden list too, for the same reason: the sentences are handed down ready-made rather than composed, and a component must never build or reset a board. `view.ts` is allowed, for types only, since `BlockTarget` and `DAY_OPTIONS` exist to be carried out to the edge. Task 16 pins all of this as a test over the components' own source, so a component added later cannot reach a rule by accident.

The orchestrator imports domain and persistence. It passes ready-made view models and strings down. It does not calculate overlap, quotas, or footprints in the component body.

Forms may hold draft input until submit. That is presentational. They emit the draft. They do not validate the board.

### Events

A dumb component does not know what an event means. The orchestrator listens and acts.

| Component | Emits |
| --- | --- |
| `WeekGrid` | `onEmptyTap(day, minute)`, `onBlockTap(target)`, `onBlockDrop(target, day, minute)`, `onBlockResize(target, edge, minute)`, `onDayHeaderTap(day)` |
| `TaskList` | `onSelectGoal(id)`, `onAddGoal()`, `onEditGoal(id)`, `onDeleteGoal(id)`, `onEditOneOff(id)`, `onAddOneOff()` |
| `GoalForm`, `OneOffForm`, `DayEditor`, `SessionEditor` | `onSubmit(draft)`, `onCancel()` |
| `ConfirmDialog` | `onConfirm()`, `onCancel()` |
| `BackupPanel` | `onCopy()`, `onImport(raw)`, `onClose()` |
| `Modal` | `onClose()` |
| `RefusalBanner` | `onDismiss()` |

`Modal` and `ConfirmDialog` receive title, message, and labels as props. Neither knows whether the action is reset, delete, or import.

Dialog state stays in the orchestrator and is not persisted:

```ts
type DialogState =
  | { type: "none" }
  | { type: "confirm"; action: "reset" | "delete-goal" | "import"; goalId?: string; imported?: Board }
  | { type: "goal-form"; mode: "create" }
  | { type: "goal-form"; mode: "edit"; goalId: string }
  | { type: "one-off-form"; mode: "create"; day: DayId; startMinute: number }
  | { type: "one-off-form"; mode: "edit"; oneOffId: string }
  | { type: "day-editor"; day: DayId }
  | { type: "session-editor"; sessionId: string }
  | { type: "backup" };
```

`goalId` and `imported` are present only on the confirm variants that need them. Model that as a discriminated union in the real code, not as optional fields on one shape, so illegal combinations do not type-check.

## Domain model

Times are minutes from midnight. There are no `Date` objects. The board is not tied to a calendar.

```ts
export const BOARD_VERSION = 1 as const;
export const DAY_START_MINUTE = 360;   // 6:00
export const DAY_END_MINUTE = 1320;    // 22:00
export const DRAG_SNAP_MINUTES = 15;
export const TYPED_STEP_MINUTES = 5;
export const MIN_ACTIVITY_MINUTES = 15;
export const MIN_TRAVEL_MINUTES = 5;
export const MIN_WORK_MINUTES = 15;
export const MAX_NAME_LENGTH = 40;

export const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type DayId = (typeof DAYS)[number];

export interface TravelMinutes {
  beforeMinutes: number;
  afterMinutes: number;
}

export interface WorkInterval {
  id: string;
  startMinute: number;
  endMinute: number;
}

export type ResizeEdge = "start" | "end";   // added in task 8

export interface DayPlan {
  workIntervals: WorkInterval[];
  commuteBeforeMinutes: number;
  commuteAfterMinutes: number;
}

export type ColorId =
  | "red"
  | "orange"
  | "amber"
  | "lime"
  | "green"
  | "teal"
  | "sky"
  | "blue"
  | "indigo"
  | "violet"
  | "pink"
  | "rose";

export interface TimeGoal {
  id: string;
  kind: "time";
  name: string;
  colorId: ColorId;
  goalMinutes: number;
  defaultActivityMinutes: number;
  defaultTravel: TravelMinutes;
}

export interface CountGoal {
  id: string;
  kind: "count";
  name: string;
  colorId: ColorId;
  goalCount: number;
  defaultActivityMinutes: number;
  defaultTravel: TravelMinutes;
}

export type Goal = TimeGoal | CountGoal;

export interface Session {
  id: string;
  goalId: string;
  day: DayId;
  startMinute: number;
  activityMinutes: number;
  travel: TravelMinutes;
  travelFollowsDefault: boolean;
  done: boolean;
}

export interface OneOff {
  id: string;
  name: string;
  colorId: ColorId;
  day: DayId;
  startMinute: number;
  activityMinutes: number;
  travel: TravelMinutes;
  done: boolean;
}

export interface Board {
  version: typeof BOARD_VERSION;
  days: Record<DayId, DayPlan>;
  goals: Goal[];
  sessions: Session[];
  oneOffs: OneOff[];
}
```

The UI says "task". The code says `Goal` for the definition and `Session` for one placed block. A one-off is not a goal.

Weekday preset, in minutes: morning `480–720` (8:00–12:00), afternoon `840–1020` (14:00–17:00). Weekends have no intervals. Commute minutes start at `0`.

Mutations are immutable. They take a `Board` and return a new one. They do not change the input. Identity comes from an injected `createId: () => string`, so tests do not depend on `crypto.randomUUID`. The app passes `crypto.randomUUID` at the edge.

```ts
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: RefusalReason };
```

`RefusalReason` is a closed union. At least: `outside-day`, `overlaps`, `too-short`, `not-a-step`, `empty-name`, `name-too-long`, `invalid-quota`, `kind-locked`, `missing-goal`, `commute-without-work`, `invalid-backup`, `storage-unavailable`. Task 8 added `missing-work`, for a work interval that is not on the day being changed. Task 10 added `missing-block`, for a session or one-off that is not on the board at all. Wording lives in `refusalMessage(reason): string`, which tests cover. Components render that string. They do not build it.

A session footprint is travel-before, then activity, then travel-after. Commute is not stored as a range. Morning commute ends at the first work start. Evening commute starts at the last work end. Moving that start or end moves the commute. A day with no work intervals cannot have a commute. Commute does not attach to middle fragments.

Travel never counts toward a quota. Visit length never counts toward a visit-count quota. Done is the only progress that counts. Unplaced is `max(0, goal - placed)` and uses activity time or visit count, not travel.

Progress sentences, covered by tests:

| Case | Sentence |
| --- | --- |
| 2 hours done, 2 hours planned, goal 5 hours | `2 hours done of 5. 1 hour is not on the grid.` |
| 6 hours placed, 2 hours done, goal 5 hours | `2 hours done of 5. Nothing is unplaced. 1 hour more than the goal is on the grid.` |
| 6 hours done, goal 5 hours | `6 hours done of 5. Nothing is unplaced.` |
| 1 visit done, 1 planned, goal 3 | `1 of 3 done. 1 visit is not on the grid.` |
| 4 visits done, goal 3 | `4 of 3 done. Nothing is unplaced.` |

When done and goal are both whole hours, use that short form. Otherwise name the hours and minutes on both sides, for example `1 hour 40 minutes done of 5 hours`. Use `visit` or `visits` correctly. Show the "more than the goal is on the grid" sentence only when placed time or visits exceed the goal and done does not already exceed it.

Clock text is 24-hour: `8:00`, `9:30`, `17:00`. Duration text is `15 minutes`, `1 hour`, `2 hours`, `1 hour 40 minutes`.

Drag snaps to 15 minutes. Typed times use 5-minute steps, so 1:40 is valid. Activity and work intervals are at least 15 minutes. Travel and commute are `0` or at least 5 minutes. A block may start at 6:00 and may end at 22:00. Nothing crosses those bounds. Touching ranges are allowed. Overlapping ranges are refused. The app never moves another block to make room.

`travelFollowsDefault` stays true until that session's travel is edited. Changing the goal's default travel updates only sessions that still follow it. Name and color edits update every session of that goal because those fields live on the goal. The goal kind cannot change.

View models are pure functions of a `Board`. Tests cover geometry: the visible day is 960 minutes, so a 15-minute block is `15 / 960` of the column and a 100-minute block is `100 / 960`. The grid applies `topPercent` and `heightPercent`. It does not invent them.

```ts
export type BlockTarget =
  | { kind: "work"; id: string }
  | { kind: "session"; id: string }
  | { kind: "one-off"; id: string };

export interface GridBlockView {
  id: string;
  day: DayId;
  topPercent: number;
  heightPercent: number;
  label: string;
  detail: string | null;
  tone: "work" | "commute" | "activity" | "travel";
  colorId: ColorId | null;
  done: boolean;
  target: BlockTarget | null;
  draggable: boolean;
  resizable: boolean;
}
```

Work is draggable and resizable. Commute and travel are visible, not independently dragged. Tapping travel opens the session or one-off that owns it. Activity blocks show the name. Done blocks keep their color and also say `Done`.

`view.ts` re-exports `BlockTarget`, so `WeekGrid` can name `onBlockTap(target)` without importing `schedule.ts`, which the task 17 search bans. A view key is the kind, the board id, and the part: `work:w-am`, `session:s1:activity`, `session:s1:before`, `commute:monday:after`. It is unique across the whole model, which is why one block drawn as three strips is three keys.

Task 12 also settled the ruler, so the grid never does geometry. `GridModel.lines` is the horizontal rules from 6:00 to 22:00 inclusive: hours are the guides, half hours are faint, and there is no line every fifteen minutes.

```ts
export interface GridLineView {
  minute: number;
  label: string | null;   // clock text on an hour line, nothing on a half hour
  major: boolean;
  topPercent: number;
}

export interface GridDayView {
  day: DayId;
  label: string;
  blocks: GridBlockView[];
}

export interface GridModel {
  days: GridDayView[];
  lines: GridLineView[];
}
```

A goal row nests the whole `GoalProgress` rather than copying a sentence and a status out of it, so the two facts a row renders cannot come from two different calculations. A one-off row is a different case of the union — a day, a clock span, and a done mark — and has no quota and no way to be selected for placement. `DAY_OPTIONS` carries the seven days and their names out to the day select, which is a dumb component and may not import this module.

Palette classes are complete strings in `palette.ts`, for example `bg-sky-500` and `bg-sky-200`. Never build a class with `` `bg-${color}-500` ``. Tailwind would drop it. Work uses stone utilities, not a `ColorId`. Commute uses a lighter stone treatment and the label `Travel`. Task travel uses the soft shade of that task's color and the label `Travel`.

`nextColorId(used)` returns the first unused palette id, then wraps.

## Persistence and backup

Storage key: `weekly-planner.board`.

`loadBoard(storage)` and `saveBoard(storage, board)` take `Pick<Storage, "getItem" | "setItem">`, so tests pass a fake. They do not read `window` themselves.

- Missing key: return the preset. Do not write yet.
- Invalid JSON or a failed type guard: return the preset. Do not overwrite the stored text on load.
- `setItem` throws: return `storage-unavailable`. Keep the in-memory board. The orchestrator shows a short notice that Backup is the way to keep it.

`JSON.parse` is isolated in one function that returns `unknown`. The type guard is the only narrowing. Do not cast parsed JSON with `as Board`.

Export is `JSON.stringify(board, null, 2)` of the same `Board` interface, including `version: 1`. Import runs the type guard and then the same overlap and reference checks as a live board. A session whose `goalId` is missing is invalid. Overlaps are invalid. Import does not repair and does not merge.

The Backup control is a text button labeled `Backup`, below the grid, not in the day headers. The panel is a dumb modal with a read-only text area and a Copy button. Copy uses the clipboard API. If that fails, the text area is the fallback. Import reads the text area, validates, then opens `ConfirmDialog`: `Replace the current board with this backup? The current plan will be discarded.` Confirm replaces memory and saves. Cancel leaves the board alone.

Reset confirm: `Clear the whole board and go back to the empty week?` Delete-goal confirm names the task. Deleting one session or one-off does not ask.

## Phone interaction

The phone layout is the default. A wider screen may put the task list beside the grid. The list is visible without a hidden menu. It may collapse, but it starts open and the control is labeled `Tasks`.

The grid has an hour gutter and seven day columns. Hour lines are stronger than half-hour lines. There is no 15-minute line. Day headers stay visible while the day scrolls from 6:00 to 22:00. On a narrow screen the grid may scroll horizontally so a column stays wide enough to show a name. The page must not depend on a mouse.

Placement: select a goal, then tap an empty point. The grid reports a 15-minute-snapped minute. The orchestrator calls the domain place function. Refusal leaves the board unchanged and shows the reason.

Moving: drag reports a snapped drop. The domain function accepts or refuses. Refusal leaves the previous state, so the block returns. The same move is available in the session editor with 5-minute fields, including a day change. Resize on the grid snaps to 15 minutes. The editor can set 1:40.

One-off: Add event, tap a slot, submit the form. Work and commute: day header opens the day editor. Typed fields use 5-minute steps. Grid resize of a work interval uses the same work mutation as the editor.

Every successful mutation saves. A refused mutation does not.

## Tooling

Expected runtime is current Node.js 22 LTS. Vite currently requires Node.js 20.19+ or 22.12+.

Scaffold with the Vite `react-ts` template into this repo. Keep `docs/`. If the generator refuses a non-empty directory, generate beside it and move the app files in, without deleting `docs/`.

- Tailwind v4 and `@tailwindcss/vite` are dev dependencies. CSS entry is `@import "tailwindcss";`.
- `@` aliases `src`, in both TypeScript and Vite.
- Vitest uses the Node environment. Tests import `describe`, `it`, and `expect` from `vitest`. Do not enable globals, jsdom, or a setup file for DOM matchers.
- `npm test` runs `vitest run` and exits.
- `npm run build` typechecks and produces a minified static `dist/`. Opening `file://` is not a target. Use `npm run dev` and `npm run preview`.
- Keep the template ESLint setup and turn `@typescript-eslint/no-explicit-any` on as an error.
- No runtime dependency beyond `react` and `react-dom`.

Remove the Vite starter logos, counter, and `App.css`. Title the document `Weekly Planner`. Use the system font. Set the viewport for a phone.

## Tasks

### 1. Scaffold the client app [done]

Create the Vite React TypeScript app in this repo without removing `docs/`. Add the Tailwind v4 Vite plugin, the `@` alias, and a CSS entry that only imports Tailwind. Strip the starter UI. `npm run dev` shows an empty page titled Weekly Planner. `npm run build` emits minified JS and CSS.

Done when: the app builds, no SCSS and no Tailwind config file exist, and `docs/product-scope.md` is still there.

### 2. Lock the type and test setup [done]

Turn on the template strict options if any were relaxed. Ban explicit `any` in ESLint. Add Vitest in Node mode and a `test` script that exits. Add one temporary test that proves the runner executes a `.test.ts` file, then delete it in task 3 if it no longer applies.

Done when: `npm test` and `npm run lint` exit 0, and a file containing `: any` fails lint.

### 3. Define the board types [done]

Add `domain/types.ts` with the interfaces, unions, and constants in this plan. Export `DAYS` and the minute constants from one module so the UI and the rules cannot drift.

Done when: the file typechecks, uses interfaces for object shapes, and contains no `any`.

### 4. Time and geometry helpers [done]

Implement clock formatting, duration formatting, drag snap, typed-step checks, bounds checks, overlap, and percent-of-day conversion.

Done when tests cover: `8:00`, `9:30`, `17:00`; `15 minutes`, `1 hour`, `2 hours`, `1 hour 40 minutes`; drag snap of 6:07 to 6:00 or 6:15 by the chosen nearest rule, documented in the test; typed 1:40 accepted; 6:00 start and 22:00 end accepted; 5:55 and 22:05 rejected; a 15-minute block is `15 / 960` tall.

### 5. Preset board [done]

Implement `createDefaultBoard(createId)` and `resetBoard(createId)`. Monday–Friday get 8:00–12:00 and 14:00–17:00. Saturday and Sunday are empty. Commute is 0. Goals, sessions, and one-offs are empty. Ids come from `createId`.

Done when a test builds the preset with a fake id function and checks those minutes, and a second call does not mutate the first board.

Done in `src/domain/board.ts` and `src/domain/board.test.ts` (16 tests). `CreateId` is exported here so the mutations in tasks 8–15 share one id-source type. The seven days are written out literally rather than looped over `DAYS`, so a new day in the union fails the build instead of producing a day with no plan. `resetBoard(createId)` takes no board on purpose: reset discards the whole document, so the caller replaces its state with the result.

### 6. Palette [done]

Add the twelve `ColorId` values and a map of complete Tailwind class strings for the solid shade, the soft shade, and readable text. Implement `nextColorId`.

Done when a test shows the first unused id is chosen, a used id is skipped, and the map values contain no interpolated class names.

Done in `src/colors/palette.ts` and `src/colors/palette.test.ts` (16 tests). The twelve ids were already fixed by task 3, so this task adds the map, the swatch order, and `nextColorId`. Three roles per hue, one shade each: `solid` is the 600 step, `soft` the 200 step, `text` the 900 step. The 600 step is one darker than the 500 this plan offers as its example, because the name on a block has to stay readable: white on the 500 step measures under 4.5:1 for seven of the twelve hues, while at the 600 step the weakest, orange, is 4.6:1. `PALETTE` is typed `Record<ColorId, ColorClasses>`, so the union and the map cannot drift. The test imports its own module with `?raw` and asserts each shipped class is spelled out in the source, which is the only place a Tailwind interpolation actually shows up.

### 7. Footprints and placement checks [done]

Implement occupancy for work, commute, session travel, session activity, and one-offs. Implement the check that a proposed footprint fits in the day and does not overlap anything already there.

Done when tests cover: morning commute ends at the first work start and evening commute starts at the last work end; a middle work fragment gets no commute; a day with no work and a non-zero commute is refused; travel is occupied time but is not activity length; a block that would cross work is refused; a block that fits in 12:00–14:00 is accepted; a block ending at 22:00 is accepted; touching work intervals are accepted; overlapping work intervals are refused.

Done in `src/domain/schedule.ts` and `src/domain/schedule.test.ts` (68 tests). One type carries the whole idea: `OccupiedStretch` is a union on `role`, so a commute cannot claim a `target` (it hangs off the day) and a travel stretch cannot name a work interval. A `Footprint` is just the stretches one thing takes, contiguous, so `footprintRange` is the stretch that has to fit. Three checks answer three questions and compose: `checkFootprintFits` (in the day, inside one free stretch), `checkCommute` (the one rule occupancy cannot see: no work, no commute), and `checkDayPlan` (a whole proposed day for task 8's mutations, which compares work against work *inside the plan* rather than against the day already stored — that is what lets a morning interval move from 8:00–12:00 to 10:00–12:00). Minimum activity and work lengths are deliberately not checked here, since `MIN_ACTIVITY_MINUTES` and `MIN_WORK_MINUTES` differ and belong to the mutation that knows which kind of block it is placing.

`BlockTarget` is declared in `schedule.ts`, not in `types.ts`, because it is not board vocabulary — nothing on the board stores it — and because this is where a stretch learns what holds it. Task 12's `view.ts` imports it for `GridBlockView.target`.

### 8. Work and commute mutations [done]

Implement add, move, resize, and remove for work intervals, plus set commute. Removing the last interval clears commute. Changing the outer start or end recomputes the commute footprint and refuses if that footprint hits a session or leaves 6:00–22:00.

Done when tests cover the product examples: leave at 12:00 by removing 14:00–17:00; start earlier than 8:00; appointment day with work at 10:00–12:00 and 14:00–17:00; appointment day with work at 8:00–9:30, 10:30–12:00, and 14:00–17:00. Also cover a weekend gaining a work interval, and a commute change refused because a session is in the way. The input board in each test is unchanged.

Done in `src/domain/work.ts` and `src/domain/work.test.ts` (71 tests). All five mutations go through one private `commit(board, day, candidate)`: build the day that would result, hand it to `checkDayPlan`, and only then make a board. That is the whole reason a move or a resize can move the commute without any of the five functions knowing what a commute is — the commute moves because the *day* is re-checked, not because a rule was copied into four call sites. `removeWorkInterval` also goes through the door even though a removal can only free time and can never be refused for a reason of its own.

Three decisions are recorded in the module header and pinned by tests:

- **Work does not change days.** The id has to be on the day being changed, so a drop on another column is refused rather than silently pulling an interval off its day. Which days have work is the day editor's question; this keeps `moveWorkInterval` a single-day change instead of a remove plus an add.
- **Removing the last interval clears both commute directions.** It is a rule, not a repair: a commute hangs off work, so `checkDayPlan`'s `commute-without-work` would otherwise refuse the removal of the last interval, making a day impossible to empty.
- **The typed step is checked here, not in the component.** A 1:37 start is told to use 1:35 or 1:40 rather than that it is outside 6:00–22:00, which is true and useless. A commute is the one place the order is reversed, and `commuteRefusal` says why: every whole number under five is also off the five-minute step, so three minutes of commute must be reported as too short.

Two members were added to the vocabulary this task needed, both additions to the "at least" list above rather than departures from it:

- `RefusalReason` gained **`missing-work`**. A work interval that is not on the day being changed has no honest sentence among the existing twelve — `missing-goal` is nonsense for a work block and `overlaps` is a lie — and a stale grid drop is a real event, since the grid is where ids come from. `types.test.ts` was updated so the closed set still cannot grow quietly.
- `types.ts` gained **`ResizeEdge` (`'start' | 'end'`)**. A resize reports one edge, which is what lets a grid drag and a typed field share one mutation; it lives in `types.ts` rather than here because a dumb component has to be able to name it, and the plan only lets components import types, `colors/palette.ts`, and display helpers.

Also decided here for the later tasks: intervals are stored in **clock order** on every mutation, so a backup text reads the way the grid does; the day that changed is rebuilt down to fresh interval objects, while the other six days are shared; and `addWorkInterval` spends its id even when the change is refused, since the check does not depend on it.

### 9. Goal mutations [done]

Implement create and update for both kinds, delete, and default-travel propagation. Kind is fixed after create. Delete removes that goal's sessions and no others. Empty names, names over 40 characters, a count below 1, and a time quota below 15 minutes are refused. Default activity length is at least 15 minutes.

Done when tests cover type lock, color and name living on the goal, custom session travel surviving a default-travel edit, non-custom session travel updating, and delete removing only that goal's sessions.

Done in `src/domain/goals.ts` and `src/domain/goals.test.ts` (51 tests). Four exports: `createGoal`, `updateGoal`, `deleteGoal`, and `findGoal` (task 10 needs the lookup to place a session, since that is where a block's first length and travel come from). No `Result` code was added to the vocabulary: goals own six of the thirteen reasons the board already had words for, and a test gathers every reason a real call can produce and asserts the set is exactly those six, so neither a new reason nor a dead branch can slip in.

A **draft is the whole goal, not a patch**, and it is a union on `kind` with the same discriminant the stored goal has. That is what makes "the kind cannot change" cheap to honour: `updateGoal` is handed a kind, and a draft whose kind does not match the goal it is editing is `kind-locked` rather than coerced. It also means a count goal cannot be handed minutes — that shape does not compile, proved with a throwaway file. Create and update both validate through one private `draftRefusal`, so the two doors cannot disagree about what a legal goal is; a table asserts all ten bad drafts are refused identically through both.

The important structural point is what a goal edit does **not** touch. A name and a color live on the goal and are never copied onto a session, so "changing the name changes every block of this task" is true by construction instead of by a loop that has to remember to visit every session. Only default travel is copied, and only to the sessions whose `travelFollowsDefault` is still true. A name, color, quota, or default-length edit therefore rebuilds no session at all — not one object, and not the array either, which is what makes "a quota change only changes the numbers" checkable rather than merely intended.

Four decisions are recorded in the module header and pinned by tests:

- **Quotas have their own rule and their own reason.** A visit count is a whole number of at least one; a time budget is at least one shortest activity. Neither is asked about the five-minute typed step, because the plan states that step for clock positions and a quota is a target rather than a time. A default *activity length* is the exception: it stops being a target and becomes a block's real minutes on the grid, so it is held to the step and 1:40 is legal.
- **A name is stored exactly as it was typed.** A name of nothing but spaces is refused as empty, since nobody meant to name a task that, but nothing is trimmed — the app refuses rather than repairs, and quietly editing a person's words is a repair. The 40-character limit is measured on the name that reaches the board, spaces included.
- **Goals are appended and never sorted.** Priorities are out of scope in the product scope, so the order of the list is the order the person made them.
- **A refused create mints no id.** The checks do not need one, so a refused change cannot spend the app's uuid source.

One rule was lifted rather than copied. A commute and a task's default travel are the same rule from this plan — zero or at least five minutes, on the five-minute step, floor asked first — and `work.ts` already had it as a private function. Rather than let two modules hold one rule, `checkTravelMinutes` now lives in `schedule.ts` beside the other length rules, and both `setCommute` and the default-travel check call it. Task 8's pinned ordering test (three minutes is `too-short`, seven is `not-a-step`) still passes unchanged, and a goals test asserts the same order for a default travel, so the shared rule is covered from both sides.

Twenty-five wrong implementations were probed against the real file and all twenty-five were caught, three of them only after they exposed a gap the tests had to close first: a name trimmed on the way in, a travel comparison that looked at the before side only, and a length limit measured after a trim. The order the four fields are reported in is pinned too, because a form can be wrong several ways at once and only one sentence is shown.

### 10. Session and one-off mutations [done]

Implement place, move, resize, set travel, set done, and delete. Place copies the goal's default length and travel and sets `travelFollowsDefault` to true. Move of a done session keeps it done and leaves no block on the old day. A second session of the same goal on the same day is allowed. Resize of a done session changes the activity minutes that progress will later sum. Delete of a done session removes it. One-offs have no quota and no `travelFollowsDefault` flag.

Done when tests cover those cases, including a move from Monday to Friday and a refusal that returns the original board.

Done in `src/domain/sessions.ts` and `src/domain/sessions.test.ts` (69 tests). Twelve exports, six per kind, and the two kinds are told apart in exactly one private function (`isSession`, on whether the block has a `goalId`) so a rule such as the minimum activity length cannot come to mean two things. All the fit-checking doors go through one private `put`, which is `work.ts`'s `commit` again: build the block that would result, hand its footprint to `checkFootprintFits` excluding itself by id, and only then make a board.

The signature decisions, since every later task calls them:

- `placeSession(board, goalId, day, startMinute, createId)` asks the minute first, then the task, and refuses `missing-goal` for a task that is not on the board. The order is the one `work.ts` uses — a minute is a property of the request, and a sentence about it is useful whether or not the rest of the request makes sense. The task is asked next because without one there is no length and no travel to place.
- `moveSession(board, id, day, startMinute)` takes the day as an argument, which is the whole difference from `moveWorkInterval`. **A placed block changes days and a work interval does not**, and the header says why: which days carry work is the day editor's question, whereas the product scope is explicit that moving a block from Monday to Friday moves it and leaves no copy, ghost, or missed mark. Nothing is re-checked against the day the block is leaving; that day simply loses it.
- `resizeSession(board, id, edge, minute)` takes **one end of the activity**, not of the block. This is forced by the plan's own `GridBlockView`: travel is drawn as its own strip with its own `topPercent`, so the rectangle a finger lands on is the activity, and the minute a drag reports is that rectangle's edge. The travel keeps its lengths and stays attached to the outside, so the activity is what grows or shrinks and `activityMinutes` is the number progress will later sum — which is what the done-when for this task asks for. The editor's fields are the block's first minute (a move) and the activity length, both of which are minutes the caller already has, so no component or orchestrator has to turn a length into an end position.
- `setSessionTravel(board, id, travel)` is the only mutation that clears `travelFollowsDefault`, including when the person types the same numbers back: they edited it, so it no longer follows the task default. A move, a resize, and a done mark all leave the flag true. Clearing the travel to nothing clears the flag too, which the product scope's "including clearing them" needs.
- `setSessionDone(board, id, done)` re-checks nothing, because no minute moved. A test marks a block done on a board where the block is already overlapping work, and gets `ok`: the mark is the person saying they did the thing, not something the geometry gets to argue with.

Decisions recorded in the module header and pinned by tests:

- **A resize must be asked about the length before the fit.** A start edge dragged past the activity's own end produces a negative `activityMinutes` and a footprint that `footprintRange` folds into a legal-looking sliver sitting exactly where the travel was, so the fit check alone would *allow* it. `checkActivityMinutes` is asked first, on the number the resize would leave, and the test says so in its name.
- **The exclusion is by block id and never by task.** A block is not in its own way, but a second visit of the same task on the same day is a different block and stays in the way. A probe that excluded by `goalId` fails seventeen tests.
- **The list keeps placement order and is never sorted.** A backup text reads in the order the person made it, and the grid's order comes from `dayOccupancy` rather than from the array. A probe that sorted by day after a move was caught only after a test was written for it: the first version of that test moved a block to a day that sorted the same way round, so it proved nothing.
- **A refused change before the door mints no id; one inside it does.** An unknown task, a minute off the step, or an empty draft name never reach `createId`, and a test asserts the counter is still at zero. A change refused for not fitting has already been given one, because the fit check needs the candidate's id to name the block it is checking — the same split `work.ts` recorded for `addWorkInterval`.
- **Deleting a block takes its credit with it**, and deleting one block asks nothing. A confirm is a dialog, so it belongs to the orchestrator; the product scope makes a whole task or the whole board the thing that confirms.

Two things were lifted rather than copied, following the `checkTravelMinutes` precedent from task 9:

- `checkMinute` now lives in `schedule.ts` and is asked by both `work.ts` and `sessions.ts`. It is the same rule about *when* something is, and one module accepting 1:37 while the other refused it would be exactly the drift that only shows up on a phone. `work.ts` lost its private copy and the reasoning moved with the function; task 8's pinned ordering tests pass unchanged.
- `checkName` and `checkActivityMinutes` are now exported from `goals.ts`, where the rules were first written, because a one-off has a name and an activity length too. `MAX_NAME_LENGTH` is the length of a label the grid can show rather than a rule about tasks, so a dentist appointment may not be 60 characters while a task may not be 41.

One member was added to the vocabulary this task needed, an addition to the "at least" list rather than a departure from it. `RefusalReason` gained **`missing-block`**: a session or one-off that is not on the board has no honest sentence among the existing thirteen (`missing-goal` is nonsense for a one-off, which has no goal at all, and `overlaps` would be a lie), and a stale id is a real event because the grid is where block ids come from — a person can start a drag, be refused, and drag again from a board that has since changed. `types.test.ts` was updated so the closed set still cannot grow quietly.

**One reason the new tests had to be written before the probes all passed, which is the finding worth keeping.** Twenty wrong implementations were probed against the real file. Eighteen were caught at once; the two that were not were both real gaps in the tests rather than mistakes in the rules: a one-off that kept the *form's* travel object by reference instead of copying it, and a move that re-sorted the sessions by day. The first is now covered by the same "every travel is its own object" test that a session gets, and the second by a move that a day-order sort would visibly reorder.


### 11. Progress sentences [done]

Implement the quota math and the list sentences from this plan.

Done when tests match the five table rows, a travel-heavy study session whose activity is 1 hour does not count the travel, two gym visits of different lengths count as 2, and the 1:40 wording uses hours and minutes rather than a decimal.

Done in `src/domain/progress.ts` and `src/domain/progress.test.ts` (47 tests). One export, `goalProgress(board, goal)`, returns the numbers, the status, and the whole row as one string. The goal is handed in rather than looked up, because the caller is already walking `board.goals` to build the list, and a goal that is not on this board has no honest progress to report. `ProgressStatus` and `GoalProgress` are the other two exports; nothing here mutates, and nothing here refuses.

The module is only allowed to touch a session's `activityMinutes` and its `done` mark, and that is the rule most of the file is about. Travel is never counted, so a study block with half an hour of travel each way is an hour of progress; a visit's length is never counted either, so two gym visits of 45 and 90 minutes are two visits and the sentence never mentions an hour. A one-off is not in `board.sessions` at all and has no quota, so it cannot reach a total. A test drives all three of those, and a probe that adds travel into the sum or points the reader at `board.oneOffs` fails immediately.

**The short form counts hours itself rather than asking `formatDuration`, and that was a bug the tests found.** The rule is the one this plan states: both sides whole hours reads `2 hours done of 5.`, and anything else names both sides in full — `1 hour 40 minutes done of 5 hours.` The goal is left bare in the short form because that is how the worked examples read. Zero is a whole number of hours, so an empty task reads `0 hours done of 5.` and not `0 minutes done of 5.`: `formatDuration` spells a zero as `0 minutes`, which is right for a length such as absent travel and wrong for a total, because it puts two different units in one clause. The first version used `formatDuration` for the done side and every zero-done row came out wrong.

**The surplus clause is about the grid, and it waits until it is not redundant.** `2 hours done of 5. Nothing is unplaced. 1 hour more than the goal is on the grid.` is the product's second worked example. `6 hours done of 5. Nothing is unplaced.` is the third, and it is the same code with one clause missing: once the done total is past the goal the first clause already says so, so the clause is only added when the grid is over and the done total is not. Unplaced cannot go below zero and the surplus is measured against `placed` rather than `done`, and since every done block is a placed block those are the same number — one surplus to keep, and a test pins `done <= placed`.

**The status is derived here, and `unplaced` is asked first.** A task with four of five hours done and nothing else placed has still not been planned, and the week is not ready because of it, so `unplaced` outranks `met`. Then `over`, then `met`, and `planned` is what is left. A test sweeps every combination of done, placed, and quota the numbers can be in and asserts the set of statuses is exactly the four, which fails both ways: a fifth status cannot appear quietly and a dead branch cannot hide.

**The verb agrees with the quantity, not with the presence of an hour.** `1 hour is not on the grid.` and `4 hours are not on the grid.`, and a quantity of minutes is plural however many hours are in it, so `1 hour 40 minutes are not on the grid.` A first version asked whether the measure was a whole number of hours and got `4 hours is not on the grid`, which the tests caught; `measure` now reports one singular measure, exactly one hour, and one singular visit.

The test file builds its boards two ways, on purpose. Most cases are literal sessions so a case can state exact minutes, and the `through the real mutations` group places, marks done, resizes, and deletes through `sessions.ts` so the sentence is proved to follow the board rather than to be composed of the right words. That group is what pins the product scope's "resize a done block and the done total follows" and "deleting a block removes that credit".

Twenty-eight wrong implementations were probed against the real file and twenty-eight are caught. Two of them got through on the first pass, and both were gaps in the tests rather than mistakes in the rules: no case had a grid that was over the goal while the done total was not — the one case where measuring the surplus against `done` gives a different number — and the purity test used a single-session board, so a reader that sorted the array in place had nothing to shuffle. Both are covered now, and a re-run catches all twenty-eight.


### 12. View models [done]

Implement `toGridModel(board)` and `toTaskListModel(board)`. Grid blocks carry percents, tone, color id, done, and drag flags. List rows carry the progress sentence and a status the component can map to classes: `unplaced`, `planned`, `met`, or `over`. Status is derived, not stored.

Done when a test checks the 15-minute and 100-minute heights, commute and travel are not draggable, work and activity are draggable, and a goal with unplaced time is `unplaced`.

Done in `src/domain/view.ts` and `src/domain/view.test.ts` (61 tests). Two exports do the work, and both are pure functions of a `Board`: they change nothing, they refuse nothing, and they never reach past their argument. A view model that also asked the domain a question would be a rule wearing a component's clothes, which is the one thing this split exists to prevent.

**The grid is drawn from occupancy, not by walking the four lists.** Every rectangle on the week chart is a stretch, and `dayOccupancy` already reports all of them for a day in clock order with the work, the commute, the activities, and the travels in one list. Building the view out of that list is why a commute cannot be forgotten, why a block with travel is three strips rather than one, and why the order on screen is the order in time rather than the order things were created. A probe that filtered the board's arrays instead of asking `dayOccupancy` failed fifteen tests, and one that dropped the travel strips failed eleven.

**Nothing is filtered, clamped, or repaired.** A block outside 6:00–22:00 — which only a board that skipped every check can produce — keeps its geometry, and the percentage says so rather than being tidied into the column. A view model that repairs a geometry can disagree with the one drawn beside it, and a person would see two different truths about the same minute.

**A travel strip is its own block, and a quiet one.** The product says travel is drawn *on* the block, so it gets its own `topPercent` and its own tone. That is also why a grid resize reports the *activity's* edge: the rectangle a finger lands on is the activity. It is not draggable or resizable, and its `target` is the block that owns it, so a tap on it opens that block's editor. It inherits the block's color and its done mark, and carries no second line, because a five-minute strip has no room for one.

**A commute has no target, because it belongs to the day.** It hangs off the outer ends of the day's work, so there is no block behind it to open, and it is not draggable at all; the day header is what opens the day editor. It is never `done`, because work is not a task. Its key is `commute:<day>:<direction>`, which is the only key in the model with no board id in it.

**`id` is a view key, and it is unique across the whole model.** It is not a board id, because a commute has no board id and the same field has to be a string for all four tones. A key names the kind, the id, and — where a block is more than one strip — the part, so `session:s1:activity` and `session:s1:before` are two keys. A work interval and a session that somehow shared a raw id still get different keys. **This was a real bug the tests found**: the first version keyed a placed block by its owner alone, so a block with travel was three rectangles sharing one key, and the uniqueness sweep caught it. The key scheme is now the reason `block(model, 'session:s1:activity')` is how a test names the activity at all.

**The geometry is read off the stretch, not off the block that produced it.** A travel strip's height is its own minutes even though the block's length lives on the activity, so a rectangle and the numbers that placed it cannot disagree. A test resizes an activity's start edge through the real mutation and asserts the travel before it keeps its ten minutes and stays glued to the new left edge — a block is contiguous, so there is nothing else it could do — while the travel after it does not move at all. That test was wrong twice before it was right: the first version assumed the travel would stay put, and the second assumed a resize by ten minutes when the edge it named was fifty minutes away.

**A session whose task is not on the board is still drawn.** A stored blob can name a task that is gone, and the block holds real minutes, so hiding it would hide a real conflict. It is labelled `Task not on this board` and given `colorId: null`, because there is no task color to inherit and inventing one would be a lie. This widens what `null` means on `colorId` — it is no longer only work and commute — and it is the one addition this task made to the plan's own vocabulary. The alternative, dropping the block, would have made a conflicting block invisible.

**A row's `status` is `progress.ts`'s, not a second opinion.** A goal row nests the whole `GoalProgress`, so the sentence and the status a row renders cannot come from different calculations, and the orchestrator does not re-derive a number it is about to show. A test asserts a goal row's own keys are exactly the five it declares, which is what caught a probe that added a `status` beside `progress.status` where the two could have disagreed. A one-off row is a different case of the union: a day, a clock span read through the footprint so it includes travel, and a done mark — no quota, no fraction, and no way to be selected, since selecting a task is what places that task's defaults and a one-off has none. The list is goals first, then one-offs, each in the order the board holds them.

**`DAY_OPTIONS` exists for task 16's day select.** A day select is a dumb component and may not import this module, so the seven days and their names are carried out to the edge rather than read from `DAYS` inside a component. `DAY_LABELS` is a `Record<DayId, string>`, so a new day in the union fails the build here rather than producing a column with no name.

**A second real bug, found by a probe, and it was in the ruler.** `gridLines` first stepped by 30 *and* pushed a line at `minute + 30`, so every half hour was emitted twice and every half hour was labelled as an hour. The count of hour lines caught it. The loop is now one line per half hour with `major` decided by `minute % 60 === 0`.

**Thirty-seven wrong implementations were probed against the real file, and thirty-seven are caught.** The first pass caught thirty-four; the three that got through were all my probes being no-ops rather than tests being weak — a constant I added and never used, a property the type did not have, and a cache nothing ever wrote to — and the fourth was a real gap, the second status, which is now covered. Also caught: the day span hard-coded as 24 hours; the top measured from midnight; a line every fifteen minutes; a half hour with hour text on it; travel or work draggable; a commute naming a work interval; a done activity that stops being draggable; `Done` dropped from a done block; its length dropped to keep `Done`; a travel strip named after the block or given a second line; work wearing a hue; an orphan session left blank or given a made-up color; the goals sorted by name; the one-offs listed first; a column drawn bottom-up; a one-off clock span ignoring its travel; and either model cached and reused, which is the probe that proves the purity tests do something. Every probe was reverted and the file checked back against a backup.

### 13. Refusal copy [done]

Implement `refusalMessage` for every reason the mutations return.

Done when each reason has one stable sentence and a test that the sentence is non-empty and unique.

Done in `src/domain/refusal.ts` and `src/domain/refusal.test.ts` (6 tests). One export, `refusalMessage(reason): string`, a switch over the whole closed set with no default, so a reason that joins the union fails the build until it has a sentence. The sentence takes the reason and nothing else, so it can never name the block, the day, or the task: the banner is shown at the moment of the refusal, where the person already knows what they were trying to do, so the sentence says what is wrong and, where there is one, the next move — and the next move is one the app really offers, so `storage-unavailable` points at Backup and `missing-work` points at the day the work is on. A reason is shared across modules — `too-short` comes back for an activity, a work interval, and travel — so each sentence names every floor its reason covers rather than the one the nearest check produces. Every sentence is pinned word for word in a `Record<RefusalReason, string>` table, which is also a total map, so the compiler is the one that says a reason is missing from the table. Every sentence ends with a full stop, like the progress sentences, and no hyphenated identifier reaches a person. Two sentences are written for reasons no module produces yet — `invalid-backup` for task 15 and `storage-unavailable` for task 14 — so those tasks arrive with their wording pinned rather than each inventing a voice. One finding is worth keeping: the first version of the leak check asked each sentence not to contain its own reason code, and running it caught the sentence rather than the module — `overlaps` is the one code that is also a plain English word, and using that word in its own sentence is what the sentence is for, so the check is now against the hyphenated identifiers, which are the ones a person should never read.

### 14. Storage [done]

Implement load and save against an injected storage object.

Done when tests cover a round trip, a missing key returning the preset without writing, corrupt JSON returning the preset without writing, and `setItem` throwing `storage-unavailable` without throwing out of the function.

Done in `src/persistence/storage.ts` and `src/persistence/storage.test.ts` (30 tests). Exports: `STORAGE_KEY` (`weekly-planner.board`), `BoardStorage` (`Pick<Storage, 'getItem' | 'setItem'>`), `isBoard`, `loadBoard`, `saveBoard`. `JSON.parse` lives in one private `parseStoredText` that returns `unknown`, and the hand-written `isBoard` guard is the only narrowing — nothing casts parsed text to a `Board`. The guard is exported because task 15's import reads pasted text through the same guard, so a board that loads and a board that imports are judged by one shape rather than two that can drift.

Decisions recorded in the module header and pinned by tests:

- **Load never writes, on any path.** A missing key, a storage that cannot be read from, text that does not parse, and text that is not a board all hand back the preset, leave the stored text exactly as it was, and record no `setItem` call — the bad blob is not destroyed on load, and the next successful save is what replaces it.
- **The guard checks shape and closed sets only**: the version, all seven days, all twelve colors (read from `COLOR_IDS`, the one source of the list), the seven weekdays, strings, booleans, and finite numbers — JSON cannot spell `NaN`, but `1e400` parses to `Infinity`, so "finite" is a real check and not a flourish. It deliberately does not check that a session's task exists or that nothing overlaps: those are live-board invariants, task 15's import runs them after this guard, and a stored board that breaks them is drawn by the view models as it is rather than hidden.
- **Save writes one line of JSON.** The two-space pretty form is the Backup export, which a person reads in a text area; storage is not read by a person, so it carries no indentation.
- **`saveBoard` returns `Result<null>`.** A save has no product: the caller already holds the board, and the only fact worth reporting is whether it landed.
- **An unreadable storage reads as "no board here".** `getItem` throwing is handled like a missing key, because `loadBoard` must return a board; only `setItem` throwing is a refusal, and `storage-unavailable` already points at Backup.

The test's round trip is a week built through the real mutations — two tasks, a block with custom travel, a done block, weekend work, a commute, a done one-off — so it proves the document the app actually writes comes back, not a hand-typed shape that happens to match; an id source that throws proves a good blob builds no preset. Fifteen wrong implementations were probed against the real file and all fifteen were caught: rethrowing on a failed write, an ok that never writes, the pretty form, a handed-back board, another key, preset-on-missing-key writing, overwriting corrupt text, a cast instead of the guard, an unreadable storage left to throw, and the guard dropping the version, the seven days, color membership, the finite check, the kind discriminant, and the `travelFollowsDefault` flag. Every probe was reverted and the file diffed back identical against a backup.

### 15. Backup transfer [done]

Implement export and import. Import accepts only `unknown` narrowed by a hand-written type guard, then runs the same board invariants as live edits.

Done when tests cover a round trip, wrong `version`, a session pointing at a missing goal, an overlap, and a non-object payload. Each invalid case is refused and does not need a DOM.

Done in `src/persistence/transfer.ts` and `src/persistence/transfer.test.ts` (26 tests). Two exports: `exportBoardText(board)` — the two-space pretty JSON the plan calls for, version included, deliberately a different form from the one line `saveBoard` writes — and `importBoardText(text): Result<Board>`, which is the only place pasted text becomes a value. `JSON.parse` is isolated in one private function returning `unknown`, and the guard is task 14's exported `isBoard`, so a board that loads and a board that imports are judged by one shape rather than two that can drift; nothing casts parsed text to a `Board`.

**Every failure is `invalid-backup`, and the reason the individual checks produce is dropped on purpose.** Task 13 pinned that sentence to name the file rather than the grid, so leaking `missing-goal` or `overlaps` to a person holding a pasted document would be a lie about what they are looking at. The checks still return their reason for the debugger's benefit, and a test sweeps every invalid fixture and asserts the set of answers is exactly `{invalid-backup}` — so a second reason cannot appear quietly, and validation happens before the orchestrator opens the confirm dialog, which is what keeps "Nothing was replaced." true even when the person cancels.

**Import never repairs and never merges, and the invariants are asked through the doors the live mutations already go through rather than through a second copy of each rule.** `findGoal` for every session, `checkDayPlan` for every day on the day as stored (work legal, commute attached to that work, both inside 6:00–22:00 and clear of that day's blocks), and `checkFootprintFits` for every session and one-off, excluding the block by id. Those doors cannot see one thing: each excludes a single block by id, which is exactly how a move is checked without the block being in its own way, and a pasted file is the only caller in the app that can hand one door two blocks sharing an id. So a final sweep per day states the invariant with no id in sight — `dayOccupancy` already lists every stretch in clock order, so one walk holding the latest end is the whole check, touching allowed. The test fixture is built to make that sweep the *only* possible catch: two blocks with the same id on the same Tuesday hole, each of which fits alone.

**Deliberately not checked, and recorded rather than left to be wondered about:** the five-minute typed step and id uniqueness. The plan gives import the type guard plus the overlap and reference checks, and this module does exactly those. A step rule would judge a number nobody typed in this dialog, and refusing a file over 1:37 reads as the app's own arithmetic being wrong. Nothing downstream breaks — a drag snaps to fifteen, a typed field replaces the minute, and the view models draw what is stored rather than repairing it.

The round trip is a week the app really built through the real mutations (two tasks, three placed blocks including one whose travel the task no longer dictates and one already done, a done one-off, weekend work, a 20-minute morning commute, and blocks that *touch* other stretches exactly), so it proves the document the app actually writes comes back rather than a hand-typed shape that happens to match. Twenty invalid fixtures cover the five done-when cases and the rules behind them, each naming the check that catches it, and all are compact one-line JSON because a hand-edited file does not keep the app's indentation and import must not care how the text is spaced.

**Eighteen wrong implementations were probed against the real file and all eighteen are caught on the first pass** — the compact export form, an export dropping the version, an export dropping `travelFollowsDefault`, a cast instead of the guard, `JSON.parse` throwing out, a leaked reason, a repair instead of a refusal, a guard that only asks whether the text is an object, each of the four checks removed in turn, a sweep that read touching as a shared minute, a block excluded by the wrong kind and then by task instead of by id, and a round trip that handed back an emptied board. Every probe was reverted and the file diffed back identical against a backup.

### 16. Dumb chrome [done]

Build `Modal`, `ConfirmDialog`, `RefusalBanner`, and the small fields those forms need: color swatches, duration inputs, day select. Props are explicit interfaces. Events are the callbacks in the table above. No domain imports except types and display helpers.

Done when these components compile, contain no quota or overlap logic, and `Modal` closes only by calling `onClose`.

Done in `src/components/` — `Modal.tsx`, `ConfirmDialog.tsx`, `RefusalBanner.tsx`, `ColorSwatches.tsx`, `DurationInput.tsx`, `DaySelect.tsx` — plus `component-rules.test.ts` (7 tests). The three fields are the plan's "small fields those forms need", and they are the pieces task 17's four forms are built out of, so they were built to be handed a value and emit a change and nothing else. Each component imports exactly one thing: `Modal` imports React, `ColorSwatches` imports `@/colors/palette`, `DurationInput` and `DaySelect` import types, and `ConfirmDialog` imports `Modal`.

`Modal` holds **no state at all**, which is the whole of how it closes only by calling `onClose`. There is no `open` prop to honor and no `setOpen` to call, so it cannot decide to close itself, cannot reopen itself, and cannot disagree with the orchestrator about whether a dialog is showing. Escape is listened for on the document rather than on the panel, because a key handler on the panel only fires while something inside it has focus, which is not guaranteed the moment a dialog appears; the listener is removed on cleanup so a closed dialog leaves nothing behind to eat a keystroke. The panel takes focus when it opens, without moving the scroll, because a dialog that leaves focus on the page behind it is read aloud as nothing at all — and **a tap on the dim area deliberately does not close**, since on a phone a stray thumb lands there easily and every dialog in this app holds a form somebody has already typed half of.

Two smaller decisions are recorded in the file headers. `ConfirmDialog` cannot tell whether it is a reset, a delete, or an import — title, message, and both labels are props — so the three confirmations cannot drift into sounding like three apps; and it routes Escape *and* the modal's Close button through `onCancel`, because the answer that destroys nothing is the answer a stray keystroke should give. The filled button is the one that goes ahead and it sits on the far side of the row, so the thumb that lands on the edge of a dialog lands on the safe answer; nothing in it is red, since a hue on this board means a task. `RefusalBanner` shows a sentence it was given and is stone rather than a palette color, because a color on screen here is a task the person would then look for on the grid; `role="status"` is polite, and the banner stays until it is dismissed or the next successful change replaces it, since a refusal that vanished on a timer would be a refusal nobody could act on.

**The three fields each solve one question the domain cannot answer for them.** `ColorSwatches` takes its background from `PALETTE`, so nothing in the file can assemble a class name out of a hue and a shade; it renders twelve buttons rather than a picker, because a person choosing between twelve known colors should see all twelve and a dropdown hides eleven behind a tap; the selected swatch is marked with both `aria-pressed` and a ring, since the product is explicit that color is never the only thing distinguishing two things. `DaySelect` takes its seven options as a prop and declares the shape of an option itself rather than importing it — a dumb component does not get to know where its data came from, and the orchestrator passing its options to the prop is what makes the compiler check the two shapes against each other. It looks a choice up among the options it offered rather than trusting the browser's string, which is what lets it report a `DayId` with no assertion anywhere.

**`DurationInput` is the one field with any machinery in it, and it has state for its own text and nothing else.** A controlled number box cannot be emptied — clearing it puts a number straight back and the next digit appends to that — so both boxes hold text locally, and the boxes are refilled from the props *only when the props actually move*, which is another block in the same editor, an imported board, or a change made elsewhere. They are deliberately **not** refilled when an edit was refused: a refusal leaves the prop exactly where it was, and wiping the box would throw away the number the person had just fixed in favour of the number that was already wrong. An empty or half-typed box reports nothing at all rather than reporting a zero, so the domain is never asked about a length nobody finished typing. The minutes box steps by five and the hours box does not, and that is arithmetic rather than a style choice: an hour is sixty minutes, so a whole number of hours plus a multiple of five is *always* a multiple of five, which means whatever this field reports is already on the step the domain asks about and the two rules cannot contradict each other. The minutes box is left uncapped, because `100` typed there is a fair way of writing one hour and forty minutes and is read as exactly that.

**The rules this folder lives by are tested against the components' own source rather than by rendering them**, in `src/components/component-rules.test.ts` — the plan forbids rendering components and there is no jsdom here, so a `?raw` glob reads the files as text and never executes them. Three things are pinned: no component imports a rule module (the eight that own a rule, including `refusal.ts` because the sentences are handed down ready-made and `board.ts` because a component must never build or reset a board), every component's declared callbacks are exactly the ones the plan's events table names, and `Modal` names no callback but `onClose`, holds no state, and has exactly one tap handler. The glob is the whole folder rather than a list, so a component added in task 17 is covered from the moment it exists.

**One test was wrong on its first pass and one probe exposed a false negative, both worth recording.** The callback reader originally matched every `on[A-Z]` name in a file, which counted React's own `onClick` and `onChange` as though the app had asked for them; it now reads the callbacks each component *declares*, which is the thing the events table is about — a component cannot be handed anything it did not ask for. And the "a tap beside the panel does not close" check originally found the backdrop by its class names, so it passed *vacuously* the moment that element was formatted across lines: a test written about source text has to fail loudly when it cannot find what it is looking for, and it now pins the number of tap handlers in the file instead. Probing the real files caught all four guards — a component importing `refusal.ts`, `Modal` growing an `onConfirm` and some state, a backdrop handler reformatted across lines, and a seventh component nobody had declared in the events table. Every probe was reverted and the files diffed back against a backup.

A throwaway render probe (`react-dom/server`, deleted immediately) confirmed all six render without throwing, that the modal carries `role="dialog"` and `aria-modal`, that there are twelve swatches with the chosen one pressed, that 300 minutes reads `5` and `0`, and that the day select offers its options in the order it was given. Its one failure was the probe's own arithmetic, not the component's. **Not verified: the interactive behavior** — typing into the duration boxes, dragging a swatch, pressing Escape — which needs a browser this session has none of, so it is left to task 18's orchestrator and task 19's layout to exercise on the dev server.

### 17. Dumb planning surfaces

Build `WeekGrid`, `TaskList`, `GoalForm`, `OneOffForm`, `DayEditor`, `SessionEditor`, and `BackupPanel`. The grid draws from `GridBlockView` and reports snapped pointer results. It does not call placement checks. Forms submit drafts and do not save. `GoalForm` receives `kindLocked` when editing. `BackupPanel` shows the export text and emits the pasted string. It does not parse it.

Done when a search of `components/` finds no imports from `goals.ts`, `sessions.ts`, `work.ts`, `schedule.ts`, `progress.ts`, or `persistence/`.

### 18. Orchestrator

Implement `BoardOrchestrator`. On mount, load the board. Keep dialog state, the selected goal id, the refusal string, and the storage notice. Each user event calls one domain or persistence function. Success replaces state and saves. Failure shows `refusalMessage` and keeps the previous board.

Wire the flows in the product scope: place, move, resize, done, delete session, create and edit both goal kinds, delete goal after confirm, one-off create and edit, day editor, reset after confirm, backup copy, and import after confirm. Selecting a goal then tapping empty grid places that goal's defaults. Add event then tapping a slot opens the one-off form at that time.

Done when no schedule arithmetic is written inside the orchestrator, and a refused drop does not save.

### 19. Phone layout

Apply the mobile-first layout: task list available immediately, scrolling week chart, sticky day headers, quiet Backup button under the grid, wider layout optional. Use Tailwind utilities only. Names are visible on blocks, not color alone. Done stays colored and reads `Done`. Unplaced or unfinished goals are visually distinct via the status from the view model.

Done when the default styles target a phone width, and no desktop-only hover action is the only way to place, edit, mark done, or reset.

### 20. Project readme

Replace the one-line README with how to install, run, test, and build, plus links to the two docs. Do not copy the product rules into the README.

Done when a new checkout can follow the README without reading this plan.

### 21. Finish line

Run `npm test`, `npm run lint`, and `npm run build`. Remove unused starter files, unused exports, and any `any`. Confirm the runtime dependency list is only React and React DOM.

Done when all three commands exit 0 and the behaviors in the product scope can be performed through the orchestrator events.

## Known limits

- Two open tabs: the last save wins. Do not add cross-tab sync.
- `file://` is unsupported.
- Clipboard copy can fail. The text area is the backup path.
- Invalid stored JSON is left in place until the next successful save, so a bad blob is not destroyed on load.
- There is no undo besides marking a block not done and cancelling a confirm dialog.

## Handoff

Implementation starts at task 1. Do not add a task that the product scope marks out of scope. If a rule here conflicts with the product scope, the product scope wins, except the Backup section and the Tailwind decision, which are agreed additions.
