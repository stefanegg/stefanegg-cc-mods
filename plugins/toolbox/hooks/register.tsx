import { atom, read, update } from 'claude-code'
import type { CommandInfo, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Catalog, ModEntry, SkillEntry, SkillOrigin, Tab } from '../types'

const PANE = 'toolbox'
const TITLE = 'Toolbox: Skills & Mods'
const PROMPT_LIMIT = 12000

const catalog = atom({ plugin: 'toolbox', key: 'catalog' } as const, null)
const query = atom({ plugin: 'toolbox', key: 'query' } as const, '')
const tab = atom({ plugin: 'toolbox', key: 'tab' } as const, 'skills')
const open = atom({ plugin: 'toolbox', key: 'open' } as const, null)

type Frontmatter = Record<string, string>

// Enough YAML for skill frontmatter: `key: value`, quoted values, and
// `>` / `|` blocks continued on indented lines.
const parseFrontmatter = (text: string): { meta: Frontmatter; body: string } => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { meta: {}, body: text }
  const meta: Frontmatter = {}
  const lines = (match[1] ?? '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i] ?? '')
    if (!pair || !pair[1]) continue
    let value = (pair[2] ?? '').trim()
    if (/^[>|][-+]?$/.test(value) || value === '') {
      const block: string[] = []
      while (/^\s+\S/.test(lines[i + 1] ?? '')) block.push((lines[++i] ?? '').trim())
      value = block.join(value.startsWith('|') ? '\n' : ' ')
    }
    meta[pair[1]] = value.replace(/^(["'])([\s\S]*)\1$/, '$2')
  }

  return { meta, body: text.slice(match[0].length) }
}

const readText = ($: EngineInterface, path: string) =>
  $.fs.read(path).then(
    text => (typeof text === 'string' ? text : undefined),
    () => undefined,
  )

const readJson = async ($: EngineInterface, path: string): Promise<any> => {
  const text = await readText($, path)
  try {
    return text === undefined ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

const listDirs = async ($: EngineInterface, path: string) =>
  (await $.fs.list(path).catch(() => [])).filter(one => one.kind === 'dir' || one.isLink)

type FileSkill = Omit<SkillEntry, 'id' | 'isLoaded'>

// Every `<dir>/<name>/SKILL.md` and `<commandsDir>/<name>.md` under a root.
const scanSkills = async (
  $: EngineInterface,
  skillDirs: string[],
  commandDirs: string[],
  origin: SkillOrigin,
  plugin?: string,
): Promise<FileSkill[]> => {
  const found: FileSkill[] = []
  for (const dir of skillDirs) {
    for (const entry of await listDirs($, dir)) {
      const path = `${dir}/${entry.name}/SKILL.md`
      const text = await readText($, path)
      if (text === undefined) continue
      const { meta } = parseFrontmatter(text)
      found.push({ name: meta.name || entry.name, description: meta.description ?? '', origin, plugin, path })
    }
  }
  for (const dir of commandDirs) {
    for (const entry of await $.fs.list(dir).catch(() => [])) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
      const path = `${dir}/${entry.name}`
      const text = await readText($, path)
      if (text === undefined) continue
      const { meta } = parseFrontmatter(text)
      found.push({ name: entry.name.slice(0, -3), description: meta.description ?? '', origin, plugin, path })
    }
  }

  return found
}

const asList = (value: unknown): string[] =>
  typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter(v => typeof v === 'string') : []

// A page a browser can open for a git or web address: `https://…` as is,
// `git@host:owner/repo.git` as `https://host/owner/repo`; else none.
const webUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/.exec(value)
  const url = ssh ? `https://${ssh[1]}/${ssh[2]}` : value.replace(/^git\+/, '')

  return /^https?:\/\//.test(url) ? url.replace(/\.git$/, '') : undefined
}

type PluginRoot ={ key: string; root?: string; kind: ModEntry['kind'] }

const ORIGINS: Record<string, SkillOrigin> = {
  userSettings: 'personal',
  projectSettings: 'project',
  plugin: 'plugin',
  'built-in': 'built-in',
  mcp: 'mcp',
}

const buildCatalog = async ($: EngineInterface): Promise<Catalog> => {
  const home = (await $.env.get('HOME')) ?? ''
  const commands: CommandInfo[] = await $.command.list().catch(() => [])
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  const listed = usage?.context.breakdown?.skills?.skillFrontmatter ?? []
  const enabled: Record<string, boolean> =
    ((await $.settings.read({ key: 'enabledPlugins' }).catch(() => undefined)) as Record<string, boolean>) ?? {}

  // Every plugin folder there is: installed ones, this machine's dev mods,
  // and enabled built-ins (which have no folder to read).
  const roots: PluginRoot[] = []
  const installed = await readJson($, `${home}/.claude/plugins/installed_plugins.json`)
  for (const [key, installs] of Object.entries<any>(installed?.plugins ?? {})) {
    const root = Array.isArray(installs) ? installs[0]?.installPath : undefined
    if (typeof root === 'string') roots.push({ key, root, kind: 'installed' })
  }
  for (const session of await listDirs($, `${home}/.claude/dev-mods`)) {
    for (const mod of await listDirs($, `${home}/.claude/dev-mods/${session.name}`)) {
      roots.push({ key: mod.name, root: `${home}/.claude/dev-mods/${session.name}/${mod.name}`, kind: 'dev' })
    }
  }
  for (const key of Object.keys(enabled)) {
    if (key.endsWith('@builtin') && !roots.some(one => one.key === key)) roots.push({ key, kind: 'built-in' })
  }
  // A marketplace from a folder or file on this machine is never fetched,
  // so the mods it installed do not update by themselves.
  const marketplaces: Record<string, any> = (await readJson($, `${home}/.claude/plugins/known_marketplaces.json`)) ?? {}
  const sourceOf = (marketplace: string | undefined) => {
    const source = marketplace ? marketplaces[marketplace]?.source : undefined
    if (!source || typeof source.source !== 'string') return { isLocal: false }
    const where = source.repo ?? source.url ?? source.path ?? source.package ?? ''
    const isLocal = source.source === 'directory' || source.source === 'file'

    return {
      isLocal,
      marketplaceSource: isLocal ? `local · ${where}` : `${source.source} · ${where}`,
      marketplaceUrl: source.source === 'github' ? `https://github.com/${source.repo}` : webUrl(source.url),
    }
  }

  const fileSkills: FileSkill[] = [
    ...(await scanSkills($, [`${home}/.claude/skills`], [`${home}/.claude/commands`], 'personal')),
    ...(await scanSkills($, ['.claude/skills'], ['.claude/commands'], 'project')),
  ]
  const mods: ModEntry[] = []
  for (const { key, root, kind } of roots) {
    const shortName = key.split('@')[0]
    const manifest = root ? await readJson($, `${root}/.claude-plugin/plugin.json`) : undefined
    const name: string = manifest?.name ?? shortName
    if (root) {
      const skillDirs = [`${root}/skills`, ...asList(manifest?.skills).map(dir => `${root}/${dir.replace(/^\.\//, '')}`)]
      const commandDirs = [`${root}/commands`, ...asList(manifest?.commands).map(dir => `${root}/${dir.replace(/^\.\//, '')}`)]
      fileSkills.push(...(await scanSkills($, [...new Set(skillDirs)], [...new Set(commandDirs)], 'plugin', name)))
    }
    const hooks = root ? await readJson($, `${root}/hooks/hooks.json`) : undefined
    const modules = asList(hooks?.modules)
    if (kind !== 'built-in' && modules.length === 0) continue
    const marketplace = kind === 'installed' ? key.split('@')[1] : undefined
    mods.push({
      marketplace,
      ...sourceOf(marketplace),
      id: `mod:${kind}:${key}`,
      name,
      version: manifest?.version,
      homepage: webUrl(manifest?.homepage) ?? webUrl(manifest?.repository?.url ?? manifest?.repository),
      description: manifest?.description ?? '',
      kind,
      isEnabled: kind === 'dev' || enabled[key] === true,
      root,
      modules,
      commands: commands
        .filter(one => one.plugin === name || one.plugin === shortName)
        .map(one => ({ name: one.name, description: one.description })),
      skills: [],
    })
  }

  // The session's own listing is the truth for what is loaded; the files
  // add the prompt, and skills the session does not list (a disabled plugin).
  const describe = new Map(commands.map(one => [one.name, one.description]))
  const used = new Set<FileSkill>()
  const skills: SkillEntry[] = listed.map(one => {
    const short = one.name.includes(':') ? one.name.slice(one.name.indexOf(':') + 1) : one.name
    const file = fileSkills.find(
      f => !used.has(f) && (f.name === one.name || (f.name === short && (!one.pluginName || f.plugin === one.pluginName))),
    )
    if (file) used.add(file)

    return {
      id: `skill:${one.name}`,
      name: one.name,
      description: file?.description || describe.get(one.name) || '',
      origin: file?.origin ?? ORIGINS[one.source] ?? 'other',
      plugin: one.pluginName ?? file?.plugin,
      path: file?.path,
      isLoaded: true,
    }
  })
  for (const file of fileSkills) {
    if (used.has(file)) continue
    const name = file.plugin && !describe.has(file.name) && describe.has(`${file.plugin}:${file.name}`)
      ? `${file.plugin}:${file.name}`
      : file.name
    if (skills.some(one => one.name === name)) continue
    skills.push({ ...file, id: `skill:${file.path}`, name, isLoaded: describe.has(name) })
  }
  skills.sort((a, b) => a.name.localeCompare(b.name))
  for (const mod of mods) mod.skills = skills.filter(one => one.plugin === mod.name).map(one => one.name)

  return { skills, mods, builtAt: Date.now() }
}

const refresh = async ($: EngineInterface) => {
  const next = await buildCatalog($)
  await update($, catalog, () => next)
}

const ORIGIN_LABEL: Record<SkillOrigin, string> = {
  personal: 'Your skills',
  project: 'This project',
  plugin: 'From plugins',
  'built-in': 'Built into Claude',
  mcp: 'From MCP servers',
  other: 'Other',
}
const ORIGIN_HINT: Record<SkillOrigin, string> = {
  personal: '~/.claude/skills',
  project: '.claude/skills',
  plugin: 'installed plugins',
  'built-in': 'ships with the app',
  mcp: 'connected servers',
  other: '',
}
// One theme color per source, so a card says where it comes from at a glance.
const ORIGIN_COLOR: Record<SkillOrigin, string> = {
  personal: 'claude',
  project: 'success',
  plugin: 'suggestion',
  'built-in': 'planMode',
  mcp: 'merged',
  other: 'subtle',
}
const KIND_COLOR: Record<ModEntry['kind'], string> = {
  installed: 'suggestion',
  dev: 'claude',
  'built-in': 'planMode',
}
const ORIGIN_ORDER: SkillOrigin[] =['personal', 'project', 'plugin', 'built-in', 'mcp', 'other']

// Descriptions stay whole up to this many words; past it the card shows the
// first ones and the full text once opened.
const WORDS_SHOWN = 45

const shorten = (text: string) => {
  const words = text.split(/\s+/).filter(Boolean)

  return words.length <= WORDS_SHOWN + 10 ? text : `${words.slice(0, WORDS_SHOWN).join(' ')} …`
}

const matches = (q: string, ...texts: (string | undefined)[]) =>
  q === '' || texts.some(text => text?.toLowerCase().includes(q))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'toolbox', description: 'Show your skills and mods in a side pane' })
    void refresh($)
    if (e.isInteractive) void $.ui.open({ id: PANE, title: TITLE })

    return result
  })

  on('command.run', { command: 'toolbox' }, async $ => {
    void refresh($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Toolbox pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link, Markdown } = els
    const Input = 'Input' in els ? els.Input : undefined
    const data = await read($, catalog)
    const typed = await read($, query)
    const q = typed.trim().toLowerCase()
    const current = (await read($, tab)) as Tab
    const expanded = await read($, open)

    const useCommand = (name: string) => () => void $.prompt.fill({ text: `/${name} `, mode: 'replace' })
    const toggle = (id: string) => () => update($, open, was => (was === id ? null : id))

    const badge = (key: string, label: string, color: string = 'subtle') => (
      <Text key={key} size="caption" color={color}>
        {label}
      </Text>
    )
    // The card's border carries its source's color: dim at rest, full on
    // hover and while open.
    const card = (key: string, isOpen: boolean, color: string, children: RenderChildren[]) => (
      <Box
        key={key}
        flexDirection="column"
        gap="xs"
        paddingX="sm"
        paddingY="xs"
        borderStyle="round"
        borderColor={color}
        borderDimColor={!isOpen}
        hover={{ borderColor: color, borderDimColor: false }}
      >
        {children}
      </Box>
    )
    const section = (key: string, label: string, hint: string, count: number, color: string, children: RenderChildren[]) => (
      <Box key={key} flexDirection="column" gap="xs">
        <Box flexDirection="row" gap="sm" alignItems="center" marginTop="xs">
          <Text weight="bold" size="footnote" color={color}>
            ■ {label.toUpperCase()}
          </Text>
          <Text size="caption" weight="semibold" color={color}>
            {count}
          </Text>
          <Text size="caption" dimColor>
            {hint}
          </Text>
        </Box>
        {children}
      </Box>
    )

    const tabButton = (id: Tab, label: string, count?: number) => (
      <Button key={`tab:${id}`} variant={current === id ? 'primary' : 'secondary'} onPress={() => update($, tab, () => id)}>
        {label}
        {count !== undefined && <Text dimColor={current !== id}> {count}</Text>}
      </Button>
    )

    const header = (
      <Box flexDirection="column" gap="sm" marginBottom="xs">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap="xs">
            {tabButton('skills', 'Skills', data?.skills.length)}
            {tabButton('mods', 'Mods', data?.mods.length)}
          </Box>
          <Button key="refresh" plain onPress={() => void refresh($)}>
            <Text dimColor>↻ Refresh</Text>
          </Button>
        </Box>
        {Input && (
          <Input
            key="search"
            placeholder={current === 'skills' ? 'Search skills…' : 'Search mods…'}
            value={typed}
            submitLabel="search"
            onInput={value => void update($, query, () => value)}
            onSubmit={value => void update($, query, () => value)}
          />
        )}
      </Box>
    )

    if (!data) {
      return (
        <Box flexDirection="column" gap="sm">
          {header}
          <Text dimColor italic>
            Reading your skills and mods…
          </Text>
        </Box>
      )
    }

    const skillCard = async (skill: SkillEntry) => {
      const isOpen = expanded === skill.id
      const body = isOpen && skill.path ? await readText($, skill.path) : undefined
      const prompt = body === undefined ? undefined : parseFrontmatter(body).body.trim()
      const description = isOpen ? skill.description : shorten(skill.description)

      const color = ORIGIN_COLOR[skill.origin]

      return card(skill.id, isOpen, color, [
        <Box key={`head:${skill.id}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
          <Button key={`row:${skill.id}`} plain onPress={toggle(skill.id)}>
            <Text mono weight="semibold" color={color}>
              /{skill.name}
            </Text>
          </Button>
          <Box flexDirection="row" gap="xs">
            {!skill.isLoaded && badge(`off:${skill.id}`, 'not loaded', 'warning')}
            <Button key={`use:${skill.id}`} onPress={useCommand(skill.name)}>
              Use
            </Button>
          </Box>
        </Box>,
        description !== '' ? (
          <Text key={`desc:${skill.id}`} size="footnote" wrap="wrap">
            {description}
          </Text>
        ) : (
          <Text key={`desc:${skill.id}`} size="footnote" dimColor italic>
            No description.
          </Text>
        ),
        <Box key={`foot:${skill.id}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
          <Text size="caption" color={color} wrap="truncate-middle">
            ● {skill.plugin ?? ORIGIN_LABEL[skill.origin]}
          </Text>
          <Button key={`more:${skill.id}`} plain onPress={toggle(skill.id)}>
            <Text size="caption" dimColor>
              {isOpen ? 'Less ▴' : 'Details ▾'}
            </Text>
          </Button>
        </Box>,
        isOpen && (
          <Box key={`open:${skill.id}`} flexDirection="column" gap="xs" marginTop="xs">
            {skill.path && (
              <Text size="caption" mono dimColor wrap="wrap">
                {skill.path}
              </Text>
            )}
            {prompt !== undefined ? (
              <Box flexDirection="column" paddingX="sm" paddingY="xs" borderStyle="round" borderDimColor>
                <Markdown
                  key={`md:${skill.id}`}
                  text={prompt.length > PROMPT_LIMIT ? `${prompt.slice(0, PROMPT_LIMIT)}\n\n…` : prompt}
                />
              </Box>
            ) : (
              <Text size="footnote" dimColor italic wrap="wrap">
                {skill.path
                  ? 'Could not read the prompt file.'
                  : 'Built into the app: its prompt ships inside Claude and has no file to show.'}
              </Text>
            )}
          </Box>
        ),
      ])
    }

    const modCard = (mod: ModEntry) => {
      const isOpen = expanded === mod.id
      const [status, color] =
        mod.kind === 'dev'
          ? ['in development', 'planMode']
          : mod.kind === 'built-in'
            ? ['built in', 'subtle']
            : mod.isEnabled
              ? ['on', 'success']
              : ['off', 'inactive']
      const description = isOpen ? mod.description : shorten(mod.description)
      // The mod's commands, then the skills it brings that no command covers,
      // each with the one line that says what it does.
      const entries = [
        ...mod.commands,
        ...mod.skills
          .filter(name => !mod.commands.some(command => command.name === name))
          .map(name => ({ name, description: data.skills.find(skill => skill.name === name)?.description ?? '' })),
      ]

      return card(mod.id, isOpen, KIND_COLOR[mod.kind], [
        <Box key={`head:${mod.id}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
          <Button key={`row:${mod.id}`} plain onPress={toggle(mod.id)}>
            <Text weight="semibold">{mod.name}</Text>
            {mod.version && <Text size="caption" dimColor> v{mod.version}</Text>}
          </Button>
          <Box flexDirection="row" gap="sm">
            {mod.isLocal && badge(`local:${mod.id}`, '⌂ local', 'warning')}
            {badge(`status:${mod.id}`, `● ${status}`, color)}
          </Box>
        </Box>,
        description !== '' && (
          <Text key={`desc:${mod.id}`} size="footnote" wrap="wrap">
            {description}
          </Text>
        ),
        entries.length > 0 && (
          <Box key={`cmds:${mod.id}`} flexDirection="row" flexWrap="wrap" gap="xs">
            {entries.map(entry => (
              <Button key={`cmd:${mod.id}:${entry.name}`} onPress={useCommand(entry.name)}>
                <Text mono>/{entry.name}</Text>
              </Button>
            ))}
          </Box>
        ),
        <Box key={`foot:${mod.id}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
          <Box flexDirection="row" gap="xs" alignItems="center" flexShrink={1}>
            <Text size="caption" color={mod.isLocal ? 'warning' : KIND_COLOR[mod.kind]}>
              ●
            </Text>
            {mod.marketplace && mod.marketplaceUrl ? (
              <Link href={mod.marketplaceUrl} label={mod.marketplace} />
            ) : (
              <Text size="caption" color={mod.isLocal ? 'warning' : KIND_COLOR[mod.kind]} wrap="truncate-middle">
                {mod.marketplace
                  ? `${mod.marketplace}${mod.isLocal ? ' · local, no auto-update' : ''}`
                  : mod.kind === 'dev'
                    ? 'written in a session'
                    : 'ships with Claude Code'}
              </Text>
            )}
          </Box>
          <Button key={`more:${mod.id}`} plain onPress={toggle(mod.id)}>
            <Text size="caption" dimColor>
              {isOpen ? 'Less ▴' : 'Details ▾'}
            </Text>
          </Button>
        </Box>,
        isOpen && (
          <Box key={`open:${mod.id}`} flexDirection="column" gap="xs">
            {mod.commands
              .filter(command => command.description !== '')
              .map(command => (
                <Text key={`cmddesc:${mod.id}:${command.name}`} size="footnote" wrap="wrap">
                  <Text mono>/{command.name}</Text>
                  <Text dimColor> — {command.description}</Text>
                </Text>
              ))}
            {mod.commands.length === 0 && mod.skills.length === 0 && (
              <Text size="footnote" dimColor italic wrap="wrap">
                No commands: it works on its own through hooks, panes or bands.
              </Text>
            )}
            {mod.modules.length > 0 && (
              <Text size="caption" dimColor wrap="wrap">
                Hooks: {mod.modules.join(', ')}
              </Text>
            )}
            {mod.marketplaceSource && (
              <Box flexDirection="row" gap="xs" flexWrap="wrap">
                <Text size="caption" dimColor>
                  Marketplace:
                </Text>
                {mod.marketplaceUrl ? (
                  <Link href={mod.marketplaceUrl} label={mod.marketplaceSource} />
                ) : (
                  <Text size="caption" dimColor wrap="wrap">
                    {mod.marketplaceSource}
                  </Text>
                )}
              </Box>
            )}
            {mod.homepage && mod.homepage !== mod.marketplaceUrl && (
              <Box flexDirection="row" gap="xs" flexWrap="wrap">
                <Text size="caption" dimColor>
                  Repository:
                </Text>
                <Link href={mod.homepage} label={mod.homepage.replace(/^https?:\/\//, '')} />
              </Box>
            )}
            <Text size="caption" mono dimColor wrap="wrap">
              {mod.root ?? 'Ships with Claude Code'}
            </Text>
          </Box>
        ),
      ])
    }

    const empty = (what: string) => (
      <Box paddingY="md" justifyContent="center">
        <Text dimColor italic>
          {q === '' ? `No ${what} found.` : `No ${what} match “${typed.trim()}”.`}
        </Text>
      </Box>
    )

    if (current === 'mods') {
      const mods = data.mods.filter(mod => matches(q, mod.name, mod.description, ...mod.commands.map(c => c.name)))
      const kinds: [ModEntry['kind'], string, string][] = [
        ['installed', 'Installed', 'from marketplaces'],
        ['dev', 'In development', '~/.claude/dev-mods'],
        ['built-in', 'Built in', 'ships with the app'],
      ]

      return (
        <Box flexDirection="column" gap="md">
          {header}
          {mods.length === 0 && empty('mods')}
          {kinds.map(([kind, label, hint]) => {
            const members = mods.filter(mod => mod.kind === kind)

            return members.length === 0
              ? null
              : section(`group:${kind}`, label, hint, members.length, KIND_COLOR[kind], members.map(modCard))
          })}
        </Box>
      )
    }

    const skills = data.skills.filter(skill => matches(q, skill.name, skill.description, skill.plugin))
    const groups = []
    for (const origin of ORIGIN_ORDER) {
      const members = skills.filter(skill => skill.origin === origin)
      if (members.length === 0) continue
      groups.push(
        section(
          `group:${origin}`,
          ORIGIN_LABEL[origin],
          ORIGIN_HINT[origin],
          members.length,
          ORIGIN_COLOR[origin],
          await Promise.all(members.map(skillCard)),
        ),
      )
    }

    return (
      <Box flexDirection="column" gap="md">
        {header}
        {groups.length === 0 && empty('skills')}
        {groups}
      </Box>
    )
  })
}
