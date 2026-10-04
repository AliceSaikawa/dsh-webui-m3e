import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import type { DshHost } from './dsh-host.ts'

/** A valid PNG larger than the UI's 256 KiB read page, without image libraries. */
export function pagedPng(): Buffer {
  const width = 384, height = 256
  const pixels = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (1 + width * 4) + 1 + x * 4
    pixels.set([x % 256, y, (x + y) % 256, 255], offset)
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data])
    let crc = 0xffffffff
    for (const byte of body) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    const result = Buffer.alloc(body.length + 8)
    result.writeUInt32BE(data.length)
    body.copy(result, 4)
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4)
    return result
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4)
  header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels, { level: 0 })), chunk('IEND', Buffer.alloc(0))])
}

/** Mount a test integration in this harness's profile, using the real Host API. */
export async function autoPresetControl(host: DshHost) {
  const run = dirname(host.workspace)
  const flag = join(run, 'rpc-auto-flag')
  const ack = join(run, 'rpc-auto-ack')
  const pluginDir = join(run, 'rpc-auto-plugin')
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ name: 's5-rpc-audit', type: 'module', version: '0.0.0' }))
  const plugin = join(pluginDir, 'index.mjs')
  const profile = join(run, 'dsh-home/profiles/web/cordis.patch.yml')
  const original = readFileSync(profile, 'utf8')
  writeFileSync(flag, 'off')
  writeFileSync(plugin, `
import { readFileSync, writeFileSync, watchFile, unwatchFile } from 'node:fs';
export const inject = ['permissionPresets'];
export function apply(ctx) {
  const flag = ${JSON.stringify(flag)}, ack = ${JSON.stringify(ack)};
  let dispose, queue = Promise.resolve();
  const update = () => { queue = queue.then(async () => {
    const state = readFileSync(flag, 'utf8');
    if (state === 'on' && !dispose) dispose = ctx.permissionPresets.registerAuto(() => {});
    if (state === 'off' && dispose) { await dispose(); dispose = undefined; }
    writeFileSync(ack, state);
  }); };
  ctx.effect(() => {
    watchFile(flag, { interval: 20 }, update); update();
    return async () => { unwatchFile(flag, update); await queue; await dispose?.(); };
  });
}
`)
  writeFileSync(profile, `${original.replace(/^\[\]\s*$/m, '')}\n- insert:\n    - id: s5-rpc-auto\n      name: ${JSON.stringify(pathToFileURL(plugin).href)}\n`)
  await host.restart()
  return {
    set: (enabled: boolean) => writeFileSync(flag, enabled ? 'on' : 'off'),
    acknowledged: () => { try { return readFileSync(ack, 'utf8') } catch { return '' } },
    restore: () => { writeFileSync(flag, 'off'); writeFileSync(profile, original) },
  }
}
