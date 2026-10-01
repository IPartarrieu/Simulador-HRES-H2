# Simulador HRES-H2

Página interactiva que da vida a la tesis de magíster de Ignacio Partarrieu (UdeC, 2026): dimensionamiento óptimo de un sistema híbrido PV-WT con almacenamiento en hidrógeno (HESS) para la Isla Las Huichas. Sitio estático (HTML, CSS y JavaScript con módulos ES, sin compilación). El detalle para usuarios está en `README.md`.

Plan: primero se publica en el GitHub personal (cuenta `IPartarrieu`); después se pasará al formato visual de MetGeo (skill `metgeo-marca`). Por eso los colores viven en variables en `assets/style.css` y el diagrama usa colores propios en `assets/diagram.js`.

## Fuentes de la tesis

- Carpeta: `~/Documentos/TESIS-FINAL/` (artículo final en `2026/Documentos finales/ArticuloTesis_MagisterEnGeofisica_IPartarrieu.pdf`).
- Código original: `OTROS/MODELO_HRES/` (`funciones.py`, `params.py`, `GA_optimizer.py`, `cs_hs_sa_optimizer.py`, `MC_LCOE.py`) y los datos `input_data.txt` (demanda, potencia de un Gaia-Wind 11 kW y de un panel CS6U-330P).

## Reglas que no se rompen

- **El motor debe seguir reproduciendo el código Python.** Si se toca `simular`, `npcUnidad` o `prepararCaso` en `assets/model.js`, correr `node tests/validar.mjs`: las siete configuraciones de `tests/referencia_python.json` deben coincidir exactamente (LCOE, LOLE, ENS, energía, pérdidas, H₂ final). Detalles que importan: la demanda se multiplica por (1 + reserva); la producción por unidad se recorta a la potencia nominal; los tanques parten llenos; el déficit se redondea como `round(x, 2)` de Python (`redondear2`); LOLE cuenta horas con déficit > 0,01; el LCOE se redondea a 4 decimales. Las configuraciones tienen 8 cantidades `[wt, pv, con, ele, ht, fc, bat, dg]`; con `bat = dg = 0` (o con solo 6 valores) el despacho debe ser idéntico al de la tesis. Las baterías y el diésel van en bloques aparte (`if (capBat > 0)`, `if (nDg > 0)`): no mezclarlos con el código de la tesis.
- **La serie de la tesis solo vale para sus equipos.** Con el recurso «Serie de la tesis», el aerogenerador y el panel quedan fijos en Gaia-Wind 133 y CS6U-330P (se pueden editar costos, no parámetros físicos). Para otras marcas se usa ERA5.
- **Diésel y baterías:** el NPC del diésel depende del uso (litros × precio + mantención por kWh, cada año, y vida según horas de operación); el de la batería, de sus ciclos anuales. Por eso se calculan en `simular`, no en `npcU`.
- **Objetivos:** `evaluacion()` en `model.js` arma lo que reciben los optimizadores: `obj` (objetivo único, con penalizaciones), `objs` (frente de Pareto, según `OBJETIVOS_MO`) y `viol`. Los optimizadores de un objetivo comparan con `mejorQue` (reglas de Deb) y los multiobjetivo con `domina`.
- **Comparaciones justas entre métodos:** `node tests/comparar.mjs <h> <simulaciones> <semillas>` usa el mismo presupuesto de simulaciones para todos. Si se cambia un optimizador, volver a correrlo y actualizar la tabla del README.
- **Seguridad:** la meta `Content-Security-Policy` de `index.html` solo permite scripts propios y conexiones a `archive-api.open-meteo.com`. No usar scripts en línea ni `innerHTML` con texto externo (el diagrama escapa sus textos con `esc`). Los datos del usuario (CSV) se leen solo en el navegador.
- **Equipos del catálogo:** cada uno tiene `fuente` (clave de `FUENTES` en `model.js`, con DOI si es un artículo) y la página la muestra. Los marcados «tesis» usan los valores del artículo (Tablas 2.2.3 y 2.2.5). Solo citar un artículo si sus datos se leyeron en el texto completo (skill `articulos-cientificos`); los costos que no vienen de la fuente se marcan como referenciales.
- **Español neutro, forma «tú»,** sin modismos.

## Datos (`data/`)

- `huichas_2018.json`: `demanda_codificada` (ver arriba) y `tesis.wt_kw`, `tesis.pv_kw` con la precisión completa de `input_data.txt` (redondearlos cambia los resultados); `era5` con temperatura, presión, viento a 10 y 100 m y radiación en plano inclinado 45° hacia el norte, de Open-Meteo (hora de Chile, 2018).
- `resstock_maine_2018.json`: kWh por vivienda y hora (NREL ResStock AMY2018, viviendas unifamiliares de Maine, hora EST).
- **La demanda de Las Huichas es de terceros** (base de datos de William López-Castrillón). Ignacio autorizó publicarla en el simulador, pero **no que se pueda descargar**: va codificada en `demanda_codificada` (`assets/codec.js`, conserva los float64 exactos) y la página bloquea la descarga del CSV horario con esa demanda y con la sintética (que con poca variabilidad reproduce casi los mismos valores). No agregar ninguna vía de descarga de esa serie ni guardarla en texto plano en el repositorio. No es un cifrado real: si se necesitara protección fuerte, habría que simular en un servidor.

## Probar

```bash
node tests/validar.mjs                    # motor = Python de la tesis
node tests/multiobjetivo.mjs              # frentes de Pareto factibles y no dominados
node tests/comparar.mjs 0 20000 5         # métodos con el mismo presupuesto
python3 -m http.server 8000               # y abrir http://localhost:8000
```

En los navegadores automatizados (puppeteer), la política de seguridad bloquea el código que inyectan: probar sobre una copia sin la meta CSP.

Revisar en escritorio y a 400 px de ancho.
