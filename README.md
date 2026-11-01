# stefanegg-cc-mods

A Claude Code marketplace of mods by stefanegg.

| Mod | What it does |
| --- | --- |
| [toolbox](plugins/toolbox) | A side pane listing every skill and mod you have, with descriptions, prompts and a button to use each |
| [pins](plugins/pins) | A side pane of pinned files, grouped by repository and kept across sessions |

## Install a mod

At the prompt of a terminal session:

```
/plugin install toolbox --marketplace stefanegg/stefanegg-cc-mods
```

From a shell:

```bash
claude plugin install toolbox --marketplace stefanegg/stefanegg-cc-mods
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `stefanegg/stefanegg-cc-mods`, then **Add plugin**.

## Add a mod

Put it in `plugins/<name>/` and list it in `.claude-plugin/marketplace.json`.
