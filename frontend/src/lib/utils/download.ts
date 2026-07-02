/** Downloadt een URL direct i.p.v. 'm in een nieuw tabblad te openen. */
export function downloadUrl(url: string, filename?: string): void {
  const a = document.createElement('a')
  a.href = url
  if (filename) a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
