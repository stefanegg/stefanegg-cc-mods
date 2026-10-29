export type SkillOrigin = 'personal' | 'project' | 'plugin' | 'built-in' | 'mcp' | 'other'

export type SkillEntry = {
  id: string
  /** What `/name` runs it by. */
  name: string
  description: string
  origin: SkillOrigin
  plugin?: string
  /** The SKILL.md (or command .md) it was read from, when there is one. */
  path?: string
  /** Whether the session lists it for the model right now. */
  isLoaded: boolean
}

export type ModCommand = { name: string; description: string }

export type ModEntry = {
  id: string
  name: string
  version?: string
  description: string
  /** `installed`, `dev` (a folder under ~/.claude/dev-mods) or `built-in`. */
  kind: 'installed' | 'dev' | 'built-in'
  isEnabled: boolean
  /** The marketplace it was installed from (`name@marketplace`). */
  marketplace?: string
  /** Where that marketplace comes from: `github · owner/repo`, a folder path. */
  marketplaceSource?: string
  /** The marketplace's web page (a GitHub repo, a git host's https URL). */
  marketplaceUrl?: string
  /** The mod's own `homepage` or `repository`, from its plugin.json. */
  homepage?: string
  /** From a marketplace on this machine (a folder or file), so nothing updates it. */
  isLocal: boolean
  root?: string
  modules: string[]
  commands: ModCommand[]
  skills: string[]
}

export type Catalog = {
  skills: SkillEntry[]
  mods: ModEntry[]
  builtAt: number
}

export type Tab = 'skills' | 'mods'

declare module 'claude-code' {
  interface PluginState {
    toolbox: {
      catalog: Catalog | null
      query: string
      tab: Tab
      open: string | null
    }
  }
}
