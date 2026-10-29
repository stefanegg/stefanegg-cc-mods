# toolbox

A Claude Code mod that adds a **Toolbox: Skills & Mods** side pane, so you stop forgetting what you have installed.

- **Skills tab**: every skill the session can use, grouped and color-coded by where it comes from (your own `~/.claude/skills`, this project, plugins, built into Claude, MCP servers). Each card shows the full description, a **Use** button that puts `/name` in the prompt box, and **Details** with the file path and the skill's whole prompt.
- **Mods tab**: every installed mod (plugins that ship a hooks module), plus mods in development and built-in ones. Each card shows version, on/off status, description, its commands as buttons, and a link to the marketplace it came from. Mods from a marketplace on your own disk get a **⌂ local** tag, since nothing updates them automatically.
- A search box filters both tabs; **Refresh** re-reads everything.

The pane opens when a session starts; `/toolbox` reopens it.

## Install

At the prompt of a terminal session:

```
/plugin install toolbox --marketplace stefanegg/stefanegg-cc-mods
```

From a shell:

```bash
claude plugin install toolbox --marketplace stefanegg/stefanegg-cc-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `stefanegg/stefanegg-cc-mods`, then **Add plugin**.

## What it reads

Everything stays on your machine. The mod reads the session's own skill and command lists, `SKILL.md` files under `~/.claude/skills`, the project's `.claude/skills` and installed plugins, and `~/.claude/plugins/installed_plugins.json` and `known_marketplaces.json`. It writes nothing.

## Develop

```bash
claude plugin validate plugins/toolbox
```

```bash
claude plugin test plugins/toolbox
```
