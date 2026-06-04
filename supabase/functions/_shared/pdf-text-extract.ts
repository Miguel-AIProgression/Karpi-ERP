/**
 * Minimale PDF-tekstextractor voor Deno/edge-omgevingen zonder native dependencies.
 * Werkt voor digitale (niet-gescande) PDFs — typisch voor inkooporder-PDFs.
 *
 * Aanpak: zoek tekst-streams (BT…ET blokken) en lees Tj/TJ/Tf-operatoren.
 * Compressed content streams (FlateDecode) worden gedecomprimeerd via DecompressionStream.
 */

/** Decodeer PDF-escaped string: \n → newline, \( → (, \012 → octal, etc. */
function decodePdfString(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\(.)/g, '$1')
}

/** Extraheer leesbare tekstfragmenten uit een gedecodeerde content-stream. */
function extractFromStream(stream: string): string[] {
  const fragments: string[] = []

  // (tekst) Tj  — enkelvoudige tekst-string
  const tjRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g
  for (const m of stream.matchAll(tjRe)) {
    const t = decodePdfString(m[1]).trim()
    if (t) fragments.push(t)
  }

  // [(tekst1) offset (tekst2) …] TJ — array van strings met kerning
  const tjArrayRe = /\[([^\]]*)\]\s*TJ/g
  for (const m of stream.matchAll(tjArrayRe)) {
    const inner = m[1]
    const strRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g
    for (const s of inner.matchAll(strRe)) {
      const t = decodePdfString(s[1]).trim()
      if (t) fragments.push(t)
    }
  }

  return fragments
}

/** Probeer een FlateDecode-gecomprimeerd byte-blok te decomprimeren. */
async function tryDecompress(bytes: Uint8Array): Promise<string | null> {
  try {
    const ds = new DecompressionStream('deflate-raw')
    const writer = ds.writable.getWriter()
    const reader = ds.readable.getReader()

    writer.write(bytes)
    writer.close()

    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }

    const total = chunks.reduce((n, c) => n + c.length, 0)
    const merged = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) { merged.set(c, offset); offset += c.length }

    return new TextDecoder('latin1').decode(merged)
  } catch {
    return null
  }
}

/**
 * Extraheer zoveel mogelijk leesbare tekst uit een PDF (als Uint8Array).
 * Geeft een lege string terug als er niets uitkomt (gescande/versleutelde PDF).
 */
export async function extractTextFromPdfBytes(pdfBytes: Uint8Array): Promise<string> {
  const raw = new TextDecoder('latin1').decode(pdfBytes)

  const fragments: string[] = []

  // 1. Directe tekst-streams (niet gecomprimeerd)
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  for (const m of raw.matchAll(streamRe)) {
    fragments.push(...extractFromStream(m[1]))
  }

  // 2. FlateDecode-streams decomprimeren
  const flateRe = /\/FlateDecode[^>]*>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g
  for (const m of raw.matchAll(flateRe)) {
    const streamBytes = new TextEncoder().encode(m[1])
    const decompressed = await tryDecompress(streamBytes)
    if (decompressed) {
      fragments.push(...extractFromStream(decompressed))
    }
  }

  // 3. Leesbare ASCII-strings als laatste redmiddel (strings ≥ 4 printbare tekens)
  if (fragments.length === 0) {
    const asciiRe = /[ -~]{4,}/g
    for (const m of raw.matchAll(asciiRe)) {
      // Sla PDF-structuurwoorden over
      if (/^(stream|endstream|obj|endobj|xref|trailer|startxref|PDF)/.test(m[0])) continue
      fragments.push(m[0])
    }
  }

  return fragments
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 15_000) // max 15k tekens — ruim genoeg voor een bestelling
}
