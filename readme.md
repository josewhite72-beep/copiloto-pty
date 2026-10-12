# Copiloto PTY (PWA)

Copiloto de voz y pantalla estilo HUD para conductores con poca experiencia en tramos de alto estrés
(interior → Ciudad de Panamá). Avisa **en orden** cada punto crítico a ~1 km y ~250 m, muestra una flecha,
un diagrama de carriles y un texto grande.

> Los avisos son una ayuda. Manda siempre lo que se ve en la vía y la señalización.

## Estructura

```
index.html        Interfaz: inicio, HUD, grabación y editor
app.js            Motor: rutas, GPS, avisos, simulador, editor, rotondas OSM
sw.js             Service Worker (v21): app sin conexión + caché del mapa ya visto
manifest.json     Instalación PWA
icons/            íconos normales, maskable (Android), apple-touch y favicon
lib/              Leaflet 1.9.4 local (leaflet.js, leaflet.css, images/)
```

**Importante al actualizar:** borra el archivo viejo `sw..js` (con dos puntos). El correcto es `sw.js`.

## Uso rápido: "¿A dónde vas?"

1. Escribe el destino (ej. "Albrook Mall"). "Desde" vacío = tu ubicación; o escribe otro punto de partida para planear.
2. Si hay varios lugares parecidos, elige el correcto. **Calcular ruta** muestra la vista previa: camino, km, minutos y
   maniobras (giros, rotondas con su salida y calle, bifurcaciones, salidas y llegada), calculadas con OSRM sobre
   OpenStreetMap. Los avisos de voz dicen la distancia real ("En 600 metros, gire a la derecha en Vía España").
3. Tus **avisos propios** (puntos de las rutas personalizadas) se suman solos si están sobre el camino y en el mismo sentido.
4. **🚗 Iniciar** o **🤖 Simular**. Si te sales del camino con internet, la ruta se **recalcula** desde donde estás.
5. **☆ Guardar en favoritas** para repetirla desde **⭐ Mis rutas** (funciona sin señal con la ruta guardada; con internet se
   actualiza). **⇅ Invertir** calcula la vuelta al instante: sale de tu ubicación actual y llega a
   donde empezaste. Si la planeas desde otro sitio, el botón "↺ Salir desde …" usa el destino anterior como salida.

Búsqueda de lugares: Nominatim (OpenStreetMap), solo al tocar "Calcular ruta" (sus reglas no permiten autocompletar),
limitada a Panamá. Las rutas personalizadas del editor siguen en **⭐ Mis rutas → Rutas personalizadas (avanzado)**.

## Pantalla de manejo

- **Rumbo arriba**: el mapa gira para que la dirección de avance quede siempre hacia arriba; el carro es una flecha
  fija en la parte baja de la pantalla (se ve más vía por delante). El botón **🧭** alterna con **Norte arriba**.
- **Movimiento suave**: entre una lectura de GPS (o del simulador) y la siguiente, el carro y el mapa se animan cuadro a cuadro.
- **Zoom automático**: según velocidad (más cerca en ciudad, más lejos en autopista) y **de cerca al llegar a cada
  maniobra** (~300 m; nivel 18 en rotondas). Botones **＋/－** (hasta nivel 19) y **AUTO** para volver al automático;
  se ocultan con el carro en movimiento en modo conductor.
- **Controles del simulador**: ⏸/▶ pausar y reanudar; **barra deslizable** para retroceder o adelantar a cualquier
  punto (al deslizar se pausa; los avisos se vuelven a escuchar desde ahí); ⏪/⏩ saltan 300 m; 🐢/🐇 cambian la
  velocidad de reproducción (×½ a ×20). **Auto** (por defecto): ×10 en tramos largos, ×3 al acercarse y ×1 (tiempo real)
  a menos de 400 m de cada maniobra o rotonda. Toca el indicador para volver a Auto. Al terminar, ▶ empieza de nuevo.
- **Vista previa**: el mapa se mueve y hace zoom; tocar una maniobra de la lista la muestra de cerca; "↩ Ver ruta completa".
- Hecho con CSS sobre Leaflet (sin complementos de terceros). Los textos del mapa giran con él (son imágenes).

## Rotondas: salidas numeradas

Al calcular una ruta, la app consulta en OpenStreetMap la forma real de cada rotonda del camino y, con el trazado,
deduce por qué calle se entra y por cuál se sale (si difiere del número que da el servicio de rutas, manda la geometría real).
- El dibujo de la maniobra numera todas las salidas e ilumina en verde la que hay que tomar.
- En el mapa aparecen globos sobre cada salida real; la tuya, grande y en verde. Al dar la vuelta, las que pasas se marcan ✓.
- La rotonda sigue activa hasta que sales por tu salida (no al entrar al anillo).
- A 60 m o menos de cualquier maniobra (y dentro de la rotonda) el letrero rojo se reduce a una línea
  ("3.ª SALIDA · AV. …") y se ocultan los carriles, para dejar ver la maniobra en el mapa.
- En la vista previa, los globos se ven al acercar el mapa (tocar la maniobra).
- Las rotondas partidas en muchos tramos en OSM se reúnen (búsqueda de 250 m) y solo se usan anillos cerrados. Si una
  rotonda no tiene forma real disponible, la vista previa dice por qué (sin respuesta de OSM, no hay rotonda mapeada,
  anillo incompleto o con ramales, el camino no coincide, sin entrada/salida identificada) y se usa el dibujo aproximado.
- Anillos con tramos dibujados al revés en OSM se reconstruyen y se orientan en sentido antihorario.
- Rotondas atravesadas por una avenida (intercambiadores como el de Chitré): la avenida que cruza por el centro no
  cuenta como salida, aunque en OSM esté marcada como parte de la rotonda; los arcos del anillo cortados por el cruce
  se unen y, si hace falta, el anillo se reconstruye por ángulo alrededor del centro.

## Conceptos

- **Ruta**: tiene dos sentidos, **ida** y **vuelta**, cada uno con su nombre (ej. "Interior → Ciudad" y "Ciudad → Interior").
- **Destinos**: cada sentido puede tener destinos (ej. Albrook, Balboa, Cinta Costera). Al iniciar se elige uno, o "General".
- **Tipos de punto**:
  - *Aviso*: curva, carril, salida…
  - *División*: la vía se separa; cada destino puede tener su propia flecha, carriles, texto y avisos.
  - *Rotonda*: número de salidas y salida a tomar, general o por destino. Si los avisos quedan vacíos se generan solos:
    a ~1 km "Tome la tercera salida hacia Albrook", a ~250 m "En la rotonda, tome la tercera salida…" y al entrar (~40 m)
    "Tercera salida hacia Albrook". El dibujo muestra la rotonda en sentido antihorario con la salida resaltada.
- **Rotondas reales (OpenStreetMap)**: en el editor, "Buscar rotondas reales" consulta OpenStreetMap desde el teléfono
  (a lo largo del sentido de la ruta o en el área visible del mapa, p. ej. Tumba Muerto o San Miguelito). De cada rotonda
  trae la ubicación, las calles que la tocan y **sus salidas en orden de circulación** (las calles de solo entrada no cuentan;
  la calle por donde entras cuenta al final como retorno). La entrada se adivina según el punto anterior de la ruta o el
  trazado grabado, y se puede cambiar. Los avisos incluyen el nombre de la calle ("tome la segunda salida hacia Albrook,
  por Vía Ricardo J. Alfaro") y el dibujo usa los ángulos reales. En el mapa del editor las salidas aparecen numeradas
  (E = entrada). Datos © colaboradores de OpenStreetMap (ODbL).
- **Aplica a**: un punto puede limitarse a ciertos destinos (ej. una salida que solo usa quien va a Balboa).
  Con "General" se muestran todos los puntos con su instrucción general.
- **Trazados (camino por la vía)**: cada sentido puede tener un trazado general y uno por destino. Se obtienen de dos formas:
  - **Grabado** manejando de acompañante (lo más exacto).
  - **🛣️ Trazar por carretera**: pide a OSRM (rutas sobre OpenStreetMap) el camino por las calles entre los puntos, en orden,
    para el general y para cada destino con puntos propios. Avisa de posibles desvíos y de puntos lejos de la vía.
  - **📍 Ajustar puntos a la vía**: mueve sobre el trazado los puntos que están a menos de 150 m (no las rotondas).
- **Punto de paso**: no da avisos; obliga al trazado a pasar por ahí (p. ej. por la Panamericana y no por la autopista).

- **Vista previa** (inicio): al elegir ruta, sentido y destino se ve un mapa con el camino, el resumen (km, minutos,
  rotondas, divisiones, curvas), la lista de maniobras como se verán al manejar, avisos de lo que falta (salidas sin
  elegir, camino en línea recta, puntos lejos de la vía) y **🔊 Repasar en voz alta** para escuchar la ruta antes de salir.
- **Cualquier lugar del país**: funciona en toda Panamá (y fuera). La búsqueda de rotondas a lo largo de la ruta se hace
  por tramos de ~13 km, así que sirve para rutas largas (p. ej. David → Ciudad). Para rutas largas, traza primero por carretera.

## Cómo se usa

1. **Grabar (acompañante, nunca manejando).** En el inicio elige ruta, sentido y, si hace falta, destino; toca "Grabar ruta".
   Toca **📍 Marcar aquí** en cada punto crítico. Al terminar se abre el editor.
2. **Editar.** Elige Ida o Vuelta, agrega destinos y completa cada punto: tipo, "aplica a", instrucción general e
   instrucción por destino. "Crear vuelta a partir de la ida" copia los puntos en orden inverso para revisarlos.
3. **Simular** a 60/80/100 km/h (×1, ×5, ×10). Sigue el trazado por la vía; frena a ~25 km/h en rotondas y ~50 km/h en curvas.
4. **Conductor.** Teléfono en soporte. Por encima de 10 km/h los controles se bloquean; tocar la tarjeta repite el aviso.

## Lógica de navegación

- Los puntos del sentido y destino elegidos se siguen **en orden**.
- Con trazado grabado las distancias son por carretera; a más de 200 m aparece "Fuera de la ruta".
- Si te alejas de los puntos aparece "Sentido contrario (¿era la vuelta/ida?)" y se pausan los avisos.
- Con precisión GPS peor de ±75 m se pausan los avisos.
- Cola de voz: ningún aviso corta a otro y se descartan los de puntos ya pasados.
- Pantalla siempre encendida mientras se navega o graba.

## Formato de datos (Exportar / Importar JSON)

```json
{
  "id": "mi-ruta", "nombre": "Chorrera ⇄ Ciudad", "verificada": false,
  "ida": {
    "nombre": "Chorrera → Ciudad",
    "destinos": [{ "id": "albrook", "nombre": "Albrook" }],
    "trazados": { "*": [[8.92, -79.71], [8.93, -79.70]], "albrook": [[8.94, -79.56], [8.95, -79.55]] },
    "puntos": [
      {
        "id": "r1", "nombre": "Rotonda X", "lat": 8.93, "lon": -79.70,
        "tipo": "rotonda", "salidasTotal": 4, "salida": null,
        "soloDestinos": [],
        "flecha": "recto", "carriles": "", "carrilTexto": "",
        "instrucciones": { "larga": "", "corta": "", "entrada": "" },
        "variantes": { "albrook": { "salida": 3 } }
      }
    ]
  },
  "vuelta": { "nombre": "Ciudad → Chorrera", "destinos": [], "trazados": {}, "puntos": [] }
}
```

- `tipo`: `normal`, `division`, `rotonda`, `paso`.
- `flecha`: `recto`, `sal-izq`, `sal-der`, `izq`, `der`, `retorno`, `division`, `curva`.
- `carriles` (izquierda a derecha): `O` = usar, `-` = evitar, `|` = separación.
- `variantes`: por id de destino; cualquier campo vacío usa el general.
- Se importan también rutas del formato anterior (un solo sentido) y el arreglo antiguo `PUNTOS_CRITICOS`;
  las rutas guardadas en el teléfono se migran solas.

## Notas

- La ruta de ejemplo trae coordenadas, carriles y destinos **sin verificar**, y ninguna rotonda real.
- Mapa base: OpenStreetMap estándar (sin clave) con tema oscuro por CSS. Según sus reglas solo se reusa lo ya visto
  (caché de 7 días); no se descargan zonas completas. Sin señal, la voz, la flecha y los carriles siguen funcionando.
  (CARTO dejó de servir mapas sin clave de API.)
- Requiere HTTPS (Vercel) para el GPS, la instalación y el Service Worker.
