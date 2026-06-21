/** Splits een array in stukken van `size` (o.a. om de PostgREST row-cap te omzeilen). */
export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
