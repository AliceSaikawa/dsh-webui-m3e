/**
 * Browser stand-in for `node:module`. The loader may build a require at module
 * scope, but never calls it in the browser, where imports go through
 * `loader.internal`.
 */
export function createRequire(): (id: string) => never {
  return (id) => {
    throw new Error(`webui-m3e: require("${id}") is not available in the browser`)
  }
}
