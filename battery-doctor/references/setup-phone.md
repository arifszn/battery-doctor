# Connecting the phone

Give the user one step at a time and wait for them. Run `node <skill-dir>/scripts/doctor.mjs status` after each step to see where they are.

Sources: Android's official guides, [Configure on-device developer options](https://developer.android.com/studio/debug/dev-options) and [Run apps on a hardware device](https://developer.android.com/studio/run/device).

## On the phone

1. **Turn on Developer options.** Find **Build number** and tap it seven times until the phone says "You are now a developer!".

   | Phone | Where Build number is |
   |---|---|
   | Google Pixel | Settings > About phone > Build number |
   | Samsung Galaxy | Settings > About phone > Software information > Build number |
   | OnePlus | Settings > About phone > Build number |
   | Other brands | Open Settings and search for "Build number". Some brands use their own version name instead, for example "MIUI version" or "OS version". |

2. **Turn on USB debugging.** Open Settings and search for "Developer options" (on most phones it is under Settings > System). Turn on **USB debugging**.
3. **Connect the cable** to the computer and unlock the phone.
4. **Tap Allow** on the "Allow USB debugging?" prompt. Ticking "Always allow from this computer" avoids the prompt next time.

The user can turn USB debugging off again when they are finished. Say so at the end of the session.

## On the computer

| Computer | Extra setup |
|---|---|
| macOS | None. |
| ChromeOS | None. |
| Windows | Some phones need the maker's USB driver before they show up. Links per brand: https://developer.android.com/studio/run/oem-usb |
| Linux (Ubuntu and similar) | The user must be in the `plugdev` group (`sudo usermod -aG plugdev $LOGNAME`, then log out and in), and udev rules must cover the phone (`sudo apt-get install android-sdk-platform-tools-common`). |

## When the phone does not show up

Try these in order. Check with `status` after each.

1. Unlock the phone and look for the "Allow USB debugging?" prompt.
2. Unplug the cable and plug it in again.
3. Pull down the phone's notification shade, tap the USB notification, and choose **File transfer**.
4. Use a different cable. Many cables only charge and carry no data.
5. Use a different USB port, directly on the computer and not through a hub.
6. In Developer options, tap **Revoke USB debugging authorizations**, then reconnect and tap Allow.
7. On Windows, install the maker's USB driver from the link above.

`status` output and what it means:

| `phone:` line | Meaning |
|---|---|
| `NOT FOUND` | The computer does not see a phone with USB debugging on. |
| `UNAUTHORIZED` | The phone is waiting for the user to tap Allow. |
| `OFFLINE` | The connection dropped. Reconnect the cable. |
| `READY` | Connected. |

If two phones are connected, unplug one or pass `--serial=<serial>` to the command.
