export type Pin = {
  /** Absolute path of the pinned file. */
  path: string
  /** Root of the repository the file sits in (nearest `.git`), else its folder. */
  repo: string
}

declare module 'claude-code' {
  interface PluginState {
    pins: {
      /** `null` until the first read of the store. */
      pins: Pin[] | null
      /** Text typed in the "pin a file" box. */
      draft: string
    }
  }
}
