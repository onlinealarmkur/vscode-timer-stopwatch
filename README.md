# Timer & Stopwatch for VS Code

Run countdowns and track elapsed time without leaving VS Code. The remaining or elapsed time stays visible in the status bar while you work, and VS Code saves the session locally.

## Preview

![A VS Code window with countdown controls open and the remaining time displayed in the status bar along the bottom](resources/marketplace-countdown.png)

![A VS Code window with stopwatch controls open and the elapsed time displayed in the status bar along the bottom](resources/marketplace-stopwatch.png)

## Quick start

The status bar is the horizontal strip along the bottom of the VS Code window.

1. Look for the clock icon followed by **Timer** near the left side of the status bar.
2. Select **Timer**, then select **Start timer**.
3. Enter a duration such as `10m`, then press **Enter**.
4. The status bar changes to `10:00` and begins counting down.

To measure elapsed time, select **Start stopwatch**. It starts immediately without asking for a duration.

If you do not see **Timer**, select **View > Command Palette** from the VS Code menu bar. Type `Timer & Stopwatch`, then select **Timer & Stopwatch: Start Timer** or **Timer & Stopwatch: Start Stopwatch**.

## Features

- Enter countdowns as `25m`, `1h 30m`, or `01:30:00`.
- Use the stopwatch to measure elapsed time.
- Keep the remaining or elapsed time in the status bar.
- Hide the idle **Timer** label without hiding its clock button.
- Pause, resume, reset, or stop a session from a built-in VS Code menu.
- Control the completion beep and notification separately.
- Continue the current session after reopening the same workspace.
- Run independent sessions in different workspaces.
- Store session data locally without telemetry or workspace inspection.

## Detailed usage

### Start from the VS Code menu

Use the Command Palette if you cannot find **Timer** in the VS Code window:

1. In the VS Code menu bar, select **View > Command Palette**. A searchable list of commands opens.
2. Type `Timer & Stopwatch`.
3. Select **Timer & Stopwatch: Start Timer** or **Timer & Stopwatch: Start Stopwatch**.
4. If you chose **Start Timer**, enter a duration such as `25m`, `1h 30m`, or `01:30:00`, then press **Enter**. If you chose **Start Stopwatch**, it starts immediately.

When the session starts, the remaining or elapsed time replaces **Timer** in the status bar. Your current editor, terminal, or panel keeps focus.

You can also open the Command Palette with **Shift+Command+P** on macOS or **Ctrl+Shift+P** on Windows and Linux.

### Start from the status bar

The status bar is the horizontal strip along the bottom of the VS Code window. After installing the extension, look near the left side for a clock icon followed by **Timer**.

1. Select **Timer**. VS Code opens a list of timer actions near the top of the window.
2. Select **Start timer** or **Start stopwatch**.
3. For a countdown, enter a duration and press **Enter**. A stopwatch starts immediately.

### Control a running session

Once a timer or stopwatch starts, the status bar shows its remaining or elapsed time in place of **Timer**.

A clock-face icon marks a running countdown, a watch icon marks a running stopwatch, and a pause icon marks either type of paused session.

1. Select the displayed time.
2. Select **Pause**, **Resume**, **Reset**, or **Stop**.

Reset pauses the session and returns a stopwatch to zero or a countdown to its full duration.

### Countdown formats

- `25m` means 25 minutes.
- `1h 30m` means 1 hour and 30 minutes.
- `01:30:00` means 1 hour and 30 minutes.
- A number without a unit is treated as minutes.
- The minimum countdown is 1 second, and durations use whole-second precision.
- The maximum countdown duration is 30 days.

VS Code stores one session for each workspace, meaning the project or folder open in the current window. Reopening that workspace restores its session.

## Countdown completion

When a countdown finishes, the extension clears its session. The status bar returns to **Timer**, or to a clock icon if the idle label is hidden. By default, the extension also plays a short beep and shows a VS Code notification with an option to start another timer.

Configure sound and notifications separately:

- Disable the beep with the **Play Completion Sound** setting.
- Disable the notification by selecting **Don't show again** when a countdown finishes.
- Preview the beep with the **Timer & Stopwatch: Test Completion Sound** command in the Command Palette.

You can also change these options in VS Code Settings. Select **View > Command Palette**, run **Preferences: Open Settings (UI)**, then search for `Timer & Stopwatch`.

- **Show Idle Label** hides the word **Timer** when nothing is running. The clock button remains visible and active time is never hidden.
- **Play Completion Sound** controls the completion beep.
- **Show Completion Notification** controls the visual notification.

The extension creates the completion beep as a local WAV file. On macOS it uses `afplay`. On Windows it uses PowerShell SoundPlayer. On Linux it uses the first available supported player: `paplay`, `aplay`, or `ffplay`. The notification appears immediately without waiting for the sound to finish.

VS Code must be open for the extension to notify you immediately. If a countdown expires while VS Code is closed, the notification appears after you reopen the same workspace.

## Compatibility

- The extension requires Visual Studio Code 1.125 or newer on desktop.
- On macOS, sound uses the system `afplay` player.
- On Windows, sound uses Windows PowerShell and `System.Media.SoundPlayer`.
- On Linux, sound requires `/usr/bin/paplay`, `/usr/bin/aplay`, or `/usr/bin/ffplay` and a working audio output.
- With Remote SSH, WSL, Dev Containers, or desktop Codespaces, the extension runs on your local computer, so its controls and sound stay on your desktop.
- Browser-only VS Code environments such as `vscode.dev` and `github.dev` are not supported.

After installation, run **Timer & Stopwatch: Test Completion Sound** from the Command Palette. If you hear nothing, check the system volume and selected audio output. On Linux, also check that `paplay`, `aplay`, or `ffplay` is installed. The notification still works when sound is unavailable.

## Privacy

The extension does not use telemetry or analytics, require an account, show advertising, or inspect project files. It makes no network requests. VS Code stores the current session locally for that workspace. The stored data contains only the mode, whether the session is running or paused, the duration when one applies, and the timing values needed to restore it.

## License

MIT © Burak Ozdemir
