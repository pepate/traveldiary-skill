# traveldiary – Claude Code skill

Builds and maintains an interactive travel diary website (satellite map, 3D replay per day, photos/videos on the
map, points of interest) from diary text, photos, GPX tracks and an optional Google Timeline export.

## Install

```bash
git clone git@github.com:pepate/traveldiary-skill.git ~/traveldiary-skill
# Claude Code looks for skills in ~/.claude/skills/<name>
ln -s ~/traveldiary-skill ~/.claude/skills/traveldiary          # macOS/Linux
mklink /J %USERPROFILE%\.claude\skills\traveldiary %USERPROFILE%\traveldiary-skill    # Windows (cmd)
```

Then in Claude Code: `/traveldiary` → "new travel diary in ~/trips/norway" starts the scaffold and the local
setup app; "new photos and GPX" processes a day; "deploy" publishes.

## Layout

- `SKILL.md` – the skill (modes init / day / deploy)
- `template/` – the project template (Vite + TypeScript + MapLibre, build scripts, setup app, deploy scripts)
- `references/` – day workflow, hosting, data formats
- `scripts/init.mjs` – scaffolds a project from the template
- `evals/` – test prompts and sample data

Requires Node 20+, ffmpeg on PATH (for videos), Python 3 with Pillow (contact sheets).
