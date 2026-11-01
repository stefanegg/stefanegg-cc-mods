# pins

A Claude Code mod that adds a **Pinned Files** side pane for the markdown files you open again and again, grouped by repository and kept across sessions.

- Each pin is a card with the file name and its path inside the repository. Press the name to open the file in the app's file viewer: the pane cannot do that itself, so it asks the session to open it, which costs one short turn. **Add to prompt** adds `@path` to the prompt at the caret (relative to the session's folder when the file is inside it, else absolute) without touching what you typed; hovering the pin icon strikes it through, and pressing it unpins (a ✕ button in a terminal).
- Pins are grouped under the repository they sit in (the nearest folder with a `.git`).
- The pane opens when a session starts.

## Commands

| Command | Does |
| --- | --- |
| `/pins` | Shows the pane, or hides it when it is already open. `/pins <path>` pins that file |
| `/pin <path>` | Pins a file: absolute, `~/…`, or relative to the session's folder |
| `/unpin <path>` | Removes a pin |

Where the surface draws a text box, the pane also has a **Pin a file** box.

## Install

```bash
claude plugin install pins --marketplace stefanegg/stefanegg-cc-mods
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, then add `pins` from the `stefanegg-cc-mods` marketplace.

## What it reads

Only the files you pin, and `.git` folder names above them to find the repository. The pin list is kept in the mod's own store under your Claude configuration folder.

## Develop

```bash
claude plugin validate plugins/pins
```

```bash
claude plugin test plugins/pins
```
