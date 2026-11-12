# Changes the skill can make

The script allows three actions. Each is reversible or harmless, is logged in `~/battery-doctor/<phone>/changes.json` with the previous value, and is read back from the phone to confirm it took. Anything else is a manual fix: give the user the steps.

Never run `apply` without `--yes`, and never add `--yes` before the user has agreed to that specific change.

## The three actions

| Command | What it does on the phone | What the user loses | Undo |
|---|---|---|---|
| `apply restrict-background <package> --yes` | Blocks the app from running in the background. | Notifications and syncing from that app can be late or stop until the app is opened. | `undo <id>` restores the previous setting. |
| `apply force-stop <package> --yes` | Closes the app now. | Nothing lasting. The app starts again when opened, and some apps restart themselves. | Nothing to undo. |
| `apply setting <key> --yes` | Turns one battery-related setting off. | See the table below. | `undo <id>` restores the previous value. |

Settings that can be changed:

| Key | Setting | What the user loses |
|---|---|---|
| `ble_scan_always_enabled` | Bluetooth scanning while Bluetooth is off | Slightly less accurate location indoors. |
| `wifi_scan_always_enabled` | Wi-Fi scanning while Wi-Fi is off | Slightly less accurate location indoors. |
| `doze_always_on` | Always-on display (phones that use Android's standard setting) | The clock and notifications no longer show on the locked screen. |

## What the script refuses

- Any app that came with the phone. Only apps the user installed can be restricted or closed.
- Any setting outside the table.
- Uninstalling, disabling, clearing data, changing permissions, restarting.

If the user wants one of these, explain how to do it on the phone themselves.

## How to offer fixes

1. Lead with the fix that addresses the biggest drain, not the easiest one.
2. For each fix say three things: what it does, what the user loses, and whether you can do it or they must.
3. Be specific about the loss. For a watch or earbuds companion app: "your watch will stop showing notifications".
4. Let the user choose. Apply only what they chose.
5. After applying, read out each result line. If a line says the change was not verified, tell the user it may not have taken.
6. If the phone refuses a command, do not retry with a different command. Offer the manual route. Some brands block these commands until an extra developer setting is on; see `brands.md`.

## Undo

```
node <skill-dir>/scripts/doctor.mjs changes     # list changes with their ids
node <skill-dir>/scripts/doctor.mjs undo 2      # reverse one
node <skill-dir>/scripts/doctor.mjs undo all    # reverse everything reversible
```

## Manual fixes that apply to any Android phone

| Fix | Where | What the user loses |
|---|---|---|
| Limit an app's location to "Only while using the app" | Settings > Apps > the app > Permissions > Location | Background location features of that app. |
| Turn off notification categories of a noisy app | Settings > Notifications > the app | Those alerts. |
| Lower screen brightness or turn on adaptive brightness | Settings > Display | Nothing, or a dimmer screen. |
| Dark mode (helps on OLED screens) | Settings > Display | Nothing. |
| Shorter screen timeout | Settings > Display | The screen turns off sooner. |
| Disconnect Bluetooth devices not in use | Settings > Connected devices | Those devices stop working until reconnected. |
| Stop video autoplay in social apps | Inside each app's settings | Videos no longer start by themselves. |
| Uninstall an app the user does not use | Long-press the app icon | The app. |

Menu names differ slightly by brand and Android version. If a path does not match, tell the user to open Settings and search for the last word in the path.
