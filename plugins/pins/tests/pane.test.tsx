import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'pins',
  component: 'Pane',
  requestId: 'pins',
  props: {
    title: 'Pinned Files',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('lists stored pins by repository and opens a file in the viewer and unpins', async ($, on) => {
  on('command.register', () => ({ value: { command: 'pins' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const submitted: string[] = []
  on('prompt.submit', (_, e: any) => {
    submitted.push(e.text)

    return { drop: 'test' }
  })
  let stored: unknown[] = [
    { path: '/r/notes/docs/plan.md', repo: '/r/notes' },
    { path: '/r/other/README.md', repo: '/r/other' },
  ]
  on('store.get', () => ({ value: stored }))
  on('store.set', (_, e: any) => {
    stored = e.value

    return { value: undefined }
  })
  on('fs.read', (_, e: any) =>
    e.path === '/r/notes/docs/plan.md' ? { value: '# The plan\n\nShip it.' } : (() => { throw new Error('ENOENT') })(),
  )

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /NOTES/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^README\.md$/ }))?.text).toBe('README.md')

  await ui.press({ key: 'row:/r/notes/docs/plan.md' })
  expect(submitted).toEqual(['Open /r/notes/docs/plan.md in the file pane.'])

  await ui.press({ key: 'unpin:/r/other/README.md' })
  expect(stored).toEqual([{ path: '/r/notes/docs/plan.md', repo: '/r/notes' }])
  await ui.unmount()
})
