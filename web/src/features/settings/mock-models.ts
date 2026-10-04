import type { MockKit } from '../../dsh/mock/kit.ts'
import type { ModelCatalog, ModelCatalogModel, ModelSelection } from '../composer/api.ts'
import type { ProviderAddress, ProviderEntry } from './providers.ts'

interface Model { id: string; name?: string; description?: string; reasoningEfforts?: false | Record<string, string | null> }
interface Profile { displayName?: string; models?: Model[]; reasoning?: string }
const profiles = (kit: MockKit) => kit.getSettingsValue<{ providers: Record<string, Profile> }>('llm-pi-ai')?.providers ?? {}

/** Both discovery surfaces read the same current configuration as settings.describe. */
export function mockProviderRegistry(kit: MockKit): { providers: ProviderEntry[]; directory: ProviderAddress[] } {
  const directory = [
    { provider: 'deepseek', displayName: 'ディープシーク', settingsNs: 'llm-deepseek', settingsPath: [] },
    ...Object.entries(profiles(kit)).map(([provider, profile]) => ({ provider,
      displayName: profile.displayName ?? (provider === 'cloud' ? 'クラウド提供元' : provider),
      settingsNs: 'llm-pi-ai', settingsPath: ['providers', provider] })),
    { provider: 'ollama', displayName: 'ローカル', settingsNs: 'example-extension', settingsPath: ['localProvider'] },
  ]
  return { directory, providers: directory.map(row => ({ id: row.provider, name: row.displayName })) }
}

export function readMockModelCatalog(kit: MockKit, initial: ModelCatalog): ModelCatalog {
  const deepseek = kit.getSettingsValue<{ models?: Model[]; reasoningEffort?: string }>('llm-deepseek')
  const groups = initial.groups.map(group => group.id !== 'deepseek' || !deepseek ? structuredClone(group) : {
    ...group, models: (deepseek.models ?? []).map(model => ({ id: model.id, name: model.name ?? model.id,
      ...(model.description === undefined ? {} : { description: model.description }),
      reasoning: { ...group.models[0]!.reasoning!, defaultEffort: deepseek.reasoningEffort ?? 'high' },
    })),
  })
  for (const [id, profile] of Object.entries(profiles(kit))) {
    const models: ModelCatalogModel[] = (profile.models ?? []).map(model => ({ id: model.id, name: model.name ?? model.id,
      ...(model.reasoningEfforts ? { reasoning: {
        efforts: Object.keys(model.reasoningEfforts).map(id => ({ id, name: id })),
        ...(profile.reasoning === undefined ? {} : { defaultEffort: profile.reasoning }),
      } } : {}),
    }))
    groups.push({ id, name: profile.displayName ?? id, models })
  }
  return { default: kit.getSettingsValue<ModelSelection>('agent-default-model') ?? structuredClone(initial.default),
    routableProviders: [...initial.routableProviders, ...Object.keys(profiles(kit))], groups, failures: [] }
}

const writers = new WeakMap<MockKit, (selection: ModelSelection) => Promise<unknown>>()
const pending = new WeakMap<MockKit, Promise<unknown>>()
export function registerMockModelWriter(kit: MockKit, write: (selection: ModelSelection) => Promise<unknown>): void { writers.set(kit, write) }
/** Real selectModel returns before serialized default persistence finishes. */
export function saveMockModelDefault(kit: MockKit, selection: ModelSelection): void {
  const write = writers.get(kit)
  if (!write) return
  const value = structuredClone(selection)
  const next = (pending.get(kit) ?? Promise.resolve()).then(() => write(value))
  pending.set(kit, next.catch(() => {}))
}
