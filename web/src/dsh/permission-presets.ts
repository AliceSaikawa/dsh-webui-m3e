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
const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  'read-only': 'ファイルの読み取りだけを許可します。書き込みやコマンドの実行は確認します。',
  'workspace-write': '作業フォルダと許可された一時フォルダの中に書き込めます。範囲を広げるときは確認します。',
  'danger-full-access': '確認なしで、すべてのファイルにアクセスできます。',
}
const AUTO_NAME = '自動レビュー（実験的）'
const AUTO_DESCRIPTION = 'サンドボックスなしで動きます。ツールを呼び出すたびに、同じモデルが実験的に確認します。'
const HAS_JAPANESE = /[ぁ-んァ-ン一-龥]/

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

/** Built-in Japanese description for a default English one; Host copy is kept as-is. */
export function presetDescription(value: string, hostDescription: string | undefined): string | undefined {
  if (value === 'auto') return AUTO_DESCRIPTION
  const label = BUILTIN_DESCRIPTIONS[value]
  if (label !== undefined && hostDescription !== undefined && !HAS_JAPANESE.test(hostDescription)) return label
  return hostDescription
}
