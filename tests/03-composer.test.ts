import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterCommands, findReferenceToken, fitImageDimensions, isKnownCommand,
  isReferencePathSafe, replaceReference, shouldConvertImage, visibleQueue,
} from '../web/src/features/composer/helpers.ts'

test('reference completion is limited to the cursor word after a whitespace boundary', () => {
  assert.deepEqual(findReferenceToken('@docs', 5), { start: 0, end: 5, query: 'docs' })
  assert.deepEqual(findReferenceToken('確認\n@docs/file 後で', 8), { start: 3, end: 13, query: 'docs' })
  assert.deepEqual(findReferenceToken('確認 @', 4), { start: 3, end: 4, query: '' })
  assert.equal(findReferenceToken('mail@example.com', 16), null)
  assert.equal(findReferenceToken('@docs 後で', 8), null)
  assert.equal(findReferenceToken('途中 @docs', -1), null)
  assert.equal(findReferenceToken('途中 @docs', 99), null)
})

test('reference insertion replaces the whole active word and preserves surrounding text', () => {
  const text = '確認 @docs/file 後で'
  const token = findReferenceToken(text, 8)
  assert.ok(token)
  const result = replaceReference(text, token, 'docs/handoff.md')
  assert.deepEqual(result, { text: '確認 @docs/handoff.md 後で', cursor: 20 })
  assert.equal(result.text.slice(result.cursor), '後で')
  assert.deepEqual(replaceReference('@do', { start: 0, end: 3, query: 'do' }, 'docs', 'directory'), {
    text: '@docs/ ', cursor: 7,
  })
  assert.equal(replaceReference('@do', { start: 0, end: 3, query: 'do' }, 'docs/', 'directory').text, '@docs/ ')
})

test('space-containing paths are quoted and quoted completion remains cursor-aware', () => {
  assert.deepEqual(findReferenceToken('@"my docs/re', 12), { start: 0, end: 12, query: 'my docs/re' })
  const text = '見て @"my docs/readme" 続き'
  const token = findReferenceToken(text, 10)
  assert.ok(token)
  assert.equal(token.query, 'my do')
  assert.equal(replaceReference(text, token, 'my docs/README.md').text, '見て @"my docs/README.md" 続き')
  assert.equal(findReferenceToken('@"my docs"', 10), null)
  assert.equal(isReferencePathSafe('my docs/README.md'), true)
  assert.equal(isReferencePathSafe('a"b'), false)
  assert.equal(isReferencePathSafe('a\nb'), false)
  assert.equal(isReferencePathSafe(''), false)
  assert.throws(() => replaceReference('@a', { start: 0, end: 2, query: 'a' }, 'a"b'), /参照に使えません/u)
})

test('slash suggestions use prefixes while execution requires an exact command name', () => {
  const commands = [{ name: 'plan', hint: '内容' }, { name: 'permission' }, { name: '/model' }]
  assert.deepEqual(filterCommands(commands, '/p'), commands.slice(0, 2))
  assert.deepEqual(filterCommands(commands, '/'), commands)
  assert.deepEqual(filterCommands(commands, '/plan '), [])
  assert.deepEqual(filterCommands(commands, ' /p'), [])
  assert.deepEqual(filterCommands(commands, '文\n/p'), [])
  assert.equal(isKnownCommand('/plan off', commands), true)
  assert.equal(isKnownCommand('/model local', commands), true)
  assert.equal(isKnownCommand('/planner', commands), false)
  assert.equal(isKnownCommand('/unknown', commands), false)
  assert.equal(isKnownCommand('/p', commands), false)
  assert.equal(isKnownCommand(' /plan', commands), false)
  assert.equal(isKnownCommand('/', commands), false)
})

test('only queued and steering placements are shown, retaining order and identity', () => {
  const queue = ['queued', 'submitted', 'steering', 'consumed', 'unknown'].map((placement, id) => ({ placement, id }))
  const selected = visibleQueue(queue)
  assert.deepEqual(selected.map(item => item.id), [0, 2])
  assert.equal(selected[0], queue[0])
  assert.equal(queue.length, 5)
})

test('image conversion preserves all supported types at the exact size limit', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    assert.equal(shouldConvertImage(type, 2048, 1), false)
    assert.equal(shouldConvertImage(type, 1, 2048), false)
    assert.equal(shouldConvertImage(type, 2049, 1), true)
    assert.equal(shouldConvertImage(type, 1, 2049), true)
  }
  for (const type of ['image/heic', 'image/avif', 'image/svg+xml', '']) {
    assert.equal(shouldConvertImage(type, 20, 30), true)
  }
})

test('image resizing keeps aspect ratio without enlarging images or producing an empty edge', () => {
  assert.deepEqual(fitImageDimensions(4000, 3000), { width: 2048, height: 1536 })
  assert.deepEqual(fitImageDimensions(3000, 4000), { width: 1536, height: 2048 })
  assert.deepEqual(fitImageDimensions(400, 300), { width: 400, height: 300 })
  assert.deepEqual(fitImageDimensions(1, 9000), { width: 1, height: 2048 })
  assert.throws(() => fitImageDimensions(0, 10), /大きさ/u)
  assert.throws(() => fitImageDimensions(10, Number.NaN), /大きさ/u)
})
