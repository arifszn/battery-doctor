# Phone brands

The checkup reads standard Android statistics, so it runs on any brand. What differs is where each maker puts its battery controls, and how much extra data the phone reports.

Status: **features verified** means the features were used on a real phone of that brand and their effect was measured. **Not verified** means the feature name is the maker's own, but the menu path has not been checked for this skill and changes between versions. For a not-verified brand, give the user the feature name and tell them to search for it in Settings. Do not present an unverified path as certain.

## Samsung (One UI): features verified on a Galaxy S23 Ultra, Android 17

The features below were used and their effect measured on that phone. Menu paths can differ between One UI versions; if one does not match, have the user search Settings for the feature name.

- Reports measured current and the maker's own battery health figure, so results are the most precise here.
- **Deep sleeping apps**: Settings > Battery > Background usage limits > Deep sleeping apps. The app is stopped completely until the user opens it. Stronger than `restrict-background`, and the right choice for apps the user rarely opens. No notifications from those apps.
- **Sleeping apps**: same screen. The app runs in the background only occasionally.
- **Stylus (S Pen) Air actions**: Settings > Advanced features > S Pen > Air actions. When on, the pen keeps a Bluetooth connection and wakes the phone. Turn off if the user does not use pen gestures.
- **Nearby device scanning**: Settings > Connections > More connection settings > Nearby device scanning.
- **Always On Display**: Settings > Lock screen and AOD. Samsung uses its own setting, so `apply setting doze_always_on` does not change it.
- Samsung "Modes and Routines" cannot close another app reliably. Do not suggest it for that.

## Google Pixel: not verified

- Feature names: **Adaptive Battery**, **Battery usage** per app with "Restricted", **Battery Saver**, **Always show time and info**.
- Battery health figure: recent Pixels show it under Settings > Battery > Battery health.

## Xiaomi, Redmi, POCO (MIUI, HyperOS): not verified

- Feature names: **Autostart**, per-app **Battery saver** with "Restrict background activity", **Battery optimization**.
- These phones are reported to block changes over USB until **USB debugging (Security settings)** is also turned on in Developer options. If `apply` reports that the phone refused, tell the user about that setting or use the manual route.

## OnePlus, OPPO, realme (OxygenOS, ColorOS): not verified

- Feature names: per-app **Battery usage** with "Allow background activity" and "Allow auto-launch", **Optimized night charging**, **Sleep standby optimization**.

## Motorola, Nokia, Sony and others close to standard Android: not verified

- Feature names: **Adaptive Battery**, per-app **App battery usage** with "Restricted".

## Huawei, Honor: not verified

- Feature names: **App launch** (manage manually), **Power-intensive apps**.

## If the phone reports less data

Some phones leave out parts of the statistics. The script then prints less and the report shows a dash. Typical gaps:

- No measured current: idle drain is taken from battery percent instead. Still usable, less precise.
- No per-app screen figures: the report falls back to Android's estimate.
- No battery health figure: the estimate needs the battery above 20% at checkup time.

Tell the user what is missing; do not fill the gap with a guess. Reports from other phones are welcome at https://github.com/arifszn/battery-doctor/issues.
