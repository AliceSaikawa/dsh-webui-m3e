/**
 * Presentation for DSH permission presets. The Host names the built-in presets
 * after their machine key (or the stock English label), so the shipped client
 * replaces those names and descriptions with product copy. These are the same
 * substitutions for this UI. A host-supplied name outside the built-ins is kept.
 */

const BUILTIN_NAMES: Record<string, string> = {
  'read-only': '読み取りのみ',
  'workspace-write': 'ワークスペース書込',
  'danger-full-access': 'フル アクセス',
}
/** Stock English labels the Host may use instead of the machine key. */
const STOCK_NAMES: Record<string, readonly string[]> = {
  'read-only': ['Read Only'],
  'workspace-write': ['Workspace Write'],
  'danger-full-access': ['Full access'],
}
/**
 * Stock English descriptions from the plugin's default config, for a Host that
 * passes that config through unchanged. dsh-base's layout has no descriptions,
 * so these never match there. It ships none for read-only.
 */
const STOCK_DESCRIPTIONS: Record<string, string> = {
  'workspace-write': 'Write inside the workspace and permitted temporary directories; wider retries require approval.',
  'danger-full-access': 'Full file access without approval prompts.',
}
const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  'workspace-write': '作業フォルダと許可された一時フォルダの中に書き込めます。範囲を広げるときは確認します。',
  'danger-full-access': '確認なしで、すべてのファイルにアクセスできます。',
}
const AUTO_NAME = '自動レビュー（実験的）'
const AUTO_DESCRIPTION = 'サンドボックスなしで動きます。ツールを呼び出すたびに、同じモデルが実験的に確認します。'

function isStockName(value: string, hostName: string): boolean {
  if (hostName === '' || hostName === value) return true
  return STOCK_NAMES[value]?.some(stock => stock.toLowerCase() === hostName.toLowerCase()) ?? false
}

/** Built-in product label, or the Host's own name when it customized the preset. */
export function presetDisplayName(value: string, hostName: string): string {
  if (value === 'auto') return AUTO_NAME
  if (value === 'custom') return 'カスタム'
  const label = BUILTIN_NAMES[value]
  if (label !== undefined && isStockName(value, hostName)) return label
  return hostName || value
}

/** Built-in Japanese description when the Host sent exactly the stock English one; any other Host copy is kept as-is. */
export function presetDescription(value: string, hostDescription: string | undefined): string | undefined {
  if (value === 'auto') return AUTO_DESCRIPTION
  const label = BUILTIN_DESCRIPTIONS[value]
  if (label !== undefined && hostDescription?.trim() === STOCK_DESCRIPTIONS[value]) return label
  return hostDescription
}
