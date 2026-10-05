/** Match Schemastery's decimal shifting: no tolerance around an integer step. */
function decimalShift(value: number, digits: number): number {
  const text = value.toString()
  const point = text.indexOf('.')
  if (text.includes('e') || point === -1) return value * 10 ** digits
  const fraction = text.slice(point + 1)
  const integer = text.slice(0, point)
  return fraction.length <= digits ? Number(integer + fraction.padEnd(digits, '0'))
    : Number(integer + fraction.slice(0, digits) + '.' + fraction.slice(digits))
}

export function matchesNumberStep(value: number, min = 0, step?: number): boolean {
  if (!step) return true
  const size = Math.abs(step)
  if (!/^\d+\.\d+$/.test(size.toString())) return (value - min) % size === 0
  const digits = size.toString().split('.')[1]!.length
  return Math.abs(decimalShift(value, digits) - decimalShift(min, digits)) % decimalShift(size, digits) === 0
}
