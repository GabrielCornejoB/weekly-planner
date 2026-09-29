# Weekly Planner — Product Scope

This is the product scope for the first version. It describes what the app is, what it is not, and the rules the plan must follow. It does not choose technologies, storage, or visual design details.

Technical decisions and the build tasks are in [PRD.md](../PRD.md).

The app is a personal, mobile-first weekly planner. One person uses it on one device to fill a Monday–Sunday board with work time and the tasks they intend to do, then marks what they actually did. The board is a plan they edit by hand. It is not a calendar that advances on its own, and it does not build the schedule for them.

## Who it is for

One person, planning their own week. No accounts, no sharing, and no second user.

## The board

The main view is a time chart:

- Seven columns, in this order: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday.
- The day runs from 6:00 to 22:00. A block may start at 6:00 and may end at 22:00. Nothing may start earlier or end later.
- Column labels are the day names only. There are no dates, no highlight on today, and no line for the current time.
- Hour lines are the main guides. Half-hours are faint. There is no line every 15 minutes.
- A block’s height matches its real duration. Fifteen minutes looks short. One hour 40 minutes looks like one hour 40 minutes.
- Dragging snaps to 15 minutes, so a thumb can hit a time. Typed times can use 5-minute steps, so a session can be 1:40.
- The shortest activity is 15 minutes. Travel and commute can be 5 minutes, or absent.

There is always exactly one board. It stays on this device if the page is closed. It is not tied to the real calendar. Nothing is kept after a reset, and there is no next week to open.

## How time is occupied

Only one thing can occupy a moment. These all take exclusive time:

- a work interval
- the commute attached to work
- the activity part of a session or one-off
- the travel attached to a session or one-off

If a change would make two of those overlap, or would cross 6:00 or 22:00, the app refuses it and says why. It does not move or delete something else to make the change fit.

A session, including its travel, must sit entirely inside one free stretch. It cannot cross work or commute. The app does not split a session across a work interval.

## Work

Work is blocked time, not a task. It has no quota and cannot be marked done. Its look is neutral, so it is not mistaken for a colored task.

Work is made of intervals the person adds on a day. A day may have several, because a single range with one hole cannot express the real week.

The usual weekday is two intervals:

| | Time |
| --- | --- |
| Morning work | 8:00–12:00 |
| Afternoon work | 14:00–17:00 |

12:00–14:00 is free because no work interval is there. It is not a special gap object. Saturday and Sunday start with no work. No day starts with a commute.

On any day, the person can:

- add a work interval
- move, shorten, lengthen, or remove one
- remove all of them, which makes that day a day off
- add work to a weekend

Intervals on the same day cannot overlap. They may touch. The shortest interval is 15 minutes.

Examples the model has to allow:

- Leave at 12:00: remove 14:00–17:00. Morning work can stay 8:00–12:00.
- Start earlier than 8:00: move the morning start earlier, but not before 6:00, and only if the commute still fits.
- Appointment 8:00–10:00, then back at work: morning work is 10:00–12:00, afternoon stays 14:00–17:00, and the appointment is a one-off in the free time.
- Appointment 9:30–10:30: work is 8:00–9:30, 10:30–12:00, and 14:00–17:00. The appointment sits in the hole, with its own travel if it has any.

There is no separate “second gap” feature. A hole is just time with no work interval. Adding the surrounding work intervals creates it.

### Commute to work

Some days include travel to work and some do not. Each day can have travel before work, after work, both, or neither. The two directions can have different lengths. The default is neither.

Commute is not a task. It blocks the grid, does not count toward any goal, and is drawn as travel attached to work, distinct from solid work and from a task’s travel.

It attaches only to the outer ends of the day’s work:

- morning commute ends when the first work interval starts
- evening commute starts when the last work interval ends

It does not attach to every fragment, and it does not represent a trip home at lunch. A trip to a midday appointment belongs to that appointment. If the day has no work intervals, it cannot have a commute.

Changing the first start or the last end moves the attached commute with it. Lengthening a commute grows it outward. If that would hit another block, or cross 6:00 or 22:00, the change is refused until the person moves the other block or shortens the commute.

## Tasks

A weekly goal is a named task with a color and a quota. There are two kinds. A one-off event is separate: it occupies time, but it is not a goal.

| | Time budget | Visit count | One-off |
| --- | --- | --- | --- |
| Example | Study 5 hours | Gym 3 times | Dentist, dinner |
| Quota | A total amount of activity time | A number of visits | None |
| What a placed block needs | Its own activity duration | A duration, because it still takes time | A start and end |
| What counts toward the goal | Done activity time only | One done visit, whatever its length | Nothing |
| Travel | Optional. Does not count | Optional. Does not count | Optional. Does not count |

Creating a time-budget or visit-count task asks for:

- name
- color
- the weekly quota
- a default activity length, used when a block is placed, and editable on that block afterward
- optional default travel before, after, or both

A visit-count quota is a whole number, at least 1. A time quota and a default length can use hours and minutes, not only whole hours. The default activity length is at least 15 minutes.

The type cannot be changed later. The name, color, quota, default length, and default travel can. Name and color update every block of that task. A quota change only changes the numbers; it does not add or remove blocks. Default travel applies to blocks that are still using the default. A block whose travel was edited keeps that edit.

A one-off has a name, a color, a time, and optional travel. It is created on a free slot, not from a quota. It can be marked done. Deleting it removes that event.

## Travel on a task or one-off

Travel is optional. When a task has it, every new block of that task uses the same before and after lengths. Either side can be zero. One block can override those lengths, including clearing them, when that day is different.

Travel is drawn on the block and is visually distinct from the activity, in the same color family. It moves with the block. It occupies the grid. It never counts toward a time quota, a visit, or the visit’s activity length.

## Placing the plan

The person places every block. The app does not suggest or fill the week.

Placing a goal means choosing that task and putting a block on a free stretch. The block starts at the default activity length and default travel. The person can then move it, resize the activity, or edit that block’s travel.

Placing a one-off means choosing a free slot and giving it a name, color, time, and optional travel.

A second visit of the same task on the same day is allowed. It counts as another visit.

The person can also:

- mark a block done, or mark it not done again
- move a block, including one that is already done
- resize a block; if it is done, the done total follows the new activity length
- delete a block; if it was done, that credit is removed
- delete a task, after confirmation, which removes all of its blocks

Deleting one block should be easy. Resetting the board, or deleting a whole task, must ask for confirmation first.

Moving a block from Monday to Friday moves it. Monday does not keep a copy, a ghost, or a missed mark. There is no skipped state. If a visit will not happen, the person moves it or deletes it.

## Progress

The task list shows every goal and every one-off. A goal shows three facts:

- how much is done
- the goal
- how much is not on the grid yet

A block counts toward “done” only after it is marked done. Time on the grid that is still planned does not count as done. Travel never counts.

Unplaced is the goal minus everything already placed, and it cannot go below zero. Placing or finishing more than the goal is allowed. The list shows the real done number, including 4 of 3, or 6 hours of 5. Times are shown in hours and minutes, not decimals.

Worked examples for a 5-hour study goal:

| On the grid | List shows |
| --- | --- |
| 2 hours done, 2 hours still planned | 2 hours done of 5. 1 hour is not on the grid. |
| 6 hours placed, 2 hours of that done | 2 hours done of 5. Nothing is unplaced. 1 hour more than the goal is on the grid. |
| 6 hours done | 6 hours done of 5. Nothing is unplaced. |

Worked examples for a 3-visit gym goal:

| On the grid | List shows |
| --- | --- |
| 1 visit done, 1 still planned | 1 of 3 done. 1 visit is not on the grid. |
| 4 visits done | 4 of 3 done. Nothing is unplaced. |

The visit’s duration is visible on the block. It is not added up into the gym goal.

A one-off has no fraction. Done is only a mark on that event.

Goals that are not fully placed, or not fully done, must be easy to see in the list. The grid must make a done block look settled without losing its color, so the week can still be read at a glance.

## Color

Each task and each one-off has a color so it can be recognized on the grid. The app suggests a distinct color. The person can change it, and the change applies to every block of that item. The name is also shown on the block. Color is not the only way to tell blocks apart.

Work does not use a task color.

## What must be easy on a phone

The phone is the primary layout. On a phone, without depending on a precise mouse, the person must be able to:

- see the week and the goal list
- add a goal or a one-off
- place, move, resize, and delete a block
- mark a block done or not done
- change a day’s work intervals and commute
- change a color, a quota, or a block’s travel
- reset the board

The goal list can sit with the grid or open from it, but the quotas have to be reachable without guessing where they went.

## Reset

Reset puts the board back to the blank preset:

- Monday–Friday work at 8:00–12:00 and 14:00–17:00
- Saturday and Sunday with no work
- no commute
- no tasks, one-offs, blocks, or done marks

It asks for confirmation first. Past boards are not kept. Task definitions do not survive reset. The next plan is created again from scratch.

## First open

The first open shows the preset work intervals and an empty task list. There is no setup wizard. The person adjusts days, adds goals, and places blocks.

## Backup

A quiet Backup control sits away from the grid. It is visible, but it is not part of planning. Copying produces the whole board: work hours, commute, tasks, colors, placed blocks, and done marks. Importing that text replaces the current board after confirmation. It does not merge, and it does not keep the previous board. This is a manual transfer, not an account and not sync.

## Out of scope

- accounts, sync, and automatic updates across devices
- more than one board, past weeks, next week, dates, or a today marker
- reminders and notifications
- building or suggesting a schedule
- a skipped, missed, or “original plan versus what happened” state
- keeping tasks or custom work hours after reset
- copying one day’s hours onto other days
- a dedicated split command; the person shortens a block and places another
- notes, categories, priorities, and tags beyond the name and color
- changing a goal from a time budget into a visit count, or the reverse
- commute between work fragments, including going home for lunch
- sharing with another person, and undo beyond marking a block not done
- treating work as something to check off

## Decisions made while scoping

These were chosen so the rules would stay understandable. They are part of the scope, not open questions.

| Topic | Decision |
| --- | --- |
| Who places blocks | The person. The app only enforces the rules and shows quotas. |
| Grid | Hours 6:00–22:00 are the scale. Blocks use their real length. Dragging snaps to 15 minutes. Typed times can use 5-minute steps. |
| Done | The grid is the live plan. A block is planned or done. Moving it does not leave a record behind. |
| Missed visit | Move it or delete it. There is no skipped state. |
| Over the goal | Allowed. The list shows the real number. |
| Travel and the quota | Travel occupies time only. It does not count toward the goal. |
| Week | One undated Monday–Sunday board. The person clears it with Reset. |
| Work | Several intervals per day, not one range with a single hole. The usual day is 8:00–12:00 and 14:00–17:00. |
| Work commute | Optional before the first interval and after the last, set per day. Default is none. |
| Memory | This device, until Reset. No archive. |
| Backup | A quiet control copies the whole board as text. Import replaces the board after confirmation. |
