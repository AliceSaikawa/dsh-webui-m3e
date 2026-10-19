import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import type { RemoteResult } from '../web/src/dsh/services.ts'
import { extendMock, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { DISPLAY_LOCALES, LOCALES, displayLocale, documentLanguage, isLocaleTag, matchLocale, requestedLocale, type Locale } from '../web/src/i18n/locale.ts'
import { compareText, formatDateTime, formatNumber, intlLocale, numberFormat } from '../web/src/i18n/format.ts'
import { catalogProblems, defineMessages, isCatalog, messagesOf, untranslatedLocales, type Catalog, type Messages, type Translation } from '../web/src/i18n/catalog.ts'
import { createLocaleStore } from '../web/src/i18n/store.ts'
import { connectLocalePreference, localePreferenceOf } from '../web/src/i18n/dsh.ts'
import { bootMessages } from '../web/src/app/messages.ts'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

// --- Choosing the language -------------------------------------------------

test('DSH の locale.preference をブラウザの言語より優先する', () => {
  assert.equal(requestedLocale({ preference: 'en', languages: ['ja-JP'] }), 'en')
  assert.equal(requestedLocale({ preference: 'zh', languages: ['ja-JP'] }), 'zh')
  assert.equal(requestedLocale({ preference: 'ja', languages: ['en-US'] }), 'ja')
  assert.equal(requestedLocale({ preference: 'zh-CN', languages: ['en-US'] }), 'zh')
})

test('locale.preference が未設定ならブラウザの言語を順に見て、最初に対応する言語を使う', () => {
  assert.equal(requestedLocale({ languages: ['ja-JP', 'en-US'] }), 'ja')
  assert.equal(requestedLocale({ languages: ['en-GB'] }), 'en')
  assert.equal(requestedLocale({ languages: ['fr-FR', 'zh-CN', 'ja'] }), 'zh')
  assert.equal(requestedLocale({ languages: ['zh-TW', 'ja-JP'] }), 'ja')
  assert.equal(requestedLocale({ preference: undefined, languages: ['ja'] }), 'ja')
  // DSH would not accept these values, so they count as unset.
  for (const preference of ['', ' ', 'x', '日本語', 'en_US', 'en-']) {
    assert.equal(requestedLocale({ preference, languages: ['ja-JP'] }), 'ja', preference)
  }
})

test('未対応の言語は英語にする（設定値でもブラウザの言語でも）', () => {
  assert.equal(requestedLocale({ preference: 'fr', languages: ['ja-JP'] }), 'en')
  assert.equal(requestedLocale({ preference: 'ko-KR', languages: ['zh-CN'] }), 'en')
  assert.equal(requestedLocale({ languages: ['fr-FR', 'de'] }), 'en')
  assert.equal(requestedLocale({ languages: [] }), 'en')
})

test('中国語は簡体字だけ。繁体字は未対応として英語にする', () => {
  for (const tag of ['zh', 'zh-CN', 'zh-Hans', 'zh-SG', 'zh-Hans-CN', 'zh-Hans-HK', 'ZH-cn', 'zh_CN', 'zh-MY']) {
    assert.equal(matchLocale(tag), 'zh', tag)
    assert.equal(requestedLocale({ languages: [tag] }), 'zh', tag)
  }
  for (const tag of ['zh-Hant', 'zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant-TW', 'zh-Hant-CN', 'zh-hant-hk', 'ZH-TW', 'zh_TW']) {
    assert.equal(matchLocale(tag), undefined, tag)
    assert.equal(requestedLocale({ languages: [tag] }), 'en', tag)
    if (!tag.includes('_')) assert.equal(requestedLocale({ preference: tag, languages: ['zh-CN'] }), 'en', tag)
  }
  assert.equal(matchLocale('yue-HK'), undefined)
  assert.equal(matchLocale('ja-JP'), 'ja')
  assert.equal(matchLocale('en-US-u-ca-gregory'), 'en')
})

test('訳がそろうまでは、英語・中国語を求められても画面は日本語のまま（lang も ja）', () => {
  assert.deepEqual(DISPLAY_LOCALES, ['ja'])
  assert.equal(displayLocale('en'), 'ja')
  assert.equal(displayLocale('zh'), 'ja')
  assert.equal(displayLocale('ja'), 'ja')
  assert.equal(displayLocale('en', LOCALES), 'en')
  assert.equal(displayLocale('zh', ['ja', 'en']), 'ja')
})

test('DSH が受け付ける形の未知の言語タグでも、画面はキー名を出さず日本語に落ちる（Issue #128 の確かめ）', () => {
  // Same shape as dsh-client-locale's LOCALE_ID_PATTERN (web/src/i18n/locale.ts LOCALE_TAG).
  // The heading in e2e-dsh/real-dsh.spec.ts shows the DSH workspace record directly, so even
  // if the dictionary's language resolution breaks on unknown values, no key name may appear on screen.
  for (const preference of ['fr', 'ko-KR', 'de-CH', 'zz', 'xx-3', 'qq-Q']) {
    assert.ok(isLocaleTag(preference), `${preference}: DSH の preference の形と同じパターン`)
    const store = createLocaleStore({ languages: ['ja-JP'], preference })
    assert.equal(displayLocale(store.getSnapshot().requested), 'ja', preference)
    assert.equal(store.getSnapshot().lang, 'ja', preference)
    const messages = messagesOf(bootMessages, store.getSnapshot().active)
    for (const key of Object.keys(bootMessages.ja) as (keyof typeof bootMessages.ja)[]) {
      assert.notEqual(messages[key], key, `${preference}: キー名 ${String(key)} をそのまま出さない`)
      assert.equal(messages[key], bootMessages.ja[key], preference)
    }
  }
})

test('lang 属性の値：日本語は今と同じ ja、中国語は DSH の標準画面と同じ zh-CN', () => {
  assert.equal(documentLanguage('ja'), 'ja')
  assert.equal(documentLanguage('en'), 'en')
  assert.equal(documentLanguage('zh'), 'zh-CN')
})

test('言語の store は結果が変わったときだけ通知し、設定を消すとブラウザの言語に戻る', () => {
  const store = createLocaleStore({ languages: ['ja-JP'], available: LOCALES })
  let notified = 0
  const off = store.subscribe(() => { notified++ })
  assert.deepEqual(store.getSnapshot(), { requested: 'ja', active: 'ja', lang: 'ja' })
  store.setPreference('en')
  assert.deepEqual(store.getSnapshot(), { requested: 'en', active: 'en', lang: 'en' })
  assert.equal(notified, 1)
  const same = store.getSnapshot()
  store.setPreference('en-GB')
  assert.equal(store.getSnapshot(), same, 'the same result keeps the snapshot identity')
  assert.equal(notified, 1)
  store.setPreference('zh-Hans')
  assert.deepEqual(store.getSnapshot(), { requested: 'zh', active: 'zh', lang: 'zh-CN' })
  store.setPreference(undefined)
  assert.equal(store.getSnapshot().requested, 'ja')
  store.setLanguages(['zh-TW'])
  assert.equal(store.getSnapshot().requested, 'en')
  assert.equal(notified, 4)
  off()
  store.setPreference('zh')
  assert.equal(notified, 4)
})

test('既定の store は、英語を求められても表示を日本語にし、求めた言語は requested に残す', () => {
  const store = createLocaleStore({ languages: ['en-US'], preference: 'zh' })
  assert.deepEqual(store.getSnapshot(), { requested: 'zh', active: 'ja', lang: 'ja' })
  let notified = 0
  store.subscribe(() => { notified++ })
  store.setPreference('en')
  assert.deepEqual(store.getSnapshot(), { requested: 'en', active: 'ja', lang: 'ja' })
  assert.equal(notified, 1)
})

// --- Reading DSH's locale.preference ---------------------------------------

test('settings.describe() の locale 名前空間から preference を読む', () => {
  const describe = (namespaces: unknown) => localePreferenceOf({ writable: true, namespaces })
  assert.deepEqual(describe([{ ns: 'shell', value: { preference: 'en' } }, { ns: 'locale', value: { preference: 'zh' } }]), { preference: 'zh' })
  assert.deepEqual(describe([{ ns: 'locale', value: {} }]), { preference: undefined })
  assert.deepEqual(describe([{ ns: 'locale', value: { preference: 'not a tag' } }]), { preference: undefined })
  assert.deepEqual(describe([{ ns: 'locale', value: { preference: 3 } }]), { preference: undefined })
  assert.deepEqual(describe([{ ns: 'locale' }]), { preference: undefined })
  assert.deepEqual(describe([]), { preference: undefined }, 'a DSH without the locale plugin follows the browser')
  assert.equal(localePreferenceOf(undefined), undefined)
  assert.equal(localePreferenceOf({ namespaces: 'x' }), undefined)
})

test('偽データの DSH（0.2.0-rc.2 の describe の写し）にも locale 名前空間があり、変更の通知で再読み込みなしに追従する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  const settings = ctx.remote.settings as SettingsMockRemote
  const store = createLocaleStore({ languages: ['ja-JP'], available: LOCALES })
  const stop = connectLocalePreference(ctx, store)
  await tick()
  assert.equal(store.getSnapshot().requested, 'ja')
  const revision = async () => {
    const result = await settings.describe()
    assert.ok(result.ok)
    const row = result.value.namespaces.find(item => item.ns === 'locale')
    assert.ok(row, 'locale namespace is listed')
    assert.equal(row.autoGenerate, false)
    return row.revision
  }
  assert.ok((await settings.update('locale', { preference: 'en' }, await revision())).ok)
  await tick(); await tick()
  assert.equal(store.getSnapshot().requested, 'en')
  assert.ok((await settings.mutate('locale', [{ op: 'unset', path: ['preference'] }], await revision())).ok)
  await tick(); await tick()
  assert.equal(store.getSnapshot().requested, 'ja')
  stop()
  assert.ok((await settings.update('locale', { preference: 'zh' }, await revision())).ok)
  await tick(); await tick()
  assert.equal(store.getSnapshot().requested, 'ja', 'no update after the disposer ran')
})

function fakeRemote() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const pending: ((result: RemoteResult<unknown>) => void)[] = []
  let calls = 0
  let state: 'connected' | 'disconnected' | 'connecting' | undefined = 'connected'
  const stateListeners = new Set<() => void>()
  const remote = {
    settings: { describe: () => { calls++; return new Promise<RemoteResult<unknown>>(resolve => pending.push(resolve)) } },
    $on(event: string, listener: (...args: unknown[]) => void) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => set.delete(listener)
    },
  }
  const connection = {
    state: { getSnapshot: () => state, subscribe: (listener: () => void) => { stateListeners.add(listener); return () => { stateListeners.delete(listener) } } },
    reconnect() {},
  }
  return {
    remote, connection, pending,
    get calls() { return calls },
    emit(event: string, ...args: unknown[]) { for (const listener of listeners.get(event) ?? []) listener(...args) },
    setState(next: typeof state) { state = next; for (const listener of [...stateListeners]) listener() },
    answer(preference: string | undefined) {
      pending.shift()!({ ok: true, value: { writable: true, namespaces: [{ ns: 'locale', value: preference === undefined ? {} : { preference } }] } })
    },
  }
}

test('locale 以外の名前空間の通知では読み直さず、読み直しは同時に 1 件にまとめる', async () => {
  const fake = fakeRemote()
  const store = createLocaleStore({ languages: ['ja-JP'], available: LOCALES })
  connectLocalePreference(fake, store)
  assert.equal(fake.calls, 1)
  fake.emit('settings/document-updated', 'shell', 2)
  fake.emit('settings/document-updated', 'locale', 2)
  fake.emit('settings/document-updated', 'locale', 3)
  assert.equal(fake.calls, 1, 'a read is already running')
  fake.answer('en')
  await tick()
  assert.equal(store.getSnapshot().requested, 'en')
  assert.equal(fake.calls, 2, 'the two locale notices became one more read')
  fake.answer('zh')
  await tick()
  assert.equal(store.getSnapshot().requested, 'zh')
  assert.equal(fake.calls, 2)
})

test('失敗した読み込みは今の言語を保ち、再接続したら読み直す', async () => {
  const fake = fakeRemote()
  const store = createLocaleStore({ languages: ['ja-JP'], available: LOCALES })
  const stop = connectLocalePreference(fake, store)
  fake.answer('en')
  await tick()
  assert.equal(store.getSnapshot().requested, 'en')
  fake.setState('disconnected')
  fake.setState('connecting')
  assert.equal(fake.calls, 1)
  fake.setState('connected')
  assert.equal(fake.calls, 2)
  fake.pending.shift()!({ ok: false, error: { code: 'gateway/internal', message: 'x', details: {} } })
  await tick()
  assert.equal(store.getSnapshot().requested, 'en')
  fake.setState('connected')
  assert.equal(fake.calls, 2, 'staying connected is not a reconnect')
  fake.emit('settings/document-updated', 'locale')
  fake.pending.shift()!({ ok: true, value: { namespaces: 'broken' } })
  await tick()
  assert.equal(store.getSnapshot().requested, 'en')
  stop()
  fake.emit('settings/document-updated', 'locale')
  fake.setState('disconnected'); fake.setState('connected')
  assert.equal(fake.calls, 3)
})

test('describe が投げても、settings のない DSH でも何もしない', async () => {
  const store = createLocaleStore({ languages: ['ja-JP'], available: LOCALES })
  const stop = connectLocalePreference({ remote: { settings: { describe: () => Promise.reject(new Error('x')) } } }, store)
  await tick()
  assert.equal(store.getSnapshot().requested, 'ja')
  stop()
  connectLocalePreference({ remote: {} }, store)()
})

// --- Formats ---------------------------------------------------------------

test('日本語の書式は、いま各機能に直接書いてある ja-JP の書式と同じ結果になる', () => {
  for (const value of [0, 7, 1023, 12345, 9999.5]) {
    assert.equal(formatNumber('ja', value), value.toLocaleString('ja-JP'))
    assert.equal(formatNumber('ja', value, { maximumFractionDigits: 1 }), value.toLocaleString('ja-JP', { maximumFractionDigits: 1 }))
  }
  const date = new Date(2026, 0, 5, 9, 7)
  // web/src/features/home/data.ts formatUpdatedAt (yyyy/mm/dd, HH:mm)
  assert.equal(formatDateTime('ja', date, { year: 'numeric', month: '2-digit', day: '2-digit' }), '2026/01/05')
  assert.equal(formatDateTime('ja', date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), '09:07')
  // web/src/features/search/SearchScreen.tsx
  const search: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
  assert.equal(formatDateTime('ja', date, search), new Intl.DateTimeFormat('ja-JP', search).format(date))
  assert.equal(formatDateTime('ja', date.getTime(), search), formatDateTime('ja', date, search))
  // web/src/features/session-tools/files.ts sortFileEntries
  const names = ['file10.txt', 'File2.txt', 'あいう', 'アイウ', '漢字', 'file1.txt', 'b', 'A']
  assert.deepEqual([...names].sort((a, b) => compareText('ja', a, b, { numeric: true })), [...names].sort((a, b) => a.localeCompare(b, 'ja', { numeric: true })))
})

test('英語・中国語の書式はその言語の Intl を使う', () => {
  assert.equal(intlLocale('ja'), 'ja-JP')
  assert.equal(intlLocale('en'), 'en-US')
  assert.equal(intlLocale('zh'), 'zh-CN')
  assert.equal(formatNumber('en', 1234.5), '1,234.5')
  assert.equal(formatNumber('zh', 1234.5), '1,234.5')
  const date = new Date(2026, 0, 5, 9, 7)
  assert.equal(formatDateTime('en', date, { month: 'long', day: 'numeric' }), 'January 5')
  assert.equal(formatDateTime('zh', date, { month: 'long', day: 'numeric' }), '1月5日')
  assert.equal(formatDateTime('ja', date, { month: 'long', day: 'numeric' }), '1月5日')
  assert.ok(compareText('en', 'apple', 'Banana') < 0)
  assert.ok(compareText('en', 'file2', 'file10', { numeric: true }) < 0)
})

test('不正な日時は undefined を返し、書式の部品は言語と指定ごとに使い回す', () => {
  assert.equal(formatDateTime('ja', Number.NaN, { year: 'numeric' }), undefined)
  assert.equal(formatDateTime('en', new Date('invalid'), { year: 'numeric' }), undefined)
  assert.equal(numberFormat('ja', { maximumFractionDigits: 1 }), numberFormat('ja', { maximumFractionDigits: 1 }))
  assert.notEqual(numberFormat('ja'), numberFormat('en'))
})

// --- Dictionaries ----------------------------------------------------------

test('訳が未定（null）の言語では日本語を返し、訳があればその言語を返す', () => {
  const catalog = defineMessages({
    ja: { title: '設定', count: (count: number) => `${count} 件` },
    en: { title: 'Settings', count: (count: number) => `${count} items` },
    zh: null,
  })
  assert.equal(messagesOf(catalog, 'ja').title, '設定')
  assert.equal(messagesOf(catalog, 'en').count(3), '3 items')
  assert.equal(messagesOf(catalog, 'zh').count(3), '3 件')
  assert.deepEqual(untranslatedLocales(catalog), ['zh'])
  assert.deepEqual(catalogProblems(catalog), [])
  assert.ok(isCatalog(catalog))
  assert.equal(isCatalog({ ja: {}, en: null, zh: null }), false)
})

test('キーの欠け・余り・文字列と関数の取り違えを実行時にも検出できる', () => {
  // Bypasses the type check on purpose, as a dictionary built at run time could.
  const broken = defineMessages({
    ja: { a: 'あ', b: 'い', n: (count: number) => `${count}` },
    en: { a: 'a', n: 'n', z: 'z' } as unknown as Translation<{ a: string; b: string; n: (count: number) => string }>,
    zh: { a: 'a', b: 'b', n: (count: number) => `${count}` },
  })
  assert.deepEqual(catalogProblems(broken), [{ locale: 'en', missing: ['b'], extra: ['z'], kind: ['n'] }])
})

test('辞書の型：英語・中国語のキーの欠けと余り、差し込む値の型の違いを型検査で落とす', () => {
  // `pnpm typecheck` (tsconfig.host.json includes tests/) fails if any of these
  // lines stops being a type error ("Unused '@ts-expect-error' directive").
  const ja = { title: '設定', count: (count: number) => `${count} 件` }
  // @ts-expect-error missing key
  defineMessages({ ja, en: { title: 'Settings' }, zh: null })
  // @ts-expect-error extra key
  defineMessages({ ja, en: { title: 'Settings', count: (count: number) => `${count}`, extra: 'x' }, zh: null })
  const separate = { title: '设置', count: (count: number) => `${count} 条`, extra: 'x' }
  // @ts-expect-error extra key in a dictionary written elsewhere
  defineMessages({ ja, en: null, zh: separate })
  // @ts-expect-error a function message must stay a function
  defineMessages({ ja, en: { title: 'Settings', count: 'items' }, zh: null })
  // @ts-expect-error with the same parameters
  defineMessages({ ja, en: { title: 'Settings', count: (count: string) => count }, zh: null })
  // @ts-expect-error extra key with satisfies
  void ({ title: 'Settings', count: (count: number) => `${count}`, extra: 'x' } satisfies Translation<typeof ja>)
  const fine = defineMessages({ ja, en: { title: 'Settings', count: (count: number) => `${count} items` }, zh: null })
  // @ts-expect-error the parameter type is kept for callers
  messagesOf(fine, 'en').count('3')
  assert.equal(messagesOf(fine, 'en').count(3), '3 items')
})

async function messageFiles(dir: URL): Promise<URL[]> {
  const entries = await readdir(fileURLToPath(dir), { recursive: true })
  return entries.filter(path => /(^|[\\/])messages\.ts$/u.test(path)).sort().map(path => pathToFileURL(`${fileURLToPath(dir)}${path}`))
}

test('web/src の全 messages.ts の辞書がそろっていて、表示に使う言語には訳がある', async t => {
  const files = await messageFiles(new URL('../web/src/', import.meta.url))
  assert.ok(files.length >= 1, 'at least the start-up messages exist')
  const found: { name: string; catalog: Catalog<Messages> }[] = []
  for (const file of files) {
    const module = await import(file.href) as Record<string, unknown>
    const catalogs = Object.entries(module).filter(([, value]) => isCatalog(value))
    assert.ok(catalogs.length > 0, `${file.pathname} exports no defineMessages() catalog`)
    for (const [name, value] of catalogs) found.push({ name: `${file.pathname.replace(/^.*\/web\/src\//u, '')}#${name}`, catalog: value as Catalog<Messages> })
  }
  for (const { name, catalog } of found) {
    assert.deepEqual(catalogProblems(catalog), [], name)
    for (const locale of DISPLAY_LOCALES) {
      assert.ok(!untranslatedLocales(catalog).includes(locale), `${name} has no ${locale} translation, but ${locale} is in DISPLAY_LOCALES`)
    }
  }
  const pending = (locale: Locale) => found.filter(({ catalog }) => untranslatedLocales(catalog).includes(locale)).length
  t.diagnostic(`catalogs: ${found.length}; untranslated en: ${pending('en')}, zh: ${pending('zh')}`)
})
