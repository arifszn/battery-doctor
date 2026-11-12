---
name: battery-doctor
description: Find what drains an Android phone's battery and make a charge last longer. Connects to the phone over USB, reads its own battery statistics, shows an HTML report with the trend across checkups, and applies reversible fixes only after the user confirms each one. Use when the user says their phone battery drains fast, dies early, drains overnight or while idle, gets hot, or asks for a battery checkup, a battery health check, what is using their battery, or whether a change improved it. Android only; works on macOS, Windows and Linux.
---

# battery-doctor

Check an Android phone's battery over a USB cable, explain what drains it in plain words, fix what the user agrees to, and show whether it got better on the next checkup.

Everything runs through one script. `<skill-dir>` is the folder this file is in:

```
node <skill-dir>/battery-doctor/scripts/doctor.mjs <command>
```

It needs Node 18 or later and nothing else. If `node` is missing, tell the user to install it from https://nodejs.org and stop.

## Rules

1. **Say what is collected before the first checkup.** The checkup reads the phone's battery statistics, the list of installed apps and how long each was used. It saves them on this computer under `~/battery-doctor/`. You (the assistant) read a summary that includes app names and usage times. Tell the user this in two sentences and continue unless they object.
2. **Never change the phone without a yes to that exact change.** "Fix it" or "go ahead" at the start is not a yes. Show each change and what it costs the user, and let them pick.
3. **Change the phone only with `doctor.mjs apply`.** Never run your own `adb` commands that write, install, uninstall, disable, clear or reboot. The script allows three reversible actions and refuses the rest.
4. **Use plain words.** The user is not technical. Say "runs in the background", not "foreground service". Use app names, not package names. Give hours and percent, not mA.
5. **Do not guess.** Every number you say comes from the script's output. If the output says NOT ENOUGH DATA, say so.

## Step 1: Connect

Run `status`. Act on the line that starts with `adb:` and the line that starts with `phone:`.

| Output | What to do |
|---|---|
| `adb: NOT INSTALLED` | Ask: "I need Google's Android connection tool (adb, about 15 MB, from Google's site, under the Android SDK terms). Download it?" On yes, run `get-adb`. |
| `phone: NOT FOUND` | Run `guide`. It opens a picture guide in the user's browser that shows how to turn on USB debugging. Then read `battery-doctor/references/setup-phone.md` and walk the user through it, one step at a time. Run `status` again after each step they finish. |
| `phone: ... is UNAUTHORIZED` | Ask the user to unlock the phone and tap **Allow** on the "Allow USB debugging?" prompt. If they see no prompt, run `guide` and point them to its last section. |
| `phone: READY ...` | Go to Step 2. |

If the output has a `## Plan` block, read it before anything else. It says what the last session was testing, when the next checkup is due and what is still open. Tell the user in one or two lines and follow it: if the next checkup is due, go to Step 2. If it says the plan is older than the latest checkup, update it (Step 5).

## Step 2: Check

Give the notice from Rule 1, then run `check`. It takes under a minute, prints a summary, saves the checkup and writes the report.

Read the whole output. If it contains `PLAN before this checkup`, judge the result against its `Testing` line first. If it contains `SAME CHARGE PERIOD`, tell the user this checkup repeats the last one and when a new one will be useful. If it contains `NOT ENOUGH DATA`, tell the user why and when to come back: use the phone unplugged for most of a day, do not restart it, and run the checkup before charging. You can still tell them what the short checkup shows, clearly marked as incomplete.

## Step 3: Explain

1. Write `findings.json` into the checkup folder printed by `check`. Format and writing guidance: `battery-doctor/references/report.md`. It carries a one-sentence headline, readable app names, and manual fixes for this phone's brand.
2. Run `report`. It rebuilds the report and opens it in the browser. Tell the user where the file is.
3. In the chat, give at most five lines: how much screen time a full charge gives (and the change since the last checkup), how fast the phone drains while idle against the healthy level, the top one to three causes, and whether the battery itself is worn.

To interpret the numbers, read `battery-doctor/references/reading-results.md`.

## Step 4: Fix

1. List the fixes from the `check` output, most useful first. For each: what it does, and what it costs the user (the `Cost:` text). Mark each as "I can do this for you" (`auto`) or "you do this on the phone" (`manual`).
2. Add manual fixes that fit this phone from `battery-doctor/references/brands.md`.
3. Ask which ones they want. Wait for the answer.
4. For each chosen `auto` fix, run `apply <action> <target> --yes`, using the action and target from its fix id (`restrict-background:com.example.app` becomes `apply restrict-background com.example.app --yes`). Report the result line by line. If the output says `verified on the phone: NO`, say that the change may not have taken.
5. For each chosen `manual` fix, give the steps and wait until the user says it is done. Then run `note "<what they did>"`, for example `note "Put Maps into deep sleep"`, so the report marks it on the calendar. Do the same when the user says they changed something on the phone themselves, or reversed it.

Details of each action and how to undo: `battery-doctor/references/fixes.md`.

## Step 5: Check again

Tell the user: use the phone as usual for a day, keep it unplugged, do not restart it, and come back before charging. When they return, run `check` again. The output compares the new checkup with the previous one, and the report shows every checkup on a calendar with the changes marked.

Compare fairly. A period that includes a night drains slower than a daytime one, so say which kind each checkup covers when they differ.

Then write `plan.json` (format in `battery-doctor/references/report.md`): what the next checkup tests, when and how to take it, what the user still has to decide, what is not explained yet, and which fixes they turned down and why. Run `report` so the report shows it. Update the plan after every `check`, and whenever the user decides something or changes the phone by hand.

## Other requests

- "Undo that" or "put it back": run `changes` to list them, then `undo <id>` or `undo all`. A note of a hand fix cannot be reversed by the script: give the user the steps to reverse it, then run `note` for the reversal.
- "Show the report": run `report`.
- "Apply fix F1" (a number from the report): run `fixes` to see what that number is in the latest checkup. Confirm that exact change with the user (Rule 2), then follow Step 4.
- "What's next?" or "What were we doing?": run `plan`.
- "Is it better?": run `check` if the last checkup is older than the last change, otherwise read the comparison from the last `check`.

## Reference files

Read each when you reach it; not all at once.

- `battery-doctor/references/setup-phone.md`: turning on USB debugging, computer setup per operating system, connection problems (Step 1)
- `battery-doctor/references/report.md`: the `findings.json` and `plan.json` formats (Steps 3 and 5)
- `battery-doctor/references/reading-results.md`: what each number means, the thresholds, how far to trust each source (Step 3)
- `battery-doctor/references/fixes.md`: the three allowed changes, their costs, undo (Step 4)
- `battery-doctor/references/brands.md`: where battery settings live on each phone brand (Step 4)
