/** Trim shared outer lines, retaining two context lines around the changed region. */
export function reviewDiff(before: string, after: string) {
  const left = before.split('\n')
  const right = after.split('\n')
  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start++
  let end = 0
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++
  return {
    before: left.slice(Math.max(0, start - 2), left.length - Math.max(0, end - 2)).join('\n'),
    after: right.slice(Math.max(0, start - 2), right.length - Math.max(0, end - 2)).join('\n'),
    omitted: start > 2 || end > 2,
  }
}
