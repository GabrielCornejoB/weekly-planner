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
    WeekGrid.tsx
    TaskList.tsx
    GoalForm.tsx
    OneOffForm.tsx
    DayEditor.tsx
    SessionEditor.tsx
    BackupPanel.tsx
    RefusalBanner.tsx
```

Tests sit next to the module they cover: `time.test.ts` beside `time.ts`.

`App.tsx` only renders `BoardOrchestrator`. It contains no schedule rules.

### Who may import what

Dumb components may import types, `colors/palette.ts`, and pure display helpers from `domain/time.ts`. They may not import mutation modules, `schedule.ts`, `progress.ts`, or persistence.

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

`RefusalReason` is a closed union. At least: `outside-day`, `overlaps`, `too-short`, `not-a-step`, `empty-name`, `name-too-long`, `invalid-quota`, `kind-locked`, `missing-goal`, `commute-without-work`, `invalid-backup`, `storage-unavailable`. Wording lives in `refusalMessage(reason): string`, which tests cover. Components render that string. They do not build it.

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

### 6. Palette

Add the twelve `ColorId` values and a map of complete Tailwind class strings for the solid shade, the soft shade, and readable text. Implement `nextColorId`.

Done when a test shows the first unused id is chosen, a used id is skipped, and the map values contain no interpolated class names.

### 7. Footprints and placement checks

Implement occupancy for work, commute, session travel, session activity, and one-offs. Implement the check that a proposed footprint fits in the day and does not overlap anything already there.

Done when tests cover: morning commute ends at the first work start and evening commute starts at the last work end; a middle work fragment gets no commute; a day with no work and a non-zero commute is refused; travel is occupied time but is not activity length; a block that would cross work is refused; a block that fits in 12:00–14:00 is accepted; a block ending at 22:00 is accepted; touching work intervals are accepted; overlapping work intervals are refused.

### 8. Work and commute mutations

Implement add, move, resize, and remove for work intervals, plus set commute. Removing the last interval clears commute. Changing the outer start or end recomputes the commute footprint and refuses if that footprint hits a session or leaves 6:00–22:00.

Done when tests cover the product examples: leave at 12:00 by removing 14:00–17:00; start earlier than 8:00; appointment day with work at 10:00–12:00 and 14:00–17:00; appointment day with work at 8:00–9:30, 10:30–12:00, and 14:00–17:00. Also cover a weekend gaining a work interval, and a commute change refused because a session is in the way. The input board in each test is unchanged.

### 9. Goal mutations

Implement create and update for both kinds, delete, and default-travel propagation. Kind is fixed after create. Delete removes that goal's sessions and no others. Empty names, names over 40 characters, a count below 1, and a time quota below 15 minutes are refused. Default activity length is at least 15 minutes.

Done when tests cover type lock, color and name living on the goal, custom session travel surviving a default-travel edit, non-custom session travel updating, and delete removing only that goal's sessions.

### 10. Session and one-off mutations

Implement place, move, resize, set travel, set done, and delete. Place copies the goal's default length and travel and sets `travelFollowsDefault` to true. Move of a done session keeps it done and leaves no block on the old day. A second session of the same goal on the same day is allowed. Resize of a done session changes the activity minutes that progress will later sum. Delete of a done session removes it. One-offs have no quota and no `travelFollowsDefault` flag.

Done when tests cover those cases, including a move from Monday to Friday and a refusal that returns the original board.

### 11. Progress sentences

Implement the quota math and the list sentences from this plan.

Done when tests match the five table rows, a travel-heavy study session whose activity is 1 hour does not count the travel, two gym visits of different lengths count as 2, and the 1:40 wording uses hours and minutes rather than a decimal.

### 12. View models

Implement `toGridModel(board)` and `toTaskListModel(board)`. Grid blocks carry percents, tone, color id, done, and drag flags. List rows carry the progress sentence and a status the component can map to classes: `unplaced`, `planned`, `met`, or `over`. Status is derived, not stored.

Done when a test checks the 15-minute and 100-minute heights, commute and travel are not draggable, work and activity are draggable, and a goal with unplaced time is `unplaced`.

### 13. Refusal copy

Implement `refusalMessage` for every reason the mutations return.

Done when each reason has one stable sentence and a test that the sentence is non-empty and unique.

### 14. Storage

Implement load and save against an injected storage object.

Done when tests cover a round trip, a missing key returning the preset without writing, corrupt JSON returning the preset without writing, and `setItem` throwing `storage-unavailable` without throwing out of the function.

### 15. Backup transfer

Implement export and import. Import accepts only `unknown` narrowed by a hand-written type guard, then runs the same board invariants as live edits.

Done when tests cover a round trip, wrong `version`, a session pointing at a missing goal, an overlap, and a non-object payload. Each invalid case is refused and does not need a DOM.

### 16. Dumb chrome

Build `Modal`, `ConfirmDialog`, `RefusalBanner`, and the small fields those forms need: color swatches, duration inputs, day select. Props are explicit interfaces. Events are the callbacks in the table above. No domain imports except types and display helpers.

Done when these components compile, contain no quota or overlap logic, and `Modal` closes only by calling `onClose`.

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
