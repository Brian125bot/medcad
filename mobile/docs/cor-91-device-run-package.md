# COR-91 device-run package

Everything needed to close [COR-91](https://linear.app/coretek/issue/COR-91)
— device QA of the COR-75 add / edit medication wizard — with **physical-device**
evidence. No device numbers exist yet: the code is complete, two defects found
by the desk review are fixed, and the hardware run is not done. Only a physical
iPhone and a physical Android phone count. Simulator, emulator, browser and
Node figures are **not** COR-91 evidence, and the report labels a
simulator/emulator run as such.

The wizard's logic is covered on every CI run by
`tests/cor-91-wizard-device-qa.spec.ts` (the test script below, encoded as
assertions, including the encrypted-store round trip). That harness does **not**
replace the run below: it cannot show the native wheels, the keyboard, the
modal presentation or the device logs.

## What each acceptance criterion needs

| # | COR-91 criterion | Produced by | Evidence to paste |
| --- | --- | --- | --- |
| 1 | All steps pass on at least one iOS and one Android dev build | The full script below, per platform | The filled-in result table, one per platform |
| 2 | Screenshots or a short screen recording | Steps 1–4 | PNGs (or a screen recording) of the key flows |
| 3 | Bugs found are fixed in a PR referencing COR-75, or filed as new issues | The run | Issue links / PR links on COR-91 |

## 0. Before you start

- Node 22, from `mobile/`. Expo Go is **not** enough: `@react-native-community/datetimepicker`
  is native code. You need a **development build** once for COR-88, COR-91 and
  COR-97 — bundle-id choice and prebuild once, then reuse the install for all
  three.
- `app.json` has no `ios.bundleIdentifier` / `android.package`. The first
  `expo run:*` asks for them (prebuild). Pick the ids you want to keep.
- iOS: a Mac with Xcode, phone on a cable, trusted, **Developer Mode** on, a
  signing team selected in Xcode for the generated project.
- Android: **USB debugging** on; `adb devices` lists the phone as `device`.
- Use a phone with nothing you care about in the CadenceRx dev build. Every
  medication you type below is fake — do not type a real drug, and do not use
  the app for real medication in this build.
- Delete the app (not just its data) before the run if a previous run left
  medications behind: the encrypted vault survives a reinstall only if the
  Keystore key survives too, and you want a clean, reproducible start.

## 1. Build and install

```bash
cd mobile
npm ci

# iOS — debug development build (COR-88 / COR-91 / COR-97)
npx expo run:ios --device
# Android — debug development build
npx expo run:android --device
```

## 2. The script

Run every step on **both** phones. Use the fake values below verbatim so the
two runs can be compared line by line.

### Step 1 — add a medication for each frequency type

Open **Regimen → + Add**. For each medication below, fill step 1 (name,
strength, form), step 2 (pill look), step 3 (schedule) and step 4 (inventory),
then **Add medication**.

| # | Name | Strength | Form | Frequency | Days | Every N | Dose times |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | `ZZQXDAILY` | 20 mg | Tablet | Every day | — | — | 08:00, 20:00 |
| B | `ZZQXWEEKLY` | 10 mg | Capsule | Specific days | Mon, Wed, Fri | — | 09:00, 21:30 |
| C | `ZZQXINTERVAL` | 5 mg | Tablet | Every N days | — | 3 | 07:30, 22:00 |

- Set **two dose times per medication** (a medication with two slots is the
  minimum the script asks for).
- Give each medication a distinct **pill look** (shape + primary/secondary
  colour) so the preview can be checked later.
- Leave the default inventory (`30` on hand, package `30`, alert `5`).

**Capture:** a screenshot of each saved medication's schedule step and of the
pill-look step for at least medication A.

> **Note (fixed in this PR):** `+ Add dose time` used to insert a hard-coded
> `20:00`, which collided with the default second slot and blocked the save
> with *"This time is already used by another dose."* It now picks the first
> free time. If you see that message, you are on a build without the fix.

### Step 2 — edit a medication

Edit medication **A** (`ZZQXDAILY`):

1. Change the `20:00` dose time to `21:30` (via the native picker).
2. **+ Add dose time** → the new slot must land on a free time (`12:00` on a
   build with the fix) and the wizard must let you continue.
3. Remove one dose slot (the `Remove` link). You must be left with at least one.
4. Set **units on hand** to `29.5` → saves.
5. Set **units on hand** to `55` (package size still `30`) → the field shows a
   *warning* ("More than one package on hand — that is OK after a refill") and
   the save **must succeed**. A red blocking error here is a bug.

**Capture:** screenshots of the two added/removed dose slots, the `29.5`
value, and the `55`-on-`30` warning.

### Step 3 — persistence (force-quit and relaunch)

1. Force-quit the app (iOS: swipe up from the app switcher; Android: swipe the
   app away / *App info → Force stop*). Do **not** just background it.
2. Relaunch, open **Regimen**.
3. Confirm for all three medications: name, strength, form, frequency, the
   days or interval, every dose time and dose, the pill look, and the
   inventory values (`29.5`, then `55` after step 2, package `30`).
4. Edit medication A again and confirm the values are still there.

**Capture:** a screenshot of the Regimen list after the relaunch, and of
medication A's schedule step after the relaunch.

### Step 4 — native UI and live preview

1. **Native wheels.** Open a dose-time field: iOS shows an inline spinner
   (with a **Done** button under it); Android opens the system dialog. Turn
   the wheels, pick a time, and confirm the field shows the new `HH:mm`.
   Repeat for a **date** field (start date / last refilled) — same rule.
   *Platform difference to note:* iOS keeps the picker open until **Done**;
   Android closes it on selection.
2. **Keyboard avoidance and scrolling.** Focus the *name* field on step 1 and
   the *pharmacy notes* field on step 4 (the multiline one). The keyboard must
   not cover the focused field, the form must scroll to it, and the
   **Back / Next** footer must stay reachable. Type into the notes field and
   scroll to the bottom of the step.
3. **Live pill preview.** On step 2, change the shape (round → capsule →
   oval) and the primary/secondary colours. The SVG preview must change on
   every tap, without leaving the step.

**Capture:** a screen recording of the whole of step 4 is ideal (it shows the
wheels, the keyboard and the preview in one take); otherwise one screenshot
per bullet.

### Step 5 — privacy (device logs)

Run the log capture **while** you repeat steps 1 and 2. Then search the log
for the fake medication details and for the fields of a medication.

```bash
# Android — live capture (Ctrl-C to stop)
adb logcat -v time | tee /tmp/cor91-android.log

# then, after the run:
grep -i -E "ZZQX|dose|medication|note|pharmacy" /tmp/cor91-android.log

# iOS — Xcode > Window > Devices and Simulators, select the phone,
# then the app's log via Console.app (or `log stream --device` on the Mac):
log stream --device --level debug --predicate 'processImagePath CONTAINS "CadenceRx"' > /tmp/cor91-ios.log
grep -i -E "ZZQX|dose|medication|note|pharmacy" /tmp/cor91-ios.log
```

**Pass =** no drug name, dose amount, pharmacy note or any other medication
detail appears in the log. Warning/error lines about a *failed save* are fine
as long as they carry no detail — the wizard deliberately shows only
*"Could not save. Please try again."*

**Capture:** the grep output (expect no hits) for both platforms.

## 3. Results to record (per platform)

- Hardware: model, OS version, debug build, app commit SHA.
- Step 1: A / B / C saved with the listed values? (yes / no + notes)
- Step 2: time changed, slot added at `____`, slot removed, `29.5` saved,
  `55`-on-`30` warned and saved.
- Step 3: all values present after the force-quit relaunch.
- Step 4: wheels work (iOS inline + Done / Android dialog), keyboard
  behaviour, preview updates live.
- Step 5: log grep clean (0 hits).
- Screenshots / recording attached.

## 4. Linear

One comment on **COR-91** per platform (or one combined), and a short
pointer comment on **COR-75** linking to it.

```markdown
### COR-91 device run — <iPhone model / Android model>, <debug build>, <commit SHA>

Step 1 (A/B/C): <result>
Step 2 (edit): <result>
Step 3 (relaunch): <result>
Step 4 (wheels / keyboard / preview): <result, incl. platform differences>
Step 5 (logs): <grep output, 0 hits>

Screenshots: <links>
```

- **Both platforms pass, evidence attached** → mark COR-91 **Done**, and add a
  line to `CHANGELOG.md` (`[Unreleased] → Fixed` or `Documentation`) plus the
  measured result in `mobile/docs/medication-wizard.md` ("never validated on a
  device" is no longer true).
- **Anything fails** → file a new Linear issue that references COR-75 (and
  COR-91), leave COR-91 **In Progress**, and keep the failing phone out of
  the "pass" column. Do not close COR-91 with one platform done.

Do not mark COR-91 Done from a Node run, a simulator, an emulator or a browser:
those are not the acceptance criteria.
