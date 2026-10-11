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
  pasadoRadio: 400,        // (sin trazado) el punto se considera pasado si estuvo a menos de esto...
  pasadoMargen: 60,        // ...y luego se alejó esta cantidad
  fueraRuta: 200,          // (con trazado) m de separación para "fuera de ruta"
  precisionMax: 75,        // m: con peor precisión se pausan los avisos
  velBloqueo: 10 / 3.6,    // m/s: por encima se bloquean los controles del conductor
  grabarCada: 15,          // m entre puntos del trazado grabado
  grabarPrecision: 50,     // m: precisión mínima para grabar
  tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  tileAttr: '© OpenStreetMap · © CARTO',
  zMin: 12, zMax: 16, maxTiles: 3000,
  tileCache: 'copiloto-tiles-v1'
};

const LS_RUTAS = 'copiloto.rutas.v2';
const LS_RUTAS_V1 = 'copiloto.rutas.v1';
const LS_SEL = 'copiloto.sel.v2';
const LS_AJ = 'copiloto.ajustes';

const SENTIDOS = ['ida', 'vuelta'];
const TIPOS = ['normal', 'division', 'rotonda'];
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
    rotGeo: normalizarRotGeo(p.rotGeo)
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
  return { osm: String(g.osm || ''), L: Math.max(1, Number(g.L) || 1), radio: Number(g.radio) || 20, conexiones, entrada };
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
  return { nombre: String(t.nombre || nombreDef), destinos, trazados, puntos };
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
        ? salidasReales[r.salida - 1].nombre : '';
      const por = calle ? `, por ${calle}` : '';
      r.calleSalida = calle;
      if (!r.larga) r.larga = `En un kilómetro, ${p.nombre}. Tome la ${ord} salida${hacia}${por}.`;
      if (!r.corta) r.corta = `En la rotonda, tome la ${ord} salida${hacia}${por}.`;
      if (!r.entrada) r.entrada = `${cap(ord)} salida${hacia}${por}.`;
      if (!r.carrilTexto) r.carrilTexto = `ROTONDA: ${ord.toUpperCase()} SALIDA` + (calle ? ` · ${calle.toUpperCase()}` : '');
    } else {
      if (!r.larga) r.larga = `En un kilómetro, ${p.nombre}.`;
      if (!r.corta) r.corta = `Rotonda. Busque la salida${hacia}.`;
      if (!r.carrilTexto) r.carrilTexto = 'ROTONDA';
    }
  }
  if (!r.carrilTexto) r.carrilTexto = p.nombre.toUpperCase();
  if (!r.larga) r.larga = `En un kilómetro, ${p.nombre}.`;
  if (!r.corta) r.corta = `${p.nombre}. Atención.`;
  return r;
}

function puntosParaNavegar(tramo, destId) {
  return tramo.puntos
    .filter(p => !destId || !p.soloDestinos.length || p.soloDestinos.includes(destId))
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
function prepararGeometria(trazado, puntos) {
  const real = !!(trazado && trazado.length >= 2);
  const linea = real ? trazado.map(([lat, lon]) => ({ lat, lon })) : puntos.map(p => ({ lat: p.lat, lon: p.lon }));
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
      if (d < best.d) best = { d, s: geo.cum[i] + t * Math.sqrt(L2) };
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
  let s = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${r}" fill="none" stroke="${gris}" stroke-width="11"/>`;
  otras.forEach(a => { s += brazo(a, gris, 5); });
  angulos.forEach((a, k) => { if (k + 1 !== elegida && Math.abs(a - 270) > 1) s += brazo(a, gris, 9); });
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
  } else {
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

function decir(texto, { urgente = false, puntoId = null, aviso = false } = {}) {
  if (!texto) return;
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
  L.tileLayer(CFG.tileUrl, { subdomains: 'abcd', maxZoom: 19, attribution: CFG.tileAttr }).addTo(m);
  m.setView([8.95, -79.65], 11);
  return m;
}

function iconoNumero(n, clase = '', tipo = 'normal') {
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

function iniciarNavegacion(modo) {
  const ruta = rutaSel(), tramo = ruta[sel.sentido];
  const puntos = puntosParaNavegar(tramo, sel.destino);
  if (!puntos.length) {
    alert(`"${tramo.nombre}" no tiene puntos${sel.destino ? ' para este destino' : ''}. Agrégalos en el editor o graba la ruta.`);
    return;
  }
  if (modo === 'conductor' && !ruta.verificada &&
      !confirm('Esta ruta todavía no está marcada como verificada: las coordenadas o los avisos podrían no coincidir con la vía.\n\n¿Iniciar de todas formas?')) return;

  callarVoz();
  Object.assign(nav, {
    activo: true, modo, ruta, sentido: sel.sentido, tramo, destino: sel.destino, puntos,
    geo: prepararGeometria(trazadoPara(tramo, sel.destino), puntos),
    idx: -1, min: Infinity, alertas: {}, ultimoFix: null, sProg: null, sMax: -Infinity,
    contrario: false, completado: false
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
  const dest = nombreDestino(tramo, sel.destino);
  decir((modo === 'simulador' ? 'Simulación iniciada. ' : 'Copiloto activado. ') + (dest ? `Destino: ${dest}.` : ''));
  if (modo === 'simulador') iniciarSimulador();
  else iniciarGPS();
}

function encabezadoHud(extra) {
  const dest = nombreDestino(nav.tramo, nav.destino) || 'General';
  return `${nav.tramo.nombre} · ${dest}` + (extra ? ` · ${extra}` : '');
}

function detenerNavegacion() {
  if (nav.watchId != null) navigator.geolocation.clearWatch(nav.watchId);
  clearInterval(nav.simTimer);
  Object.assign(nav, { activo: false, watchId: null, simTimer: null });
  callarVoz(); soltarWakeLock();
  document.body.classList.remove('bloqueado');
  mostrarPantalla('pantalla-inicio');
}

function iniciarGPS() {
  if (!('geolocation' in navigator)) { alert('Este dispositivo o navegador no ofrece ubicación GPS.'); detenerNavegacion(); return; }
  nav.watchId = navigator.geolocation.watchPosition(
    pos => procesarFix({ lat: pos.coords.latitude, lon: pos.coords.longitude, speed: pos.coords.speed,
                         acc: pos.coords.accuracy, t: pos.timestamp }),
    err => {
      if (err.code === 1) {
        alert('Permiso de ubicación denegado. Actívalo en los ajustes del navegador (permisos del sitio) para usar el copiloto.');
        detenerNavegacion();
      } else setChip($('hud-gps'), 'Sin señal GPS', 'bad');
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );
}

function prepararMapaHud() {
  if (!mapaHud) mapaHud = crearMapa('map-hud');
  setTimeout(() => mapaHud.invalidateSize(), 60);
  if (capaHud) capaHud.remove();
  capaHud = L.layerGroup().addTo(mapaHud);
  const g = nav.geo;
  const latlngs = g.linea.map(p => [p.lat, p.lon]);
  if (latlngs.length >= 2) {
    L.polyline(latlngs, g.real ? { color: '#00ff66', weight: 6, opacity: .75 }
                               : { color: '#00ff66', weight: 3, opacity: .6, dashArray: '6 10' }).addTo(capaHud);
  }
  marcadoresHud = nav.puntos.map((p, i) =>
    L.marker([p.lat, p.lon], { icon: iconoNumero(i + 1, '', p.tipo), keyboard: false }).addTo(capaHud).bindTooltip(esc(p.nombre)));
  const b = L.latLngBounds(latlngs);
  if (b.isValid()) setTimeout(() => mapaHud.fitBounds(b, { padding: [24, 24], maxZoom: 15 }), 80);
  if (autoHud) autoHud.remove();
  autoHud = L.circleMarker([0, 0], { radius: 9, color: '#fff', weight: 3, fillColor: '#2f8cff', fillOpacity: 1 });
}

function moverAuto(f) {
  autoHud.setLatLng([f.lat, f.lon]);
  if (!mapaHud.hasLayer(autoHud)) { autoHud.addTo(mapaHud); mapaHud.setView([f.lat, f.lon], 15); }
  else mapaHud.panTo([f.lat, f.lon], { animate: true, duration: .5 });
}

function marcarPinesHud() {
  marcadoresHud.forEach((m, i) =>
    m.setIcon(iconoNumero(i + 1, i < nav.idx ? 'pasado' : i === nav.idx ? 'actual' : '', nav.puntos[i].tipo)));
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

// ¿Ya pasamos el punto actual? También detecta el sentido contrario.
function evaluarPaso(f, dist, proj) {
  if (nav.geo.real) {
    nav.sMax = Math.max(nav.sMax, proj.s);
    if (proj.s < nav.sMax - 150) nav.contrario = true;
    else if (proj.s >= nav.sMax - 20) nav.contrario = false;
    return dist < -15;
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

function procesarFix(f) {
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
  moverAuto(f);
  if (nav.completado) return;

  const pts = nav.puntos, geo = nav.geo;
  let proj = null, fuera = false;
  if (geo.real) { proj = proyectar(geo, f, nav.sProg); nav.sProg = proj.s; fuera = proj.d > CFG.fueraRuta; }

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
  const pausa = fuera ? 'Fuera de la ruta: avisos en pausa'
              : nav.contrario ? `Sentido contrario: avisos en pausa (¿era ${otro}?)`
              : !gpsOk ? 'GPS impreciso: avisos en pausa' : '';

  if (!pausa) {
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
      decir(p.larga, { puntoId: p.id, aviso: true });
    }
  }

  $('hud-progreso').textContent = encabezadoHud(`${nav.idx + 1}/${pts.length}`);
  $('hud-dist').textContent = fmtDist(dist);
  $('hud-nombre').textContent = p.nombre;
  pintarDibujo($('hud-flecha'), p);
  const cerca = dist <= CFG.avisoLargo && !pausa;
  $('hud-carriles').innerHTML = cerca ? htmlCarriles(p.carriles) : '';
  const alerta = $('hud-alerta');
  alerta.textContent = p.carrilTexto;
  alerta.className = 'hud-alerta' + (cerca && p.carrilTexto ? ' visible' : '') + (dist <= CFG.avisoCorto ? ' urgente' : '');
  const banner = $('hud-banner');
  banner.textContent = pausa;
  banner.className = 'hud-banner' + (pausa ? ' visible' : '');
}

function completar() {
  if (nav.completado) return;
  nav.completado = true;
  clearInterval(nav.simTimer);
  marcarPinesHud();
  $('hud-dist').textContent = '✓';
  $('hud-nombre').textContent = 'Ruta completada';
  $('hud-progreso').textContent = encabezadoHud();
  $('hud-carriles').innerHTML = '';
  $('hud-alerta').className = 'hud-alerta';
  $('hud-banner').className = 'hud-banner';
  pintarDibujo($('hud-flecha'), { tipo: 'normal', flecha: 'recto' });
  document.body.classList.remove('bloqueado');
  decir('Pasó todos los puntos críticos de la ruta.');
}

$('hud-tarjeta').addEventListener('click', () => {
  if (voz.ultimoAviso) decir(voz.ultimoAviso);
  else toast('Aún no hay avisos para repetir');
});

/* ------------------------------------------------------------------ */
/* Simulador                                                           */
/* ------------------------------------------------------------------ */

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
  const total = cum[cum.length - 1];
  const vel = Number($('sim-vel').value) / 3.6;
  const factor = Number($('sim-factor').value) || 1;
  let s = 0, t = Date.now();

  nav.simTimer = setInterval(() => {
    s += vel; t += 1000;
    const p = interpolar(pts, cum, Math.min(s, total));
    procesarFix({ lat: p.lat, lon: p.lon, speed: vel, acc: 5, t });
    if (s >= total) { clearInterval(nav.simTimer); if (!nav.completado) completar(); }
  }, 1000 / factor);
}

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
  Object.assign(grab, { activo: true, traza: [], marcas: [], ultimoFix: null, dist: 0, sentido: sel.sentido, destino: sel.destino });
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
    if (trazado) tramo.trazados[clave] = trazado;
  } else {
    const fecha = new Date().toLocaleDateString('es-PA', { day: '2-digit', month: 'short' });
    rutaDestino = normalizarRuta({ id: uid(), nombre: `Ruta grabada ${fecha}`, ida: { nombre: 'Ida' }, vuelta: { nombre: 'Vuelta' } });
    tramoDestino = rutaDestino[grab.sentido];
    tramoDestino.puntos = grab.marcas.map((m, i) => puntoNuevo(m.lat, m.lon, `Punto ${i + 1}`));
    if (trazado) tramoDestino.trazados['*'] = trazado;
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
        delete t.trazados[k]; guardarRutas(); renderEditor(true);
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
    const num = document.createElement('span'); num.className = 'num'; num.textContent = p.tipo === 'rotonda' ? '⟳' : i + 1;
    const nom = document.createElement('span'); nom.className = 'nom';
    const etiqueta = p.tipo === 'rotonda' ? ' (rotonda)' : p.tipo === 'division' ? ' (división)' : '';
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
  delete t.trazados[id];
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

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
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
  const q = `[out:json][timeout:40];way["junction"~"^(roundabout|circular)$"]["highway"](${bbox.map(n => n.toFixed(5)).join(',')})->.r;` +
            'node(w.r)->.n;way(bn.n)["highway"]->.c;(.r;.c;);out geom tags;';
  let ultimo;
  for (const url of OVERPASS) {
    try {
      const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 45000);
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
      clearTimeout(to);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { ultimo = e; }
  }
  throw ultimo || new Error('sin respuesta');
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

  const res = [];
  grupos.forEach(ws => {
    const sig = new Map(), tienePrevio = new Set();
    ws.forEach(w => { for (let i = 0; i < w.nodes.length - 1; i++) { sig.set(w.nodes[i], w.nodes[i + 1]); tienePrevio.add(w.nodes[i + 1]); } });
    let inicio = ws[0].nodes[0];
    for (const n of sig.keys()) if (!tienePrevio.has(n)) { inicio = n; break; }
    const pos = new Map(); let n = inicio;
    while (n != null && !pos.has(n)) { pos.set(n, pos.size); n = sig.get(n); }
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
            const c = coord.get(w.nodes[j]);
            if (c && !pos.has(w.nodes[j])) { ref = c; if (distancia(centro, c) > radio + 25) break; }
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
      osm: String(ws[0].id), centro, radio: Math.round(radio), L, conexiones,
      nombre: nombreAnillo || (calles.length ? 'Rotonda ' + calles.slice(0, 2).join(' / ') : 'Rotonda sin nombre'),
      calles
    });
  });
  return res;
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
  let bbox;
  if (zona === 'ruta') {
    const todos = lineasTramo(t).flat();
    if (!todos.length) { alert('Este sentido no tiene puntos ni trazado. Usa "El área visible del mapa".'); return; }
    const lats = todos.map(p => p.lat), lons = todos.map(p => p.lon), m = 0.006;
    bbox = [Math.min(...lats) - m, Math.min(...lons) - m, Math.max(...lats) + m, Math.max(...lons) + m];
  } else {
    const b = ed.mapa.getBounds();
    bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
  }
  if ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > 0.15) {
    alert('La zona es muy grande. Acerca el mapa a la parte que te interesa (por ejemplo, Tumba Muerto o San Miguelito) y busca de nuevo.');
    return;
  }
  estado.textContent = 'Consultando OpenStreetMap…';
  $('osm-buscar').disabled = true;
  let lista;
  try { lista = analizarRotondas(await consultarOverpass(bbox)); }
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
/* Mapa sin señal: tiles del corredor (ida + vuelta + trazados)        */
/* ------------------------------------------------------------------ */

function tileXY(p, z) {
  const n = 2 ** z, lat = p.lat * RAD;
  return [Math.floor((p.lon + 180) / 360 * n),
          Math.floor((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * n)];
}

function lineasDeRuta(r) {
  const lineas = [];
  SENTIDOS.forEach(s => {
    const t = r[s];
    Object.values(t.trazados).forEach(tr => lineas.push(tr.map(([lat, lon]) => ({ lat, lon }))));
    if (t.puntos.length) lineas.push(t.puntos.map(p => ({ lat: p.lat, lon: p.lon })));
  });
  return lineas;
}

function urlsTilesRuta(lineas) {
  const retina = (window.devicePixelRatio || 1) > 1 ? '@2x' : '';
  const set = new Set();
  for (let z = CFG.zMin; z <= CFG.zMax; z++) {
    const n = 2 ** z;
    lineas.forEach(linea => {
      if (!linea.length) return;
      const anchoTile = 40075016 * Math.cos(linea[0].lat * RAD) / n;
      densificar(linea, anchoTile / 3).forEach(p => {
        const [x, y] = tileXY(p, z);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const tx = x + dx, ty = y + dy;
          if (tx >= 0 && ty >= 0 && tx < n && ty < n) set.add(`${z}/${tx}/${ty}`);
        }
      });
    });
  }
  return [...set].map(k => `https://a.basemaps.cartocdn.com/dark_all/${k}${retina}.png`);
}

let descargando = false;
async function descargarMapaRuta() {
  if (descargando) return;
  if (!('caches' in window)) { alert('Este navegador no permite guardar el mapa.'); return; }
  const r = rutaSel();
  const lineas = lineasDeRuta(r);
  if (!lineas.length) { alert('La ruta no tiene puntos.'); return; }
  const urls = urlsTilesRuta(lineas);
  if (urls.length > CFG.maxTiles) { alert(`La ruta es muy extensa (${urls.length} imágenes). Divídela en rutas más cortas.`); return; }
  const mb = Math.max(1, Math.round(urls.length * 20 / 1024));
  if (!confirm(`Se guardarán ${urls.length} imágenes del mapa alrededor de la ida y la vuelta (≈${mb} MB).\nRecomendado: con Wi-Fi.\n\n¿Continuar?`)) return;

  descargando = true;
  const estado = $('descarga-estado');
  const cache = await caches.open(CFG.tileCache);
  let i = 0, hechos = 0, fallos = 0;
  const trabajador = async () => {
    while (i < urls.length) {
      const url = urls[i++];
      try {
        if (!(await cache.match(url))) {
          let res;
          try { res = await fetch(url, { mode: 'cors' }); } catch (e) { res = await fetch(url, { mode: 'no-cors' }); }
          if (res.ok || res.type === 'opaque') await cache.put(url, res); else fallos++;
        }
      } catch (e) { fallos++; }
      hechos++;
      if (hechos % 5 === 0 || hechos === urls.length) estado.textContent = `Guardando mapa… ${hechos}/${urls.length}`;
    }
  };
  await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()]);
  descargando = false;
  estado.textContent = fallos
    ? `Mapa guardado con ${fallos} imagen(es) faltante(s). Vuelve a intentarlo con mejor señal.`
    : `✔ Mapa de "${r.nombre}" guardado para usar sin señal.`;
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
  $('ruta-info').textContent = `${n} punto(s) · ${real ? 'trazado grabado' : 'trazado aproximado'} · ` +
                               (r.verificada ? '✔ verificada' : '⚠ sin verificar');
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
$('sel-ruta').addEventListener('change', e => { sel.rutaId = e.target.value; sel.destino = ''; renderInicio(); $('descarga-estado').textContent = ''; });
['btn-ida', 'btn-vuelta'].forEach(id => $(id).addEventListener('click', e => {
  sel.sentido = e.currentTarget.dataset.sentido; sel.destino = ''; renderInicio();
}));
$('sel-destino').addEventListener('change', e => { sel.destino = e.target.value; renderInicio(); });
$('btn-conductor').addEventListener('click', () => iniciarNavegacion('conductor'));
$('btn-simular').addEventListener('click', () => iniciarNavegacion('simulador'));
$('btn-detener').addEventListener('click', detenerNavegacion);
$('btn-grabar').addEventListener('click', iniciarGrabacion);
$('btn-marcar').addEventListener('click', marcarAqui);
$('btn-terminar-grab').addEventListener('click', terminarGrabacion);
$('btn-editor').addEventListener('click', abrirEditor);
$('btn-descargar').addEventListener('click', descargarMapaRuta);

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
renderInicio();
renderAjustes();
cargarVoces();
