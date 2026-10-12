'use strict';
/* =========================================================================
   Copiloto de Ruta – PanaMentorLabs
   Rutas de ida y vuelta, destinos, divisiones y rotondas con instrucción
   según el destino. Avisos de voz + flecha + carriles, en orden de ruta.
   ========================================================================= */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
}

const $ = (id) => document.getElementById(id);

const CFG = {
  avisoLargo: 1000,        // m: primer aviso de voz
  avisoCorto: 250,         // m: aviso urgente
  avisoEntrada: 40,        // m: aviso al entrar a una rotonda
  letreroCompacto: 60,     // m: desde aquí el letrero rojo se reduce a una línea
  pasadoRadio: 400,        // (sin trazado) el punto se considera pasado si estuvo a menos de esto...
  pasadoMargen: 60,        // ...y luego se alejó esta cantidad
  fueraRuta: 200,          // (con trazado) m de separación para "fuera de ruta"
  precisionMax: 75,        // m: con peor precisión se pausan los avisos
  velBloqueo: 10 / 3.6,    // m/s: por encima se bloquean los controles del conductor
  grabarCada: 15,          // m entre puntos del trazado grabado
  grabarPrecision: 50,     // m: precisión mínima para grabar
  // Mapa base de OpenStreetMap (sin clave). Sus reglas permiten ver el mapa y reusar lo ya visto,
  // pero NO descargar zonas completas para usar sin señal. El tema oscuro se aplica con CSS.
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttr: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
};

const LS_RUTAS = 'copiloto.rutas.v2';
const LS_RUTAS_V1 = 'copiloto.rutas.v1';
const LS_SEL = 'copiloto.sel.v2';
const LS_AJ = 'copiloto.ajustes';

const SENTIDOS = ['ida', 'vuelta'];
const TIPOS = ['normal', 'division', 'rotonda', 'paso'];
const ORD = ['', 'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava'];
const FLECHAS = [
  ['recto', '↑ Seguir recto'],
  ['sal-izq', '↖ Salida / carril izquierdo'],
  ['sal-der', '↗ Salida / carril derecho'],
  ['izq', '← Girar a la izquierda'],
  ['der', '→ Girar a la derecha'],
  ['retorno', '↶ Retorno (vuelta en U)'],
  ['division', '⑂ La vía se divide'],
  ['curva', '⚠ Precaución (curvas, pendiente…)']
];

/* ------------------------------------------------------------------ */
/* Datos de ejemplo (SIN VERIFICAR)                                    */
/* ------------------------------------------------------------------ */

const RUTA_EJEMPLO = {
  id: 'ejemplo-oeste-ciudad',
  nombre: 'Panamá Oeste ⇄ Ciudad (ejemplo)',
  verificada: false,
  ida: {
    nombre: 'Interior → Ciudad',
    destinos: [
      { id: 'albrook', nombre: 'Albrook' },
      { id: 'balboa', nombre: 'Balboa' },
      { id: 'cinta', nombre: 'Cinta Costera' },
      { id: 'centenario', nombre: 'Ciudad por Puente Centenario' }
    ],
    trazados: {},
    puntos: [
      { id: 'aprox_westland', nombre: 'Westland Mall', lat: 8.92450, lon: -79.71210, tipo: 'normal',
        flecha: 'recto', carriles: '-OO-', carrilTexto: 'CARRILES CENTRALES',
        instrucciones: { larga: 'En un kilómetro, Westland Mall. Manténgase en los carriles centrales.',
                         corta: 'Evite el carril derecho para no quedar en el tráfico del mall.' } },
      { id: 'loma_coba', nombre: 'Loma Cobá', lat: 8.93100, lon: -79.68500, tipo: 'normal',
        flecha: 'curva', carrilTexto: 'CURVAS: REDUZCA VELOCIDAD',
        instrucciones: { larga: 'En un kilómetro inicia Loma Cobá. Curvas pronunciadas, reduzca la velocidad.',
                         corta: 'Curvas. Mantenga su carril y su distancia.' } },
      { id: 'bifurcacion_arraijan', nombre: 'Intercambiador Arraiján', lat: 8.94820, lon: -79.65850, tipo: 'division',
        flecha: 'division', carrilTexto: 'IZQ: CENTENARIO | DER: AMÉRICAS',
        instrucciones: { larga: 'En un kilómetro la vía se divide hacia ambos puentes.',
                         corta: 'Carriles izquierdos para Puente Centenario. Derechos para Puente de las Américas.' },
        variantes: {
          centenario: { flecha: 'sal-izq', carriles: 'OO--', carrilTexto: 'IZQUIERDA: PUENTE CENTENARIO',
            larga: 'En un kilómetro la vía se divide. Para el Puente Centenario, pásese a los carriles izquierdos.',
            corta: 'Carriles izquierdos hacia el Puente Centenario.' },
          albrook: { flecha: 'sal-der', carriles: '--OO', carrilTexto: 'DERECHA: PUENTE DE LAS AMÉRICAS',
            larga: 'En un kilómetro la vía se divide. Para el Puente de las Américas, pásese a los carriles derechos.',
            corta: 'Carriles derechos hacia el Puente de las Américas.' },
          balboa: { flecha: 'sal-der', carriles: '--OO', carrilTexto: 'DERECHA: PUENTE DE LAS AMÉRICAS',
            larga: 'En un kilómetro la vía se divide. Para el Puente de las Américas, pásese a los carriles derechos.',
            corta: 'Carriles derechos hacia el Puente de las Américas.' },
          cinta: { flecha: 'sal-der', carriles: '--OO', carrilTexto: 'DERECHA: PUENTE DE LAS AMÉRICAS',
            larga: 'En un kilómetro la vía se divide. Para el Puente de las Américas, pásese a los carriles derechos.',
            corta: 'Carriles derechos hacia el Puente de las Américas.' }
        } },
      { id: 'salida_americas', nombre: 'Salida Puente de las Américas', lat: 8.94310, lon: -79.56610, tipo: 'division',
        soloDestinos: ['albrook', 'balboa', 'cinta'],
        flecha: 'division', carrilTexto: 'IZQ: ALBROOK | CENTRO: BALBOA | DER: CINTA COSTERA',
        instrucciones: { larga: 'Al terminar el puente, la vía se divide.',
                         corta: 'Izquierda hacia Albrook, centro para Balboa, derecha para Cinta Costera.' },
        variantes: {
          albrook: { flecha: 'sal-izq', carrilTexto: 'IZQUIERDA: ALBROOK',
            larga: 'Al terminar el puente la vía se divide. Para Albrook, manténgase a la izquierda.', corta: 'Izquierda hacia Albrook.' },
          balboa: { flecha: 'recto', carrilTexto: 'CENTRO: BALBOA',
            larga: 'Al terminar el puente la vía se divide. Para Balboa, manténgase en el centro.', corta: 'Centro hacia Balboa.' },
          cinta: { flecha: 'sal-der', carrilTexto: 'DERECHA: CINTA COSTERA',
            larga: 'Al terminar el puente la vía se divide. Para la Cinta Costera, manténgase a la derecha.', corta: 'Derecha hacia la Cinta Costera.' }
        } }
    ]
  },
  vuelta: {
    nombre: 'Ciudad → Interior',
    destinos: [],
    trazados: {},
    puntos: [
      { id: 'v_loma_coba', nombre: 'Loma Cobá', lat: 8.93100, lon: -79.68500, tipo: 'normal',
        flecha: 'curva', carrilTexto: 'CURVAS: REDUZCA VELOCIDAD',
        instrucciones: { larga: 'En un kilómetro, Loma Cobá. Curvas pronunciadas, reduzca la velocidad.',
                         corta: 'Curvas. Mantenga su carril y su distancia.' } },
      { id: 'v_westland', nombre: 'Westland Mall', lat: 8.92450, lon: -79.71210, tipo: 'normal',
        flecha: 'recto', carrilTexto: 'ATENCIÓN: ENTRADAS Y SALIDAS',
        instrucciones: { larga: 'En un kilómetro, zona de Westland Mall.',
                         corta: 'Atención a los vehículos que entran y salen del mall.' } }
    ]
  }
};

/* ------------------------------------------------------------------ */
/* Normalización y almacenamiento                                      */
/* ------------------------------------------------------------------ */

const uid = () => Math.random().toString(36).slice(2, 10);
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

function leerLS(k, def) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
}
function escribirLS(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) { toast('No se pudo guardar en este dispositivo'); return false; }
}

function normalizarVariante(v) {
  const o = {};
  if (!v) return o;
  ['flecha', 'carriles', 'carrilTexto', 'larga', 'corta', 'entrada'].forEach(k => {
    if (v[k] != null && String(v[k]).trim() !== '') o[k] = String(v[k]).trim();
  });
  if (Number(v.salida) > 0) o.salida = Math.round(Number(v.salida));
  if (o.carriles) o.carriles = o.carriles.toUpperCase();
  return o;
}

function normalizarPunto(p) {
  const ins = p.instrucciones || {};
  const variantes = {};
  Object.entries(p.variantes || {}).forEach(([k, v]) => {
    const n = normalizarVariante(v); if (Object.keys(n).length) variantes[String(k)] = n;
  });
  return {
    id: String(p.id || uid()),
    nombre: String(p.nombre || 'Punto'),
    lat: Number(p.lat), lon: Number(p.lon ?? p.lng),
    tipo: TIPOS.includes(p.tipo) ? p.tipo : (p.flecha === 'division' ? 'division' : 'normal'),
    soloDestinos: Array.isArray(p.soloDestinos) ? p.soloDestinos.map(String) : [],
    flecha: p.flecha || 'recto',
    salida: Number(p.salida) > 0 ? Math.round(Number(p.salida)) : null,
    salidasTotal: clamp(Math.round(Number(p.salidasTotal) || 4), 2, 8),
    carriles: String(p.carriles || '').toUpperCase(),
    carrilTexto: String(p.carrilTexto || ''),
    instrucciones: { larga: String(ins.larga || ''), corta: String(ins.corta || ''), entrada: String(ins.entrada || '') },
    variantes,
    rotGeo: normalizarRotGeo(p.rotGeo),
    calle: String(p.calle || ''),          // calle de salida (rotondas calculadas)
    rotDiag: String(p.rotDiag || ''),      // por qué no se obtuvo la forma real de la rotonda
    fuente: String(p.fuente || '')         // 'auto' = maniobra calculada, 'propio' = aviso tuyo
  };
}

// Geometría real de una rotonda importada de OpenStreetMap:
// conexiones = calles que tocan el anillo, con su posición en el sentido de circulación (pos),
// su rumbo desde el centro y si permiten entrar y/o salir.
function normalizarRotGeo(g) {
  if (!g || !Array.isArray(g.conexiones) || !g.conexiones.length) return null;
  const conexiones = g.conexiones.map(c => ({
    pos: Number(c.pos) || 0, nombre: String(c.nombre || 'Calle sin nombre'),
    rumbo: ((Number(c.rumbo) || 0) % 360 + 360) % 360, entrada: !!c.entrada, salida: !!c.salida
  }));
  const entrada = Number.isInteger(g.entrada) && g.entrada >= 0 && g.entrada < conexiones.length && conexiones[g.entrada].entrada
    ? g.entrada : null;
  const centro = isFinite(Number(g.lat)) && isFinite(Number(g.lon)) && g.lat != null ? { lat: Number(g.lat), lon: Number(g.lon) } : {};
  return { osm: String(g.osm || ''), L: Math.max(1, Number(g.L) || 1), radio: Number(g.radio) || 20, conexiones, entrada, ...centro };
}

// Salidas en el orden en que se encuentran al circular, empezando después de la entrada.
// La calle por la que se entra (si permite salir) cuenta al final: es el retorno.
function salidasDe(g) {
  if (!g || g.entrada == null) return [];
  const e = g.conexiones[g.entrada];
  return g.conexiones
    .map((c, i) => ({ ...c, i, k: i === g.entrada ? g.L + 1 : (((c.pos - e.pos) % g.L + g.L) % g.L) || g.L }))
    .filter(c => c.salida)
    .sort((a, b) => a.k - b.k);
}

function normalizarTrazado(t) {
  if (!Array.isArray(t)) return null;
  const n = t.map(x => Array.isArray(x) ? [Number(x[0]), Number(x[1])] : [Number(x && x.lat), Number(x && x.lon)])
             .filter(x => isFinite(x[0]) && isFinite(x[1]));
  return n.length >= 2 ? n : null;
}

function normalizarTramo(t, nombreDef) {
  t = t || {};
  const destinos = (t.destinos || []).map(d => ({ id: String(d.id || uid()), nombre: String(d.nombre || 'Destino') }));
  const ids = new Set(destinos.map(d => d.id));
  const trazados = {};
  Object.entries(t.trazados || {}).forEach(([k, v]) => {
    const n = normalizarTrazado(v); if (n && (k === '*' || ids.has(k))) trazados[k] = n;
  });
  if (!trazados['*'] && t.trazado) { const n = normalizarTrazado(t.trazado); if (n) trazados['*'] = n; }
  const puntos = (t.puntos || []).map(normalizarPunto).filter(p => isFinite(p.lat) && isFinite(p.lon));
  puntos.forEach(p => {
    p.soloDestinos = p.soloDestinos.filter(id => ids.has(id));
    Object.keys(p.variantes).forEach(k => { if (!ids.has(k)) delete p.variantes[k]; });
  });
  const duraciones = {};
  Object.entries(t.duraciones || {}).forEach(([k, v]) => { if (trazados[k] && Number(v) > 0) duraciones[k] = Number(v); });
  return { nombre: String(t.nombre || nombreDef), destinos, trazados, duraciones, puntos };
}

function normalizarRuta(r) {
  const base = { id: String(r.id || uid()), nombre: String(r.nombre || 'Ruta sin nombre'), verificada: !!r.verificada };
  if (r.ida || r.vuelta) {
    return { ...base, ida: normalizarTramo(r.ida, 'Ida'), vuelta: normalizarTramo(r.vuelta, 'Vuelta') };
  }
  // Formato anterior (un solo sentido): pasa a ser la ida
  return { ...base, ida: normalizarTramo({ nombre: 'Ida', trazado: r.trazado, puntos: r.puntos }, 'Ida'),
           vuelta: normalizarTramo(null, 'Vuelta') };
}

let rutas = (leerLS(LS_RUTAS, null) || leerLS(LS_RUTAS_V1, null) || []).map(normalizarRuta);
if (!rutas.length) rutas = [normalizarRuta(JSON.parse(JSON.stringify(RUTA_EJEMPLO)))];
const guardarRutas = () => escribirLS(LS_RUTAS, rutas);
guardarRutas();

// Selección actual (ruta, sentido, destino)
const sel = Object.assign({ rutaId: rutas[0].id, sentido: 'ida', destino: '' }, leerLS(LS_SEL, {}));
function validarSel() {
  if (!rutas.some(r => r.id === sel.rutaId)) sel.rutaId = rutas[0].id;
  if (!SENTIDOS.includes(sel.sentido)) sel.sentido = 'ida';
  const t = rutaSel()[sel.sentido];
  if (sel.destino && !t.destinos.some(d => d.id === sel.destino)) sel.destino = '';
  escribirLS(LS_SEL, sel);
}
const rutaSel = () => rutas.find(r => r.id === sel.rutaId) || rutas[0];
validarSel();

function puntoNuevo(lat, lon, nombre) {
  // Avisos vacíos = se generan automáticamente a partir del nombre (o de la salida, en rotondas)
  return normalizarPunto({ id: uid(), nombre, lat: r6(lat), lon: r6(lon), tipo: 'normal', flecha: 'recto' });
}

/* ------------------------------------------------------------------ */
/* Instrucción efectiva de un punto según el destino                   */
/* ------------------------------------------------------------------ */

function resolverPunto(p, destId, destinos) {
  const v = (destId && p.variantes[destId]) || {};
  const pick = (k, base) => (v[k] != null && v[k] !== '') ? v[k] : base;
  const dest = destinos.find(d => d.id === destId);
  const hacia = dest ? ` hacia ${dest.nombre}` : '';
  const salidasReales = p.tipo === 'rotonda' ? salidasDe(p.rotGeo) : [];
  const r = {
    id: p.id, nombre: p.nombre, lat: p.lat, lon: p.lon, tipo: p.tipo,
    flecha: pick('flecha', p.flecha),
    salida: pick('salida', p.salida),
    salidasTotal: salidasReales.length || p.salidasTotal,
    rotGeo: salidasReales.length ? p.rotGeo : null,
    carriles: pick('carriles', p.carriles),
    carrilTexto: pick('carrilTexto', p.carrilTexto),
    larga: pick('larga', p.instrucciones.larga),
    corta: pick('corta', p.instrucciones.corta),
    entrada: pick('entrada', p.instrucciones.entrada)
  };
  if (r.tipo === 'rotonda') {
    r.salida = r.salida ? clamp(r.salida, 1, r.salidasTotal) : null;
    if (r.salida) {
      const ord = ORD[r.salida];
      const calle = salidasReales[r.salida - 1] && !/sin nombre/i.test(salidasReales[r.salida - 1].nombre)
        ? salidasReales[r.salida - 1].nombre : (p.calle || '');
      const por = calle ? `, por ${calle}` : '';
      r.calleSalida = calle;
      if (!r.larga) r.larga = `En {dist}, ${p.nombre.toLowerCase().startsWith('rotonda') ? 'rotonda' : p.nombre}. Tome la ${ord} salida${hacia}${por}.`;
      if (!r.corta) r.corta = `En la rotonda, tome la ${ord} salida${hacia}${por}.`;
      if (!r.entrada) r.entrada = `${cap(ord)} salida${hacia}${por}.`;
      if (!r.carrilTexto) r.carrilTexto = `ROTONDA: ${ord.toUpperCase()} SALIDA` + (calle ? ` · ${calle.toUpperCase()}` : '');
    } else {
      if (!r.larga) r.larga = `En {dist}, ${p.nombre}.`;
      if (!r.corta) r.corta = `Rotonda. Busque la salida${hacia}.`;
      if (!r.carrilTexto) r.carrilTexto = 'ROTONDA';
    }
  }
  if (!r.carrilTexto) r.carrilTexto = p.nombre.toUpperCase();
  if (!r.larga) r.larga = `En {dist}, ${p.nombre}.`;
  if (!r.corta) r.corta = `${p.nombre}. Atención.`;
  return r;
}

// Puntos del recorrido para un destino (incluye los de paso)
function puntosDelRecorrido(tramo, destId) {
  return tramo.puntos.filter(p => !destId || !p.soloDestinos.length || p.soloDestinos.includes(destId));
}
// Puntos con aviso (los de paso solo sirven para trazar la ruta)
function puntosParaNavegar(tramo, destId) {
  return puntosDelRecorrido(tramo, destId).filter(p => p.tipo !== 'paso')
    .map(p => resolverPunto(p, destId, tramo.destinos));
}

const trazadoPara = (tramo, destId) => (destId && tramo.trazados[destId]) || tramo.trazados['*'] || null;

/* ------------------------------------------------------------------ */
/* Geometría                                                           */
/* ------------------------------------------------------------------ */

const R_T = 6371000, RAD = Math.PI / 180;

function distancia(a, b) {
  const p1 = a.lat * RAD, p2 = b.lat * RAD;
  const dp = (b.lat - a.lat) * RAD, dl = (b.lon - a.lon) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_T * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Línea de la ruta: el trazado grabado (real) o la cadena de puntos (aproximada).
function prepararGeometria(trazado, puntos, cadena) {
  const real = !!(trazado && trazado.length >= 2);
  const linea = real ? trazado.map(([lat, lon]) => ({ lat, lon })) : (cadena || puntos).map(p => ({ lat: p.lat, lon: p.lon }));
  const lat0 = linea.length ? linea[0].lat : 9;
  const kx = R_T * RAD * Math.cos(lat0 * RAD), ky = R_T * RAD;
  const xy = linea.map(p => [p.lon * kx, p.lat * ky]);
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const geo = { real, linea, xy, cum, kx, ky, total: cum[cum.length - 1] || 0 };
  geo.sPuntos = puntos.map(p => proyectar(geo, p).s);
  return geo;
}

// s = metros a lo largo de la ruta; d = separación de la línea.
// Con sCerca busca primero cerca de la última posición (evita saltar a tramos paralelos).
function proyectar(geo, p, sCerca) {
  const px = p.lon * geo.kx, py = p.lat * geo.ky;
  const buscar = (desde, hasta) => {
    let best = { d: Infinity, s: 0 };
    for (let i = 0; i < geo.xy.length - 1; i++) {
      if (geo.cum[i + 1] < desde || geo.cum[i] > hasta) continue;
      const [ax, ay] = geo.xy[i], [bx, by] = geo.xy[i + 1];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
      t = clamp(t, 0, 1);
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d < best.d) best = { d, s: geo.cum[i] + t * Math.sqrt(L2), lat: (ay + t * dy) / geo.ky, lon: (ax + t * dx) / geo.kx };
    }
    return best;
  };
  if (geo.xy.length < 2) return { d: geo.linea.length ? distancia(p, geo.linea[0]) : Infinity, s: 0 };
  if (sCerca != null) {
    const local = buscar(sCerca - 500, sCerca + 3000);
    if (local.d <= CFG.fueraRuta) return local;
  }
  return buscar(-Infinity, Infinity);
}

function interpolar(pts, cum, s) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = clamp((s - cum[i - 1]) / seg, 0, 1);
  return { lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * t,
           lon: pts[i - 1].lon + (pts[i].lon - pts[i - 1].lon) * t };
}

function densificar(linea, paso) {
  if (linea.length < 2) return linea.slice();
  const out = [linea[0]];
  for (let i = 1; i < linea.length; i++) {
    const a = linea[i - 1], b = linea[i], d = distancia(a, b);
    const n = Math.max(1, Math.ceil(d / paso));
    for (let k = 1; k <= n; k++) out.push({ lat: a.lat + (b.lat - a.lat) * k / n, lon: a.lon + (b.lon - a.lon) * k / n });
  }
  return out;
}

function fmtDist(m) {
  if (!isFinite(m)) return '--';
  if (m < 0) m = 0;
  if (m >= 1000) return (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km';
  return (Math.round(m / 10) * 10) + ' m';
}

/* ------------------------------------------------------------------ */
/* Dibujos: flechas, rotondas y carriles                               */
/* ------------------------------------------------------------------ */

function svgFlecha(tipo) {
  const flecha = (rot) => `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(${rot} 50 50)">
    <path d="M50 6 L86 46 H63 V94 H37 V46 H14 Z" fill="currentColor"/></g></svg>`;
  switch (tipo) {
    case 'izq': return flecha(-90);
    case 'der': return flecha(90);
    case 'sal-izq': return flecha(-40);
    case 'sal-der': return flecha(40);
    case 'retorno':
      return `<svg viewBox="0 0 100 100" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="12"
        stroke-linecap="round" stroke-linejoin="round"><path d="M70 94 V40 A20 20 0 0 0 30 40 V70"/>
        <path d="M14 56 L30 76 L46 56"/></svg>`;
    case 'division':
      return `<svg viewBox="0 0 100 100" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="11"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M50 94 V62 L20 25"/><path d="M50 62 L80 25"/>
        <path d="M40.6 31.4 L20 25 L22 46.6"/><path d="M59.4 31.4 L80 25 L78 46.6"/></svg>`;
    case 'curva':
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6 L96 90 H4 Z" fill="currentColor"/>
        <rect x="44.5" y="34" width="11" height="32" rx="3" fill="#111"/><circle cx="50" cy="77" r="6.5" fill="#111"/></svg>`;
    default: return flecha(0);
  }
}

// Rotonda vista desde arriba: se entra por abajo y se circula en sentido antihorario (tránsito por la derecha).
function svgRotonda(salida, total, rotGeo) {
  // Ángulos (grados matemáticos; la entrada queda abajo = 270°) de cada salida, en orden de circulación
  let angulos, otras = [];
  const sal = salidasDe(rotGeo);
  if (sal.length) {
    const e = rotGeo.conexiones[rotGeo.entrada];
    const ang = (rumbo) => (((e.rumbo - rumbo + 270) % 360) + 360) % 360; // gira el plano real para poner la entrada abajo
    angulos = sal.map(c => c.i === rotGeo.entrada ? 270 : ang(c.rumbo));
    otras = rotGeo.conexiones.filter((c, i) => !c.salida && i !== rotGeo.entrada).map(c => ang(c.rumbo));
    total = sal.length;
  } else {
    total = clamp(total || 4, 2, 8);
    const paso = 360 / (total + 1);
    angulos = Array.from({ length: total }, (_, k) => 270 + (k + 1) * paso);
  }
  const elegida = salida ? clamp(salida, 1, total) : null;
  const r = 25, R = 47, gris = '#4a4a4a';
  const pt = (deg, rad) => [+(50 + rad * Math.cos(deg * RAD)).toFixed(1), +(50 - rad * Math.sin(deg * RAD)).toFixed(1)];
  const brazo = (a, color, ancho) => {
    const [x1, y1] = pt(a, r + 5), [x2, y2] = pt(a, R);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${ancho}" stroke-linecap="round"/>`;
  };
  let s = `<svg viewBox="-15 -15 130 130" aria-hidden="true"><circle cx="50" cy="50" r="${r}" fill="none" stroke="${gris}" stroke-width="11"/>`;
  otras.forEach(a => { s += brazo(a, gris, 5); });
  angulos.forEach((a, k) => { if (k + 1 !== elegida && Math.abs(a - 270) > 1) s += brazo(a, gris, 9); });
  // Número de cada salida al final de su brazo (la que hay que tomar, en verde)
  const insignias = angulos.map((a, k) => {
    const ang = Math.abs(a - 270) <= 1 ? 270 + 342 : a;   // el retorno se dibuja justo al lado de la entrada
    const [bx, by] = pt(ang, R + 6);
    const ok = k + 1 === elegida;
    return `<circle cx="${bx}" cy="${by}" r="${ok ? 10 : 8}" fill="${ok ? 'currentColor' : '#2b2b2b'}" stroke="${ok ? '#fff' : '#666'}" stroke-width="2"/>` +
           `<text x="${bx}" y="${by + 0.5}" text-anchor="middle" dominant-baseline="central" font-size="${ok ? 13 : 11}" font-weight="900" ` +
           `fill="${ok ? '#000' : '#ccc'}" font-family="system-ui, sans-serif">${k + 1}</text>`;
  }).join('');
  s += `<line x1="50" y1="97" x2="50" y2="${50 + r + 4}" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>`;
  if (elegida) {
    let span = (((angulos[elegida - 1] - 270) % 360) + 360) % 360;
    if (span < 12) span = 340; // retorno: casi una vuelta completa
    const a = 270 + span;
    const [ex, ey] = pt(a, r), [x2, y2] = pt(a, R - 10);
    s += `<path d="M50 ${50 + r} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 0 ${ex} ${ey}" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>`;
    s += `<line x1="${ex}" y1="${ey}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>`;
    const [tx, ty] = pt(a, R + 2), [bx, by] = pt(a, R - 13);
    const px = Math.sin(a * RAD) * 10, py = Math.cos(a * RAD) * 10;
    s += `<polygon points="${tx},${ty} ${(bx + px).toFixed(1)},${(by + py).toFixed(1)} ${(bx - px).toFixed(1)},${(by - py).toFixed(1)}" fill="currentColor"/>`;
    s += `<text x="50" y="51" text-anchor="middle" dominant-baseline="central" font-size="26" font-weight="900" fill="currentColor" font-family="system-ui, sans-serif">${elegida}</text>`;
    s += insignias;
  } else {
    s += insignias;
    s += `<text x="50" y="51" text-anchor="middle" dominant-baseline="central" font-size="24" font-weight="900" fill="${gris}" font-family="system-ui, sans-serif">?</text>`;
  }
  return s + '</svg>';
}

function htmlCarriles(str) {
  if (!str) return '';
  return [...str.trim()].map(c => {
    if (c === '|') return '<span class="carril-sep"></span>';
    if (c === ' ') return '';
    const ok = /[oO0✓]/.test(c);
    return `<span class="carril ${ok ? 'ok' : 'no'}">${ok ? '▲' : ''}</span>`;
  }).join('');
}

// p: punto resuelto (tipo, flecha, salida, salidasTotal)
function pintarDibujo(el, p) {
  el.innerHTML = p.tipo === 'rotonda' ? svgRotonda(p.salida, p.salidasTotal, p.rotGeo) : svgFlecha(p.flecha);
  el.classList.toggle('precaucion', p.tipo !== 'rotonda' && p.flecha === 'curva');
}

/* ------------------------------------------------------------------ */
/* Voz (cola: nunca corta un aviso; descarta los que ya no aplican)    */
/* ------------------------------------------------------------------ */

const ajustes = Object.assign({ voz: '', rate: 1, volume: 1 }, leerLS(LS_AJ, {}));
const voz = { cola: [], hablando: false, timer: null, ultimoAviso: '' };

function vozElegida() {
  if (!('speechSynthesis' in window)) return null;
  const voces = speechSynthesis.getVoices();
  return voces.find(v => v.name === ajustes.voz) ||
         voces.find(v => /^es[-_]PA/i.test(v.lang)) ||
         voces.find(v => /^es[-_](419|US|MX|CO|CR)/i.test(v.lang)) ||
         voces.find(v => /^es/i.test(v.lang)) || null;
}

function distanciaHablada(d) {
  if (!isFinite(d) || d >= 900) return 'un kilómetro';
  if (d >= 150) return `${Math.round(d / 100) * 100} metros`;
  return `${Math.max(10, Math.round(d / 10) * 10)} metros`;
}

function decir(texto, { urgente = false, puntoId = null, aviso = false } = {}) {
  if (!texto) return;
  texto = texto.replace('{dist}', 'un kilómetro');
  if (aviso) voz.ultimoAviso = texto;
  if (!('speechSynthesis' in window)) return;
  const item = { texto, puntoId };
  if (urgente) {
    voz.cola = voz.cola.filter(i => !puntoId || i.puntoId !== puntoId); // los avisos previos del mismo punto sobran
    voz.cola.unshift(item);
  } else voz.cola.push(item);
  siguienteVoz();
}

function siguienteVoz() {
  if (voz.hablando) return;
  const item = voz.cola.shift();
  if (!item) return;
  if (item.puntoId && nav.activo && puntoActual() && item.puntoId !== puntoActual().id) return siguienteVoz();
  voz.hablando = true;
  const u = new SpeechSynthesisUtterance(item.texto);
  const v = vozElegida();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'es-PA';
  u.rate = Number(ajustes.rate) || 1;
  u.volume = Number(ajustes.volume) || 1;
  const fin = () => { clearTimeout(voz.timer); if (!voz.hablando) return; voz.hablando = false; siguienteVoz(); };
  u.onend = fin; u.onerror = fin;
  voz.timer = setTimeout(fin, 4000 + item.texto.length * 110);
  try { speechSynthesis.speak(u); } catch (e) { console.warn('Voz no disponible:', e); fin(); }
}

function callarVoz() {
  voz.cola = []; voz.hablando = false; clearTimeout(voz.timer);
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {}
}

const vibrar = (p = [200, 100, 200]) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

/* ------------------------------------------------------------------ */
/* Pantalla encendida (Wake Lock)                                      */
/* ------------------------------------------------------------------ */

let wakeLock = null;
async function pedirWakeLock() {
  try { if ('wakeLock' in navigator && !wakeLock) {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } } catch (e) { /* no soportado */ }
}
function soltarWakeLock() { try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (nav.activo || grab.activo)) pedirWakeLock();
});

/* ------------------------------------------------------------------ */
/* Utilidades de interfaz                                              */
/* ------------------------------------------------------------------ */

function mostrarPantalla(id) {
  document.querySelectorAll('.pantalla').forEach(s => s.classList.toggle('activa', s.id === id));
  window.scrollTo(0, 0);
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('visible'), 2600);
}

function setChip(el, texto, clase) { el.textContent = texto; el.className = 'chip ' + (clase || ''); }

function crearMapa(id) {
  const m = L.map(id, { zoomControl: false, attributionControl: true });
  L.tileLayer(CFG.tileUrl, { maxZoom: 19, attribution: CFG.tileAttr, crossOrigin: true }).addTo(m);
  m.setView([8.95, -79.65], 11);
  return m;
}

function iconoNumero(n, clase = '', tipo = 'normal') {
  if (tipo === 'paso') return L.divIcon({ className: 'pin-paso ' + clase, html: '<span></span>', iconSize: [16, 16], iconAnchor: [8, 8] });
  const marca = tipo === 'rotonda' ? '⟳' : n;
  return L.divIcon({ className: 'pin-num ' + clase, html: `<span>${marca}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
}

function llenarSelect(selEl, items, valor) {
  selEl.innerHTML = '';
  items.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; selEl.appendChild(o); });
  selEl.value = valor;
}

const nombreDestino = (tramo, id) => (tramo.destinos.find(d => d.id === id) || {}).nombre || '';

/* ------------------------------------------------------------------ */
/* Navegación (conductor y simulador)                                  */
/* ------------------------------------------------------------------ */

const nav = {
  activo: false, modo: null, ruta: null, sentido: 'ida', tramo: null, destino: '', puntos: [], geo: null,
  idx: -1, min: Infinity, alertas: {}, watchId: null, simTimer: null, ultimoFix: null,
  sProg: null, sMax: -Infinity, contrario: false, completado: false
};
let mapaHud = null, capaHud = null, autoHud = null, marcadoresHud = [];

const puntoActual = () => (nav.idx >= 0 ? nav.puntos[nav.idx] : null);

// Ruta activa: un viaje calculado (buscar destino / favorita) o una ruta personalizada del editor
function contexto() {
  if (fuente === 'viaje' && viaje) {
    return { tipo: 'viaje', ruta: { nombre: viaje.tramo.nombre, verificada: true }, tramo: viaje.tramo, destId: '', sentido: 'ida' };
  }
  if (fuente === 'avanzada') {
    const r = rutaSel();
    return { tipo: 'avanzada', ruta: r, tramo: r[sel.sentido], destId: sel.destino, sentido: sel.sentido };
  }
  return null;
}

function iniciarNavegacion(modo) {
  const ctx = contexto();
  if (!ctx) { toast('Primero busca un destino o elige una ruta'); return; }
  const { ruta, tramo, destId } = ctx;
  const puntos = puntosParaNavegar(tramo, destId);
  if (!puntos.length) {
    alert(`"${tramo.nombre}" no tiene puntos${destId ? ' para este destino' : ''}. Agrégalos en el editor o graba la ruta.`);
    return;
  }
  if (modo === 'conductor' && ctx.tipo === 'avanzada' && !ruta.verificada &&
      !confirm('Esta ruta todavía no está marcada como verificada: las coordenadas o los avisos podrían no coincidir con la vía.\n\n¿Iniciar de todas formas?')) return;

  callarVoz();
  Object.assign(nav, {
    activo: true, modo, ruta, sentido: ctx.sentido, tramo, destino: destId, puntos, esViaje: ctx.tipo === 'viaje',
    geo: prepararGeometria(trazadoSimulable(trazadoPara(tramo, destId), puntos, modo), puntos, puntosDelRecorrido(tramo, destId)),
    idx: -1, min: Infinity, alertas: {}, ultimoFix: null, sProg: null, sMax: -Infinity,
    contrario: false, completado: false, fueraCuenta: 0, recalculando: false
  });
  mostrarPantalla('pantalla-hud');
  document.body.classList.remove('bloqueado');
  $('hud-dist').textContent = '--';
  $('hud-nombre').textContent = modo === 'simulador' ? 'Simulación' : 'Esperando GPS…';
  $('hud-progreso').textContent = encabezadoHud();
  $('hud-carriles').innerHTML = '';
  $('hud-alerta').className = 'hud-alerta';
  $('hud-banner').className = 'hud-banner';
  pintarDibujo($('hud-flecha'), { tipo: 'normal', flecha: 'recto' });
  setChip($('hud-gps'), modo === 'simulador' ? 'Simulado' : 'Buscando GPS…', modo === 'simulador' ? 'ok' : 'warn');
  prepararMapaHud();
  pedirWakeLock();
  const dest = ctx.tipo === 'viaje' ? viaje.destino.nombre : nombreDestino(tramo, destId);
  decir((modo === 'simulador' ? 'Simulación iniciada. ' : 'Copiloto activado. ') + (dest ? `Destino: ${dest}.` : ''));
  $('sim-ctrl').hidden = modo !== 'simulador';
  if (modo === 'simulador') iniciarSimulador();
  else iniciarGPS();
}

// En el simulador, si el primer aviso queda al inicio del trazado, agrega 1.2 km de entrada en línea recta
// para que se escuche el aviso de 1 km (en la vía real el GPS ya viene de antes).
function trazadoSimulable(trazado, puntos, modo) {
  if (modo !== 'simulador' || !trazado || trazado.length < 2 || !puntos.length) return trazado;
  const geo = prepararGeometria(trazado, puntos);
  if (geo.sPuntos[0] > 1100) return trazado;
  const ini = { lat: trazado[0][0], lon: trazado[0][1] };
  const ref = interpolar(geo.linea, geo.cum, Math.min(100, geo.total));
  const previo = puntoDesde(ini, rumbo(ref, ini), 1200);
  return [[previo.lat, previo.lon], ...trazado];
}

function encabezadoHud(extra) {
  if (nav.esViaje) return nav.tramo.nombre + (extra ? ` · ${extra}` : '');
  const dest = nombreDestino(nav.tramo, nav.destino) || 'General';
  return `${nav.tramo.nombre} · ${dest}` + (extra ? ` · ${extra}` : '');
}

function detenerNavegacion() {
  if (nav.watchId != null) navigator.geolocation.clearWatch(nav.watchId);
  clearInterval(sim.timer); sim.timer = null;
  Object.assign(nav, { activo: false, watchId: null, simTimer: null });
  callarVoz(); soltarWakeLock();
  document.body.classList.remove('bloqueado');
  mostrarPantalla('pantalla-inicio');
}

function iniciarGPS() {
  if (!('geolocation' in navigator)) { alert('Este dispositivo o navegador no ofrece ubicación GPS.'); detenerNavegacion(); return; }
  nav.watchId = navigator.geolocation.watchPosition(
    pos => procesarFix({ lat: pos.coords.latitude, lon: pos.coords.longitude, speed: pos.coords.speed,
                         heading: pos.coords.heading, acc: pos.coords.accuracy, t: pos.timestamp }),
    err => {
      if (err.code === 1) {
        alert('Permiso de ubicación denegado. Actívalo en los ajustes del navegador (permisos del sitio) para usar el copiloto.');
        detenerNavegacion();
      } else setChip($('hud-gps'), 'Sin señal GPS', 'bad');
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );
}

// ---- Cámara del HUD: el mapa gira con el rumbo y el carro (flecha) avanza suave sobre la vía
let rumboArriba = leerLS('copiloto.rumboArriba', true) !== false;
const cam = { a: null, b: null, t0: 0, dur: 0, ultimo: 0, raf: null, zoom: 16, zoomPend: 0, manual: null };
const zoomCam = () => cam.manual != null ? cam.manual : cam.zoom;

function ajustarMapaHud() {
  const wrap = $('hud-mapa-wrap'), el = $('map-hud');
  const d = Math.ceil(Math.hypot(wrap.clientWidth, wrap.clientHeight)) + 4;   // cuadrado que cubre el giro
  el.style.width = d + 'px'; el.style.height = d + 'px';
  if (mapaHud) mapaHud.invalidateSize({ pan: false });
}
window.addEventListener('resize', () => { if (nav.activo) { ajustarMapaHud(); animarCamara(); } });

function prepararMapaHud() {
  if (!mapaHud) {
    mapaHud = crearMapa('map-hud');
    mapaHud.attributionControl.remove();   // el crédito va fijo (sin girar) en la esquina
    ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard'].forEach(h => mapaHud[h] && mapaHud[h].disable());
    if (mapaHud.tap) mapaHud.tap.disable();
  }
  Object.assign(cam, { a: null, b: null, t0: 0, dur: 0, ultimo: 0, zoom: 16, zoomPend: 0, manual: null });
  actualizarBotonesZoom();
  $('hud-auto').hidden = true;
  $('map-hud').style.setProperty('--rot', '0deg'); $('map-hud').style.setProperty('--h', '0deg');
  $('btn-brujula').textContent = rumboArriba ? '🧭 Rumbo' : '🧭 Norte';
  setTimeout(ajustarMapaHud, 30);
  if (capaHud) capaHud.remove();
  capaHud = L.layerGroup().addTo(mapaHud);
  const g = nav.geo;
  const latlngs = g.linea.map(p => [p.lat, p.lon]);
  if (latlngs.length >= 2) {
    L.polyline(latlngs, g.real ? { color: '#00ff66', weight: 7, opacity: .8 }
                               : { color: '#00ff66', weight: 3, opacity: .6, dashArray: '6 10' }).addTo(capaHud);
  }
  marcadoresHud = nav.puntos.map((p, i) =>
    L.marker([p.lat, p.lon], { icon: iconoNumero(i + 1, '', p.tipo), keyboard: false, interactive: false }).addTo(capaHud));
  const b = L.latLngBounds(latlngs);
  if (b.isValid()) setTimeout(() => mapaHud.fitBounds(b, { padding: [24, 24], maxZoom: 15 }), 80);
}

const lerpAng = (a, b, p) => { const d = ((b - a + 540) % 360) - 180; return (a + d * p + 360) % 360; };
function poseActual() {
  if (!cam.b) return null;
  if (!cam.a || !cam.dur) return cam.b;
  const p = clamp((performance.now() - cam.t0) / cam.dur, 0, 1);
  return { lat: cam.a.lat + (cam.b.lat - cam.a.lat) * p, lon: cam.a.lon + (cam.b.lon - cam.a.lon) * p, h: lerpAng(cam.a.h, cam.b.h, p) };
}

function moverAuto(f, v, proj) {
  let h = null;
  if (proj && proj.d < 40 && nav.geo.real) h = rumboEn(nav.geo, proj.s);                       // sobre el camino: rumbo de la vía
  else if (typeof f.heading === 'number' && isFinite(f.heading) && (v == null || v > 1.5)) h = f.heading;
  else if (cam.b && distancia(cam.b, f) > 4) h = rumbo(cam.b, f);
  if (h == null) h = cam.b ? cam.b.h : 0;
  const ahora = performance.now();
  cam.dur = cam.ultimo ? clamp(ahora - cam.ultimo, 40, 1500) : 0;
  cam.ultimo = ahora;
  cam.a = poseActual() || { lat: f.lat, lon: f.lon, h };
  cam.b = { lat: f.lat, lon: f.lon, h };
  cam.t0 = ahora;
  // Zoom automático: según la velocidad, y de cerca al llegar a una maniobra (más en rotondas).
  // Acercarse es inmediato; alejarse espera unas lecturas para no saltar.
  if (v != null) {
    const kmh = v * 3.6;
    let z = kmh < 35 ? 17 : kmh < 75 ? 16 : 15;
    const p = puntoActual();
    if (p && nav.distActual != null && nav.distActual <= 300 && nav.distActual > -30) z = Math.max(z, p.tipo === 'rotonda' ? 18 : 17);
    if (z > cam.zoom) { cam.zoom = z; cam.zoomPend = 0; }
    else if (z < cam.zoom) { if (++cam.zoomPend >= 3) { cam.zoom = z; cam.zoomPend = 0; } }
    else cam.zoomPend = 0;
  }
  if (!cam.raf) cam.raf = requestAnimationFrame(animarCamara);
}

function animarCamara() {
  cam.raf = null;
  if (!nav.activo || !mapaHud) return;
  const pose = poseActual();
  if (!pose) return;
  const wrap = $('hud-mapa-wrap'), el = $('map-hud');
  if (rumboArriba) {
    const off = wrap.clientHeight * 0.27;                                   // el carro va abajo: se ve más vía por delante
    const mpp = 156543.03392 * Math.cos(pose.lat * RAD) / 2 ** zoomCam();
    const c = puntoDesde(pose, pose.h, off * mpp);
    mapaHud.setView([c.lat, c.lon], zoomCam(), { animate: false });
    el.style.setProperty('--rot', `${-pose.h}deg`); el.style.setProperty('--h', `${pose.h}deg`);
    wrap.style.setProperty('--off', `${off}px`); wrap.style.setProperty('--auto-rot', '0deg');
  } else {
    mapaHud.setView([pose.lat, pose.lon], zoomCam(), { animate: false });
    el.style.setProperty('--rot', '0deg'); el.style.setProperty('--h', '0deg');
    wrap.style.setProperty('--off', '0px'); wrap.style.setProperty('--auto-rot', `${pose.h}deg`);
  }
  $('hud-auto').hidden = false;
  if (performance.now() - cam.t0 < cam.dur + 30) cam.raf = requestAnimationFrame(animarCamara);
}

function actualizarBotonesZoom() {
  $('hud-zoom-auto').hidden = cam.manual == null;
  $('hud-zoom-mas').disabled = zoomCam() >= 19;
  $('hud-zoom-menos').disabled = zoomCam() <= 12;
}
function zoomManual(delta) {
  cam.manual = clamp(zoomCam() + delta, 12, 19);
  actualizarBotonesZoom(); animarCamara();
}
$('hud-zoom-mas').addEventListener('click', () => zoomManual(1));
$('hud-zoom-menos').addEventListener('click', () => zoomManual(-1));
$('hud-zoom-auto').addEventListener('click', () => { cam.manual = null; actualizarBotonesZoom(); animarCamara(); });

$('btn-brujula').addEventListener('click', () => {
  rumboArriba = !rumboArriba; escribirLS('copiloto.rumboArriba', rumboArriba);
  $('btn-brujula').textContent = rumboArriba ? '🧭 Rumbo' : '🧭 Norte';
  animarCamara();
});

function marcarPinesHud() {
  marcadoresHud.forEach((m, i) =>
    m.setIcon(iconoNumero(i + 1, i < nav.idx ? 'pasado' : i === nav.idx ? 'actual' : '', nav.puntos[i].tipo)));
  mostrarSalidasHud();
}

// Globos sobre cada salida real de la rotonda que viene: la que hay que tomar, grande y en verde
let salidasHud = null;
function globosSalidas(p, clase) {
  const g = p.rotGeo, sal = salidasDe(g);
  if (!sal.length) return [];
  const c = g.lat != null ? { lat: g.lat, lon: g.lon } : p;
  return sal.map((x, k) => {
    const q = puntoDesde(c, x.rumbo, g.radio + 24 + (x.i === g.entrada ? 14 : 0));
    const ok = k + 1 === p.salida;
    const icon = L.divIcon({ className: `pin-salida-ruta ${clase} ${ok ? 'objetivo' : ''}`, html: `<span>${k + 1}</span>`,
                             iconSize: ok ? [34, 34] : [24, 24], iconAnchor: ok ? [17, 17] : [12, 12] });
    const m = L.marker([q.lat, q.lon], { icon, keyboard: false, interactive: false, zIndexOffset: ok ? 900 : 800 });
    m.salida = { k: k + 1, rumbo: x.rumbo };
    return m;
  });
}
function mostrarSalidasHud() {
  if (salidasHud) { salidasHud.remove(); salidasHud = null; }
  const p = puntoActual();
  if (!p || p.tipo !== 'rotonda' || !p.rotGeo || !mapaHud) return;
  salidasHud = L.layerGroup(globosSalidas(p, 'en-hud')).addTo(mapaHud);
  nav.salidasPasadas = 0;
}
// Mientras se da la vuelta, las salidas que ya pasaste se marcan con ✓
function actualizarSalidasPasadas(f) {
  const p = puntoActual();
  if (!salidasHud || !p || !p.rotGeo) return;
  const g = p.rotGeo, c = g.lat != null ? { lat: g.lat, lon: g.lon } : p;
  if (distancia(f, c) > g.radio + 35) return;
  const e = g.conexiones[g.entrada];
  const recorrido = ((e.rumbo - rumbo(c, f)) % 360 + 360) % 360;          // grados avanzados en sentido antihorario
  if (recorrido > 345) return;                                             // ruido en la entrada: aún no se avanza
  salidasHud.eachLayer(m => {
    const desdeEntrada = ((e.rumbo - m.salida.rumbo) % 360 + 360) % 360 || 360;
    const pasada = m.salida.k < p.salida && recorrido > desdeEntrada + 8;
    const el = m.getElement && m.getElement();
    if (el) { el.classList.toggle('pasada', pasada); el.querySelector('span').textContent = pasada ? '✓' : m.salida.k; }
  });
}

function indiceInicial(f, proj) {
  if (nav.geo.real) {
    const i = nav.geo.sPuntos.findIndex(s => s > proj.s - 15);
    return i === -1 ? nav.puntos.length : i;
  }
  let best = 0, bd = Infinity;
  nav.puntos.forEach((p, i) => { const d = distancia(f, p); if (d < bd) { bd = d; best = i; } });
  return best;
}

function distanciaAlPunto(f, proj) {
  return nav.geo.real ? nav.geo.sPuntos[nav.idx] - proj.s : distancia(f, nav.puntos[nav.idx]);
}

// Metros después del punto para darlo por pasado. En una rotonda (el punto está en la entrada)
// se espera a recorrer el anillo hasta la salida, para seguir guiando mientras se da la vuelta.
function margenPaso(p) {
  if (!p || p.tipo !== 'rotonda' || !p.rotGeo || !p.salida) return 15;
  const g = p.rotGeo, x = salidasDe(g)[p.salida - 1], e = g.conexiones[g.entrada];
  if (!x || !e) return 15;
  const ang = ((e.rumbo - x.rumbo) % 360 + 360) % 360 || 360;
  return g.radio * ang * RAD + 30;
}

// ¿Ya pasamos el punto actual? También detecta el sentido contrario.
function evaluarPaso(f, dist, proj) {
  if (nav.geo.real) {
    nav.sMax = Math.max(nav.sMax, proj.s);
    if (proj.s < nav.sMax - 150) nav.contrario = true;
    else if (proj.s >= nav.sMax - 20) nav.contrario = false;
    if (nav.idx === nav.puntos.length - 1 && dist < 20) return true; // llegó al último punto (el destino)
    return dist < -margenPaso(nav.puntos[nav.idx]);
  }
  nav.min = Math.min(nav.min, dist);
  if (nav.min < CFG.pasadoRadio && dist > nav.min + CFG.pasadoMargen) return true;
  if (dist > nav.min + 300) {
    const sig = nav.puntos[nav.idx + 1];
    if (sig && distancia(f, sig) < dist) return true;
    nav.contrario = true;
  } else nav.contrario = false;
  return false;
}

function procesarFix(f, opc = {}) {
  if (!nav.activo) return;

  let v = (typeof f.speed === 'number' && isFinite(f.speed)) ? f.speed : null;
  if (v === null && nav.ultimoFix) {
    const dt = (f.t - nav.ultimoFix.t) / 1000;
    if (dt > 0.5) v = distancia(nav.ultimoFix, f) / dt;
  }
  nav.ultimoFix = f;
  $('hud-vel').textContent = v != null ? Math.round(v * 3.6) + ' km/h' : '-- km/h';

  const gpsOk = !(f.acc > CFG.precisionMax);
  if (nav.modo !== 'simulador') {
    setChip($('hud-gps'), gpsOk ? `GPS ±${Math.round(f.acc)} m` : `GPS impreciso ±${Math.round(f.acc)} m`, gpsOk ? 'ok' : 'warn');
  }
  document.body.classList.toggle('bloqueado', nav.modo === 'conductor' && v != null && v > CFG.velBloqueo);
  const pts = nav.puntos, geo = nav.geo;
  let proj = null, fuera = false;
  if (geo.real) { proj = proyectar(geo, f, nav.sProg); nav.sProg = proj.s; fuera = proj.d > CFG.fueraRuta; }
  moverAuto(f, v, proj);
  if (nav.completado) return;
  // Viaje calculado: si te sales del camino, recalcula desde donde estás
  if (nav.esViaje && nav.modo === 'conductor' && fuera && f.acc <= CFG.precisionMax) {
    if (++nav.fueraCuenta >= 4 && !nav.recalculando) recalcularViaje(f);
  } else nav.fueraCuenta = 0;
  if (nav.recalculando) {
    $('hud-banner').textContent = '🔄 Recalculando la ruta…'; $('hud-banner').className = 'hud-banner visible';
    return;
  }

  if (nav.idx < 0) { nav.idx = indiceInicial(f, proj); marcarPinesHud(); }
  if (nav.idx >= pts.length) return completar();

  let dist = distanciaAlPunto(f, proj);
  let vueltas = 0;
  while (vueltas++ <= pts.length && evaluarPaso(f, dist, proj)) {
    nav.idx++; nav.min = Infinity; nav.contrario = false;
    marcarPinesHud();
    if (nav.idx >= pts.length) return completar();
    dist = distanciaAlPunto(f, proj);
  }

  const p = pts[nav.idx];
  const al = nav.alertas[p.id] || (nav.alertas[p.id] = { largo: false, corto: false, entrada: false });
  const otro = nav.sentido === 'ida' ? 'la vuelta' : 'la ida';
  const pausa = fuera ? (nav.esViaje && nav.modo === 'conductor' ? 'Fuera de la ruta: se recalculará en unos segundos' : 'Fuera de la ruta: avisos en pausa')
              : nav.contrario ? (nav.esViaje ? 'Sentido contrario: avisos en pausa' : `Sentido contrario: avisos en pausa (¿era ${otro}?)`)
              : !gpsOk ? 'GPS impreciso: avisos en pausa' : '';

  if (!pausa && !opc.silencio) {
    if (p.tipo === 'rotonda' && dist <= CFG.avisoEntrada && !al.entrada) {
      al.entrada = al.corto = al.largo = true;
      decir(p.entrada, { urgente: true, puntoId: p.id, aviso: true });
      vibrar([150]);
    } else if (dist <= CFG.avisoCorto && dist > CFG.avisoEntrada / 2 && !al.corto) {
      al.corto = al.largo = true;
      decir(p.corta, { urgente: true, puntoId: p.id, aviso: true });
      vibrar();
    } else if (dist <= CFG.avisoLargo && dist > CFG.avisoCorto + 50 && !al.largo) {
      al.largo = true;
      decir(p.larga.replace('{dist}', distanciaHablada(dist)), { puntoId: p.id, aviso: true });
    }
  }

  nav.distActual = dist;
  actualizarSalidasPasadas(f);
  $('hud-progreso').textContent = encabezadoHud(`${nav.idx + 1}/${pts.length}`);
  $('hud-dist').textContent = dist <= 5 ? 'Ahora' : fmtDist(dist);
  $('hud-nombre').textContent = p.nombre;
  pintarDibujo($('hud-flecha'), p);
  const cerca = dist <= CFG.avisoLargo && !pausa;
  // A 60 m o menos (y dentro de la rotonda) el letrero se encoge a una línea para dejar ver la maniobra en el mapa
  const compacta = cerca && dist <= CFG.letreroCompacto;
  $('hud-carriles').innerHTML = cerca && !compacta ? htmlCarriles(p.carriles) : '';
  const alerta = $('hud-alerta');
  alerta.textContent = compacta && p.tipo === 'rotonda' && p.salida
    ? `${p.salida}.ª SALIDA${p.calleSalida ? ' · ' + p.calleSalida.toUpperCase() : ''}`
    : p.carrilTexto;
  alerta.className = 'hud-alerta' + (cerca && p.carrilTexto ? ' visible' : '') + (dist <= CFG.avisoCorto ? ' urgente' : '') + (compacta ? ' compacta' : '');
  const banner = $('hud-banner');
  banner.textContent = pausa;
  banner.className = 'hud-banner' + (pausa ? ' visible' : '');
}

function completar() {
  if (nav.completado) return;
  nav.completado = true;
  if (nav.modo === 'simulador') { sim.pausado = true; actualizarControlesSim(); }
  marcarPinesHud();
  $('hud-dist').textContent = '✓';
  $('hud-nombre').textContent = nav.esViaje ? '¡Llegaste!' : 'Ruta completada';
  $('hud-progreso').textContent = encabezadoHud();
  $('hud-carriles').innerHTML = '';
  $('hud-alerta').className = 'hud-alerta';
  $('hud-banner').className = 'hud-banner';
  pintarDibujo($('hud-flecha'), { tipo: 'normal', flecha: 'recto' });
  document.body.classList.remove('bloqueado');
  decir(nav.esViaje ? 'Llegó a su destino.' : 'Pasó todos los puntos críticos de la ruta.');
}

$('hud-tarjeta').addEventListener('click', () => {
  if (voz.ultimoAviso) decir(voz.ultimoAviso);
  else toast('Aún no hay avisos para repetir');
});

/* ------------------------------------------------------------------ */
/* Simulador                                                           */
/* ------------------------------------------------------------------ */

// Simulador por pasos de 100 ms: la "velocidad de reproducción" (factor) cambia en vivo.
// Auto = rápido en tramos largos, más lento al acercarse y en tiempo real en cada maniobra.
const sim = { timer: null, pausado: false, pts: null, cum: null, total: 0, s: 0, v: 0, vmax: 0, zonas: [], t: 0, factor: 'auto' };

function iniciarSimulador() {
  const geo = nav.geo;
  let pts = geo.linea.map(p => ({ ...p }));
  if (pts.length === 1) {
    pts = [{ lat: pts[0].lat - 0.012, lon: pts[0].lon - 0.006 }, pts[0], { lat: pts[0].lat + 0.003, lon: pts[0].lon + 0.0015 }];
  } else if (!geo.real) {
    const a = pts[0], b = pts[1], k = 1500 / (distancia(a, b) || 1);
    pts.unshift({ lat: a.lat - (b.lat - a.lat) * k, lon: a.lon - (b.lon - a.lon) * k });
    const y = pts[pts.length - 1], x = pts[pts.length - 2], k2 = 400 / (distancia(x, y) || 1);
    pts.push({ lat: y.lat + (y.lat - x.lat) * k2, lon: y.lon + (y.lon - x.lon) * k2 });
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distancia(pts[i - 1], pts[i]));
  // Zonas lentas del vehículo: rotondas (~25 km/h) y curvas (~50 km/h)
  const simGeo = prepararGeometria(pts.map(p => [p.lat, p.lon]), nav.puntos);
  const zonas = nav.puntos.map((p, i) => {
    const sp = simGeo.sPuntos[i];
    if (p.tipo === 'rotonda') return { desde: sp - 60, hasta: sp + 50, v: 25 / 3.6 };
    if (p.flecha === 'curva') return { desde: sp - 100, hasta: sp + 500, v: 50 / 3.6 };
    return null;
  }).filter(Boolean);
  const vmax = Number($('sim-vel').value) / 3.6;
  const fInicial = $('sim-factor').value;
  Object.assign(sim, { pts, cum, total: cum[cum.length - 1], zonas, vmax, s: 0, v: vmax, t: Date.now(), pausado: false,
                       factor: fInicial === 'auto' ? 'auto' : Number(fInicial) });
  clearInterval(sim.timer);
  sim.timer = setInterval(pasoSimulador, 100);
  $('sim-barra').max = Math.round(sim.total);
  emitirFixSim(false);
  actualizarControlesSim();
}

function factorSim() {
  if (sim.factor !== 'auto') return sim.factor;
  const d = nav.distActual;
  if (d == null || !isFinite(d)) return 5;
  if (d <= 400) return 1;      // maniobra cerca: tiempo real para verla bien
  if (d <= 1500) return 3;
  return 10;                   // tramo largo: adelanta
}

function pasoSimulador() {
  if (sim.pausado || !nav.activo) return;
  const dt = 0.1 * factorSim();
  const FRENO = 2.5, ACEL = 1.5; // m/s²
  let objetivo = sim.vmax;
  sim.zonas.forEach(z => {
    const anticipo = Math.max(0, (sim.v * sim.v - z.v * z.v) / (2 * FRENO));
    if (sim.s >= z.desde - anticipo && sim.s <= z.hasta) objetivo = Math.min(objetivo, z.v);
  });
  sim.v = objetivo < sim.v ? Math.max(objetivo, sim.v - FRENO * dt) : Math.min(objetivo, sim.v + ACEL * dt);
  sim.s = Math.min(sim.total, sim.s + sim.v * dt);
  sim.t += dt * 1000;
  emitirFixSim(false);
  if (sim.s >= sim.total && !nav.completado) completar();
  actualizarControlesSim();
}

function emitirFixSim(silencio) {
  const p = interpolar(sim.pts, sim.cum, sim.s);
  const adelante = interpolar(sim.pts, sim.cum, Math.min(sim.s + 25, sim.total));
  const atras = interpolar(sim.pts, sim.cum, Math.max(sim.s - 25, 0));
  const h = sim.s + 25 <= sim.total ? rumbo(p, adelante) : rumbo(atras, p);
  procesarFix({ lat: p.lat, lon: p.lon, speed: sim.v, heading: h, acc: 5, t: sim.t }, { silencio });
}

// Saltar a otra posición (retroceder o adelantar): reinicia el progreso y los avisos desde ahí
function irASim(s) {
  sim.s = clamp(s, 0, sim.total);
  Object.assign(nav, { idx: -1, min: Infinity, alertas: {}, sProg: null, sMax: -Infinity, contrario: false, completado: false, distActual: null });
  callarVoz();
  cam.a = null; cam.b = null; cam.ultimo = 0;     // la cámara salta, no se arrastra
  emitirFixSim(true);                             // muestra dónde quedaste sin hablar
  actualizarControlesSim();
}

function pausarSim(pausar) {
  sim.pausado = pausar;
  if (pausar) callarVoz();
  else if (nav.completado || sim.s >= sim.total) irASim(0);   // al terminar, ▶ empieza de nuevo
  actualizarControlesSim();
}

function actualizarControlesSim() {
  if (nav.modo !== 'simulador') return;
  $('sim-play').textContent = sim.pausado ? '▶' : '⏸';
  $('sim-play').setAttribute('aria-label', sim.pausado ? 'Reanudar' : 'Pausar');
  if (!arrastrandoBarra) $('sim-barra').value = Math.round(sim.s);
  $('sim-km').textContent = `${(sim.s / 1000).toFixed(1)} km`;
  $('sim-total').textContent = `de ${(sim.total / 1000).toFixed(1)} km`;
  const f = sim.factor === 'auto' ? `Auto ×${factorSim()}` : `×${sim.factor === 0.5 ? '½' : sim.factor}`;
  $('sim-factor-txt').textContent = f;
  $('sim-lento').disabled = factorSim() <= 0.5;
  $('sim-rapido').disabled = factorSim() >= 20;
}

const PASOS = [0.5, 1, 2, 5, 10, 20];
function cambiarFactor(dir) {
  const actual = factorSim();
  if (dir > 0) sim.factor = PASOS.find(x => x > actual) || 20;
  else sim.factor = [...PASOS].reverse().find(x => x < actual) || 0.5;
  actualizarControlesSim();
}

let arrastrandoBarra = false;
$('sim-play').addEventListener('click', () => pausarSim(!sim.pausado));
$('sim-atras').addEventListener('click', () => irASim(sim.s - 300));
$('sim-adelante').addEventListener('click', () => irASim(sim.s + 300));
$('sim-lento').addEventListener('click', () => cambiarFactor(-1));
$('sim-rapido').addEventListener('click', () => cambiarFactor(1));
$('sim-factor-txt').addEventListener('click', () => { sim.factor = 'auto'; actualizarControlesSim(); });
$('sim-barra').addEventListener('input', e => {
  arrastrandoBarra = true;
  if (!sim.pausado) pausarSim(true);   // deslizar pausa la simulación
  irASim(Number(e.target.value));
});
$('sim-barra').addEventListener('change', () => { arrastrandoBarra = false; actualizarControlesSim(); });

/* ------------------------------------------------------------------ */
/* Grabar ruta (modo acompañante)                                      */
/* ------------------------------------------------------------------ */

const grab = { activo: false, traza: [], marcas: [], watchId: null, mapa: null, capa: null, linea: null,
               auto: null, ultimoFix: null, dist: 0, sentido: 'ida', destino: '' };

function iniciarGrabacion() {
  if (!navigator.geolocation) { alert('Este dispositivo no ofrece ubicación GPS.'); return; }
  const tramo = rutaSel()[sel.sentido];
  const dest = nombreDestino(tramo, sel.destino);
  if (!confirm(`Modo acompañante: úsalo solo si NO vas manejando.\n\nSe grabará "${tramo.nombre}"` +
               (dest ? ` (trazado hacia ${dest})` : '') +
               '. En cada punto crítico toca "Marcar aquí". ¿Continuar?')) return;
  Object.assign(grab, { activo: true, traza: [], marcas: [], ultimoFix: null, dist: 0, sentido: sel.sentido, destino: sel.destino, inicio: Date.now() });
  $('grab-titulo').textContent = `🎙️ ${tramo.nombre}${dest ? ' · ' + dest : ''}`;
  mostrarPantalla('pantalla-grabar');
  if (!grab.mapa) grab.mapa = crearMapa('map-grabar');
  setTimeout(() => grab.mapa.invalidateSize(), 60);
  if (grab.capa) grab.capa.remove();
  grab.capa = L.layerGroup().addTo(grab.mapa);
  grab.linea = L.polyline([], { color: '#00ff66', weight: 5 }).addTo(grab.capa);
  grab.auto = L.circleMarker([0, 0], { radius: 9, color: '#fff', weight: 3, fillColor: '#2f8cff', fillOpacity: 1 });
  $('grab-dist').textContent = '0.0 km'; $('grab-marcas').textContent = '0';
  setChip($('grab-gps'), 'Buscando GPS…', 'warn');
  pedirWakeLock();

  grab.watchId = navigator.geolocation.watchPosition(pos => {
    const f = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
    grab.ultimoFix = f;
    const ok = f.acc <= CFG.grabarPrecision;
    setChip($('grab-gps'), `${ok ? 'GPS' : 'GPS impreciso'} ±${Math.round(f.acc)} m`, ok ? 'ok' : 'warn');
    grab.auto.setLatLng([f.lat, f.lon]);
    if (!grab.capa.hasLayer(grab.auto)) { grab.auto.addTo(grab.capa); grab.mapa.setView([f.lat, f.lon], 16); }
    else grab.mapa.panTo([f.lat, f.lon]);
    if (!ok) return;
    const last = grab.traza[grab.traza.length - 1];
    if (!last || distancia(last, f) >= CFG.grabarCada) {
      if (last) grab.dist += distancia(last, f);
      grab.traza.push(f);
      grab.linea.addLatLng([f.lat, f.lon]);
      $('grab-dist').textContent = (grab.dist / 1000).toFixed(1) + ' km';
    }
  }, err => {
    if (err.code === 1) { alert('Permiso de ubicación denegado.'); cancelarGrabacion(); }
    else setChip($('grab-gps'), 'Sin señal GPS', 'bad');
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
}

function marcarAqui() {
  const f = grab.ultimoFix;
  if (!f) { toast('Esperando señal GPS…'); return; }
  grab.marcas.push({ lat: f.lat, lon: f.lon });
  const n = grab.marcas.length;
  L.marker([f.lat, f.lon], { icon: iconoNumero(n) }).addTo(grab.capa);
  $('grab-marcas').textContent = String(n);
  vibrar(80);
  toast(`Punto ${n} marcado`);
}

function pararGPSGrabacion() {
  if (grab.watchId != null) navigator.geolocation.clearWatch(grab.watchId);
  grab.watchId = null; grab.activo = false; soltarWakeLock();
}
function cancelarGrabacion() { pararGPSGrabacion(); mostrarPantalla('pantalla-inicio'); }

function terminarGrabacion() {
  pararGPSGrabacion();
  if (grab.traza.length < 2 && !grab.marcas.length) {
    alert('No se grabó suficiente recorrido ni puntos.'); mostrarPantalla('pantalla-inicio'); return;
  }
  const trazado = grab.traza.length >= 2 ? grab.traza.map(p => [r6(p.lat), r6(p.lon)]) : null;
  const ruta = rutaSel(), tramo = ruta[grab.sentido];
  const clave = grab.destino || '*';
  const dest = nombreDestino(tramo, grab.destino);
  let rutaDestino, tramoDestino;
  if (confirm(`¿Guardar lo grabado en "${ruta.nombre}" › ${tramo.nombre}${dest ? ' (trazado hacia ' + dest + ')' : ''}?\n\n` +
              'Aceptar = agregar a esa ruta (reemplaza ese trazado)\nCancelar = crear una ruta nueva')) {
    rutaDestino = ruta; tramoDestino = tramo;
    const base = tramo.puntos.length;
    grab.marcas.forEach((m, i) => tramo.puntos.push(puntoNuevo(m.lat, m.lon, `Punto ${base + i + 1}`)));
    if (trazado) { tramo.trazados[clave] = trazado; tramo.duraciones[clave] = (Date.now() - grab.inicio) / 60000; }
  } else {
    const fecha = new Date().toLocaleDateString('es-PA', { day: '2-digit', month: 'short' });
    rutaDestino = normalizarRuta({ id: uid(), nombre: `Ruta grabada ${fecha}`, ida: { nombre: 'Ida' }, vuelta: { nombre: 'Vuelta' } });
    tramoDestino = rutaDestino[grab.sentido];
    tramoDestino.puntos = grab.marcas.map((m, i) => puntoNuevo(m.lat, m.lon, `Punto ${i + 1}`));
    if (trazado) { tramoDestino.trazados['*'] = trazado; tramoDestino.duraciones['*'] = (Date.now() - grab.inicio) / 60000; }
    rutas.push(rutaDestino);
  }
  ordenarPorTrazado(tramoDestino, rutaDestino === ruta ? clave : '*');
  guardarRutas();
  sel.rutaId = rutaDestino.id; sel.sentido = grab.sentido; validarSel();
  toast('Grabación guardada. Ahora ponle nombre y avisos a cada punto.');
  abrirEditor();
}

function ordenarPorTrazado(tramo, clave) {
  const trazado = tramo.trazados[clave] || tramo.trazados['*'] || Object.values(tramo.trazados)[0];
  if (!trazado) return false;
  const geo = prepararGeometria(trazado, tramo.puntos);
  tramo.puntos = tramo.puntos.map((p, i) => ({ p, s: geo.sPuntos[i] })).sort((a, b) => a.s - b.s).map(o => o.p);
  return true;
}

/* ------------------------------------------------------------------ */
/* Editor de rutas                                                     */
/* ------------------------------------------------------------------ */

const ed = { mapa: null, capa: null, puntoId: null, sentido: 'ida', rotGeo: null };
const rutaEd = () => rutaSel();
const tramoEd = () => rutaEd()[ed.sentido];

function abrirEditor() {
  ed.sentido = sel.sentido;
  ed.puntoId = null;
  $('ed-form').hidden = true;
  mostrarPantalla('pantalla-editor');
  if (!ed.mapa) {
    ed.mapa = crearMapa('map-editor');
    ed.mapa.on('click', e => { if (ed.puntoId) moverPuntoEd(ed.puntoId, e.latlng.lat, e.latlng.lng); });
  }
  setTimeout(() => { ed.mapa.invalidateSize(); renderEditor(true); }, 60);
}

function boton(txt, titulo, fn, { dis = false, clase = 'btn-mini' } = {}) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = clase; b.textContent = txt; b.title = titulo;
  b.setAttribute('aria-label', titulo); b.disabled = dis; b.addEventListener('click', fn);
  return b;
}

function renderEditor(ajustarMapa) {
  const r = rutaEd(), t = tramoEd();
  llenarSelect($('ed-sel-ruta'), rutas.map(x => [x.id, x.nombre]), r.id);
  $('ed-nombre').value = r.nombre;
  $('ed-verificada').checked = r.verificada;
  $('ed-ida').textContent = 'Ida: ' + r.ida.nombre;
  $('ed-vuelta').textContent = 'Vuelta: ' + r.vuelta.nombre;
  $('ed-ida').classList.toggle('activo', ed.sentido === 'ida');
  $('ed-vuelta').classList.toggle('activo', ed.sentido === 'vuelta');
  $('ed-tramo-nombre').value = t.nombre;

  // Destinos
  const cont = $('ed-destinos'); cont.innerHTML = '';
  if (!t.destinos.length) {
    const p = document.createElement('p'); p.className = 'info';
    p.textContent = 'Sin destinos: todos los avisos son generales.'; cont.appendChild(p);
  }
  t.destinos.forEach(d => {
    const fila = document.createElement('div'); fila.className = 'fila';
    const inp = document.createElement('input'); inp.value = d.nombre; inp.setAttribute('aria-label', 'Nombre del destino');
    inp.addEventListener('change', () => { d.nombre = inp.value.trim() || d.nombre; guardarRutas(); renderEditor(false); if (ed.puntoId) abrirFormPunto(ed.puntoId, false); });
    fila.append(inp, boton('🗑', 'Eliminar destino', () => eliminarDestino(d.id)));
    cont.appendChild(fila);
  });

  // Trazados
  const ul = $('ed-trazados'); ul.innerHTML = '';
  const claves = Object.keys(t.trazados);
  if (!claves.length) {
    const li = document.createElement('li');
    li.textContent = 'Ninguno: se usa una línea recta entre puntos (aproximada). Graba este sentido en modo acompañante.';
    ul.appendChild(li);
  }
  claves.forEach(k => {
    const li = document.createElement('li');
    li.append(`${k === '*' ? 'General' : 'Hacia ' + nombreDestino(t, k)}: ${t.trazados[k].length} puntos GPS`,
      boton('Borrar', 'Borrar trazado', () => {
        if (!confirm('¿Borrar este trazado? Los puntos se conservan.')) return;
        delete t.trazados[k]; delete t.duraciones[k]; guardarRutas(); renderEditor(true);
      }));
    ul.appendChild(li);
  });
  $('ed-ordenar').disabled = !claves.length;
  $('ed-crear-vuelta').hidden = ed.sentido !== 'vuelta';

  // Mapa
  if (ed.capa) ed.capa.remove();
  ed.capa = L.layerGroup().addTo(ed.mapa);
  const limites = [];
  claves.forEach(k => {
    const ll = t.trazados[k].map(([a, b]) => [a, b]); limites.push(...ll);
    L.polyline(ll, k === '*' ? { color: '#00ff66', weight: 5, opacity: .7 }
                             : { color: '#2f8cff', weight: 4, opacity: .8, dashArray: '8 8' })
      .addTo(ed.capa).bindTooltip(esc(k === '*' ? 'Trazado general' : 'Hacia ' + nombreDestino(t, k)));
  });
  if (!claves.length && t.puntos.length >= 2) {
    L.polyline(t.puntos.map(p => [p.lat, p.lon]), { color: '#00ff66', weight: 3, opacity: .6, dashArray: '6 10' }).addTo(ed.capa);
  }
  t.puntos.forEach((p, i) => {
    limites.push([p.lat, p.lon]);
    const m = L.marker([p.lat, p.lon], { draggable: true, icon: iconoNumero(i + 1, p.id === ed.puntoId ? 'sel' : '', p.tipo) })
      .addTo(ed.capa).bindTooltip(esc(`${i + 1}. ${p.nombre}`));
    m.on('dragend', () => { const ll = m.getLatLng(); moverPuntoEd(p.id, ll.lat, ll.lng); });
    m.on('click', () => abrirFormPunto(p.id));
  });
  if (ajustarMapa) {
    const b = L.latLngBounds(limites);
    if (b.isValid()) ed.mapa.fitBounds(b, { padding: [30, 30], maxZoom: 16 });
  }

  // Salidas numeradas de la rotonda abierta en el formulario
  const pAbierto = ed.puntoId && t.puntos.find(x => x.id === ed.puntoId);
  if (pAbierto && ed.rotGeo && $('f-tipo').value === 'rotonda') {
    const g = ed.rotGeo;
    const icono = (txt, clase) => L.divIcon({ className: 'pin-salida ' + clase, html: `<span>${txt}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
    if (g.entrada != null) {
      const e = g.conexiones[g.entrada], q = puntoDesde(pAbierto, e.rumbo, g.radio + 48);
      L.marker([q.lat, q.lon], { icon: icono('E', 'entrada'), keyboard: false }).addTo(ed.capa).bindTooltip(esc('Entrada: ' + e.nombre));
    }
    salidasDe(g).forEach((c, k) => {
      const q = puntoDesde(pAbierto, c.rumbo, g.radio + 28);
      L.marker([q.lat, q.lon], { icon: icono(k + 1, ''), keyboard: false }).addTo(ed.capa).bindTooltip(esc(`${k + 1}. ${c.nombre}`));
    });
  }

  // Lista de puntos
  const lista = $('ed-lista'); lista.innerHTML = '';
  t.puntos.forEach((p, i) => {
    const li = document.createElement('li');
    const num = document.createElement('span'); num.className = 'num'; num.textContent = p.tipo === 'rotonda' ? '⟳' : p.tipo === 'paso' ? '·' : i + 1;
    const nom = document.createElement('span'); nom.className = 'nom';
    const etiqueta = p.tipo === 'rotonda' ? ' (rotonda)' : p.tipo === 'division' ? ' (división)' : p.tipo === 'paso' ? ' (paso)' : '';
    const solo = p.soloDestinos.length ? ` · solo ${p.soloDestinos.map(id => nombreDestino(t, id)).join(', ')}` : '';
    nom.textContent = `${i + 1}. ${p.nombre}${etiqueta}${solo}`;
    const acc = document.createElement('span'); acc.className = 'acc';
    acc.append(
      boton('↑', 'Subir', () => moverOrden(i, -1), { dis: i === 0 }),
      boton('↓', 'Bajar', () => moverOrden(i, 1), { dis: i === t.puntos.length - 1 }),
      boton('✏️', 'Editar', () => abrirFormPunto(p.id)),
      boton('🗑', 'Eliminar', () => {
        if (!confirm(`¿Eliminar "${p.nombre}"?`)) return;
        t.puntos.splice(i, 1); if (ed.puntoId === p.id) cerrarFormPunto();
        guardarRutas(); renderEditor(false);
      }));
    li.append(num, nom, acc);
    lista.appendChild(li);
  });
  if (!t.puntos.length) {
    const li = document.createElement('li'); li.textContent = 'Sin puntos en este sentido. Agrega uno o graba la ruta.'; lista.appendChild(li);
  }
}

function eliminarDestino(id) {
  const t = tramoEd();
  if (!confirm(`¿Eliminar el destino "${nombreDestino(t, id)}"? Se borran sus instrucciones propias y su trazado.`)) return;
  t.destinos = t.destinos.filter(d => d.id !== id);
  delete t.trazados[id]; delete t.duraciones[id];
  t.puntos.forEach(p => { delete p.variantes[id]; p.soloDestinos = p.soloDestinos.filter(x => x !== id); });
  if (sel.destino === id) sel.destino = '';
  validarSel(); guardarRutas(); renderEditor(false);
  if (ed.puntoId) abrirFormPunto(ed.puntoId, false);
}

function moverOrden(i, delta) {
  const t = tramoEd(), j = i + delta;
  if (j < 0 || j >= t.puntos.length) return;
  [t.puntos[i], t.puntos[j]] = [t.puntos[j], t.puntos[i]];
  guardarRutas(); renderEditor(false);
}

function moverPuntoEd(id, lat, lon) {
  const p = tramoEd().puntos.find(x => x.id === id);
  if (!p) return;
  p.lat = r6(lat); p.lon = r6(lon);
  guardarRutas();
  if (ed.puntoId === id) { $('f-lat').value = p.lat; $('f-lon').value = p.lon; }
  renderEditor(false);
}

function opcionesFlecha(conGeneral) {
  return (conGeneral ? '<option value="">(la general)</option>' : '') +
    FLECHAS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
}
$('f-flecha').innerHTML = opcionesFlecha(false);
['f-carril-texto', 'f-larga', 'f-corta', 'f-entrada'].forEach(id => { $(id).placeholder = 'Vacío = automático'; });

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function htmlVariante(d, v) {
  const val = (k) => esc(v[k] != null ? v[k] : '');
  const abierta = Object.keys(v).length ? ' open' : '';
  return `<details class="variante" data-dest="${esc(d.id)}"${abierta}>
    <summary>${esc(d.nombre)}</summary>
    <div data-no="rotonda"><label class="etq">Flecha</label><select data-k="flecha">${opcionesFlecha(true)}</select></div>
    <div data-solo="rotonda"><label class="etq">Salida a tomar</label>
      <input data-k="salida" type="number" min="1" max="8" inputmode="numeric" placeholder="(la general)" value="${val('salida')}"></div>
    <label class="etq">Carriles</label><input data-k="carriles" placeholder="(los generales)" autocapitalize="characters" value="${val('carriles')}">
    <label class="etq">Texto grande en pantalla</label><input data-k="carrilTexto" placeholder="(el general)" value="${val('carrilTexto')}">
    <label class="etq">Aviso a ~1 km</label><textarea data-k="larga" rows="2" placeholder="(el general)">${val('larga')}</textarea>
    <label class="etq">Aviso a ~250 m</label><textarea data-k="corta" rows="2" placeholder="(el general)">${val('corta')}</textarea>
    <div data-solo="rotonda"><label class="etq">Aviso al entrar</label><textarea data-k="entrada" rows="2" placeholder="(el general)">${val('entrada')}</textarea></div>
    <div class="preview" data-preview></div>
    <div class="fila-wrap"><button type="button" class="btn-mini" data-escuchar>🔊 Escuchar este destino</button></div>
  </details>`;
}

function abrirFormPunto(id, desplazar = true) {
  const t = tramoEd(), p = t.puntos.find(x => x.id === id);
  if (!p) return;
  ed.puntoId = id;
  $('ed-form-titulo').textContent = `Punto ${t.puntos.indexOf(p) + 1}`;
  $('f-nombre').value = p.nombre;
  $('f-lat').value = p.lat; $('f-lon').value = p.lon;
  $('f-tipo').value = p.tipo;
  $('f-flecha').value = p.flecha;
  $('f-salidas').value = p.salidasTotal;
  $('f-salida').value = p.salida || '';
  $('f-carriles').value = p.carriles;
  $('f-carril-texto').value = p.carrilTexto;
  $('f-larga').value = p.instrucciones.larga;
  $('f-corta').value = p.instrucciones.corta;
  $('f-entrada').value = p.instrucciones.entrada;

  const aplica = $('f-aplica'); aplica.innerHTML = '';
  t.destinos.forEach(d => {
    const l = document.createElement('label');
    const c = document.createElement('input'); c.type = 'checkbox'; c.value = d.id; c.checked = p.soloDestinos.includes(d.id);
    c.addEventListener('change', actualizarFormDinamico);
    l.append(c, d.nombre); aplica.appendChild(l);
  });
  $('f-aplica-box').hidden = !t.destinos.length;
  $('f-variantes-box').hidden = !t.destinos.length;
  $('f-general-ayuda').hidden = !t.destinos.length;
  $('f-variantes').innerHTML = t.destinos.map(d => htmlVariante(d, p.variantes[d.id] || {})).join('');
  $('f-variantes').querySelectorAll('.variante').forEach(el => {
    const v = p.variantes[el.dataset.dest] || {};
    el.querySelector('[data-k="flecha"]').value = v.flecha || '';
    el.querySelector('[data-escuchar]').addEventListener('click', () => escucharPunto(el.dataset.dest));
  });
  ed.rotGeo = p.rotGeo ? JSON.parse(JSON.stringify(p.rotGeo)) : null;
  renderRotOSM();
  actualizarFormDinamico();
  $('ed-form').hidden = false;
  renderEditor(false);
  if (p.tipo === 'rotonda' && ed.rotGeo) ed.mapa.setView([p.lat, p.lon], 18);
  else ed.mapa.panTo([p.lat, p.lon]);
  if (desplazar) $('ed-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cerrarFormPunto() { ed.puntoId = null; ed.rotGeo = null; $('ed-form').hidden = true; renderEditor(false); }

// Lee el formulario como un punto (sin guardarlo)
function leerFormPunto() {
  const tipo = $('f-tipo').value;
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : NaN; };
  const variantes = {};
  $('f-variantes').querySelectorAll('.variante').forEach(el => {
    const v = {};
    el.querySelectorAll('[data-k]').forEach(c => { v[c.dataset.k] = c.value; });
    const n = normalizarVariante(v);
    if (tipo === 'rotonda') delete n.flecha; else { delete n.salida; delete n.entrada; }
    if (Object.keys(n).length) variantes[el.dataset.dest] = n;
  });
  return normalizarPunto({
    id: ed.puntoId,
    nombre: $('f-nombre').value.trim() || 'Punto',
    lat: num($('f-lat').value), lon: num($('f-lon').value),
    tipo,
    soloDestinos: [...$('f-aplica').querySelectorAll('input:checked')].map(c => c.value),
    flecha: $('f-flecha').value,
    salida: $('f-salida').value,
    salidasTotal: $('f-salidas').value,
    carriles: $('f-carriles').value.trim(),
    carrilTexto: $('f-carril-texto').value.trim(),
    instrucciones: { larga: $('f-larga').value.trim(), corta: $('f-corta').value.trim(),
                     entrada: tipo === 'rotonda' ? $('f-entrada').value.trim() : '' },
    variantes,
    rotGeo: ed.rotGeo
  });
}

function actualizarFormDinamico() {
  const form = $('ed-form'), tipo = $('f-tipo').value;
  form.querySelectorAll('[data-solo]').forEach(el => { el.hidden = el.dataset.solo !== tipo; });
  form.querySelectorAll('[data-no]').forEach(el => { el.hidden = el.dataset.no === tipo; });
  const p = leerFormPunto(), t = tramoEd();
  // Vista previa general
  pintarPreview($('f-preview'), resolverPunto(p, '', t.destinos));
  // Variantes: solo para destinos donde aplica el punto
  $('f-variantes').querySelectorAll('.variante').forEach(el => {
    const id = el.dataset.dest;
    el.hidden = p.soloDestinos.length > 0 && !p.soloDestinos.includes(id);
    pintarPreview(el.querySelector('[data-preview]'), resolverPunto(p, id, t.destinos));
  });
}

function pintarPreview(el, r) {
  el.innerHTML = '';
  const f = document.createElement('div'); f.className = 'hud-flecha'; pintarDibujo(f, r);
  const c = document.createElement('div'); c.className = 'carriles'; c.innerHTML = htmlCarriles(r.carriles);
  const tx = document.createElement('span'); tx.className = 'info'; tx.textContent = r.carrilTexto;
  el.append(f, c, tx);
}

function escucharPunto(destId) {
  const r = resolverPunto(leerFormPunto(), destId || '', tramoEd().destinos);
  callarVoz(); decir(r.larga); decir(r.corta); if (r.tipo === 'rotonda') decir(r.entrada);
}

function guardarFormPunto(e) {
  e.preventDefault();
  const t = tramoEd(), i = t.puntos.findIndex(x => x.id === ed.puntoId);
  if (i < 0) return;
  const p = leerFormPunto();
  if (!isFinite(p.lat) || !isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) { alert('Latitud o longitud no válida.'); return; }
  if (p.tipo === 'rotonda') {
    const salidas = [p.salida, ...Object.values(p.variantes).map(v => v.salida)].filter(Boolean);
    const total = salidasDe(p.rotGeo).length || p.salidasTotal;
    if (salidas.some(s => s > total)) { alert(`La rotonda tiene ${total} salidas: ninguna salida puede ser mayor.`); return; }
  }
  t.puntos[i] = p;
  guardarRutas();
  toast('Punto guardado');
  renderEditor(false);
}

/* ------------------------------------------------------------------ */
/* Trazado por carretera (OSRM) y ajuste de puntos a la vía            */
/* ------------------------------------------------------------------ */

const OSRM = 'https://router.project-osrm.org/route/v1/driving/';

function adelgazar(c) {
  const out = [c[0]];
  for (let i = 1; i < c.length; i++) {
    const u = out[out.length - 1];
    if (i === c.length - 1 || distancia({ lat: u[0], lon: u[1] }, { lat: c[i][0], lon: c[i][1] }) >= 8) out.push(c[i]);
  }
  return out;
}

async function rutaOSRM(puntos) {
  const coords = puntos.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 30000);
  let data;
  try {
    const res = await fetch(`${OSRM}${coords}?overview=full&geometries=geojson&continue_straight=true`, { signal: ctrl.signal });
    data = await res.json();
  } finally { clearTimeout(to); }
  if (!data || data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error((data && (data.message || data.code)) || 'sin ruta');
  const ruta = data.routes[0];
  const c = ruta.geometry.coordinates.map(([lon, lat]) => [r6(lat), r6(lon)]);
  const trazado = adelgazar(c);
  // Posibles desvíos: tramos mucho más largos por carretera que en línea recta
  const desvios = [];
  (ruta.legs || []).forEach((leg, i) => {
    const recta = distancia(puntos[i], puntos[i + 1]);
    if (leg.distance > recta * 1.7 + 400) desvios.push(`${puntos[i].nombre} → ${puntos[i + 1].nombre}`);
  });
  return { trazado, km: ruta.distance / 1000, min: ruta.duration / 60, desvios };
}

async function trazarPorCarretera() {
  const t = tramoEd(), estado = $('ed-trazar-estado');
  const conjuntos = [{ clave: '*', nombre: 'General', pts: t.puntos }];
  t.destinos.forEach(d => {
    const pts = puntosDelRecorrido(t, d.id);
    if (pts.length !== t.puntos.length) conjuntos.push({ clave: d.id, nombre: d.nombre, pts });
  });
  const validos = conjuntos.filter(c => c.pts.length >= 2);
  if (!validos.length) { alert('Hacen falta al menos 2 puntos en este sentido para trazar el camino.'); return; }
  const reemplaza = validos.filter(c => t.trazados[c.clave]).map(c => c.nombre);
  if (reemplaza.length && !confirm(`Se reemplazará el trazado: ${reemplaza.join(', ')}.\nSi lo grabaste manejando, ese es más exacto que el automático.\n\n¿Continuar?`)) return;

  $('ed-trazar').disabled = true;
  estado.textContent = 'Trazando el camino por carretera…';
  const resumen = [], fallos = [], desvios = [];
  for (const c of validos) {
    try {
      const r = await rutaOSRM(c.pts);
      t.trazados[c.clave] = r.trazado; t.duraciones[c.clave] = r.min;
      resumen.push(`${c.nombre}: ${r.km.toFixed(1)} km (~${Math.round(r.min)} min)`);
      desvios.push(...r.desvios);
    } catch (e) { fallos.push(c.nombre); }
  }
  $('ed-trazar').disabled = false;
  if (t.trazados['*']) ordenarPorTrazado(t, '*');
  guardarRutas(); renderEditor(true);

  const lejos = puntosLejosDeLaVia(t, 40);
  let msg = resumen.length ? `✔ ${resumen.join(' · ')}. ` : '';
  if (fallos.length) msg += `No se pudo trazar: ${fallos.join(', ')} (revisa tu conexión). `;
  if ([...new Set(desvios)].length) msg += `⚠ Posible desvío entre: ${[...new Set(desvios)].join('; ')} — puede que un punto esté fuera de la vía principal. `;
  if (lejos.length) msg += `⚠ Lejos de la vía: ${lejos.map(x => `${x.p.nombre} (${Math.round(x.d)} m)`).join(', ')}. `;
  msg += 'Revisa en el mapa que el camino sea el tuyo; si se mete por otro lado, arrastra el punto a la vía correcta o agrega un punto de paso y traza de nuevo.';
  estado.textContent = msg;
}

function puntosLejosDeLaVia(t, umbral) {
  const traz = t.trazados['*'] || Object.values(t.trazados)[0];
  if (!traz) return [];
  const geo = prepararGeometria(traz, []);
  return t.puntos.filter(p => p.tipo !== 'rotonda')
    .map(p => ({ p, ...proyectar(geo, p) })).filter(x => x.d > umbral).map(x => ({ p: x.p, d: x.d }));
}

function ajustarPuntosAVia() {
  const t = tramoEd();
  const traz = t.trazados['*'] || Object.values(t.trazados)[0];
  if (!traz) { alert('Primero traza o graba el camino de este sentido.'); return; }
  const geo = prepararGeometria(traz, []);
  let movidos = 0; const lejos = [];
  t.puntos.forEach(p => {
    if (p.tipo === 'rotonda') return; // el centro de una rotonda no está sobre la vía
    const q = proyectar(geo, p);
    if (q.d > 150) lejos.push(`${p.nombre} (${Math.round(q.d)} m)`);
    else if (q.d > 3) { p.lat = r6(q.lat); p.lon = r6(q.lon); movidos++; }
  });
  guardarRutas(); renderEditor(false);
  $('ed-trazar-estado').textContent = `${movidos} punto(s) movidos a la vía.` +
    (lejos.length ? ` Demasiado lejos para moverlos solos (arrástralos tú): ${lejos.join(', ')}.` : '');
}

// Bloque del formulario para rotondas con geometría real
function renderRotOSM() {
  const g = ed.rotGeo;
  $('f-rot-osm').hidden = !g;
  $('f-salidas').disabled = !!g;
  if (!g) return;
  const opciones = g.conexiones.map((c, i) => [c, i]).filter(([c]) => c.entrada)
    .map(([c, i]) => [String(i), `${c.nombre} (lado ${rumboTexto(c.rumbo)})`]);
  if (g.entrada == null) opciones.unshift(['', 'Elige por dónde entras…']);
  llenarSelect($('f-entrada-osm'), opciones, g.entrada == null ? '' : String(g.entrada));
  const ol = $('f-salidas-osm'); ol.innerHTML = '';
  const sal = salidasDe(g);
  sal.forEach(c => {
    const li = document.createElement('li');
    li.textContent = `${c.nombre} (lado ${rumboTexto(c.rumbo)})${c.i === g.entrada ? ' — retorno' : ''}`;
    ol.appendChild(li);
  });
  if (!sal.length) { const li = document.createElement('li'); li.textContent = 'Elige primero la entrada.'; ol.appendChild(li); }
  $('f-salidas').value = sal.length || '';
}

/* ------------------------------------------------------------------ */
/* Rotondas reales: OpenStreetMap (consulta Overpass desde el teléfono) */
/* ------------------------------------------------------------------ */

// Servidores públicos de Overpass: si uno está saturado o caído se prueba el siguiente
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
                  'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const VIAS_VEHICULO = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$/;
const osm = { resultados: [], capa: null };

function rumbo(a, b) {
  const f1 = a.lat * RAD, f2 = b.lat * RAD, dl = (b.lon - a.lon) * RAD;
  const y = Math.sin(dl) * Math.cos(f2), x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
function puntoDesde(p, rumboGrados, m) {
  const d = m / R_T, b = rumboGrados * RAD, f1 = p.lat * RAD, l1 = p.lon * RAD;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return { lat: f2 / RAD, lon: l2 / RAD };
}
const rumboTexto = (b) => ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'][Math.round(b / 45) % 8];
const difAng = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

function sentidoUnico(tags) {
  const o = String(tags.oneway || '').toLowerCase();
  if (o === 'yes' || o === 'true' || o === '1') return 1;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'no' || o === 'false' || o === '0') return 0;
  return /^motorway(_link)?$/.test(tags.highway || '') ? 1 : 0;
}
function nombreVia(tags) {
  return tags.name || tags.ref || (/_link$/.test(tags.highway || '') ? 'Rampa' : 'Calle sin nombre');
}

async function consultarOverpass(bbox) {
  return consultarOverpassQ(`[out:json][timeout:40];way["junction"~"^(roundabout|circular)$"]["highway"](${bbox.map(n => n.toFixed(5)).join(',')})->.r;` +
            'node(w.r)->.n;way(bn.n)["highway"]->.c;(.r;.c;);out geom;');
}

async function consultarOverpassQ(q, msMax = 45000) {
  const fallos = [];
  // 1) Por el servidor propio de la app (mismo dominio: sin bloqueos del navegador, con reintentos y caché)
  {
    const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), Math.max(msMax, 45000));
    try {
      const res = await fetch('./api/overpass?data=' + encodeURIComponent(q), { signal: ctrl.signal });
      const tipo = res.headers.get('content-type') || '';
      if (res.ok && tipo.includes('json')) return await res.json();
      if (tipo.includes('json')) {                 // el servidor propio probó todo y explica la causa
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'HTTP ' + res.status);
      }
      // 404 u otra cosa: no hay servidor propio (p. ej. copia local) → se consulta directo
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('tiempo agotado');
      if (!/Failed to fetch|NetworkError|Load failed/i.test(e.message)) throw e;
      fallos.push('sin conexión');
    } finally { clearTimeout(to); }
  }
  // 2) Directo a los servidores públicos
  for (const url of OVERPASS) {
    const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), msMax);
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
      if (!res.ok) throw new Error(res.status === 429 ? 'servidor ocupado' : res.status >= 500 ? 'servidor saturado' : 'HTTP ' + res.status);
      const data = await res.json();
      if (data && data.remark && /runtime error|timed out/i.test(data.remark) && !(data.elements || []).length) throw new Error('consulta demasiado lenta');
      return data;
    } catch (e) {
      fallos.push(e.name === 'AbortError' ? 'tiempo agotado' : /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'sin conexión' : e.message);
    } finally { clearTimeout(to); }
  }
  // Mensaje corto con la causa más repetida
  const causa = fallos.sort((a, b) => fallos.filter(x => x === b).length - fallos.filter(x => x === a).length)[0];
  throw new Error(causa || 'sin respuesta');
}

// Rotondas ya analizadas: se guardan en el teléfono para no volver a consultar (y para funcionar sin señal)
const LS_ROTCACHE = 'copiloto.rotondas.v1';
function rotondasGuardadas() { return leerLS(LS_ROTCACHE, []).filter(x => x && x.centro && Date.now() - (x.t || 0) < 60 * 864e5); }
function guardarRotondas(nuevas) {
  if (!nuevas.length) return;
  const lista = rotondasGuardadas().filter(x => !nuevas.some(n => distancia(n.centro, x.centro) < 15));
  nuevas.forEach(n => lista.push({ ...n, t: Date.now() }));
  try { localStorage.setItem(LS_ROTCACHE, JSON.stringify(lista.slice(-150))); } catch (e) { /* sin espacio: no pasa nada */ }
}

// Convierte la respuesta de Overpass en rotondas con sus conexiones ordenadas en sentido de circulación
function analizarRotondas(data) {
  const ways = (data.elements || []).filter(e => e.type === 'way' && Array.isArray(e.nodes) && Array.isArray(e.geometry));
  const coord = new Map();
  ways.forEach(w => w.nodes.forEach((id, i) => { if (w.geometry[i]) coord.set(id, { lat: w.geometry[i].lat, lon: w.geometry[i].lon }); }));
  const esAnillo = w => /^(roundabout|circular)$/.test((w.tags || {}).junction || '');
  const anillos = ways.filter(esAnillo);
  const vias = ways.filter(w => !esAnillo(w) && VIAS_VEHICULO.test((w.tags || {}).highway || ''));

  // Agrupar tramos de anillo que comparten nodos (una rotonda puede venir partida en varios "ways")
  const padre = new Map();
  const raiz = x => { while (padre.get(x) !== x) x = padre.get(x); return x; };
  anillos.forEach(w => padre.set(w.id, w.id));
  const nodoDe = new Map();
  anillos.forEach(w => w.nodes.forEach(n => {
    if (nodoDe.has(n)) { const a = raiz(nodoDe.get(n)), b = raiz(w.id); if (a !== b) padre.set(a, b); }
    else nodoDe.set(n, w.id);
  }));
  const grupos = new Map();
  anillos.forEach(w => { const g = raiz(w.id); if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(w); });
  // Si una avenida atraviesa la rotonda por el centro, el anillo puede venir en arcos separados: se unen los arcos vecinos
  const lista = [...grupos.values()].map(ws => {
    const ids = [...new Set(ws.flatMap(w => w.nodes))].map(id => coord.get(id)).filter(Boolean);
    const c = { lat: ids.reduce((a, p) => a + p.lat, 0) / ids.length, lon: ids.reduce((a, p) => a + p.lon, 0) / ids.length };
    return { ws, c, r: Math.max(...ids.map(p => distancia(c, p))) };
  });
  for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
    const a = lista[i], b = lista[j];
    if (a.ws.length && b.ws.length && a.r < 150 && b.r < 150 && distancia(a.c, b.c) < Math.min(a.r, b.r) * 1.6 + 10) {
      a.ws.push(...b.ws); b.ws = [];
    }
  }
  grupos.clear();
  lista.filter(x => x.ws.length).forEach((x, i) => grupos.set(i, x.ws));

  const res = [];
  grupos.forEach(ws0 => {
    // Un tramo marcado como rotonda que pasa por el centro es la avenida que la atraviesa, no parte del anillo
    let ws = ws0;
    if (ws0.length > 1) {
      const ps = [...new Set(ws0.flatMap(w => w.nodes))].map(id => coord.get(id)).filter(Boolean);
      const c = { lat: ps.reduce((a, p) => a + p.lat, 0) / ps.length, lon: ps.reduce((a, p) => a + p.lon, 0) / ps.length };
      const rm = ps.reduce((a, p) => a + distancia(c, p), 0) / ps.length;
      const cruza = w => w.nodes.slice(1, -1).some(id => { const p = coord.get(id); return p && distancia(c, p) < rm * 0.4; }) ||
        (w.nodes.length === 2 && (() => { const a = coord.get(w.nodes[0]), b = coord.get(w.nodes[1]);
          return a && b && distancia(c, { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }) < rm * 0.4; })());
      const resto = ws0.filter(w => !cruza(w));
      if (resto.length && resto.length < ws0.length) ws = resto;
    }
    const sig = new Map(), tienePrevio = new Set();
    ws.forEach(w => { for (let i = 0; i < w.nodes.length - 1; i++) { sig.set(w.nodes[i], w.nodes[i + 1]); tienePrevio.add(w.nodes[i + 1]); } });
    let inicio = ws[0].nodes[0];
    for (const n of sig.keys()) if (!tienePrevio.has(n)) { inicio = n; break; }
    let pos = new Map(); let n = inicio;
    while (n != null && !pos.has(n)) { pos.set(n, pos.size); n = sig.get(n); }
    let cerrado = n != null && n === inicio;       // el anillo da la vuelta completa
    if (!cerrado) {
      // A veces algún tramo del anillo está dibujado al revés en OSM: si sin importar el sentido
      // los tramos forman un anillo cerrado, se reconstruye y se orienta antihorario (circulación por la derecha).
      const orden = anilloSinSentido(ws, coord) || anilloPolar(ws, coord);
      if (orden) { pos = new Map(orden.map((id, i) => [id, i])); cerrado = true; }
    }
    const L = pos.size;
    const pts = [...pos.keys()].map(id => coord.get(id)).filter(Boolean);
    if (L < 3 || !pts.length) return;
    const centro = { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length };
    const radio = pts.reduce((s, p) => s + distancia(centro, p), 0) / pts.length;
    if (radio > 250) return; // no es una rotonda de calle

    const conexiones = [];
    vias.forEach(w => {
      const tags = w.tags || {}, ow = sentidoUnico(tags);
      w.nodes.forEach((nid, i) => {
        if (!pos.has(nid)) return;
        // Cada calle sale del anillo hacia adelante y/o hacia atrás en su lista de nodos
        [[1, ow !== -1, ow !== 1], [-1, ow !== 1, ow !== -1]].forEach(([dir, salida, entrada]) => {
          let j = i + dir, ref = null;
          while (j >= 0 && j < w.nodes.length) {
            if (pos.has(w.nodes[j])) { ref = null; break; }      // vuelve al anillo: es un paso por el centro, no una salida
            const c = coord.get(w.nodes[j]);
            if (c) { ref = c; if (distancia(centro, c) > radio + 25) break; }
            j += dir;
          }
          if (!ref) return;
          conexiones.push({ pos: pos.get(nid), nombre: nombreVia(tags), rumbo: rumbo(centro, ref), entrada, salida });
        });
      });
    });
    if (!conexiones.length) return;
    conexiones.sort((a, b) => a.pos - b.pos);
    const nombreAnillo = ws.map(w => (w.tags || {}).name).find(Boolean);
    const calles = [...new Set(conexiones.map(c => c.nombre).filter(x => !/sin nombre|^Rampa$/.test(x)))];
    res.push({
      osm: String(ws[0].id), centro, radio: Math.round(radio), L, conexiones, cerrado,
      nombre: nombreAnillo || (calles.length ? 'Rotonda ' + calles.slice(0, 2).join(' / ') : 'Rotonda sin nombre'),
      calles
    });
  });
  return res;
}

// Divide el corredor de una o varias líneas en cajas pequeñas (~10–15 km) para consultar por partes
function cajasCorredor(lineas, margen) {
  const cajas = [];
  lineas.forEach(linea => {
    const muestras = densificar(linea, 400);
    let caja = null;
    muestras.forEach(p => {
      const nueva = caja ? [Math.min(caja[0], p.lat), Math.min(caja[1], p.lon), Math.max(caja[2], p.lat), Math.max(caja[3], p.lon)]
                         : [p.lat, p.lon, p.lat, p.lon];
      if (caja && ((nueva[2] - nueva[0]) > 0.12 || (nueva[3] - nueva[1]) > 0.12)) {
        cajas.push(caja); caja = [p.lat, p.lon, p.lat, p.lon];
      } else caja = nueva;
    });
    if (caja) cajas.push(caja);
  });
  return cajas.map(c => [c[0] - margen, c[1] - margen, c[2] + margen, c[3] + margen]);
}

function anilloSinSentido(ws, coord) {
  const ady = new Map();
  const unir = (a, b) => { if (a === b) return; if (!ady.has(a)) ady.set(a, new Set()); ady.get(a).add(b); };
  ws.forEach(w => { for (let i = 0; i < w.nodes.length - 1; i++) { unir(w.nodes[i], w.nodes[i + 1]); unir(w.nodes[i + 1], w.nodes[i]); } });
  if (ady.size < 3 || ![...ady.values()].every(v => v.size === 2)) return null;   // con ramales no es un anillo simple
  const ini = ady.keys().next().value, orden = [ini];
  let prev = null, cur = ini;
  while (orden.length <= ady.size) {
    const sig = [...ady.get(cur)].find(x => x !== prev);
    if (sig === ini) break;
    if (sig == null || orden.includes(sig)) return null;
    orden.push(sig); prev = cur; cur = sig;
  }
  if (orden.length !== ady.size) return null;
  const pts = orden.map(id => coord.get(id));
  if (pts.some(p => !p)) return null;
  const k = Math.cos(pts[0].lat * RAD);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a.lon * k * b.lat - b.lon * k * a.lat;
  }
  return area < 0 ? orden.reverse() : orden;   // área positiva = antihorario
}

// Último recurso (anillos cortados o con ramales, como un intercambiador con paso central): se toman los nodos
// que forman el círculo exterior y se ordenan por ángulo alrededor del centro, en sentido antihorario.
function anilloPolar(ws, coord) {
  const ids = [...new Set(ws.flatMap(w => w.nodes))].filter(id => coord.get(id));
  if (ids.length < 4) return null;
  const pts = ids.map(id => coord.get(id));
  const c = { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lon: pts.reduce((a, p) => a + p.lon, 0) / pts.length };
  const ds = pts.map(p => distancia(c, p)).sort((a, b) => a - b), r = ds[Math.floor(ds.length / 2)];
  const k = Math.cos(c.lat * RAD);
  const borde = ids.map(id => ({ id, p: coord.get(id) })).filter(o => { const d = distancia(c, o.p); return d > r * 0.55 && d < r * 1.6; })
    .map(o => ({ id: o.id, a: Math.atan2(o.p.lat - c.lat, (o.p.lon - c.lon) * k) }))
    .sort((x, y) => x.a - y.a);
  if (borde.length < 4) return null;
  let hueco = 0;
  for (let i = 0; i < borde.length; i++) {
    const sig = i + 1 < borde.length ? borde[i + 1].a : borde[0].a + 2 * Math.PI;
    hueco = Math.max(hueco, sig - borde[i].a);
  }
  if (hueco > 110 * RAD) return null;      // le falta un pedazo grande al anillo
  return borde.map(o => o.id);             // ángulo creciente = antihorario
}

function lineasTramo(t) {
  const l = Object.values(t.trazados).map(tr => tr.map(([lat, lon]) => ({ lat, lon })));
  if (t.puntos.length) l.push(t.puntos.map(p => ({ lat: p.lat, lon: p.lon })));
  return l;
}

function abrirPanelOSM() {
  const t = tramoEd();
  $('osm-panel').hidden = false;
  $('osm-zona').value = t.puntos.length || Object.keys(t.trazados).length ? 'ruta' : 'mapa';
  $('osm-estado').textContent = '';
  $('osm-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cerrarPanelOSM() {
  $('osm-panel').hidden = true;
  osm.resultados = [];
  $('osm-resultados').innerHTML = ''; $('osm-acciones').hidden = true;
  if (osm.capa) { osm.capa.remove(); osm.capa = null; }
}

async function buscarOSM() {
  const t = tramoEd(), zona = $('osm-zona').value, estado = $('osm-estado');
  let cajas;
  if (zona === 'ruta') {
    // Corredor de la ruta dividido en tramos (sirve para rutas largas, p. ej. David → Ciudad)
    const traz = trazadoPara(t, '');
    const lineas = traz ? Object.values(t.trazados).map(tr => tr.map(([lat, lon]) => ({ lat, lon }))) : lineasTramo(t);
    if (!lineas.flat().length) { alert('Este sentido no tiene puntos ni trazado. Usa "El área visible del mapa".'); return; }
    cajas = cajasCorredor(lineas, 0.006);
    if (cajas.length > 60) { alert('La ruta es demasiado larga para buscar de una vez. Divídela en rutas más cortas.'); return; }
  } else {
    const b = ed.mapa.getBounds();
    cajas = [[b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]];
    if ((cajas[0][2] - cajas[0][0]) * (cajas[0][3] - cajas[0][1]) > 0.15) {
      alert('La zona es muy grande. Acerca el mapa a la parte que te interesa (por ejemplo, Tumba Muerto o San Miguelito) y busca de nuevo.');
      return;
    }
  }
  $('osm-buscar').disabled = true;
  let lista = [];
  try {
    const vistos = new Set();
    for (let i = 0; i < cajas.length; i++) {
      estado.textContent = cajas.length > 1 ? `Consultando OpenStreetMap… tramo ${i + 1} de ${cajas.length}` : 'Consultando OpenStreetMap…';
      analizarRotondas(await consultarOverpass(cajas[i])).forEach(r => { if (!vistos.has(r.osm)) { vistos.add(r.osm); lista.push(r); } });
      if (i < cajas.length - 1) await new Promise(res => setTimeout(res, 700)); // no saturar el servicio público
    }
  }
  catch (e) { estado.textContent = 'No se pudo consultar OpenStreetMap. Revisa tu conexión a internet e inténtalo de nuevo.'; return; }
  finally { $('osm-buscar').disabled = false; }

  // A lo largo de la ruta: con trazado grabado se filtran las que están sobre el recorrido
  const traz = trazadoPara(t, '');
  let nota = '';
  if (zona === 'ruta') {
    if (traz) {
      const geo = prepararGeometria(traz, []);
      lista = lista.filter(r => proyectar(geo, r.centro).d <= r.radio + 60);
    } else nota = ' Como este sentido aún no tiene trazado grabado, se muestran todas las del área de la ruta: marca solo las que recorres.';
  }
  lista.forEach(r => { r.existe = t.puntos.some(p => p.tipo === 'rotonda' && distancia(p, r.centro) < Math.max(40, r.radio + 15)); });
  osm.resultados = lista;
  estado.textContent = (lista.length ? `${lista.length} rotonda(s) encontradas.` : 'No se encontraron rotondas en esta zona.') + nota;
  renderResultadosOSM();
}

function renderResultadosOSM() {
  const cont = $('osm-resultados'); cont.innerHTML = '';
  if (osm.capa) osm.capa.remove();
  osm.capa = L.layerGroup().addTo(ed.mapa);
  const icono = L.divIcon({ className: 'pin-osm', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] });
  osm.resultados.forEach((r, i) => {
    const salidas = r.conexiones.filter(c => c.salida).length;
    const label = document.createElement('label');
    if (r.existe) label.className = 'ya';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = String(i); cb.disabled = r.existe;
    const txt = document.createElement('span');
    txt.textContent = r.nombre;
    const sub = document.createElement('span'); sub.className = 'sub';
    sub.textContent = `${salidas} salida(s)` + (r.calles.length ? ` · ${r.calles.slice(0, 4).join(', ')}` : '') + (r.existe ? ' · ya está en este sentido' : '');
    txt.appendChild(sub);
    label.append(cb, txt);
    label.addEventListener('click', () => ed.mapa.setView([r.centro.lat, r.centro.lon], 17));
    cont.appendChild(label);
    L.marker([r.centro.lat, r.centro.lon], { icon: icono }).addTo(osm.capa).bindTooltip(esc(r.nombre))
      .on('click', () => { if (!cb.disabled) { cb.checked = !cb.checked; } label.scrollIntoView({ block: 'nearest' }); });
  });
  $('osm-acciones').hidden = !osm.resultados.some(r => !r.existe);
  const b = L.latLngBounds(osm.resultados.map(r => [r.centro.lat, r.centro.lon]));
  if (b.isValid()) ed.mapa.fitBounds(b, { padding: [30, 30], maxZoom: 16 });
}

// Punto desde el que se llega a la rotonda (para adivinar la entrada)
function puntoPrevio(t, centro, idx) {
  const traz = trazadoPara(t, '');
  if (traz) {
    const geo = prepararGeometria(traz, []);
    const s = proyectar(geo, centro).s;
    if (s > 30) return interpolar(geo.linea, geo.cum, Math.max(0, s - 150));
  }
  return idx > 0 ? t.puntos[idx - 1] : null;
}

function adivinarEntrada(g, centro, previo) {
  const cands = g.conexiones.map((c, i) => ({ c, i })).filter(o => o.c.entrada);
  if (!cands.length || !previo) return null;
  const b = rumbo(centro, previo);
  return cands.reduce((m, o) => difAng(o.c.rumbo, b) < difAng(m.c.rumbo, b) ? o : m).i;
}

function insertarEnOrden(t, punto) {
  if (Object.keys(t.trazados).length) { t.puntos.push(punto); ordenarPorTrazado(t, '*'); return; }
  // Sin trazado: inserta donde menos alarga el recorrido entre puntos
  let mejor = t.puntos.length, costo = Infinity;
  for (let i = 0; i <= t.puntos.length; i++) {
    const a = t.puntos[i - 1], b = t.puntos[i];
    const c = (a ? distancia(a, punto) : 0) + (b ? distancia(punto, b) : 0) - (a && b ? distancia(a, b) : 0);
    if (c < costo) { costo = c; mejor = i; }
  }
  t.puntos.splice(mejor, 0, punto);
}

function agregarOSM() {
  const t = tramoEd();
  const elegidas = [...$('osm-resultados').querySelectorAll('input:checked')].map(c => osm.resultados[Number(c.value)]);
  if (!elegidas.length) { toast('Marca al menos una rotonda'); return; }
  const nuevas = elegidas.map(r => {
    const p = normalizarPunto({
      id: uid(), nombre: r.nombre, lat: r6(r.centro.lat), lon: r6(r.centro.lon), tipo: 'rotonda',
      rotGeo: { osm: r.osm, L: r.L, radio: r.radio, conexiones: r.conexiones, entrada: null }
    });
    insertarEnOrden(t, p);
    return p;
  });
  // Con el orden ya definido, adivina por dónde se entra a cada una
  let sinEntrada = 0;
  nuevas.forEach(p => {
    const e = adivinarEntrada(p.rotGeo, p, puntoPrevio(t, p, t.puntos.indexOf(p)));
    p.rotGeo.entrada = e;
    if (e == null) sinEntrada++;
  });
  guardarRutas();
  cerrarPanelOSM();
  renderEditor(true);
  toast(`${nuevas.length} rotonda(s) agregadas. Abre cada una para elegir la salida de cada destino.` +
        (sinEntrada ? ` (${sinEntrada} sin entrada definida)` : ''));
}

function crearVueltaDesdeIda() {
  const r = rutaEd();
  if (!r.ida.puntos.length && !Object.keys(r.ida.trazados).length) { alert('La ida no tiene puntos ni trazado.'); return; }
  if ((r.vuelta.puntos.length || Object.keys(r.vuelta.trazados).length) &&
      !confirm('La vuelta ya tiene datos. ¿Reemplazarlos?')) return;
  const invertirNombre = (n) => n.includes('→') ? n.split('→').map(s => s.trim()).reverse().join(' → ') : 'Vuelta';
  const trazados = {};
  if (r.ida.trazados['*']) trazados['*'] = r.ida.trazados['*'].slice().reverse();
  r.vuelta = normalizarTramo({
    nombre: invertirNombre(r.ida.nombre),
    destinos: [],
    trazados,
    puntos: r.ida.puntos.slice().reverse().map(p => ({
      id: uid(), nombre: p.nombre, lat: p.lat, lon: p.lon,
      tipo: p.tipo === 'rotonda' ? 'rotonda' : 'normal',
      salidasTotal: p.salidasTotal,
      flecha: p.flecha === 'curva' ? 'curva' : 'recto',
      carrilTexto: p.flecha === 'curva' ? p.carrilTexto : '',
      instrucciones: {}
    }))
  }, 'Vuelta');
  guardarRutas(); renderEditor(true);
  toast('Vuelta creada: revisa cada punto, los carriles cambian en sentido contrario.');
}

function exportarJSON(nombreArchivo, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombreArchivo;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function importarJSON(file) {
  const lector = new FileReader();
  lector.onload = () => {
    try {
      const data = JSON.parse(lector.result);
      let lista;
      if (Array.isArray(data) && data.length && data[0].lat !== undefined) lista = [{ nombre: 'Ruta importada', puntos: data }];
      else if (Array.isArray(data)) lista = data;
      else if (Array.isArray(data.rutas)) lista = data.rutas;
      else lista = [data];
      const nuevas = lista.map(normalizarRuta)
        .filter(r => r.ida.puntos.length || r.vuelta.puntos.length || Object.keys(r.ida.trazados).length || Object.keys(r.vuelta.trazados).length);
      if (!nuevas.length) throw new Error('El archivo no contiene rutas con puntos.');
      nuevas.forEach(r => {
        if (rutas.some(x => x.id === r.id)) {
          if (confirm(`Ya existe la ruta "${r.nombre}". ¿Reemplazarla?\n\nCancelar = importarla como copia`)) {
            rutas = rutas.map(x => x.id === r.id ? r : x); return;
          }
          r.id = uid(); r.nombre += ' (copia)';
        }
        rutas.push(r);
      });
      guardarRutas();
      sel.rutaId = nuevas[0].id; validarSel();
      ed.puntoId = null; $('ed-form').hidden = true;
      renderEditor(true);
      toast(`${nuevas.length} ruta(s) importada(s)`);
    } catch (err) { alert('No se pudo importar: ' + err.message); }
  };
  lector.readAsText(file);
}

/* ------------------------------------------------------------------ */
/* Pantalla de inicio y ajustes                                        */
/* ------------------------------------------------------------------ */

function renderInicio() {
  validarSel();
  const r = rutaSel(), t = r[sel.sentido];
  llenarSelect($('sel-ruta'), rutas.map(x => [x.id, x.nombre]), r.id);
  $('btn-ida').textContent = r.ida.nombre;
  $('btn-vuelta').textContent = r.vuelta.nombre;
  $('btn-ida').classList.toggle('activo', sel.sentido === 'ida');
  $('btn-vuelta').classList.toggle('activo', sel.sentido === 'vuelta');
  llenarSelect($('sel-destino'),
    [['', t.destinos.length ? 'General (todas las indicaciones)' : 'Sin destinos definidos'], ...t.destinos.map(d => [d.id, d.nombre])],
    sel.destino);
  $('sel-destino').disabled = !t.destinos.length;
  const n = puntosParaNavegar(t, sel.destino).length;
  const real = !!trazadoPara(t, sel.destino);
  $('ruta-info').textContent = `${n} punto(s) · ${real ? 'camino por la vía' : 'camino aproximado (línea recta)'} · ` +
                               (r.verificada ? '✔ verificada' : '⚠ sin verificar');
  $('tab-buscar').classList.toggle('activo', modoInicio === 'buscar');
  $('tab-rutas').classList.toggle('activo', modoInicio === 'rutas');
  $('panel-buscar').hidden = modoInicio !== 'buscar';
  $('panel-rutas').hidden = modoInicio !== 'rutas';
  renderFavoritos();
  renderPrevia();
}

/* ------------------------------------------------------------------ */
/* ¿A dónde vas? — búsqueda de lugares (Nominatim) y ruta con maniobras  */
/* automáticas (OSRM) + tus avisos propios                              */
/* ------------------------------------------------------------------ */

const LS_VIAJE = 'copiloto.viaje.v1', LS_FAV = 'copiloto.favoritos.v1', LS_MODO = 'copiloto.modo', LS_FUENTE = 'copiloto.fuente';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

function normalizarLugar(l) {
  if (!l || !isFinite(Number(l.lat)) || !isFinite(Number(l.lon))) return null;
  return { nombre: String(l.nombre || 'Lugar'), detalle: String(l.detalle || ''), lat: Number(l.lat), lon: Number(l.lon), gps: !!l.gps };
}
function normalizarViaje(v) {
  if (!v || !v.tramo) return null;
  const origen = normalizarLugar(v.origen), destino = normalizarLugar(v.destino);
  if (!origen || !destino) return null;
  return { origen, destino, tramo: normalizarTramo(v.tramo, 'Viaje'), creado: Number(v.creado) || Date.now() };
}

let modoInicio = leerLS(LS_MODO, 'buscar') === 'rutas' ? 'rutas' : 'buscar';
let viaje = normalizarViaje(leerLS(LS_VIAJE, null));
let fuente = leerLS(LS_FUENTE, viaje ? 'viaje' : null);
if (fuente === 'viaje' && !viaje) fuente = null;
let favoritos = (leerLS(LS_FAV, []) || []).map(f => {
  const v = normalizarViaje(f); return v ? { id: String(f.id || uid()), nombre: String(f.nombre || ''), ...v } : null;
}).filter(Boolean);
const formViaje = { origen: null, destino: null };   // lugares ya elegidos para cada campo
let ultimaUbicacion = null;

const guardarViaje = () => escribirLS(LS_VIAJE, viaje);
const guardarFavoritos = () => escribirLS(LS_FAV, favoritos);
function usarFuente(f) { fuente = f; escribirLS(LS_FUENTE, f); }
function setModoInicio(m) { modoInicio = m; escribirLS(LS_MODO, m); renderInicio(); }

function estadoViaje(msg) { $('viaje-estado').textContent = msg || ''; }

let ultimaBusqueda = 0;
async function buscarLugares(texto) {
  // Reglas de Nominatim: máximo 1 consulta por segundo y sin autocompletar mientras se escribe
  const espera = 1100 - (Date.now() - ultimaBusqueda);
  if (espera > 0) await new Promise(r => setTimeout(r, espera));
  ultimaBusqueda = Date.now();
  let url = `${NOMINATIM}?format=jsonv2&limit=6&countrycodes=pa&accept-language=es&q=${encodeURIComponent(texto)}`;
  if (ultimaUbicacion) {
    const { lat, lon } = ultimaUbicacion;
    url += `&viewbox=${(lon - 0.6).toFixed(3)},${(lat + 0.6).toFixed(3)},${(lon + 0.6).toFixed(3)},${(lat - 0.6).toFixed(3)}`;
  }
  const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data.map(d => {
      const partes = String(d.display_name || '').split(',').map(x => x.trim());
      const nombre = d.name || partes[0] || texto;
      return { nombre, detalle: partes.filter(x => x !== nombre).slice(0, 3).join(', '), lat: Number(d.lat), lon: Number(d.lon) };
    });
  } finally { clearTimeout(to); }
}

function elegirDeLista(campo, lista) {
  return new Promise(resolve => {
    $('lugares-titulo').textContent = campo === 'origen' ? '¿Desde cuál de estos lugares sales?' : '¿Cuál de estos lugares es tu destino?';
    const cont = $('lugares-lista'); cont.innerHTML = '';
    lista.forEach(l => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'lugar';
      b.textContent = l.nombre;
      if (l.detalle) { const sm = document.createElement('small'); sm.textContent = l.detalle; b.appendChild(sm); }
      b.addEventListener('click', () => { $('lugares').hidden = true; resolve(l); });
      cont.appendChild(b);
    });
    const c = document.createElement('button'); c.type = 'button'; c.className = 'btn-mini'; c.textContent = 'Ninguno: cambiaré lo que escribí';
    c.addEventListener('click', () => { $('lugares').hidden = true; resolve(null); });
    cont.appendChild(c);
    $('lugares').hidden = false;
    $('lugares').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

async function resolverLugar(campo, texto) {
  estadoViaje(`Buscando "${texto}"…`);
  let lista;
  try { lista = await buscarLugares(texto); }
  catch (e) { estadoViaje('No se pudo buscar el lugar. Revisa tu conexión a internet.'); return null; }
  if (!lista.length) {
    estadoViaje(`No encontré "${texto}". Prueba con otro nombre o agrega la zona, por ejemplo: "Albrook Mall, Panamá".`);
    $(campo === 'origen' ? 'in-origen' : 'in-destino').focus();
    return null;
  }
  estadoViaje('');
  const l = lista.length === 1 ? lista[0] : await elegirDeLista(campo, lista);
  if (!l) { $(campo === 'origen' ? 'in-origen' : 'in-destino').focus(); return null; }
  formViaje[campo] = l;
  $(campo === 'origen' ? 'in-origen' : 'in-destino').value = l.nombre;
  return l;
}

function ubicacionActual() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('sin GPS'));
    navigator.geolocation.getCurrentPosition(
      pos => { ultimaUbicacion = { lat: pos.coords.latitude, lon: pos.coords.longitude }; resolve(ultimaUbicacion); },
      reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
  });
}

const DIR = {
  'left': 'a la izquierda', 'right': 'a la derecha', 'slight left': 'ligeramente a la izquierda',
  'slight right': 'ligeramente a la derecha', 'sharp left': 'cerrado a la izquierda', 'sharp right': 'cerrado a la derecha',
  'straight': 'recto', 'uturn': 'en U'
};
function flechaDe(mod) {
  if (mod === 'uturn') return 'retorno';
  if (mod === 'slight left') return 'sal-izq';
  if (mod === 'slight right') return 'sal-der';
  if (/left/.test(mod)) return 'izq';
  if (/right/.test(mod)) return 'der';
  return 'recto';
}

// Convierte los pasos de OSRM en puntos de aviso que entiende el copiloto
function maniobrasDeOSRM(ruta, destinoNombre) {
  const pasos = (ruta.legs || []).flatMap(l => l.steps || []);
  const puntos = [];
  pasos.forEach((st, i) => {
    const m = st.maneuver || {}, tipo = m.type, mod = m.modifier || '';
    if (!m.location) return;
    const [lon, lat] = m.location;
    const ruta = (ref) => ref ? `ruta ${String(ref).split(/[;,]/)[0].trim()}` : '';
    const via = st.name || ruta(st.ref);
    let hacia = '';
    if (st.destinations) {
      // Formato de OSRM: "refs: nombres" (p. ej. "4: Arraiján, La Chorrera") o solo nombres o solo refs
      const d = String(st.destinations), i = d.indexOf(':');
      const refs = i >= 0 ? d.slice(0, i) : (/\d/.test(d) && /^[\s\dA-Z;,-]+$/.test(d) ? d : '');
      const nombres = i >= 0 ? d.slice(i + 1) : (refs ? '' : d);
      hacia = nombres.split(',')[0].trim() || ruta(refs);
    }
    const lado = /left/.test(mod) ? 'izquierda' : /right/.test(mod) ? 'derecha' : '';
    const inter = st.intersections && st.intersections[0];
    const carriles = inter && Array.isArray(inter.lanes) && inter.lanes.length > 1 ? inter.lanes.map(l => l.valid ? 'O' : '-').join('') : '';
    const base = { id: 'm' + i, lat: r6(lat), lon: r6(lon), fuente: 'auto', carriles };
    const destinoTxt = hacia ? ` hacia ${hacia}` : (via ? ` por ${via}` : '');
    const etiqueta = (hacia || via) ? ` · ${(hacia || via).toUpperCase()}` : '';
    const punto = (tipoP, flecha, nombre, accion, texto) => puntos.push(normalizarPunto({
      ...base, tipo: tipoP, flecha, nombre, carrilTexto: texto,
      instrucciones: { larga: `En {dist}, ${accion}.`, corta: `${cap(accion)}.` }
    }));

    switch (tipo) {
      case 'roundabout': case 'rotary': {
        const salida = Math.max(1, Number(m.exit) || 1);
        puntos.push(normalizarPunto({ ...base, tipo: 'rotonda', nombre: st.rotary_name ? `Rotonda ${st.rotary_name}` : (via ? `Rotonda hacia ${via}` : 'Rotonda'),
          salida, salidasTotal: Math.max(salida + 1, 3), calle: via }));
        break;
      }
      case 'turn': case 'end of road': case 'roundabout turn': case 'continue': case 'new name': {
        if (!mod || mod === 'straight') return;
        if (/^slight/.test(mod) && (tipo === 'continue' || tipo === 'new name')) return; // la vía solo se curva
        const accion = mod === 'uturn' ? `haga un retorno${via ? ' hacia ' + via : ''}` : `gire ${DIR[mod] || ''}${via ? ' en ' + via : ''}`;
        punto('normal', flechaDe(mod), mod === 'uturn' ? `Retorno${via ? ' · ' + via : ''}` : `${cap(lado)}${via ? ' en ' + via : ''}`,
              accion, mod === 'uturn' ? 'RETORNO' + etiqueta : lado.toUpperCase() + etiqueta);
        break;
      }
      case 'fork':
        if (!lado) return;
        punto('division', lado === 'izquierda' ? 'sal-izq' : 'sal-der', `Bifurcación${hacia || via ? ' hacia ' + (hacia || via) : ''}`,
              `manténgase a la ${lado}${destinoTxt}`, `MANTÉNGASE A LA ${lado.toUpperCase()}${etiqueta}`);
        break;
      case 'off ramp':
        punto('division', lado === 'izquierda' ? 'sal-izq' : 'sal-der', `Salida${hacia || via ? ' hacia ' + (hacia || via) : ''}`,
              `tome la salida a la ${lado || 'derecha'}${destinoTxt}`, `SALIDA A LA ${(lado || 'derecha').toUpperCase()}${etiqueta}`);
        break;
      case 'on ramp':
        punto('normal', lado === 'izquierda' ? 'sal-izq' : lado ? 'sal-der' : 'recto', `Rampa${via ? ' a ' + via : ''}`,
              `tome la rampa${lado ? ' a la ' + lado : ''}${destinoTxt}`, `RAMPA${etiqueta}`);
        break;
      case 'merge':
        punto('normal', lado === 'izquierda' ? 'sal-izq' : 'sal-der', `Incorporación${via ? ' a ' + via : ''}`,
              `incorpórese${via ? ' a ' + via : ''} con precaución`, `INCORPÓRESE${etiqueta}`);
        break;
      case 'arrive': {
        const donde = lado ? `a la ${lado}` : 'adelante';
        puntos.push(normalizarPunto({ ...base, tipo: 'normal', flecha: 'recto', nombre: `Destino: ${destinoNombre}`, carrilTexto: 'DESTINO',
          instrucciones: { larga: `En {dist}, llegará a ${destinoNombre}.`, corta: `Llegando a ${destinoNombre}. El destino está ${donde}.` } }));
        break;
      }
      default: break; // depart, notification, etc.
    }
  });
  return puntos;
}

function rumboEn(geo, s) {
  const a = interpolar(geo.linea, geo.cum, Math.max(0, s - 30)), b = interpolar(geo.linea, geo.cum, Math.min(geo.total, s + 30));
  return rumbo(a, b);
}

// Tus avisos propios (de las rutas personalizadas) que quedan sobre este camino y en el mismo sentido
function avisosPropiosEn(trazado) {
  const gv = prepararGeometria(trazado, []);
  const out = [], vistos = new Set();
  rutas.forEach(r => SENTIDOS.forEach(sn => {
    const t = r[sn];
    if (!t.puntos.length) return;
    const tz = t.trazados['*'] || null;
    const gt = tz ? prepararGeometria(tz, t.puntos) : null;
    t.puntos.forEach((p, i) => {
      if (p.tipo === 'paso' || p.tipo === 'rotonda' || p.fuente === 'auto') return;
      const q = proyectar(gv, p);
      if (q.d > 40) return;
      const bv = rumboEn(gv, q.s);
      let ba = null;
      if (gt) ba = rumboEn(gt, gt.sPuntos[i]);
      else if (t.puntos[i - 1]) ba = rumbo(t.puntos[i - 1], p);
      else if (t.puntos[i + 1]) ba = rumbo(p, t.puntos[i + 1]);
      if (ba != null && difAng(ba, bv) > 60) return;
      const clave = `${p.lat.toFixed(4)},${p.lon.toFixed(4)},${p.nombre}`;
      if (vistos.has(clave)) return;
      vistos.add(clave);
      const copia = JSON.parse(JSON.stringify(p));
      out.push(normalizarPunto({ ...copia, id: `a-${r.id}-${p.id}`, variantes: {}, soloDestinos: [], fuente: 'propio' }));
    });
  }));
  return out;
}

async function calcularRutaViaje(origen, destino) {
  const url = `${OSRM}${origen.lon.toFixed(6)},${origen.lat.toFixed(6)};${destino.lon.toFixed(6)},${destino.lat.toFixed(6)}` +
              '?overview=full&geometries=geojson&steps=true';
  const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 30000);
  let data;
  try { data = await (await fetch(url, { signal: ctrl.signal })).json(); } finally { clearTimeout(to); }
  if (!data || data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error((data && data.message) || 'sin ruta');
  const ruta = data.routes[0];
  const trazado = adelgazar(ruta.geometry.coordinates.map(([lon, lat]) => [r6(lat), r6(lon)]));
  const puntos = [...maniobrasDeOSRM(ruta, destino.nombre), ...avisosPropiosEn(trazado)];
  const tramo = normalizarTramo({ nombre: `Hacia ${destino.nombre}`, destinos: [], trazados: { '*': trazado },
                                  duraciones: { '*': ruta.duration / 60 }, puntos }, 'Viaje');
  ordenarPorTrazado(tramo, '*');
  try { await enriquecerRotondas(tramo); }
  catch (e) { tramo.puntos.forEach(p => { if (p.tipo === 'rotonda' && !p.rotGeo) p.rotDiag = 'error al analizar la rotonda'; }); }
  return { origen, destino, tramo, creado: Date.now() };
}

// Trae de OpenStreetMap la forma real de cada rotonda de la ruta y, con el camino trazado,
// averigua por qué calle se entra y por cuál se sale: así se numeran e iluminan las salidas reales.
async function enriquecerRotondas(tramo) {
  const rots = tramo.puntos.filter(p => p.tipo === 'rotonda' && !p.rotGeo).slice(0, 25);
  const traz = tramo.trazados['*'];
  if (!rots.length || !traz) return;
  const geo = prepararGeometria(traz, []);
  // 1) Rotondas que ya se analizaron antes en este teléfono
  const guardadas = rotondasGuardadas();
  const faltan = rots.filter(p => !aplicarRotonda(p, guardadas, geo, true));
  if (!faltan.length) return;
  // 2) El resto se consulta a OpenStreetMap
  const partes = faltan.map(p => `way["junction"~"^(roundabout|circular)$"]["highway"](around:250,${p.lat.toFixed(6)},${p.lon.toFixed(6)});`).join('');
  // En OSM una rotonda suele venir partida en muchos tramos: se buscan en 250 m alrededor de la entrada
  // para traer el anillo completo aunque la rotonda sea grande (solo se usan anillos cerrados).
  const q = `[out:json][timeout:25];(${partes})->.r;node(w.r)->.n;way(bn.n)["highway"]->.c;(.r;.c;);out geom;`;
  let lista;
  try { lista = analizarRotondas(await consultarOverpassQ(q, 20000)); }
  catch (e) { faltan.forEach(p => { p.rotDiag = 'sin respuesta de OpenStreetMap: ' + e.message; }); return; }
  guardarRotondas(lista.filter(x => x.cerrado));
  faltan.forEach(p => aplicarRotonda(p, lista, geo, false));
}

// Busca en la lista la rotonda de ese punto y, si el camino la cruza, fija su forma real y la salida.
// soloSiCoincide: no deja diagnóstico (se usa con las guardadas; si no sirve, se consulta a OSM).
function aplicarRotonda(p, lista, geo, soloSiCoincide) {
  const fallo = (m) => { if (!soloSiCoincide) p.rotDiag = m; return false; };
  const cerca = lista.filter(x => distancia(x.centro, p) < x.radio + 70).sort((a, b) => distancia(a.centro, p) - distancia(b.centro, p));
  if (!cerca.length) return fallo('no hay rotonda mapeada en ese punto');
  const r = cerca.find(x => x.cerrado);
  if (!r) return fallo('el anillo está incompleto o con ramales en el mapa');
  const cruce = cruceDeRotonda(geo, r, proyectar(geo, p).s);
  if (!cruce) return fallo('el camino no coincide con el anillo mapeado');
  const g = normalizarRotGeo({ osm: r.osm, L: r.L, radio: r.radio, conexiones: r.conexiones, lat: r.centro.lat, lon: r.centro.lon,
                               entrada: adivinarEntrada({ conexiones: r.conexiones }, r.centro, cruce.antes) });
  if (!g || g.entrada == null) return fallo('no se identificó la calle de entrada');
  // La salida que toma la ruta: la calle de salida con el rumbo más parecido al del camino al salir
  const bs = rumbo(r.centro, cruce.despues);
  const cand = g.conexiones.map((c, i) => ({ c, i })).filter(o => o.c.salida);
  if (!cand.length) return fallo('la rotonda no tiene salidas en el mapa');
  const tomada = cand.reduce((m, o) => difAng(o.c.rumbo, bs) < difAng(m.c.rumbo, bs) ? o : m);
  const k = salidasDe(g).findIndex(c => c.i === tomada.i) + 1;
  if (k < 1) return fallo('no se identificó la salida');
  p.rotDiag = '';
  p.rotGeo = g;
  p.salida = k;
  if (!p.calle || /sin nombre/i.test(p.calle)) p.calle = tomada.c.nombre;
  return true;
}

// Puntos del camino justo antes de entrar al anillo y justo después de salir
function cruceDeRotonda(geo, r, sAprox) {
  const desde = Math.max(0, sAprox - 200), hasta = Math.min(geo.total, sAprox + 600);
  const tramoLinea = [];
  for (let s = desde; s <= hasta; s += 5) tramoLinea.push(interpolar(geo.linea, geo.cum, s));
  const c = { lat: r.centro.lat, lon: r.centro.lon }, dentro = r.radio + 12, fuera = r.radio + 30;
  const iEntra = tramoLinea.findIndex(x => distancia(x, c) < dentro);
  if (iEntra < 0) return null;
  let antes = null, despues = null;
  for (let i = iEntra - 1; i >= 0; i--) if (distancia(tramoLinea[i], c) > fuera) { antes = tramoLinea[i]; break; }
  for (let i = iEntra + 1; i < tramoLinea.length; i++) if (distancia(tramoLinea[i], c) > fuera) { despues = tramoLinea[i]; break; }
  return antes && despues ? { antes, despues } : null;
}

async function calcularViaje(e) {
  if (e) e.preventDefault();
  $('lugares').hidden = true;
  const tO = $('in-origen').value.trim(), tD = $('in-destino').value.trim();
  if (!tD) { estadoViaje('Escribe a dónde vas.'); $('in-destino').focus(); return; }
  $('btn-calcular').disabled = true;
  try {
    let origen = tO ? (formViaje.origen && formViaje.origen.nombre === tO ? formViaje.origen : await resolverLugar('origen', tO)) : null;
    if (tO && !origen) return;
    const destino = formViaje.destino && formViaje.destino.nombre === tD ? formViaje.destino : await resolverLugar('destino', tD);
    if (!destino) return;
    if (!origen) {
      estadoViaje('Obteniendo tu ubicación…');
      try { const u = await ubicacionActual(); origen = { nombre: 'Tu ubicación', lat: u.lat, lon: u.lon, gps: true }; }
      catch (err) { estadoViaje('No pude obtener tu ubicación. Activa el GPS o escribe en "Desde" el lugar de partida.'); return; }
    }
    estadoViaje('Calculando la ruta…');
    try { viaje = await calcularRutaViaje(origen, destino); }
    catch (err) { estadoViaje('No se pudo calcular la ruta. Revisa tu conexión a internet e inténtalo de nuevo.'); return; }
    guardarViaje(); usarFuente('viaje');
    estadoViaje('');
    renderInicio();
    $('previa').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally { $('btn-calcular').disabled = false; }
}

// Invertir = preparar la vuelta: sale de donde estás ahora y llega al punto de partida.
// Si planeas la vuelta desde otro lugar, el botón "Salir desde …" usa el destino anterior como salida.
let sugerenciaOrigen = null;
function mostrarSugerenciaOrigen(l) {
  sugerenciaOrigen = l;
  $('sug-origen').hidden = !l;
  if (l) $('sug-origen').textContent = `↺ Salir desde ${l.nombre}`;
}

function invertirViaje() {
  const tO = $('in-origen').value.trim(), tD = $('in-destino').value.trim();
  // A dónde vuelves: el origen anterior (escrito, o tu ubicación de cuando calculaste la ida)
  let vuelta = tO ? (formViaje.origen && formViaje.origen.nombre === tO ? formViaje.origen : null) : null;
  if (!tO && viaje && viaje.origen.gps) vuelta = { ...viaje.origen, nombre: 'Punto de partida', gps: false };
  // De dónde venías: el destino anterior (para el botón "Salir desde …")
  const ida = tD ? (formViaje.destino && formViaje.destino.nombre === tD ? formViaje.destino : (viaje && viaje.destino.nombre === tD ? viaje.destino : null)) : null;

  $('in-origen').value = ''; formViaje.origen = null;          // Desde: tu ubicación actual
  $('in-destino').value = vuelta ? vuelta.nombre : tO;           // Hasta: donde empezaste
  formViaje.destino = vuelta;
  mostrarSugerenciaOrigen(ida);
  if (!$('in-destino').value) { estadoViaje('Escribe a dónde vuelves.'); $('in-destino').focus(); return; }
  calcularViaje();
}

async function recalcularViaje(f) {
  if (!navigator.onLine) { nav.fueraCuenta = 0; return; }
  nav.recalculando = true;
  decir('Recalculando la ruta.', { urgente: true });
  try {
    const nuevo = await calcularRutaViaje({ nombre: 'Tu ubicación', lat: f.lat, lon: f.lon, gps: true }, viaje.destino);
    if (!nav.activo) return;
    viaje = nuevo; guardarViaje();
    const puntos = puntosParaNavegar(viaje.tramo, '');
    Object.assign(nav, { tramo: viaje.tramo, puntos, geo: prepararGeometria(trazadoPara(viaje.tramo, ''), puntos),
                         idx: -1, min: Infinity, alertas: {}, sProg: null, sMax: -Infinity, contrario: false });
    prepararMapaHud();
    decir('Ruta nueva lista.');
  } catch (e) { toast('Sin conexión para recalcular: sigue la señalización.'); }
  finally { nav.recalculando = false; nav.fueraCuenta = 0; }
}

// ---- Favoritas
const mismoLugar = (a, b) => a && b && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;
function favoritoDe(v) {
  return v && favoritos.find(f => mismoLugar(f.destino, v.destino) && (f.origen.gps ? v.origen.gps : mismoLugar(f.origen, v.origen)));
}

function alternarFavorito() {
  if (!viaje) return;
  const f = favoritoDe(viaje);
  if (f) {
    if (!confirm(`¿Quitar "${f.nombre}" de tus favoritas?`)) return;
    favoritos = favoritos.filter(x => x !== f);
  } else {
    const sugerido = `${viaje.origen.gps ? 'Mi ubicación' : viaje.origen.nombre} → ${viaje.destino.nombre}`;
    const nombre = prompt('Nombre para esta ruta favorita:', sugerido);
    if (nombre === null) return;
    favoritos.unshift({ id: uid(), nombre: nombre.trim() || sugerido, ...JSON.parse(JSON.stringify(viaje)) });
    toast('Guardada en ⭐ Mis rutas');
  }
  guardarFavoritos(); renderInicio();
}

async function usarFavorito(f) {
  formViaje.origen = f.origen.gps ? null : f.origen; formViaje.destino = f.destino;
  $('in-origen').value = f.origen.gps ? '' : f.origen.nombre; $('in-destino').value = f.destino.nombre;
  viaje = normalizarViaje(JSON.parse(JSON.stringify(f)));   // funciona sin señal con la ruta guardada
  guardarViaje(); usarFuente('viaje'); renderInicio();
  if (navigator.onLine) {
    // Con internet, actualiza (y si sales de tu ubicación, calcula desde donde estás)
    try {
      let origen = f.origen;
      if (f.origen.gps) { const u = await ubicacionActual(); origen = { nombre: 'Tu ubicación', lat: u.lat, lon: u.lon, gps: true }; }
      const nuevo = await calcularRutaViaje(origen, f.destino);
      viaje = nuevo; guardarViaje(); renderInicio();
    } catch (e) { /* se queda la ruta guardada */ }
  }
  $('previa').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderFavoritos() {
  const cont = $('favoritos-lista'); cont.innerHTML = '';
  if (!favoritos.length) {
    const p = document.createElement('p'); p.className = 'vacio';
    p.textContent = 'Aún no tienes favoritas. En "¿A dónde vas?", calcula una ruta y toca ☆ Guardar en favoritas.';
    cont.appendChild(p); return;
  }
  favoritos.forEach(f => {
    const fila = document.createElement('div'); fila.className = 'favorito';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'lugar'; b.textContent = '⭐ ' + f.nombre;
    const geo = prepararGeometria(f.tramo.trazados['*'] || null, f.tramo.puntos);
    const min = f.tramo.duraciones['*'];
    const sm = document.createElement('small');
    sm.textContent = `${(geo.total / 1000).toFixed(1)} km${min ? ` · ~${Math.round(min)} min` : ''}${f.origen.gps ? ' · sale de donde estés' : ''}`;
    b.appendChild(sm);
    b.addEventListener('click', () => usarFavorito(f));
    const del = boton('🗑', 'Quitar de favoritas', () => {
      if (!confirm(`¿Quitar "${f.nombre}" de tus favoritas?`)) return;
      favoritos = favoritos.filter(x => x !== f); guardarFavoritos(); renderInicio();
    });
    fila.append(b, del); cont.appendChild(fila);
  });
}

/* ------------------------------------------------------------------ */
/* Vista previa de la ruta (inicio)                                    */
/* ------------------------------------------------------------------ */

const previa = { mapa: null, capa: null, puntos: [] };

function renderPrevia() {
  const ctx = contexto();
  $('previa').hidden = !ctx; $('bloque-iniciar').hidden = !ctx;
  if (!ctx) return;
  const r = ctx.ruta, t = ctx.tramo, dest = ctx.destId;
  $('previa-titulo').textContent = ctx.tipo === 'viaje'
    ? `${viaje.origen.gps ? 'Tu ubicación' : viaje.origen.nombre} → ${viaje.destino.nombre}`
    : `${t.nombre}${dest ? ' · ' + nombreDestino(t, dest) : ''}`;
  $('btn-favorito').hidden = ctx.tipo !== 'viaje';
  if (ctx.tipo === 'viaje') $('btn-favorito').textContent = favoritoDe(viaje) ? '★ En favoritas' : '☆ Guardar en favoritas';
  const puntos = puntosParaNavegar(t, dest);
  previa.puntos = puntos;
  const traz = trazadoPara(t, dest);
  const geo = prepararGeometria(traz, puntos, puntosDelRecorrido(t, dest));
  const clave = traz ? (dest && t.trazados[dest] ? dest : '*') : null;

  // Resumen
  const cuenta = (f) => puntos.filter(f).length;
  const nRot = cuenta(p => p.tipo === 'rotonda'), nDiv = cuenta(p => p.tipo === 'division'), nCurva = cuenta(p => p.tipo === 'normal' && p.flecha === 'curva');
  const partes = [];
  if (geo.total) partes.push(`${traz ? '' : '≈ '}${(geo.total / 1000).toFixed(1)} km${traz ? '' : ' en línea recta'}`);
  if (clave && t.duraciones[clave]) partes.push(`~${Math.round(t.duraciones[clave])} min`);
  if (nRot) partes.push(`${nRot} rotonda${nRot > 1 ? 's' : ''}`);
  if (nDiv) partes.push(nDiv > 1 ? `${nDiv} divisiones` : '1 división');
  if (nCurva) partes.push(`${nCurva} zona${nCurva > 1 ? 's' : ''} de curvas`);
  $('previa-resumen').textContent = puntos.length ? partes.join(' · ') : 'Sin puntos en este sentido.';

  // Alertas de lo que falta
  const alertas = [];
  if (puntos.length && !traz) alertas.push('Sin camino por la vía: las distancias son en línea recta. En el editor, toca "Trazar por carretera" o graba la ruta.');
  if (!dest && t.destinos.length && nRot) alertas.push('Elige un destino para ver qué salida tomar en cada rotonda.');
  if (ctx.tipo === 'viaje') {
    puntos.filter(p => p.tipo === 'rotonda' && !p.rotGeo).forEach(p => {
      const diag = (t.puntos.find(x => x.id === p.id) || {}).rotDiag || 'sin datos';
      alertas.push(`${p.nombre}: sin forma real (${diag}). Se muestra con dibujo aproximado y sin globos de salidas.`);
    });
  }
  puntos.filter(p => p.tipo === 'rotonda').forEach(p => {
    const orig = t.puntos.find(x => x.id === p.id);
    if (orig && orig.rotGeo && orig.rotGeo.entrada == null) alertas.push(`${p.nombre}: falta definir por dónde se entra.`);
    else if (!p.salida && (dest || !t.destinos.length)) alertas.push(`${p.nombre}: falta elegir la salida${dest ? ' para este destino' : ''}.`);
  });
  if (traz) {
    const lejos = puntos.filter(p => p.tipo !== 'rotonda').map(p => ({ p, d: proyectar(geo, p).d })).filter(x => x.d > 60);
    if (lejos.length) alertas.push(`Lejos del camino: ${lejos.map(x => `${x.p.nombre} (${Math.round(x.d)} m)`).join(', ')}.`);
  }
  if (ctx.tipo === 'viaje') {
    const propios = t.puntos.filter(p => p.fuente === 'propio').length;
    alertas.push('Ruta calculada con datos de OpenStreetMap: confirma siempre con la señalización.' +
                 (propios ? ` Incluye ${propios} aviso(s) tuyo(s).` : ''));
  } else if (!r.verificada) alertas.push('Ruta sin verificar: revisa los puntos en la vía antes de confiar en ella.');
  const ca = $('previa-alertas'); ca.innerHTML = '';
  alertas.forEach(a => { const d = document.createElement('div'); d.className = 'previa-alerta'; d.textContent = '⚠ ' + a; ca.appendChild(d); });
  if (ctx.tipo === 'viaje' && t.puntos.some(p => p.tipo === 'rotonda' && !p.rotGeo && /sin respuesta|error/.test(p.rotDiag))) {
    const b = document.createElement('button'); b.className = 'btn-mini'; b.id = 'btn-reintentar-rot'; b.type = 'button'; b.style.marginTop = '8px';
    b.textContent = '↻ Reintentar forma real de las rotondas';
    b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Consultando OpenStreetMap…';
      try { await enriquecerRotondas(t); } catch (e) { /* el diagnóstico queda en cada rotonda */ }
      guardarViaje(); renderPrevia();
      const ok = t.puntos.filter(p => p.tipo === 'rotonda' && p.rotGeo).length;
      toast(ok ? 'Forma real obtenida ✓' : 'OpenStreetMap sigue sin responder. Prueba en unos minutos.');
    });
    ca.appendChild(b);
  }

  // Lista de maniobras
  const ol = $('previa-lista'); ol.innerHTML = '';
  puntos.forEach((p, i) => {
    const li = document.createElement('li');
    const ic = document.createElement('div'); ic.className = 'hud-flecha'; pintarDibujo(ic, p);
    const tx = document.createElement('div'); tx.className = 'previa-tx';
    const km = isFinite(geo.sPuntos[i]) ? `km ${(Math.max(0, geo.sPuntos[i]) / 1000).toFixed(1)} · ` : '';
    const b = document.createElement('b'); b.textContent = `${i + 1}. ${p.nombre}${(t.puntos.find(x => x.id === p.id) || {}).fuente === 'propio' ? ' ⭐' : ''}`;
    const sub = document.createElement('span');
    sub.textContent = km + (p.tipo === 'rotonda'
      ? (p.salida ? `${cap(ORD[p.salida])} salida${p.calleSalida ? ', por ' + p.calleSalida : ''}` : 'Salida sin definir')
      : (p.carrilTexto || p.corta));
    tx.append(b, sub);
    li.append(ic, tx);
    li.tabIndex = 0; li.setAttribute('role', 'button');
    li.title = 'Ver de cerca en el mapa';
    const verDeCerca = () => {
      previa.mapa.setView([p.lat, p.lon], p.tipo === 'rotonda' ? 18 : 17);
      ol.querySelectorAll('li.sel').forEach(x => x.classList.remove('sel')); li.classList.add('sel');
      $('btn-ver-todo').hidden = false;
      $('map-previa').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    li.addEventListener('click', verDeCerca);
    li.addEventListener('keydown', e => { if (e.key === 'Enter') verDeCerca(); });
    ol.appendChild(li);
  });
  $('previa-maniobras').hidden = !puntos.length;
  $('previa-cuenta').textContent = `Ver maniobras (${puntos.length})`;
  $('btn-repasar').disabled = !puntos.length;

  // Mapa
  if (!previa.mapa) {
    previa.mapa = crearMapa('map-previa');
    previa.mapa.scrollWheelZoom.disable(); previa.mapa.boxZoom.disable();   // se mueve con el dedo y se acerca con ＋/－ o pellizco
    L.control.zoom({ position: 'topright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(previa.mapa);
    previa.mapa.setMaxZoom(19);
  }
  if (previa.capa) previa.capa.remove();
  previa.capa = L.layerGroup().addTo(previa.mapa);
  const ll = geo.linea.map(p => [p.lat, p.lon]);
  if (ll.length >= 2) L.polyline(ll, traz ? { color: '#00ff66', weight: 5, opacity: .8 } : { color: '#00ff66', weight: 3, opacity: .6, dashArray: '6 10' }).addTo(previa.capa);
  puntos.forEach((p, i) => L.marker([p.lat, p.lon], { icon: iconoNumero(i + 1, '', p.tipo), keyboard: false, interactive: false }).addTo(previa.capa));
  puntos.filter(p => p.tipo === 'rotonda' && p.rotGeo).forEach(p => globosSalidas(p, 'en-previa').forEach(m => m.addTo(previa.capa)));
  const verGlobos = () => $('map-previa').classList.toggle('lejos', previa.mapa.getZoom() < 16);
  previa.mapa.off('zoomend', verGlobos); previa.mapa.on('zoomend', verGlobos); verGlobos();
  if (ctx.tipo === 'viaje') {
    L.circleMarker([viaje.origen.lat, viaje.origen.lon], { radius: 8, color: '#fff', weight: 3, fillColor: '#2f8cff', fillOpacity: 1, interactive: false }).addTo(previa.capa);
    L.circleMarker([viaje.destino.lat, viaje.destino.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#ff3b3b', fillOpacity: 1, interactive: false }).addTo(previa.capa);
  }
  previa.limites = L.latLngBounds(ll.length ? ll : puntos.map(p => [p.lat, p.lon]));
  $('btn-ver-todo').hidden = true;
  setTimeout(() => {
    previa.mapa.invalidateSize();
    if (previa.limites.isValid()) previa.mapa.fitBounds(previa.limites, { padding: [18, 18], maxZoom: 15 });
  }, 60);
}

let repasando = false;
function repasarRuta() {
  if (repasando) { callarVoz(); repasando = false; $('btn-repasar').textContent = '🔊 Repasar en voz alta'; return; }
  const ctx = contexto(); if (!ctx) return;
  const t = ctx.tramo, dest = ctx.tipo === 'viaje' ? '' : nombreDestino(t, ctx.destId);
  callarVoz();
  repasando = true; $('btn-repasar').textContent = '⏹ Detener repaso';
  decir(`Repaso de la ruta ${t.nombre}${dest ? ', destino ' + dest : ''}. ${previa.puntos.length} indicaciones.`);
  previa.puntos.forEach((p, i) => decir(`${i + 1}. ${p.nombre}. ${p.corta}`));
  decir('Fin del repaso.');
  const vigilar = setInterval(() => {
    if (!voz.hablando && !voz.cola.length) { clearInterval(vigilar); repasando = false; $('btn-repasar').textContent = '🔊 Repasar en voz alta'; }
  }, 500);
}

function cargarVoces() {
  if (!('speechSynthesis' in window)) return;
  const s = $('aj-voz');
  const voces = speechSynthesis.getVoices().filter(v => /^es/i.test(v.lang));
  llenarSelect(s, [['', 'Automática (español)'], ...voces.map(v => [v.name, `${v.name} (${v.lang})`])],
               voces.some(v => v.name === ajustes.voz) ? ajustes.voz : '');
}

function renderAjustes() {
  $('aj-rate').value = ajustes.rate; $('aj-rate-val').textContent = Number(ajustes.rate).toFixed(2) + '×';
  $('aj-vol').value = ajustes.volume; $('aj-vol-val').textContent = Math.round(ajustes.volume * 100) + '%';
}

// ---- Eventos: inicio
$('sel-ruta').addEventListener('change', e => { sel.rutaId = e.target.value; sel.destino = ''; usarFuente('avanzada'); renderInicio(); });
['btn-ida', 'btn-vuelta'].forEach(id => $(id).addEventListener('click', e => {
  sel.sentido = e.currentTarget.dataset.sentido; sel.destino = ''; usarFuente('avanzada'); renderInicio();
}));
$('sel-destino').addEventListener('change', e => { sel.destino = e.target.value; usarFuente('avanzada'); renderInicio(); });
$('btn-usar-avanzada').addEventListener('click', () => { usarFuente('avanzada'); renderInicio(); $('previa').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('tab-buscar').addEventListener('click', () => setModoInicio('buscar'));
$('tab-rutas').addEventListener('click', () => setModoInicio('rutas'));
$('form-viaje').addEventListener('submit', calcularViaje);
$('in-origen').addEventListener('input', () => { formViaje.origen = null; mostrarSugerenciaOrigen(null); });
$('in-destino').addEventListener('input', () => { formViaje.destino = null; });
$('btn-invertir').addEventListener('click', invertirViaje);
$('sug-origen').addEventListener('click', () => {
  if (!sugerenciaOrigen) return;
  formViaje.origen = sugerenciaOrigen; $('in-origen').value = sugerenciaOrigen.nombre;
  mostrarSugerenciaOrigen(null); calcularViaje();
});
$('btn-favorito').addEventListener('click', alternarFavorito);
$('btn-repasar').addEventListener('click', repasarRuta);
$('btn-ver-todo').addEventListener('click', () => {
  if (previa.limites && previa.limites.isValid()) previa.mapa.fitBounds(previa.limites, { padding: [18, 18], maxZoom: 15 });
  $('previa-lista').querySelectorAll('li.sel').forEach(x => x.classList.remove('sel'));
  $('btn-ver-todo').hidden = true;
});
$('btn-conductor').addEventListener('click', () => { if (repasando) repasarRuta(); iniciarNavegacion('conductor'); });
$('btn-simular').addEventListener('click', () => { if (repasando) repasarRuta(); iniciarNavegacion('simulador'); });
$('btn-detener').addEventListener('click', detenerNavegacion);
$('btn-grabar').addEventListener('click', iniciarGrabacion);
$('btn-marcar').addEventListener('click', marcarAqui);
$('btn-terminar-grab').addEventListener('click', terminarGrabacion);
$('btn-editor').addEventListener('click', abrirEditor);

// ---- Eventos: ajustes de voz
$('aj-voz').addEventListener('change', e => { ajustes.voz = e.target.value; escribirLS(LS_AJ, ajustes); });
$('aj-rate').addEventListener('input', e => { ajustes.rate = Number(e.target.value); escribirLS(LS_AJ, ajustes); renderAjustes(); });
$('aj-vol').addEventListener('input', e => { ajustes.volume = Number(e.target.value); escribirLS(LS_AJ, ajustes); renderAjustes(); });
$('aj-probar').addEventListener('click', () => { callarVoz(); decir('En la rotonda, tome la tercera salida hacia Albrook.'); });
try { speechSynthesis.addEventListener('voiceschanged', cargarVoces); } catch (e) {}

// ---- Eventos: editor
$('ed-volver').addEventListener('click', () => {
  ed.puntoId = null; ed.rotGeo = null; $('ed-form').hidden = true; cerrarPanelOSM();
  sel.sentido = ed.sentido; renderInicio(); mostrarPantalla('pantalla-inicio');
});
$('ed-sel-ruta').addEventListener('change', e => {
  sel.rutaId = e.target.value; sel.destino = ''; validarSel();
  ed.puntoId = null; ed.rotGeo = null; $('ed-form').hidden = true; cerrarPanelOSM(); renderEditor(true);
});
['ed-ida', 'ed-vuelta'].forEach(id => $(id).addEventListener('click', e => {
  ed.sentido = e.currentTarget.dataset.sentido; ed.puntoId = null; ed.rotGeo = null; $('ed-form').hidden = true; cerrarPanelOSM(); renderEditor(true);
}));
$('ed-nueva').addEventListener('click', () => {
  const nombre = prompt('Nombre de la nueva ruta:', 'Mi ruta');
  if (!nombre) return;
  const r = normalizarRuta({ id: uid(), nombre: nombre.trim(), ida: { nombre: 'Ida' }, vuelta: { nombre: 'Vuelta' } });
  rutas.push(r); guardarRutas(); sel.rutaId = r.id; sel.destino = ''; validarSel();
  ed.sentido = 'ida'; ed.puntoId = null; $('ed-form').hidden = true; renderEditor(true);
});
$('ed-nombre').addEventListener('change', e => { const r = rutaEd(); r.nombre = e.target.value.trim() || r.nombre; guardarRutas(); renderEditor(false); });
$('ed-verificada').addEventListener('change', e => { rutaEd().verificada = e.target.checked; guardarRutas(); });
$('ed-tramo-nombre').addEventListener('change', e => { const t = tramoEd(); t.nombre = e.target.value.trim() || t.nombre; guardarRutas(); renderEditor(false); });
$('ed-destino-nuevo').addEventListener('click', () => {
  const nombre = prompt('Nombre del destino (ej.: Albrook):');
  if (!nombre || !nombre.trim()) return;
  tramoEd().destinos.push({ id: uid(), nombre: nombre.trim() });
  guardarRutas(); renderEditor(false);
  if (ed.puntoId) abrirFormPunto(ed.puntoId, false);
});
$('ed-ordenar').addEventListener('click', () => {
  if (ordenarPorTrazado(tramoEd(), '*')) { guardarRutas(); renderEditor(false); toast('Puntos ordenados según el trazado'); }
});
$('ed-crear-vuelta').addEventListener('click', crearVueltaDesdeIda);
$('ed-osm').addEventListener('click', abrirPanelOSM);
$('ed-trazar').addEventListener('click', trazarPorCarretera);
$('ed-ajustar').addEventListener('click', ajustarPuntosAVia);
$('osm-cerrar').addEventListener('click', cerrarPanelOSM);
$('osm-buscar').addEventListener('click', buscarOSM);
$('osm-agregar').addEventListener('click', agregarOSM);
$('osm-todas').addEventListener('click', () => $('osm-resultados').querySelectorAll('input:not(:disabled)').forEach(c => { c.checked = true; }));
$('f-entrada-osm').addEventListener('change', e => {
  if (!ed.rotGeo || e.target.value === '') return;
  ed.rotGeo.entrada = Number(e.target.value);
  renderRotOSM(); actualizarFormDinamico(); renderEditor(false);
});
$('ed-exportar').addEventListener('click', () => {
  const r = rutaEd(); exportarJSON(`${r.nombre.replace(/[^\wáéíóúñ-]+/gi, '_')}.json`, r);
});
$('ed-importar').addEventListener('change', e => { const f = e.target.files[0]; if (f) importarJSON(f); e.target.value = ''; });
$('ed-eliminar').addEventListener('click', () => {
  const r = rutaEd();
  if (rutas.length === 1) { alert('Debe quedar al menos una ruta.'); return; }
  if (!confirm(`¿Eliminar la ruta "${r.nombre}" (ida y vuelta) y todos sus puntos? Esto no se puede deshacer.`)) return;
  rutas = rutas.filter(x => x.id !== r.id); guardarRutas();
  sel.rutaId = rutas[0].id; validarSel(); ed.puntoId = null; $('ed-form').hidden = true; renderEditor(true);
});
$('ed-agregar').addEventListener('click', () => {
  const t = tramoEd(), c = ed.mapa.getCenter();
  const p = puntoNuevo(c.lat, c.lng, `Punto ${t.puntos.length + 1}`);
  t.puntos.push(p);
  if (Object.keys(t.trazados).length) ordenarPorTrazado(t, '*');
  guardarRutas(); abrirFormPunto(p.id);
});
$('ed-form').addEventListener('submit', guardarFormPunto);
$('ed-form').addEventListener('input', actualizarFormDinamico);
$('f-tipo').addEventListener('change', actualizarFormDinamico);
$('f-cerrar').addEventListener('click', cerrarFormPunto);
$('f-escuchar').addEventListener('click', () => escucharPunto(''));
$('f-ubicacion').addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Sin GPS disponible.');
  toast('Obteniendo ubicación…');
  navigator.geolocation.getCurrentPosition(
    pos => moverPuntoEd(ed.puntoId, pos.coords.latitude, pos.coords.longitude),
    () => alert('No se pudo obtener la ubicación.'),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
});

// ---- Arranque
if (viaje) {
  if (!viaje.origen.gps) { $('in-origen').value = viaje.origen.nombre; formViaje.origen = viaje.origen; }
  $('in-destino').value = viaje.destino.nombre; formViaje.destino = viaje.destino;
}
if (!fuente && !viaje) { /* primera vez: nada elegido todavía */ }
renderInicio();
renderAjustes();
cargarVoces();
