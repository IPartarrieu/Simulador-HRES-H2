# Simulador HRES-H2

Página interactiva para dimensionar un **sistema híbrido de energías renovables (HRES)** con **almacenamiento de energía en forma de hidrógeno (HESS)**: aerogeneradores y paneles fotovoltaicos, conversores DC/AC, electrolizadores, tanques de hidrógeno y celdas de combustible.

Da vida a la tesis de Magíster en Geofísica de Ignacio Partarrieu Andrade, *Dimensionamiento óptimo de un sistema híbrido de energías renovables con un sistema de almacenamiento de energía en forma de hidrógeno* (Universidad de Concepción, 2026), aplicada a la Isla Las Huichas (Aysén, Chile).

## Qué hace

1. **Demanda**: la serie horaria de Las Huichas (2018), un perfil público de viviendas (NREL ResStock, Maine 2018) escalado a una comunidad, una serie sintética generada a partir de Las Huichas o un archivo propio de 8760 valores horarios.
2. **Recurso**: la serie de la tesis (potencia medida in situ para el Gaia-Wind 11 kW y el panel CS6U-330P), el clima ERA5 de Las Huichas 2018 o el clima ERA5 de cualquier punto y año, descargado desde Open-Meteo.
3. **Arquitectura**: con o sin aerogeneradores, paneles o almacenamiento en hidrógeno. El diagrama del sistema se puede descargar en SVG o PNG.
4. **Equipos**: un catálogo con los equipos de la tesis y alternativas (otras marcas de aerogeneradores y paneles, electrolizadores alcalinos o PEM, celdas PEM o SOFC), con todos sus parámetros editables.
5. **Optimización**: busca la cantidad de equipos de cada módulo que minimiza el costo nivelado de energía (LCOE) con una confiabilidad dada (horas con déficit permitidas, LOLE ≤ h).
6. **Resultados**: cantidades, capacidades, costos, confiabilidad, gráficos horarios y diagrama con los resultados; descarga de las series horarias (CSV) y de un resumen (JSON).

## Modelo

`assets/model.js` reproduce el algoritmo de la tesis (`funciones.py`): en cada hora compara la generación con la demanda (más la reserva operativa), envía los excedentes al electrolizador y a los tanques, cubre los déficits con las celdas de combustible y limita los flujos entre buses con los conversores. La evaluación económica usa el costo presente neto de cada equipo (inversión, reemplazos, operación y mantenimiento y valor residual), el factor de recuperación del capital y el LCOE.

Cuando el recurso es meteorológico, la potencia de cada equipo se calcula con los modelos del artículo: temperatura de celda y coeficiente de temperatura para los paneles (ec. 2.2.1 a 2.2.3), y curva lineal entre la velocidad de arranque y la nominal, con viento llevado a la altura del buje y corrección por densidad del aire, para los aerogeneradores (ec. 2.2.4 a 2.2.6).

### Validación

`tests/validar.mjs` compara el motor en JavaScript con el código Python original en siete configuraciones (entre ellas las óptimas del artículo): el LCOE, el LOLE, la energía suministrada y no suministrada, las pérdidas y el hidrógeno final coinciden exactamente.

```
node tests/validar.mjs
```

## Métodos de optimización

| Método | Origen | Idea |
|---|---|---|
| Monte Carlo | tesis | Configuraciones al azar dentro de los límites. |
| Algoritmo híbrido CS-HS-SA | tesis (Zhang et al.) | Búsqueda caótica y armónica con aceptación de recocido simulado, en corridas independientes. |
| Algoritmo genético | tesis (DEAP) | Torneo de 3, cruce en dos puntos, mutación entera uniforme; penalización de las soluciones que no cumplen. |
| **SHADE** | nuevo | Evolución diferencial con adaptación de parámetros por historial de éxitos, reglas de factibilidad de Deb, población inicial por hipercubo latino y pulido final con búsqueda de patrones entera. |

`tests/comparar.mjs` los compara con el mismo número de simulaciones en el caso de la tesis. Con 20 000 simulaciones por corrida y 5 semillas, para h = 0:

| Método | Mejor LCOE | Media | Peor |
|---|---|---|---|
| Monte Carlo | 1,538 | 1,597 | 1,692 |
| Algoritmo híbrido | 1,543 | 1,802 | 2,232 |
| Algoritmo genético | 1,465 | 1,487 | 1,535 |
| **SHADE** | **1,455** | **1,455** | **1,455** |

(USD/kWh). El artículo reporta 1,469 USD/kWh con el algoritmo genético y 500 000 simulaciones. Con h = 12, SHADE llega a 1,327 USD/kWh (artículo: 1,335).

```
node tests/comparar.mjs 0 20000 5     # h, simulaciones por corrida, semillas
```

La página reparte las simulaciones entre varios Web Workers (una simulación anual tarda cerca de 0,1 ms), así que una optimización con SHADE en el caso de la tesis toma segundos.

## Uso local

Es un sitio estático, sin compilación. Los datos se leen con `fetch`, así que hay que servirlo:

```
python3 -m http.server 8000     # y abrir http://localhost:8000
```

## Estructura

| Archivo | Qué es |
|---|---|
| `index.html` | La página |
| `assets/model.js` | Catálogo de equipos, modelos de potencia, economía y simulación horaria |
| `assets/optimizers.js` | Monte Carlo, algoritmo híbrido, algoritmo genético y SHADE |
| `assets/worker.js` | Web Worker que evalúa configuraciones |
| `assets/demand.js` | Fuentes de demanda y descarga del clima desde Open-Meteo |
| `assets/diagram.js` | Diagrama SVG del sistema y descargas |
| `assets/app.js` | Interfaz |
| `data/huichas_2018.json` | Demanda de Las Huichas, serie de la tesis y clima ERA5 de 2018 |
| `data/resstock_maine_2018.json` | Consumo horario promedio por vivienda (NREL ResStock) |
| `vendor/chart.umd.min.js` | Chart.js 4.4.1 (MIT) |
| `tests/` | Validación contra Python y comparación de métodos |

## Datos y créditos

- Demanda de Isla Las Huichas (2018): base de datos de William López-Castrillón, usada en la tesis. Se incluye codificada (`demanda_codificada` en `data/huichas_2018.json`, ver `assets/codec.js`) y **solo para usarla dentro del simulador: no se autoriza su descarga ni redistribución**. La página no permite descargar las series horarias cuando se usa esta demanda o la sintética basada en ella.
- Clima: reanálisis ERA5 (Copernicus Climate Change Service, ECMWF), obtenido vía [Open-Meteo](https://open-meteo.com/), licencia CC BY 4.0.
- Perfiles residenciales: NREL, *End-Use Load Profiles for the U.S. Building Stock*, ResStock AMY2018 (CC BY 4.0).
- Parámetros del sistema de hidrógeno: Zhang et al., citados en la tesis. Los equipos alternativos del catálogo usan valores referenciales de fichas técnicas y literatura.
- Gráficos: [Chart.js](https://www.chartjs.org/) (MIT).
