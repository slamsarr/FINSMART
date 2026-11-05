/*
 * FINSMART – Écriture des valeurs dans le modèle officiel DGID (.xlsx) sans formules.
 * Modifie directement le XML des feuilles : mise en forme, fusions, impressions et dessins conservés.
 * Dépendances injectées : JSZip, DOMParser, XMLSerializer (navigateur natif ou xmldom sous Node).
 */
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const colToNum = s => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
const splitAddr = a => { const m = /^([A-Z]+)(\d+)$/.exec(a); return { col: colToNum(m[1]), row: +m[2] }; };
const childrenByTag = (el, tag) => { const out = []; for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (n.localName || n.nodeName) === tag) out.push(n); return out; };
const firstChild = (el, tag) => childrenByTag(el, tag)[0] || null;

function cleanNumber(v) {
  if (!isFinite(v)) return null;
  const r = Number(v.toPrecision(15));
  return Math.abs(r - Math.round(r)) < 1e-7 ? Math.round(r) : r;
}

/**
 * @param {ArrayBuffer|Uint8Array} modeleBytes  fichier modele_etats_financiers_DGID (Nouveau).xlsx
 * @param {Object<string, Object<string, any>>} values  { feuille: { A1: valeur } }
 * @param {{JSZip:any, DOMParser:any, XMLSerializer:any}} deps
 * @param {{isLimited?: boolean, allowedSheets?: string[]}} [options]
 * @returns {Promise<{bytes:Uint8Array, written:number, skippedErrors:string[]}>}
 */
export async function fillModele(modeleBytes, values, deps, options = {}) {
  const { isLimited = false, allowedSheets = ['Page de garde', 'Fiche de renseignement R1', 'BILAN PAYSAGE', 'COMPTE DE RESULTAT', 'FLUX DE TRESORERIE'] } = options;
  const { JSZip, DOMParser, XMLSerializer } = deps;
  const zip = await JSZip.loadAsync(modeleBytes);
  const parser = new DOMParser(), ser = new XMLSerializer();
  const readXml = async p => parser.parseFromString(await zip.file(p).async('string'), 'application/xml');

  // feuilles -> fichiers
  const wbDoc = await readXml('xl/workbook.xml');
  const relDoc = await readXml('xl/_rels/workbook.xml.rels');
  const rels = {};
  for (const r of Array.from(relDoc.getElementsByTagName('Relationship'))) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const sheetFiles = {};
  for (const s of Array.from(wbDoc.getElementsByTagName('sheet'))) {
    const rid = s.getAttributeNS(NS_REL, 'id') || s.getAttribute('r:id');
    let t = rels[rid]; if (!t) continue;
    t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    sheetFiles[s.getAttribute('name')] = t;
  }

  let written = 0; const skippedErrors = [];
  for (const [sheetName, path] of Object.entries(sheetFiles)) {
    const doc = await readXml(path);
    const sheetData = doc.getElementsByTagName('sheetData')[0];
    if (!sheetData) continue;
    const rowMap = new Map();
    for (const row of childrenByTag(sheetData, 'row')) rowMap.set(+row.getAttribute('r'), row);

    const getRow = r => {
      let row = rowMap.get(r);
      if (row) return row;
      row = doc.createElementNS(NS, 'row'); row.setAttribute('r', String(r));
      // insertion ordonnée
      let before = null;
      for (const [rr, el] of rowMap) if (rr > r && (!before || rr < +before.getAttribute('r'))) before = el;
      sheetData.insertBefore(row, before);
      rowMap.set(r, row);
      return row;
    };
    const getCell = (row, addr, col) => {
      let before = null;
      for (const c of childrenByTag(row, 'c')) {
        const a = c.getAttribute('r');
        if (a === addr) return c;
        if (!before && splitAddr(a).col > col) before = c;
      }
      const c = doc.createElementNS(NS, 'c'); c.setAttribute('r', addr);
      // reprend le style de la ligne s'il existe
      if (row.getAttribute('customFormat') === '1' && row.getAttribute('s')) c.setAttribute('s', row.getAttribute('s'));
      row.insertBefore(c, before);
      row.removeAttribute('spans');
      return c;
    };
    const clearCell = c => {
      for (const tag of ['f', 'v', 'is']) for (const n of childrenByTag(c, tag)) c.removeChild(n);
      c.removeAttribute('t'); c.removeAttribute('cm'); c.removeAttribute('vm');
    };

    const isSheetAllowed = !isLimited || allowedSheets.includes(sheetName);
    if (!isSheetAllowed) {
      const row = getRow(5);
      const c = getCell(row, 'C5', 3);
      clearCell(c);
      c.setAttribute('t', 'inlineStr');
      const is = doc.createElementNS(NS, 'is'); const t = doc.createElementNS(NS, 't');
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.appendChild(doc.createTextNode("VERSION D'ÉVALUATION GRATUITE – Débloquez la liasse complète sur FINSMART (20 000 FCFA) pour afficher cette note"));
      is.appendChild(t); c.appendChild(is);
      for (const f of Array.from(doc.getElementsByTagName('f'))) f.parentNode.removeChild(f);
      zip.file(path, ser.serializeToString(doc));
      continue;
    }
    const vals = values[sheetName] || {};
    for (const [addr, raw] of Object.entries(vals)) {
      const { row: r, col } = splitAddr(addr);
      const row = getRow(r);
      const c = getCell(row, addr, col);
      clearCell(c);
      let v = raw;
      if (v && typeof v === 'object' && 'err' in v) { skippedErrors.push(`${sheetName}!${addr} ${v.err}`); continue; }
      if (v === null || v === undefined || v === '') { written++; continue; }
      if (typeof v === 'number') {
        const n = cleanNumber(v); if (n === null) continue;
        const ve = doc.createElementNS(NS, 'v'); ve.appendChild(doc.createTextNode(String(n))); c.appendChild(ve);
      } else if (typeof v === 'boolean') {
        c.setAttribute('t', 'b');
        const ve = doc.createElementNS(NS, 'v'); ve.appendChild(doc.createTextNode(v ? '1' : '0')); c.appendChild(ve);
      } else {
        c.setAttribute('t', 'inlineStr');
        const is = doc.createElementNS(NS, 'is'); const t = doc.createElementNS(NS, 't');
        t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
        t.appendChild(doc.createTextNode(String(v))); is.appendChild(t); c.appendChild(is);
      }
      written++;
    }
    // aucune formule résiduelle : on garde la valeur en cache
    for (const f of Array.from(doc.getElementsByTagName('f'))) f.parentNode.removeChild(f);
    zip.file(path, ser.serializeToString(doc));
  }

  // la chaîne de calcul n'a plus d'objet
  if (zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml');
    for (const r of Array.from(relDoc.getElementsByTagName('Relationship')))
      if (/calcChain/.test(r.getAttribute('Type'))) r.parentNode.removeChild(r);
    zip.file('xl/_rels/workbook.xml.rels', ser.serializeToString(relDoc));
    const ct = await readXml('[Content_Types].xml');
    for (const o of Array.from(ct.getElementsByTagName('Override')))
      if (/calcChain/.test(o.getAttribute('PartName'))) o.parentNode.removeChild(o);
    zip.file('[Content_Types].xml', ser.serializeToString(ct));
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { bytes, written, skippedErrors };
}
