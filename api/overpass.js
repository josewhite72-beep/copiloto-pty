// Intermediario para Overpass (OpenStreetMap): la app consulta a su propio dominio y este servidor
// pregunta a los servidores públicos de Overpass. Evita los bloqueos del navegador cuando Overpass
// responde con error, reintenta con otros servidores y no guarda caché compartida (la app guarda las rotondas en el teléfono).

const SERVIDORES = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = String((req.query && req.query.data) || '');
  // Solo consultas de la app (JSON, cortas): no es un proxy abierto
  if (!q.startsWith('[out:json]') || q.length > 8000) {
    res.status(400).json({ error: 'consulta no válida' });
    return;
  }
  const inicio = Date.now();
  const fallos = [];
  for (const url of SERVIDORES) {
    const quedan = 40000 - (Date.now() - inicio);
    if (quedan < 3000) break;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), Math.min(15000, quedan));
    try {
      const r = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'CopilotoPTY/1.0 (copiloto-pty.vercel.app)' },
        signal: ctrl.signal
      });
      if (!r.ok) throw new Error(r.status === 429 ? 'servidor ocupado' : r.status >= 500 ? 'servidor saturado' : 'HTTP ' + r.status);
      const texto = await r.text();
      const data = JSON.parse(texto);
      if (data.remark && /runtime error|timed out/i.test(data.remark) && !(data.elements || []).length) throw new Error('consulta demasiado lenta');
      // Sin caché compartida: cada consulta es distinta (la app guarda las rotondas en el teléfono)
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(200).send(texto);
      return;
    } catch (e) {
      fallos.push(e.name === 'AbortError' ? 'tiempo agotado' : e.message);
    } finally {
      clearTimeout(to);
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(502).json({ error: fallos[0] || 'sin respuesta', detalle: fallos });
};
