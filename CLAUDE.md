# Simulador HRES-H2

Página interactiva que da vida a la tesis de magíster de Ignacio Partarrieu (UdeC, 2026): dimensionamiento óptimo de un sistema híbrido PV-WT con almacenamiento en hidrógeno (HESS) para una localidad remota del sur de Chile. Sitio estático (HTML, CSS y JavaScript con módulos ES, sin compilación). El detalle para usuarios está en `README.md`.

Plan: primero se publica en el GitHub personal (cuenta `IPartarrieu`); después se pasará al formato visual de MetGeo (skill `metgeo-marca`). Por eso los colores viven en variables en `assets/style.css` y el diagrama usa colores propios en `assets/diagram.js`.

## Fuentes de la tesis

- Carpeta: `~/Documentos/TESIS-FINAL/` (artículo final en `2026/Documentos finales/ArticuloTesis_MagisterEnGeofisica_IPartarrieu.pdf`).
- Código original: `OTROS/MODELO_HRES/` (`funciones.py`, `params.py`, `GA_optimizer.py`, `cs_hs_sa_optimizer.py`, `MC_LCOE.py`) y los datos `input_data.txt` (demanda, potencia de un Gaia-Wind 11 kW y de un panel CS6U-330P).

## Reglas que no se rompen

- **El despacho debe seguir reproduciendo el código Python; los costos siguen HOMER.** Si se toca `simular`, `flujoCaja`, `npcUnidad` o `prepararCaso` en `assets/model.js`, correr `node tests/validar.mjs`: las siete configuraciones de `tests/referencia_python.json` deben coincidir exactamente en LOLE, ENS, energía, pérdidas y H₂ final, y pasar las pruebas de HOMER (tasa real, factor de descuento, CRF, valor residual). Desde 2026-10-15, por decisión de Ignacio, el NPC usa el flujo de caja de HOMER Pro (valor residual por vida restante); el LCOE ya no coincide con el de la tesis (1,469 → 1,572 USD/kWh en su óptimo). El gráfico de flujo de caja de los resultados suma lo mismo que el NPC del motor. Detalles que importan: la demanda se multiplica por (1 + reserva); la producción por unidad se recorta a la potencia nominal; los tanques parten llenos; el déficit se redondea como `round(x, 2)` de Python (`redondear2`); LOLE cuenta horas con déficit > 0,01; el LCOE se redondea a 4 decimales. Las configuraciones tienen 8 cantidades `[wt, pv, con, ele, ht, fc, bat, dg]`; con `bat = dg = 0` (o con solo 6 valores) el despacho debe ser idéntico al de la tesis. Las baterías y el diésel van en bloques aparte (`if (capBat > 0)`, `if (nDg > 0)`): no mezclarlos con el código de la tesis.
- **La serie de la tesis solo vale para sus equipos.** Con el recurso «Serie de la tesis», el aerogenerador y el panel quedan fijos en Gaia-Wind 133 y CS6U-330P (se pueden editar costos, no parámetros físicos). Para otras marcas se usa ERA5.
- **Diésel y baterías:** el NPC del diésel depende del uso (litros × precio + mantención por kWh, cada año, y vida según horas de operación); el de la batería, de sus ciclos anuales. Por eso se calculan en `simular`, no en `npcU`.
- **Objetivos:** `evaluacion()` en `model.js` arma lo que reciben los optimizadores: `obj` (objetivo único, con penalizaciones), `objs` (frente de Pareto, según `OBJETIVOS_MO`) y `viol`. Los optimizadores de un objetivo comparan con `mejorQue` (reglas de Deb) y los multiobjetivo con `domina`.
- **Comparaciones justas entre métodos:** `node tests/comparar.mjs <h> <simulaciones> <semillas>` usa el mismo presupuesto de simulaciones para todos. Si se cambia un optimizador, volver a correrlo y actualizar la tabla del README.
- **Seguridad:** la meta `Content-Security-Policy` de `index.html` solo permite scripts propios y conexiones a `archive-api.open-meteo.com`. No usar scripts en línea ni `innerHTML` con texto externo (el diagrama escapa sus textos con `esc`). Los datos del usuario (CSV) se leen solo en el navegador.
- **Equipos del catálogo:** cada uno tiene `fuente` (clave de `FUENTES` en `model.js`, con DOI si es un artículo) y la página la muestra. Los marcados «tesis» usan los valores del artículo (Tablas 2.2.3 y 2.2.5). Solo citar un artículo si sus datos se leyeron en el texto completo (skill `articulos-cientificos`); los costos que no vienen de la fuente se marcan como referenciales.
- **Español neutro, forma «tú»,** sin modismos.

## Zona y distribución

- `assets/zona.js`: mapa Leaflet (`vendor/leaflet`), región de prueba como rectángulo (`REGION`), área máxima `AREA_MAX_KM2`, elevación con `api.open-meteo.com/v1/elevation`. `distribuirAerogeneradores` arma la grilla (sx·D × sy·D, filas perpendiculares a `eje`); `distribucionPaneles` da el m² por panel según el GCR sin sombras de 10 a 14 h en junio y la pérdida anual por sombra entre filas (`sombraFilas`). `estelaParque` (Jensen, 36 sectores, `dir100_deg` horaria o rosa estimada) ordena las posiciones por energía y da `eta` por n y sector, que `simular` aplica vía `caso.estela`. `relieve(pts)` descarga la grilla 64×64 de Terrain Tiles (la usa también la vista 3D). `factorCeldasFV` da el recurso FV de cada celda (horizonte del relieve y sombra entre filas según la pendiente N-S); `interaccionPV` arma la tabla del factor medio del campo solar con n aerogeneradores y k celdas, llenando desde el mayor recurso (`caso.campoFV`, aplicada con `factorCampoFV`); con «terreno compartido» cada aerogenerador solo excluye un círculo de `libre`·D (`areaExclusiva`). `layoutResultado` usa las mismas funciones (`celdasZona`, `ocupaCeldas`, `ordenCeldas`) para que el plano coincida con lo simulado.
- La restricción de terreno entra al modelo como `caso.terreno = { area, aWt, aPv }` y suma a `violacion` (`excesoTerreno`). Sin zona es `null` y el motor queda igual al de la tesis.
- La CSP permite además las teselas de OpenStreetMap, OpenTopoMap y Esri, y `api.open-meteo.com`.

## Datos (`data/`)

- `ejemplo_45s_2018.json`: `demanda_codificada` (ver arriba) y `tesis.wt_kw`, `tesis.pv_kw` con la precisión completa de `input_data.txt` (redondearlos cambia los resultados); `era5` con temperatura, presión, viento a 10 y 100 m y radiación en plano inclinado 45° hacia el norte, de Open-Meteo (hora de Chile, 2018), con `eje_viento` y `concentracion_viento`.
- `clima/<id>.json`: ERA5 2023 de los 10 puntos de `ESTACIONES` (`assets/demand.js`), con `eje_viento` (grados, energía v³ a 100 m).
- `resstock_maine_2018.json`: kWh por vivienda y hora (NREL ResStock AMY2018, viviendas unifamiliares de Maine, hora EST).
- **El nombre de la localidad es confidencial**: en la página y el repositorio se llama «Localidad remota - 840 habitantes» y «Series de ejemplo lat. 45°S»; no escribir su nombre ni sus coordenadas exactas. La tesis solo se menciona en la sección «Acerca del simulador».
- **La demanda de ejemplo es de terceros**. Ignacio autorizó publicarla en el simulador, pero **no que se pueda descargar**: va codificada en `demanda_codificada` (`assets/codec.js`, conserva los float64 exactos) y la página bloquea la descarga del CSV horario con esa demanda y con la sintética (que con poca variabilidad reproduce casi los mismos valores). No agregar ninguna vía de descarga de esa serie ni guardarla en texto plano en el repositorio. No es un cifrado real: si se necesitara protección fuerte, habría que simular en un servidor.

## Publicar

GitHub Pages guarda los archivos 10 minutos en caché. Los módulos propios llevan `?v=<versión>` en `index.html` y en cada `import` de `assets/`: al publicar cambios en `assets/`, cambiar esa versión en todos los archivos a la vez (`grep -rl '?v=' index.html assets | xargs sed -i 's/?v=VIEJA/?v=NUEVA/g'`).

## Probar

```bash
node tests/validar.mjs                    # despacho = Python de la tesis; costos = HOMER
node tests/multiobjetivo.mjs              # frentes de Pareto factibles y no dominados
node tests/comparar.mjs 0 20000 5         # métodos con el mismo presupuesto
python3 -m http.server 8000               # y abrir http://localhost:8000
```

En los navegadores automatizados (puppeteer), la política de seguridad bloquea el código que inyectan: probar sobre una copia sin la meta CSP.

Revisar en escritorio y a 400 px de ancho.
