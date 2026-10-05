import type { Plugin } from 'vite'

/** Paths are checked after Rollup has chosen the modules emitted in each chunk. */
export function productionModuleErrors(ids: readonly string[]): string[] {
  const errors: string[] = []
  for (const id of ids) {
    const path = id.replaceAll('\\', '/').split('?', 1)[0]!
    // This notification primitive has no fixtures/controllers and is used by
    // completion-status.ts and conversation-selection.ts in production.
    if (/(?:^|\/)web\/src\/dsh\/mock\/observable\.ts$/.test(path)) continue
    const sharedMock = /(?:^|\/)web\/src\/dsh\/mock\//.test(path)
    const featureMock = /(?:^|\/)web\/src\/features\/.*\/(?:mock[^/]*|[^/]+-mock[^/]*|[^/]+-fixtures)\.tsx?$/.test(path)
    if (sharedMock || featureMock) errors.push(`mock module in production: ${id}`)
  }
  return errors
}

export function productionModuleGuard(): Plugin {
  return {
    name: 'm3e-production-modules',
    apply: 'build',
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap(output => output.type === 'chunk' ? Object.keys(output.modules) : [])
      const errors = productionModuleErrors(ids)
      if (errors.length) this.error(errors.join('\n'))
    },
  }
}
