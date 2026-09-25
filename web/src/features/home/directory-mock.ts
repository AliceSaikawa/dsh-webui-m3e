import type { RemoteResult } from '../../dsh/services.ts'

export interface MockDirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

export interface MockDirectoryListing {
  path: string
  home: string
  crumbs: MockDirectoryEntry[]
  entries: MockDirectoryEntry[]
  truncated: boolean
}

export interface DirectoryMockOptions {
  unavailable?: 'native' | 'none'
  truncated?: boolean
}

const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
const failure = (code: string, message: string, details: Record<string, unknown> = {}): RemoteResult<never> => ({ ok: false, error: { code, message, details } })
const normalize = (path: string) => path.replace(/\/+$/, '') || '/'
const nameOf = (path: string) => path.split('/').at(-1) || '/'
const entryOf = (path: string): MockDirectoryEntry => ({ path, name: nameOf(path), hidden: nameOf(path).startsWith('.') })
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'

/** In-memory RPC fixture. It never reads or changes the host file system. */
export function createDirectoryMock(options: DirectoryMockOptions = {}) {
  const home = '/mock'
  const directories = new Set([
    '/', home, '/mock/.cache', '/mock/dev', '/mock/dev/dsh-webui-m3e',
    '/mock/dev/dsh-webui-m3e/docs', '/mock/dev/dsh-webui-m3e/web',
    '/mock/dev/sample-app', '/mock/dsh-webui-m3e', '/mock/dsh-webui-m3e/docs',
    '/mock/dsh-webui-m3e/web', '/mock/deepseek-harness', '/mock/notes',
    '/mock/read-only', '/mock/unreadable',
  ])
  if (options.truncated) {
    for (let index = 1; index <= 1001; index++) directories.add(`/mock/folder-${String(index).padStart(4, '0')}`)
  }

  const unavailable = () => failure('directory-picker/unavailable', 'この接続ではフォルダを選べません。', { capability: options.unavailable })

  return {
    async list(path?: string, signal?: AbortSignal): Promise<RemoteResult<MockDirectoryListing>> {
      if (signal?.aborted) return failure('rpc/aborted', 'フォルダの読み込みを取り消しました。')
      if (options.unavailable) return unavailable()
      const current = normalize(path ?? home)
      if (!directories.has(current) || current === '/mock/unreadable') return failure('directory-picker/unreadable', 'このフォルダを読み込めません。', { path: current })
      const crumbs = [entryOf('/')]
      let ancestor = ''
      for (const part of current.split('/').filter(Boolean)) {
        ancestor += `/${part}`
        crumbs.push(entryOf(ancestor))
      }
      const entries = [...directories]
        .filter((directory) => directory !== '/' && parentOf(directory) === current)
        .map(entryOf)
        .sort((left, right) => left.name.localeCompare(right.name, 'ja'))
      return success({ path: current, home, crumbs, entries: entries.slice(0, 1000), truncated: entries.length > 1000 })
    },
    async createDirectory(path: string, name: string): Promise<RemoteResult<string>> {
      if (options.unavailable) return unavailable()
      const parent = normalize(path)
      const normalizedName = name.trim()
      if (!directories.has(parent) || parent === '/mock/unreadable') return failure('directory-picker/unreadable', 'このフォルダを読み込めません。', { path: parent })
      if (parent === '/mock/read-only') return failure('directory-picker/create-failed', 'この場所にはフォルダを作れません。', { path: parent })
      if (!normalizedName || normalizedName === '.' || normalizedName === '..' || /[/\\\u0000]/.test(normalizedName)) return failure('directory-picker/invalid-name', 'フォルダ名を確認してください。')
      const created = `${parent === '/' ? '' : parent}/${normalizedName}`
      if (directories.has(created)) return failure('directory-picker/exists', '同じ名前のフォルダがあります。', { path: created })
      directories.add(created)
      return success(created)
    },
  }
}
