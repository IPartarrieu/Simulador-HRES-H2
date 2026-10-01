# Simulador HRES-H2

Página interactiva para dimensionar un **sistema híbrido de energías renovables (HRES)** con **almacenamiento de energía en forma de hidrógeno (HESS)**: aerogeneradores y paneles fotovoltaicos, conversores DC/AC, electrolizadores, tanques de hidrógeno y celdas de combustible, más **baterías** y **generadores diésel** opcionales.

Da vida a la tesis de Magíster en Geofísica de Ignacio Partarrieu Andrade, *Dimensionamiento óptimo de un sistema híbrido de energías renovables con un sistema de almacenamiento de energía en forma de hidrógeno* (Universidad de Concepción, 2026), aplicada a la Isla Las Huichas (Aysén, Chile).

## Qué hace

1. **Demanda**: la serie horaria de Las Huichas (2018), un perfil público de viviendas (NREL ResStock, Maine 2018) escalado a una comunidad, una serie sintética generada a partir de Las Huichas o un archivo propio de 8760 valores horarios.
2. **Recurso**: la serie de la tesis (potencia medida in situ para el Gaia-Wind 11 kW y el panel CS6U-330P), el clima ERA5 de Las Huichas 2018 o el clima ERA5 de cualquier punto y año, descargado desde Open-Meteo.
3. **Arquitectura**: con o sin aerogeneradores, paneles, almacenamiento en hidrógeno, baterías (bus DC) y generadores diésel (bus AC). El diagrama del sistema se puede descargar en SVG o PNG.
4. **Equipos**: un catálogo con los equipos de la tesis y alternativas de la literatura científica y de fichas técnicas (aerogeneradores, paneles, electrolizadores alcalinos o PEM, celdas PEM o SOFC, baterías LFP, NMC y plomo-ácido, generadores diésel), cada uno con su fuente y con todos sus parámetros editables.
5. **Optimización**:
   - **Un objetivo**: minimiza el costo nivelado de energía (LCOE), el costo presente neto (NPC) o la inversión inicial, con una confiabilidad dada (LOLE ≤ h horas o LPSP ≤ un porcentaje).
   - **Penalizaciones opcionales**: excedentes perdidos (USD/kWh) e hidrógeno almacenado que nunca se usa (USD/kWh al año).
   - **Multiobjetivo**: frente de Pareto entre 2 y 4 objetivos a elegir: LCOE, LPSP, NPC, inversión inicial, excedentes perdidos, H₂ sin usar y emisiones de CO₂.
6. **Resultados**: cantidades, capacidades, costos, confiabilidad (LOLE y LPSP), uso de baterías y diésel (ciclos, litros, emisiones, fracción renovable), gráficos horarios y diagrama con los resultados; descarga de las series horarias (CSV), de un resumen (JSON) y del frente de Pareto (CSV). En el modo multiobjetivo, cada punto del frente se puede abrir como resultado completo.

## Modelo

`assets/model.js` reproduce el algoritmo de la tesis (`funciones.py`): en cada hora compara la generación con la demanda (más la reserva operativa), envía los excedentes al electrolizador y a los tanques, cubre los déficits con las celdas de combustible y limita los flujos entre buses con los conversores. La evaluación económica usa el costo presente neto de cada equipo (inversión, reemplazos, operación y mantenimiento y valor residual), el factor de recuperación del capital y el LCOE.

**Baterías y diésel** (se agregan sin cambiar el despacho de la tesis cuando no están):
- Orden de despacho: renovables → baterías → hidrógeno → diésel, tanto para guardar excedentes (primero la batería, luego el electrolizador) como para cubrir déficits.
- **Batería** (bus DC): eficiencias de carga y descarga, estado de carga mínimo, potencia máxima por la tasa C y autodescarga horaria. La vida es la menor entre la vida de calendario y los ciclos equivalentes de vida divididos por los ciclos anuales simulados; los reemplazos y el valor residual del NPC se calculan con esa vida.
- **Generador diésel** (bus AC): seguimiento de carga con carga mínima por unidad y consumo F = a·P + b·P_nominal (L/h), con a = 0,246 y b = 0,08145 L/kWh ([Diab et al., 2019](https://doi.org/10.1109/ACCESS.2019.2936656)). El NPC del diésel suma, cada año, el combustible (litros × precio) y la mantención por kWh generado, que dependen de cuánto funciona; la vida es la menor entre la vida de calendario y las horas de operación hasta el reemplazo divididas por las horas anuales de cada unidad. Emisiones: 2,68 kg de CO₂ por litro.
- **LPSP** = energía no suministrada / energía demandada.

Cuando el recurso es meteorológico, la potencia de cada equipo se calcula con los modelos del artículo: temperatura de celda y coeficiente de temperatura para los paneles (ec. 2.2.1 a 2.2.3), y curva lineal entre la velocidad de arranque y la nominal, con viento llevado a la altura del buje y corrección por densidad del aire, para los aerogeneradores (ec. 2.2.4 a 2.2.6).

### Validación

`tests/validar.mjs` compara el motor en JavaScript con el código Python original en siete configuraciones (entre ellas las óptimas del artículo): el LCOE, el LOLE, la energía suministrada y no suministrada, las pérdidas y el hidrógeno final coinciden exactamente. Las baterías y el diésel no existen en el código de la tesis; con 0 unidades de cada uno el resultado es el mismo.

`tests/multiobjetivo.mjs` revisa que los frentes de NSGA-II y MOPSO solo tengan soluciones factibles y no dominadas.

```
node tests/validar.mjs
node tests/multiobjetivo.mjs
```

## Métodos de optimización

| Método | Origen | Idea |
|---|---|---|
| Monte Carlo | tesis | Configuraciones al azar dentro de los límites. |
| Algoritmo híbrido CS-HS-SA | tesis (Zhang et al.) | Búsqueda caótica y armónica con aceptación de recocido simulado, en corridas independientes. |
| Algoritmo genético | tesis (DEAP) | Torneo de 3, cruce en dos puntos, mutación entera uniforme; penalización de las soluciones que no cumplen. |
| **SHADE** | nuevo | Evolución diferencial con adaptación de parámetros por historial de éxitos, reglas de factibilidad de Deb, población inicial por hipercubo latino y pulido final con búsqueda de patrones entera. |
| PSO | literatura | Enjambre de partículas con inercia decreciente; el método más usado para dimensionar sistemas híbridos. |
| Lobo gris (GWO) | literatura | Mirjalili et al. (2014). Comparado en [Kharrich et al. (2021)](https://doi.org/10.1109/ACCESS.2021.3051573). |
| Ballena (WOA) | literatura | Mirjalili y Lewis (2016). El mejor de cuatro métodos en [Diab et al. (2019)](https://doi.org/10.1109/ACCESS.2019.2936656). |
| Optimizador de equilibrio (EO) | literatura | Faramarzi et al. (2020). Superó a HHO, AEFA, GWO y STOA en [Kharrich et al. (2021)](https://doi.org/10.1109/ACCESS.2021.3051573). |
| **NSGA-II** | literatura | Multiobjetivo (Deb et al., 2002): no dominancia, distancia de apiñamiento y elitismo; cruce SBX y mutación polinomial. |
| MOPSO | literatura | Multiobjetivo (Coello et al., 2004): enjambre con archivo de soluciones no dominadas. |

PSO, GWO, WOA y EO usan aquí las mismas reglas de factibilidad, población inicial y pulido final que SHADE. NSGA-II y MOPSO usan dominancia con restricciones: una solución que cumple la confiabilidad domina a una que no. Otros trabajos revisados para el modo multiobjetivo comparan MOSSA, MODA, MOGOA y MOALO en frentes LPSP-COE ([Energies 15:3579, 2022](https://doi.org/10.3390/en15103579)).

`tests/comparar.mjs` compara los métodos de un objetivo con el mismo número de simulaciones en el caso de la tesis. Con 20 000 simulaciones por corrida y 5 semillas, para h = 0:

| Método | Mejor LCOE | Media | Peor |
|---|---|---|---|
| Monte Carlo | 1,553 | 1,572 | 1,610 |
| Algoritmo híbrido | 1,515 | 1,590 | 1,727 |
| Algoritmo genético | 1,469 | 1,497 | 1,534 |
| **SHADE** | **1,4548** | **1,4548** | **1,4548** |
| PSO | 1,4549 | 1,4549 | 1,4549 |
| Lobo gris (GWO) | 1,4549 | 1,4561 | 1,4603 |
| Ballena (WOA) | 1,499 | 1,774 | 1,926 |
| Equilibrio (EO) | 1,4549 | 1,4559 | 1,4597 |

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
| `assets/optimizers.js` | Métodos de un objetivo (Monte Carlo, híbrido, genético, SHADE, PSO, GWO, WOA, EO) y multiobjetivo (NSGA-II, MOPSO) |
| `assets/worker.js` | Web Worker que evalúa configuraciones |
| `assets/demand.js` | Fuentes de demanda y descarga del clima desde Open-Meteo |
| `assets/diagram.js` | Diagrama SVG del sistema y descargas |
| `assets/app.js` | Interfaz |
| `data/huichas_2018.json` | Demanda de Las Huichas, serie de la tesis y clima ERA5 de 2018 |
| `data/resstock_maine_2018.json` | Consumo horario promedio por vivienda (NREL ResStock) |
| `vendor/chart.umd.min.js` | Chart.js 4.4.1 (MIT) |
| `tests/` | Validación contra Python, comparación de métodos y prueba del frente de Pareto |

## Datos y créditos

- Demanda de Isla Las Huichas (2018): base de datos de William López-Castrillón, usada en la tesis. Se incluye codificada (`demanda_codificada` en `data/huichas_2018.json`, ver `assets/codec.js`) y **solo para usarla dentro del simulador: no se autoriza su descarga ni redistribución**. La página no permite descargar las series horarias cuando se usa esta demanda o la sintética basada en ella.
- Clima: reanálisis ERA5 (Copernicus Climate Change Service, ECMWF), obtenido vía [Open-Meteo](https://open-meteo.com/), licencia CC BY 4.0.
- Perfiles residenciales: NREL, *End-Use Load Profiles for the U.S. Building Stock*, ResStock AMY2018 (CC BY 4.0).
- Parámetros del sistema de hidrógeno: Zhang et al., citados en la tesis.
- Equipos de la literatura (cada uno indica su fuente en la página):
  - Diésel (consumo, costos, mantención y vida en horas): [Diab et al. (2019), IEEE Access 7](https://doi.org/10.1109/ACCESS.2019.2936656); [Energies 15:3579 (2022)](https://doi.org/10.3390/en15103579); [Processes 8:1381 (2020)](https://doi.org/10.3390/pr8111381).
  - Baterías de plomo-ácido (eficiencia 85 %, descarga 70 %, 220 USD/kWh) y aerogenerador Eolica de 2 kW: [Energies 15:3579 (2022)](https://doi.org/10.3390/en15103579).
  - Panel SunPower SPR-E20-327: [Processes 8:1381 (2020)](https://doi.org/10.3390/pr8111381).
  - Eficiencia de ida y vuelta del litio (95 a 98 %): [Energies 16:3893 (2023)](https://doi.org/10.3390/en16093893). Los costos de las baterías de litio son referenciales.
  - Electrolizadores AEL (68 %) y PEM (60 %), y celdas estacionarias (55 %): [Yue et al. (2021), RSER 146:111180](https://doi.org/10.1016/j.rser.2021.111180). Los costos son referenciales.
- Los demás equipos alternativos usan valores referenciales de fichas técnicas.
- Gráficos: [Chart.js](https://www.chartjs.org/) (MIT).
