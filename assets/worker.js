// Worker de simulación: recibe el caso una vez y luego evalúa configuraciones sin bloquear la página.
// Mensajes: init (prepara el caso), lote (evalúa varias configuraciones), ha (corridas completas del
// algoritmo híbrido) y completo (simulación con series horarias para mostrar resultados).
import { prepararCaso, simular, violacion, evaluacion } from "./model.js";
import { correrHA } from "./optimizers.js";

let caso = null, crit = { tipo: "lole", h: 0, usarEnergia: false, objetivo: "lcoe" };

const evaluar = (cfg) => evaluacion(caso, cfg, crit);

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.tipo === "init") {
      caso = prepararCaso(m.caso);
      crit = m.crit;
      self.postMessage({ id: m.id, ok: true, mediaD: caso.mediaD, maxD: caso.maxD });
    } else if (m.tipo === "lote") {
      self.postMessage({ id: m.id, res: m.cfgs.map(evaluar) });
    } else if (m.tipo === "ha") {
      const cache = new Map();
      const evaluarUno = (cfg) => {
        const k = cfg.join(",");
        let e = cache.get(k);
        if (!e) { e = evaluar(cfg); cache.set(k, e); }
        return e;
      };
      for (const semilla of m.semillas) {
        const r = correrHA({ ...m.params, limites: m.limites, evaluarUno, semilla });
        self.postMessage({ id: m.id, parcial: true, mejor: r.mejor, historial: r.historial, evaluaciones: cache.size });
      }
      self.postMessage({ id: m.id, fin: true });
    } else if (m.tipo === "completo") {
      const r = simular(caso, m.cfg, true);
      const buffers = Object.values(r.series).map((a) => a.buffer);
      self.postMessage({ id: m.id, res: { ...r, viol: violacion(r, crit, caso), mediaD: caso.mediaD, npcU: caso.npcU, crf: caso.crf, sumaDF: caso.sumaDF } }, buffers);
    }
  } catch (err) {
    self.postMessage({ id: m.id, error: String((err && err.message) || err) });
  }
};
