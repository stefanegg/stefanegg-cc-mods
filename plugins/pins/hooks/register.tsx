import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Pin } from '../types'

const PANE = 'pins'
const TITLE = 'Pinned Files'
const STORE_KEY = 'pins'

const pins = atom({ plugin: 'pins', key: 'pins' } as const, null)
const draft = atom({ plugin: 'pins', key: 'draft' } as const, '')

// Lucide-style strokes for the pin mark beside a file name. The desktop draws an
// SVG as an image, so the colour is spelled out; the terminal has no Svg and gets
// the glyph. A Button holds only strings and Text, so its icons are glyphs.
const ICONS = {
  pin: {
    glyph: '📌',
    color: '#d97757',
    paths: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  },
  unpin: {
    glyph: '✕',
    color: '#8a8a8a',
    paths: '<path d="M12 17v5"/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"/><path d="m2 2 20 20"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"/>',
  },
  open: {
    glyph: '↗',
    color: '#d97757',
    paths: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  },
} as const

const ICON_BOX = 20
// A plain Button's text is what a press lands on. Plain spaces draw nothing to
// hit, and solid blocks hide the drawing beneath, so it is braille blanks: real
// characters that leave no ink.
const BLANK = '\u2800\u2800\u2800\u2800'
// Drawn over the pin when the pointer is on it: the pin struck through.
const STRIKE = '<path d="m3 3 18 18" stroke-width="2.6"/>'

const dirname = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0)) || '/'
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)

const readText = ($: EngineInterface, path: string) =>
  $.fs.read(path).then(
    text => (typeof text === 'string' ? text : undefined),
    () => undefined,
  )

// `~/x` and `x` (against the session's folder) become absolute paths; a leading
// `@` is the prompt's file mention and is dropped.
const resolvePath = async ($: EngineInterface, raw: string) => {
  const text = raw.trim().replace(/^@/, '').replace(/^(["'])([\s\S]*)\1$/, '$2')
  if (text.startsWith('/')) return text
  if (text === '~' || text.startsWith('~/')) return `${(await $.env.get('HOME')) ?? ''}${text.slice(1)}`
  const cwd = await $.session.cwd()

  return `${cwd.replace(/\/$/, '')}/${text.replace(/^\.\//, '')}`
}

// The nearest folder above the file that holds a `.git`, else the file's own folder.
const repoOf = async ($: EngineInterface, file: string) => {
  let dir = dirname(file)
  for (let i = 0; i < 12 && dir !== '/'; i++) {
    const entries = await $.fs.list(dir).catch(() => [])
    if (entries.some(one => one.name === '.git')) return dir
    dir = dirname(dir)
  }

  return dirname(file)
}

const loadPins = async ($: EngineInterface) => {
  const stored = await $.store.get(STORE_KEY)
  const list = Array.isArray(stored) ? (stored as Pin[]).filter(one => typeof one?.path === 'string') : []
  await update($, pins, () => list)
}

const savePins = async ($: EngineInterface, next: Pin[]) => {
  await $.store.set(STORE_KEY, next)
  await update($, pins, () => next)
}

const addPin = async ($: EngineInterface, raw: string): Promise<string> => {
  if (raw.trim() === '') return 'Give a path: /pin <file>.'
  const path = await resolvePath($, raw)
  if ((await readText($, path)) === undefined) return `Could not read ${path}.`
  const current = (await read($, pins)) ?? []
  if (current.some(one => one.path === path)) return `Already pinned: ${path}`
  await savePins($, [...current, { path, repo: await repoOf($, path) }])

  return `Pinned ${path}`
}

const removePin = async ($: EngineInterface, path: string) => {
  const current = (await read($, pins)) ?? []
  await savePins($, current.filter(one => one.path !== path))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'pins', description: 'Show or hide the pinned files pane' })
    await $.command.register({ name: 'pin', description: 'Pin a file: /pin <path>' })
    await $.command.register({ name: 'unpin', description: 'Unpin a file: /unpin <path>' })
    await loadPins($)

    return result
  })

  // `/pins` toggles the pane; `/pins <path>` pins that file and shows the pane.
  on('command.run', { command: 'pins' }, async ($, e) => {
    await loadPins($)
    const isUp = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (e.args.trim() !== '') {
      const text = await addPin($, e.args)
      await $.ui.open({ id: PANE, title: TITLE })

      return { text }
    }
    if (isUp) {
      await $.ui.close({ id: PANE })

      return { text: 'Pinned Files pane closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Pinned Files pane opened.' }
  })

  on('command.run', { command: 'pin' }, async ($, e) => {
    await loadPins($)
    const text = await addPin($, e.args)
    void $.ui.open({ id: PANE, title: TITLE })

    return { text }
  })

  on('command.run', { command: 'unpin' }, async ($, e) => {
    await loadPins($)
    const path = await resolvePath($, e.args)
    const current = (await read($, pins)) ?? []
    if (!current.some(one => one.path === path)) return { text: `Not pinned: ${path}` }
    await removePin($, path)

    return { text: `Unpinned ${path}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : undefined
    const Svg = 'Svg' in els ? els.Svg : undefined
    // Drawn on a padded canvas so the picture sits in the middle of a larger
    // box: that box is what the pointer lights up.
    const drawing = (name: string, body: string, color: string, dark = color) =>
      Svg && (
        <Svg
          key={`icon:${name}`}
          alt={name}
          width={ICON_BOX}
          height={ICON_BOX}
          source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><style>@media (prefers-color-scheme: dark){svg{stroke:${dark}}}</style>${body}</svg>`}
        />
      )
    const list = await read($, pins)
    const typed = await read($, draft)

    // A Button holds only text, so on a surface with Svg a blank plain Button is
    // laid over the whole drawing. `reveal` is drawn on hover, over `base`.
    const slot = (
      key: string,
      onPress: () => void,
      base: RenderChildren,
      reveal: RenderChildren | undefined,
      glyph: string,
      glyphColor: string,
    ) =>
      Svg ? (
        <Box key={`slot:${key}`} position="relative" hover={{ backgroundColor: 'diffRemovedDimmed' }}>
          {base}
          {reveal && (
            <Box position="absolute" top={0} left={0} display="none" hover={{ display: 'flex' }}>
              {reveal}
            </Box>
          )}
          <Box position="absolute" top={0} left={0} width="100%" height="100%">
            <Button key={key} plain onPress={onPress}>
              <Text>{BLANK}</Text>
            </Button>
          </Box>
        </Box>
      ) : (
        <Button key={key} plain onPress={onPress}>
          <Text color={glyphColor}>{glyph}</Text>
        </Button>
      )

    // The pane has no call that opens a file in the app's viewer, so ask the
    // session to do it with the viewer tool.
    const openFile = (path: string) =>
      $.prompt.submit({ text: `Open ${path} in the file pane.`, asUser: true })

    // Adds the path where the caret is, leaving what is already typed alone. It is
    // relative to the session's folder when the file sits under it, else absolute.
    const usePath = async (full: string) => {
      const cwd = (await $.session.cwd()).replace(/\/$/, '')
      const path = full.startsWith(`${cwd}/`) ? full.slice(cwd.length + 1) : full
      const box = await $.prompt.read()
      const before = box.text.slice(0, box.cursor)
      const lead = before === '' || /\s$/.test(before) ? '' : ' '
      await $.prompt.fill({ text: `${lead}@${path} `, mode: 'insert' })
    }

    const submit = async (value: string) => {
      if (value.trim() === '') return
      const text = await addPin($, value)
      await update($, draft, () => (text.startsWith('Pinned') ? '' : value))
      $.ui.toast(text)
    }

    const header = Input && (
      <Input
        key="add"
        placeholder="Pin a file: path, ~/path or relative…"
        value={typed}
        submitLabel="Pin"
        onInput={value => void update($, draft, () => value)}
        onSubmit={value => void submit(value)}
      />
    )

    if (list === null) {
      return (
        <Box flexDirection="column" gap="sm">
          {header}
          <Text dimColor italic>
            Reading your pins…
          </Text>
        </Box>
      )
    }
    if (list.length === 0) {
      return (
        <Box flexDirection="column" gap="sm">
          {header}
          <Text dimColor italic wrap="wrap">
            Nothing pinned yet. Pin a file with /pin &lt;path&gt;{Input ? ' or the box above' : ''}.
          </Text>
        </Box>
      )
    }

    const repos = [...new Set(list.map(one => one.repo))].sort((a, b) => basename(a).localeCompare(basename(b)))

    const pinCard = (pin: Pin) => {
      const shown = pin.path.startsWith(`${pin.repo}/`) ? pin.path.slice(pin.repo.length + 1) : pin.path

      return (
        <Box
          key={pin.path}
          flexDirection="column"
          gap="xs"
          paddingX="sm"
          paddingY="xs"
          borderStyle="round"
          borderColor="subtle"
          borderDimColor
          hover={{ borderColor: 'subtle', borderDimColor: false }}
        >
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
            <Box flexDirection="row" alignItems="center" flexShrink={1}>
              {slot(
                `unpin:${pin.path}`,
                () => void removePin($, pin.path),
                drawing('pin', ICONS.pin.paths, '#1f1f1f', '#f5f5f5') || <Text>{ICONS.pin.glyph}</Text>,
                drawing('unpin', STRIKE, '#e5484d'),
                ICONS.unpin.glyph,
                'subtle',
              )}
              <Button key={`row:${pin.path}`} plain onPress={() => void openFile(pin.path)}>
                <Text mono weight="semibold" color="claude" wrap="truncate-middle">
                  {basename(pin.path)}
                </Text>
              </Button>
            </Box>
            <Box flexDirection="row" gap="sm" alignItems="center">
              <Button key={`use:${pin.path}`} onPress={() => void usePath(pin.path)}>
                Add to prompt
              </Button>
              <Button key={`openbtn:${pin.path}`} onPress={() => void openFile(pin.path)}>
                Open
              </Button>
            </Box>
          </Box>
          <Text size="caption" mono dimColor wrap="truncate-middle">
            {shown}
          </Text>
        </Box>
      )
    }

    const groups: RenderChildren[] = []
    for (const repo of repos) {
      const members = list.filter(one => one.repo === repo)
      groups.push(
        <Box key={`repo:${repo}`} flexDirection="column" gap="xs">
          <Box flexDirection="row" gap="sm" alignItems="center" marginTop="xs">
            <Text weight="bold" size="footnote" color="claude">
              ■ {basename(repo).toUpperCase()}
            </Text>
            <Text size="caption" weight="semibold" color="claude">
              {members.length}
            </Text>
          </Box>
          {members.map(pinCard)}
        </Box>,
      )
    }

    return (
      <Box flexDirection="column" gap="md">
        {header}
        {groups}
      </Box>
    )
  })
}
