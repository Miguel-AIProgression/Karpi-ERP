import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  const url = new URL(req.url)
  const orderId = url.searchParams.get('order_id') ?? '313928073'
  const shop = url.searchParams.get('shop') ?? 'nl'

  const suffix = shop.toUpperCase()
  const key = Deno.env.get(`LIGHTSPEED_${suffix}_API_KEY`) ?? ''
  const secret = Deno.env.get(`LIGHTSPEED_${suffix}_API_SECRET`) ?? ''
  const base = (Deno.env.get(`LIGHTSPEED_${suffix}_CLUSTER_URL`) ?? '').replace(/\/$/, '')
  const auth = 'Basic ' + btoa(`${key}:${secret}`)

  // Haal order products op, probeer ook met inputFields embed
  const [resPlain, resEmbed] = await Promise.all([
    fetch(`${base}/orders/${orderId}/products.json`, { headers: { Authorization: auth, Accept: 'application/json' } }),
    fetch(`${base}/orders/${orderId}/products.json?embed=inputFields`, { headers: { Authorization: auth, Accept: 'application/json' } }),
  ])
  const dataPlain = await resPlain.json()
  const dataEmbed = await resEmbed.json()

  const firstPlain = Array.isArray(dataPlain?.orderProducts) ? dataPlain.orderProducts[0] : null
  const firstEmbed = Array.isArray(dataEmbed?.orderProducts) ? dataEmbed.orderProducts[0] : null

  return new Response(JSON.stringify({
    plain_keys: firstPlain ? Object.keys(firstPlain) : [],
    embed_keys: firstEmbed ? Object.keys(firstEmbed) : [],
    plain_first_product: firstPlain,
    embed_first_product: firstEmbed,
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
})
