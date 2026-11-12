# Reading a checkup

## What a checkup covers

Android keeps battery statistics from the last time the phone was charged to nearly full until now. A checkup reads that period. So the best moment for a checkup is in the evening, before charging, after a day unplugged with no restart.

The script prints `NOT ENOUGH DATA` when the period is under 4 hours or under 15% of the battery, or when the phone restarted during it. Do not draw conclusions from such a checkup.

## The numbers

| Number | Meaning | How to say it |
|---|---|---|
| Screen time from a full charge | Hours of screen-on time in this period, scaled to a full battery. It counts the idle time between sessions, so it is what the user really gets. The headline number, and the one to compare between checkups. Left out when the screen was on under 1 hour. | "A full charge gives you about 8 hours of screen time." |
| Idle drain | Percent of a full battery lost per hour while the screen is off. The number that background fixes change. | "Your phone loses 2% an hour when you are not using it." |
| A full charge lasts | Hours on battery divided by the share of battery used, scaled to 100%. Depends on how much the phone was used that day. | "At this rate a full charge lasts about 19 hours." |
| Screen-on drain | Percent per hour while the screen is on. Depends on the apps used and on brightness. | "While you use it, it loses about 8% an hour." |
| Battery health | How much of its original capacity the battery still holds. | "Your battery holds 93% of what it held when new." |
| Deep sleep, light sleep | Hours the phone spent in Android's two power-saving states. No deep sleep over several idle hours means something keeps the phone busy. | "Your phone never got to sleep properly." |
| Awake while screen off | Share of screen-off time the processor was awake. | "It was awake a quarter of the time it should have been asleep." |

## Thresholds

The script decides what is a problem. These are rules of thumb from field use on a small number of phones, not manufacturer limits. Say "higher than it should be", not "abnormal".

| Problem id | Raised when |
|---|---|
| `idle-drain` | Idle drain over 1% per hour (medium), over 2% (high) |
| `no-deep-sleep` | 4 or more idle hours and zero deep sleep |
| `awake-while-off` | Awake 20% or more of screen-off time |
| `frequent-wakeups` | A hardware source (Bluetooth, mobile network, Wi-Fi, stylus, sensors) woke the phone over 60 times per idle hour, or kept it awake over 5% of idle time |
| `app-wakeups:<app>` | An installed app set over 20 wakeup alarms per hour |
| `bt-scan:<app>` | An app scanned for Bluetooth devices for 2 hours or more and at least half the period |
| `always-running:<app>` | An installed app ran in the background 6 hours or more in the last 24 |
| `sensor:<app>` | An installed app held a sensor for 30 minutes or more without a break |
| `location:<app>` | An installed app has an active location request |
| `notifications:<app>` | 100 or more notifications in 24 hours |
| `heavy-app:<app>` | One app used a quarter or more of all battery drained, while on screen |
| `screen-time` | 70% or more of the drain happened with the screen on |
| `battery-worn` | Battery health under 80% |
| `hot` | Battery at 40 °C or more during the checkup |
| `long-period` | More than 36 hours on battery, or more than 100% used, in one period. The phone has not started a new record, so the figures are averages over several days |
| `battery-saver` | Battery saver was on at the checkup. Do not compare this checkup with one taken without it |
| `setting:<key>` | A battery-relevant setting is on (background Bluetooth or Wi-Fi scanning, always-on display) |

## How far to trust each source

| Source | Trust |
|---|---|
| Idle and screen-on drain, method "measured current" | High. The phone logged its real current about every 10 seconds. Seen on Samsung phones. |
| Idle and screen-on drain, method "percent while screen off" | Medium. Whole percent steps, so short periods are coarse. Used when the phone does not log current. |
| Battery used on screen, by app (measured) | High for ranking apps. |
| Battery used by app (Android estimate) | Low. Android's model often accounts for well under half of the real drain. Use it to rank, not to quote amounts. |
| What wakes the phone | High for counts. The names are hardware sources, not apps. |
| Background services, notifications | Good, covers the last 24 hours. |
| Wakeup alarms per app, Bluetooth scans | Counted since the last restart. Incomplete after a recent restart. |
| Battery health marked `vendor` | The phone maker's own figure (Samsung). |
| Battery health marked `measured` | An estimate from the charge counter. Can be off by several points, and is missing when the battery is under 20%. |

## Giving advice

- If `screen-time` is raised, most of the drain is the user using the phone. Background fixes will help little. Say so plainly, and suggest brightness, dark mode on OLED screens, and the heavy apps by name.
- If `battery-worn` is raised, no setting restores capacity. A battery replacement does.
- If `idle-drain` is raised with no specific cause listed, look at "What wakes the phone", at apps that run all day, and at connected Bluetooth devices such as watches and earbuds. A connected watch costs battery by design; that is the user's trade-off to make, so present it as a choice.
- Do not suggest restricting messaging apps the user relies on. Their messages would arrive late.

## Comparing two checkups

- Lead with screen time from a full charge: "about 5 hours, up from 4". It is the result the user feels.
- Then check idle drain. It depends least on how much the phone was used, so it shows whether a fix worked. If screen time rose but idle drain did not fall, the day was different, not the phone; say so.
- A period that includes a night idles lower than a daytime period, because most apps go quiet. `check` therefore also compares idle drain over only the hours of the day both checkups cover, with at least 20 minutes of screen-off time in each hour and 3 hours in total (`Same hours of the day`). Use that figure when it is there. Without it, if the screen-off hours differ a lot between two checkups, say that the comparison is rough.
- `CHANGED ON THE PHONE` lists differences between this checkup and the one before that this tool did not make: the three settings it can change, apps stopped from running in the background, and apps that show up in the battery figures moving into or out of Android's restricted group. The restricted group holds apps in Samsung's deep sleep and apps Android itself restricts for being rarely used, so a move there is not always the user's doing. Each change is logged with the new checkup's time: it happened at some point since the checkup before.
- "A full charge lasts" moves with usage. A longer figure after a light day is not an improvement.
- One checkup after a change is one data point. Recommend a second if the result is close.
