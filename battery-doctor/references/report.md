# Adding your explanation to the report

The script builds the report from the saved checkups. It works without you. You make it readable by writing one file, `findings.json`, into the checkup folder that `check` printed, then running `node <skill-dir>/scripts/doctor.mjs report`.

## Format

Every field is optional.

```json
{
  "headline": "A full charge now gives about 5 hours of screen time, up from 4 hours two days ago.",
  "appNames": {
    "com.instagram.android": "Instagram",
    "com.sec.android.app.launcher": "Home screen"
  },
  "explanations": {
    "idle-drain": "Two apps ran in the background for most of the day: Trail Tracker for 15 hours and Maps for 9."
  },
  "manual": [
    {
      "title": "Put apps you rarely open into deep sleep",
      "why": "Samsung stops these apps completely until you open them.",
      "action": "Add them to Deep sleeping apps",
      "tradeoff": "No notifications from those apps until you open them.",
      "steps": ["Open Settings, then Battery", "Tap Background usage limits", "Tap Deep sleeping apps, then the plus sign"]
    }
  ]
}
```

| Field | What it is |
|---|---|
| `headline` | One or two sentences at the top of the report: where the battery stands now. Lead with the screen time a full charge gives, and with the change since the last checkup when there is one. If left out, the script writes one from the numbers. |
| `appNames` | A readable name for each package name that appears in the `check` output. Use the name the user sees on their phone. Leave out any you are not sure of. |
| `explanations` | Keyed by the problem id from the `check` output (the text between `]` and `:`, for example `idle-drain` or `always-running:com.example.app`). Replaces the script's default sentence for that problem. |
| `manual` | Fixes the user does by hand, usually from `brands.md`. `steps` are shown as a numbered list. |

## Writing guidance

- Write for someone who has never opened a settings menu. Short sentences, no jargon, no package names.
- Use only numbers that appear in the `check` output.
- `headline` states the result, not the method. Good: "A full charge now lasts about a day." Bad: "I analysed your batterystats dump."
- An `explanation` names the cause, with its numbers. Start with the cause. Do not repeat the title or restate the problem in general words ("your phone keeps working while unused").
- A `tradeoff` says what the user loses. If nothing, leave it out.
- Do not use emoji.

## The plan

Write `plan.json` in the phone's folder (the folder above `checkups`; `node <skill-dir>/scripts/doctor.mjs plan` prints the path). There is one plan per phone. Replace the whole file each time; every field is optional.

```json
{
  "testing": "Maps is stopped from running in the background. The next checkup shows whether idle drain falls under 1% an hour.",
  "nextCheckup": { "after": "14 Nov 2026", "how": "Use the phone unplugged for a normal day, do not restart it, and check before charging." },
  "decide": ["Whether the watch connection is worth about 1% an hour while idle."],
  "investigate": ["What wakes the phone about 1,700 times a day through app timers."],
  "notDoing": [{ "what": "Restricting Telegram", "why": "It uses little in the background, and messages would arrive late." }]
}
```

| Field | What it is |
|---|---|
| `testing` | The change the next checkup measures, and what result would show it worked. |
| `nextCheckup` | `after`: the earliest useful date. `how`: the conditions that make the checkup comparable. |
| `decide` | Choices the user still has to make, each with the figure it depends on. |
| `investigate` | Causes not explained yet. |
| `notDoing` | Fixes the user turned down or that are not worth it, with the reason, so they are not offered again. |

Write it after the user picks fixes, and again after every `check`. Same writing rules as below.

## What the report shows

A drawing of the phone with the screen time a full charge gives, its idle drain and battery curve, a one-sentence verdict, the fix list numbered F1, F2 and so on, two curves (screen time per charge, and idle drain against the healthy limit), a calendar with both figures on each day that has a checkup and the changes marked, the plan under Next steps, and a Details section. Choosing a day in the calendar, or a checkup in the Details list, shows that checkup on the phone drawing and in the figures below it. The user can refer to a fix by its number.
