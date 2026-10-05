import type { MockKit } from '../../dsh/mock/kit.ts'
import type { SettingsMockRemote } from './mock.ts'
import type { SettingsNamespace } from './schema.ts'

/** Issue 16 fault injection stays in a production-excluded feature module. */
export function installCustomScenarios(kit: MockKit, remote: SettingsMockRemote, namespaces: Map<string, SettingsNamespace>) {
  let failRead = false
  let conflict = false
  let reject = false
  let partial = false
  let loseResponse = false
  let slow = false
  const pendingSaves: (() => void)[] = []
  kit.addRemote('customProviderTest', {
    pendingSaves: () => pendingSaves.length,
    releaseSaves() { pendingSaves.splice(0).forEach(resolve => resolve()) },
  })
  const describe = remote.describe.bind(remote)
  remote.describe = async () => failRead ? { ok: false, error: { code: 'gateway/internal', message: '読み込めません。', details: {} } } : describe()
  const mutate = remote.mutate.bind(remote)
  remote.mutate = async (ns, ops, revision) => {
    if (slow) await new Promise<void>(resolve => pendingSaves.push(resolve))
    if (ns === 'llm-pi-ai' && conflict) { conflict = false; return { ok: false, error: { code: 'settings/conflict', message: '変更されました。', details: {} } } }
    if (ns === 'llm-pi-ai' && reject) return { ok: false, error: { code: 'settings/rejected', message: '拒否されました。', details: {} } }
    const result = await mutate(ns, ops, revision)
    if (result.ok && ns === 'llm-pi-ai' && loseResponse) { loseResponse = false; kit.setConnectionState('disconnected'); throw new Error('応答を受け取れませんでした。') }
    return result
  }
  kit.scenario('custom-unavailable', () => { failRead = true })
  kit.scenario('custom-no-namespace', () => { namespaces.delete('llm-pi-ai') })
  kit.scenario('custom-conflict', () => { conflict = true })
  kit.scenario('custom-rejected', () => { reject = true })
  kit.scenario('custom-partial', () => { partial = true })
  kit.scenario('custom-response-lost', () => { loseResponse = true })
  kit.scenario('custom-slow', () => { slow = true })
  return { rejectKeyOnce() { const result = partial; partial = false; return result } }
}
