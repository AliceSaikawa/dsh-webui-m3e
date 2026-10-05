// DSH 0.2.0-rc.2: pi-ai/dist/env-api-keys.js:67-121 and provider definitions.
// These are reserved destinations, not registration-status lookup targets.
const conventional = ['ant-ling', 'qwen-token-plan', 'qwen-token-plan-cn', 'openai', 'nvidia', 'deepseek',
  'groq', 'cerebras', 'xai', 'radius', 'openrouter', 'zai', 'zai-coding-cn', 'mistral', 'minimax',
  'minimax-cn', 'fireworks', 'together', 'baseten', 'opencode', 'meta', 'xiaomi',
  'xiaomi-token-plan-cn', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-sgp']
export const derivedKeyRef = (id: string) => `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
export const validKeyReference = (ref: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)
export const invalidKeyReferenceMessage = 'キーの参照名が DSH の形式に合わないため、この提供元には API キーを登録できません。'
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
export const pendingKeyReferenceMessage = 'キーの参照先だけが設定されています。キーを登録するまで、この提供元を使えない場合があります。'
/**
 * `named` holds every reference name that a provider states in the settings.
 * Only a provider without a reference asks, so it never names `ref` itself and
 * no owner is excluded: an owner identity that could equal a custom ID (which
 * may contain "/") would hide a real collision.
 */
export function keyReferenceReason(named: readonly string[], ref: string): string | undefined {
  if (named.includes(ref)) return '別の提供元とキーの参照名が重なります。'
  if (Object.values(defaults).some(refs => refs.includes(ref))) return '標準の提供元が使う名前として予約されています。'
  const family = families.find(prefix => ref.startsWith(prefix))
  if (family) return `${family} で始まる名前は標準の提供元の補助設定として予約されています。`
}
export function keyReferenceConflict(named: readonly string[], ref: string): boolean {
  return keyReferenceReason(named, ref) !== undefined
}
export function keyReferenceError(id: string, ref: string, reason: string): string {
  return `参照名「${ref}」：${reason} キーを空欄にするか、ほかと重ならない接頭辞を付けた ID（例：my-${id}）で追加してください。`
}
