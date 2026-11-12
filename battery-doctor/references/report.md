# Adding your explanation to the report

The script builds the report from the saved checkups. It works without you. You make it readable by writing one file, `findings.json`, into the checkup folder that `check` printed, then running `node <skill-dir>/scripts/doctor.mjs report`.

## Format

Every field is optional.

```json
{
  "headline": "With the screen off your phone loses 1.9% per hour, down from 3.3% two days ago. A healthy phone loses under 1%.",
  "appNames": {
    "com.instagram.android": "Instagram",
    "com.sec.android.app.launcher": "Home screen"
  },
  "explanations": {
    "idle-drain": "Your phone keeps working when you are not using it. The two apps below are the main reason."
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
| `headline` | One or two sentences at the top of the report: where the battery stands now. If left out, the script writes one from the numbers. |
| `appNames` | A readable name for each package name that appears in the `check` output. Use the name the user sees on their phone. Leave out any you are not sure of. |
| `explanations` | Keyed by the problem id from the `check` output (the text between `]` and `:`, for example `idle-drain` or `always-running:com.example.app`). Replaces the script's default sentence for that problem. |
| `manual` | Fixes the user does by hand, usually from `brands.md`. `steps` are shown as a numbered list. |

## Writing guidance

- Write for someone who has never opened a settings menu. Short sentences, no jargon, no package names.
- Use only numbers that appear in the `check` output.
- `headline` states the result, not the method. Good: "A full charge now lasts about a day." Bad: "I analysed your batterystats dump."
- An `explanation` says why it matters to the user and what causes it. Do not repeat the title.
- A `tradeoff` says what the user loses. If nothing, leave it out.
- Do not use emoji.

## What the report shows

A drawing of the phone with its idle drain and battery curve, a one-sentence verdict, the fix list numbered F1, F2 and so on, a calendar with the idle drain on each day that has a checkup and the changes marked, and a Details section. Choosing a day in the calendar, or a checkup in the Details list, shows that checkup on the phone drawing and in the figures below it. The user can refer to a fix by its number.
