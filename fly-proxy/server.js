import { createServer } from 'http'
import { readFileSync } from 'fs'

const SUPABASE_API = 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/supplier-portal'
const PORT = process.env.PORT || 8080
const PORTAL_HTML = readFileSync(new URL('./portal.html', import.meta.url), 'utf8')

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  // /api → proxy naar Supabase Edge Function
  if (url.pathname === '/api') {
    const body = req.method !== 'GET' ? await readBody(req) : undefined
    const headers = { Accept: 'application/json' }
    if (body) headers['Content-Type'] = req.headers['content-type'] || 'application/json'

    try {
      const r = await fetch(SUPABASE_API + (url.search || ''), {
        method: req.method,
        headers,
        body,
      })
      const text = await r.text()
      res.writeHead(r.status, { 'Content-Type': 'application/json' })
      return res.end(text)
    } catch (e) {
      console.error('Proxy error:', e)
      res.writeHead(502, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: 'Proxy error' }))
    }
  }

  // / of /index.html → portal HTML
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(PORTAL_HTML)
  }

  res.writeHead(404)
  res.end('Not found')
}).listen(PORT, () => console.log(`Karpi Portal Proxy listening on :${PORT}`))

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
