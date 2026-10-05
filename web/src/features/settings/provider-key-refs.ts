// DSH 0.2.0-rc.2: pi-ai/dist/env-api-keys.js:67-121 and provider definitions.
// These are reserved destinations, not registration-status lookup targets.
const conventional = ['ant-ling', 'qwen-token-plan', 'qwen-token-plan-cn', 'openai', 'nvidia', 'deepseek',
  'groq', 'cerebras', 'xai', 'radius', 'openrouter', 'zai', 'zai-coding-cn', 'mistral', 'minimax',
  'minimax-cn', 'fireworks', 'together', 'baseten', 'opencode', 'meta', 'xiaomi',
  'xiaomi-token-plan-cn', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-sgp']
export const derivedKeyRef = (id: string) => `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
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
const families: [string, string[]][] = [
  ['AWS_', ['amazon-bedrock']], ['GOOGLE_', ['google-vertex']], ['GCLOUD_', ['google-vertex']],
  ['CLOUDFLARE_', ['cloudflare-workers-ai', 'cloudflare-ai-gateway']],
]
export const sharedKeyReferenceMessage = '別の提供元とキーの参照名が重なります。この画面ではキーを登録・削除できません。'
export const pendingKeyReferenceMessage = 'キーの参照先だけが設定されています。キーを登録するまで、この提供元を使えない場合があります。'
export interface KeyDestination { id: string; ref?: string; usedRefs?: string[] }
export function usedKeyReferences(id: string, explicit?: string): string[] {
  return [...new Set([...(explicit ? [explicit] : []), derivedKeyRef(id), ...(defaults[id] ?? [])])]
}
export function keyReferenceConflict(rows: KeyDestination[], id: string, ref: string): boolean {
  const builtinOwner = defaults[id]?.includes(ref) === true
  return rows.some(row => row.id !== id && !(builtinOwner && defaults[row.id]?.includes(ref))
      && (row.usedRefs ?? usedKeyReferences(row.id, row.ref)).includes(ref))
    || (!defaults[id]?.includes(ref) && Object.entries(defaults).some(([owner, refs]) => owner !== id && refs.includes(ref)))
    || families.some(([prefix, owners]) => ref.startsWith(prefix) && !owners.includes(id))
}
