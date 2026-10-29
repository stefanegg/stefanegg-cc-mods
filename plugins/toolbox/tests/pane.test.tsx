import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'toolbox',
  component: 'Pane',
  requestId: 'toolbox',
  props: {
    title: 'Skills & mods',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SKILL = `---
name: humanizer
description: >
  Rewrite AI-sounding text
  so it reads human.
---
# Humanizer

Do the thing.
`

test('lists a personal skill and a mod, and shows the prompt on press', async ($, on) => {
  on('command.register', () => ({ value: { command: 'toolbox' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/home/t' }))
  on('settings.read', () => ({ value: { 'demo@mkt': true } }))
  on('command.list', () => ({ value: [{ name: 'demo-cmd', description: 'A demo command', source: 'plugin', plugin: 'demo' }] }))
  on('session.usage', () => ({
    value: {
      context: {
        window: 1,
        breakdown: { skills: { totalSkills: 1, includedSkills: 1, tokens: 1, skillFrontmatter: [{ name: 'humanizer', source: 'userSettings', tokens: 1 }] } },
      },
    },
  }))
  const files: Record<string, string> = {
    '/home/t/.claude/skills/humanizer/SKILL.md': SKILL,
    '/home/t/.claude/plugins/installed_plugins.json': JSON.stringify({ plugins: { 'demo@mkt': [{ installPath: '/p/demo' }], 'gh@ghm': [{ installPath: '/p/gh' }] } }),
    '/p/demo/.claude-plugin/plugin.json': JSON.stringify({ name: 'demo', version: '1.2.0', description: 'A demo mod' }),
    '/home/t/.claude/plugins/known_marketplaces.json': JSON.stringify({
      mkt: { source: { source: 'directory', path: '/home/t/mkt' } },
      ghm: { source: { source: 'github', repo: 'someone/ghm' } },
    }),
    '/p/gh/.claude-plugin/plugin.json': JSON.stringify({ name: 'gh', description: 'A mod from GitHub' }),
    '/p/gh/hooks/hooks.json': JSON.stringify({ modules: ['./register.ts'] }),
    '/p/demo/hooks/hooks.json': JSON.stringify({ modules: ['./register.ts'] }),
  }
  on('fs.read', (_, e: any) => (e.path in files ? { value: files[e.path] } : (() => { throw new Error('ENOENT') })()))
  on('fs.list', (_, e: any) => ({
    value: e.path === '/home/t/.claude/skills' ? [{ name: 'humanizer', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [],
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'refresh' })
  expect((await ui.find({ type: 'Text', text: /Rewrite AI-sounding text so it reads human/ }))?.text).toBeTruthy()

  await ui.press({ key: 'row:skill:humanizer' })
  expect((await ui.find({ type: 'Markdown', text: /Do the thing/ }))).toBeTruthy()

  await ui.press({ key: 'tab:mods' })
  expect((await ui.find({ type: 'Text', text: /^demo$/ }))?.text).toBe('demo')
  expect((await ui.find({ type: 'Text', text: /⌂ local/ }))?.text).toBe('⌂ local')
  const link = await ui.find({ type: 'Link', text: /ghm/ })
  expect(JSON.stringify(link)).toContain('https://github.com/someone/ghm')
  await ui.unmount()
})
