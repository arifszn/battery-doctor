# Installing battery-doctor

battery-doctor is one standalone skill: the folder `battery-doctor/` with a `SKILL.md` at its root. Every agent loads that same folder. Only the skills directory it goes into differs.

Requirements: [Node.js](https://nodejs.org) 18 or later, and `git` for the manual install.

## Claude Code

### Plugin marketplace (recommended)

```
/plugin marketplace add arifszn/battery-doctor
/plugin install battery-doctor
```

### Standalone skill

Use the template below with `~/.claude/skills`.

## Any agent

Pick your agent's skills directory from the table, set it as `DEST`, and run the block for your operating system.

macOS and Linux:

```bash
DEST=~/.claude/skills   # change this line per the table below
TMP="$(mktemp -d)"
git clone --depth 1 https://github.com/arifszn/battery-doctor "$TMP/repo"
mkdir -p "$DEST"
rm -rf "$DEST/battery-doctor"
cp -r "$TMP/repo/battery-doctor" "$DEST/battery-doctor"
rm -rf "$TMP"
```

Windows (PowerShell):

```powershell
$Dest = "$HOME\.claude\skills"   # change this line per the table below
$Tmp = Join-Path $env:TEMP "battery-doctor-repo"
if (Test-Path $Tmp) { Remove-Item $Tmp -Recurse -Force }
git clone --depth 1 https://github.com/arifszn/battery-doctor $Tmp
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
if (Test-Path "$Dest\battery-doctor") { Remove-Item "$Dest\battery-doctor" -Recurse -Force }
Copy-Item "$Tmp\battery-doctor" "$Dest\battery-doctor" -Recurse
Remove-Item $Tmp -Recurse -Force
```

| Agent | User `DEST` | Project `DEST` |
| --- | --- | --- |
| Claude Code | `~/.claude/skills` | `.claude/skills` |
| OpenCode | `~/.config/opencode/skills` | `.opencode/skills` |
| Codex | `~/.agents/skills` | `.agents/skills` |
| Antigravity | `~/.gemini/config/skills` | `.agents/skills` |
| Gemini CLI, Cursor, Windsurf, Kimi, others | see your agent's skills docs | `.agents/skills` |

Notes:

- Installing for the user (not the project) is the better fit here: the skill is about your phone, not a codebase.
- When unsure, use `.agents/skills`. It is the closest thing to a shared location across agents.
- Restart or reload the agent after copying so it rescans its skills.

## With npx

```bash
npx skills add arifszn/battery-doctor
```

## Verify

Ask your agent "what skills do you have?". `battery-doctor` should be in the list. Then run:

```bash
node <DEST>/battery-doctor/scripts/doctor.mjs status
```

It prints the Node version and whether `adb` and a phone were found.

## Uninstall

Delete the `battery-doctor` folder from the skills directory. Checkups and reports are in `~/battery-doctor/`; delete that folder too if you no longer want them.
