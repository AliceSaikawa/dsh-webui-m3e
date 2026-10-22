import { messagesOf, type Translation } from '../../i18n/catalog.ts'
import { currentLocale } from '../../i18n/current.ts'
import { providerMessages } from './messages.ts'

export type ProviderTexts = Translation<typeof providerMessages.ja>
export const providerText = (): ProviderTexts => messagesOf(providerMessages, currentLocale())

// DSH 0.2.0-rc.2: pi-ai/dist/env-api-keys.js:67-121 and provider definitions.
// These are reserved destinations, not registration-status lookup targets.
const conventional = ['ant-ling', 'qwen-token-plan', 'qwen-token-plan-cn', 'openai', 'nvidia', 'deepseek',
  'groq', 'cerebras', 'xai', 'radius', 'openrouter', 'zai', 'zai-coding-cn', 'mistral', 'minimax',
  'minimax-cn', 'fireworks', 'together', 'baseten', 'opencode', 'meta', 'xiaomi',
  'xiaomi-token-plan-cn', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-sgp']
export const derivedKeyRef = (id: string) => `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
export const validKeyReference = (ref: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)
export const invalidKeyReferenceMessage = (text: ProviderTexts = providerText()) => text.invalidKeyReference
const defaults: Record<string, string[]> = {
  ...Object.fromEntries(conventional.map(id => [id, [derivedKeyRef(id)]])),
  anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN'],
  'deepseek-official': ['DEEPSEEK_API_KEY'],
  'github-copilot': ['COPILOT_GITHUB_TOKEN'], google: ['GEMINI_API_KEY'],
  'google-vertex': ['GOOGLE_CLOUD_API_KEY'], 'azure-openai-responses': ['AZURE_OPENAI_API_KEY'],
  'vercel-ai-gateway': ['AI_GATEWAY_API_KEY'], moonshotai: ['MOONSHOT_API_KEY'],
  'moonshotai-cn': ['MOONSHOT_API_KEY'], huggingface: ['HF_TOKEN'], 'kimi-coding': ['KIMI_API_KEY'],
  'opencode-go': ['OPENCODE_API_KEY'], 'qwen-token-plan-individual': ['QWEN_TOKEN_PLAN_API_KEY'],
  'cloudflare-workers-ai': ['CLOUDFLARE_API_KEY'], 'cloudflare-ai-gateway': ['CLOUDFLARE_API_KEY'],
}
// Ambient discovery also reads auxiliary names. Reserve these whole families
// conservatively; status lookup still uses only the configured reference.
const families = ['AWS_', 'GOOGLE_', 'GCLOUD_', 'CLOUDFLARE_']
/** The key check refused a reference this form had just assigned (`requireMissing`). */
export const keyRegisteredMeanwhileMessage = (text: ProviderTexts = providerText()) => text.keyRegisteredMeanwhile
export const pendingKeyReferenceMessage = (text: ProviderTexts = providerText()) => text.pendingKeyReference
/**
 * `named` holds every reference name that a provider states in the settings.
 * Only a provider without a reference asks, so it never names `ref` itself and
 * no owner is excluded: an owner identity that could equal a custom ID (which
 * may contain "/") would hide a real collision.
 */
export function keyReferenceReason(named: readonly string[], ref: string, text: ProviderTexts = providerText()): string | undefined {
  const key = keyReferenceReasonKey(named, ref)
  return key === undefined ? undefined : typeof key === 'string' ? text[key] : text.keyReferenceFamily(key.prefix)
}
export type KeyReferenceReasonKey = 'keyReferenceTaken' | 'keyReferenceReserved' | { readonly prefix: string }
/** The reason as a catalog key, so a caller can build its sentence in any language. */
export function keyReferenceReasonKey(named: readonly string[], ref: string): KeyReferenceReasonKey | undefined {
  if (named.includes(ref)) return 'keyReferenceTaken'
  if (Object.values(defaults).some(refs => refs.includes(ref))) return 'keyReferenceReserved'
  const family = families.find(prefix => ref.startsWith(prefix))
  if (family) return { prefix: family }
}
export function keyReferenceConflict(named: readonly string[], ref: string): boolean {
  return keyReferenceReason(named, ref) !== undefined
}
export function keyReferenceError(id: string, ref: string, reason: string, text: ProviderTexts = providerText()): string {
  return text.keyReferenceError(ref, reason, `my-${id}`)
}
