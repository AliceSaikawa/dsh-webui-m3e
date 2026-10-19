import type { ApprovalDisplayReason } from '../../dsh/interactions-store.ts'
import type { Locale } from '../../i18n/locale.ts'

/**
 * The line the approval sheet shows (Issue #122). The Host may attach
 * `displayReason`, localized copy meant for the reader, next to the audit
 * `reason` it keeps for the record (for example `escalate sandbox to …`).
 *
 * Pick the page language, then English, which the wire contract always
 * carries; only an approval without any display copy falls back to `reason`.
 */
export function approvalReason(
  approval: { readonly reason?: string; readonly displayReason?: ApprovalDisplayReason },
  locale: Locale,
): string | undefined {
  const display = approval.displayReason
  if (display === undefined) return approval.reason
  return display[locale] ?? display.en
}
