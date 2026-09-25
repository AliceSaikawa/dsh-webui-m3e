import { uiChoiceCookie } from '../../../../src/shared/ui-choice.ts'

export function backToClassic(): void {
  document.cookie = uiChoiceCookie('classic')
  location.assign('/')
}
