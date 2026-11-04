// Calcul du moteur SEN_ETAFI hors du fil principal (l'interface reste fluide)
import { buildWorkbook, collectValues, readResults } from './liasse.js';
let enginePromise = null;
const loadEngine = url => (enginePromise ||= fetch(url).then(r => { if (!r.ok) throw new Error('engine.json introuvable'); return r.json(); }));
self.onmessage = async ({ data }) => {
  try {
    const engine = await loadEngine(data.engineUrl);
    const t0 = Date.now();
    const wb = buildWorkbook(engine, data.balN, data.balN1, data.infos);
    const values = collectValues(wb, engine);
    const results = readResults(wb);
    results.dureeCalculMs = Date.now() - t0;
    // les erreurs Excel ne sont pas clonables telles quelles
    for (const s of Object.values(values)) for (const k in s) if (s[k] && typeof s[k] === 'object' && 'err' in s[k]) s[k] = { err: s[k].err };
    self.postMessage({ ok: true, values, results });
  } catch (e) {
    self.postMessage({ ok: false, error: e.message || String(e) });
  }
};
