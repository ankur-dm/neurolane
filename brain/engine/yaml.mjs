// Minimal YAML subset reader/writer, zero dependencies.
// Supported: block maps, block lists (of scalars or maps), inline lists [a, b],
// inline empty map {}, quoted/plain scalars, numbers, booleans, null,
// literal block strings (|), and full-line # comments.
// Everything neurolane writes stays inside this subset, so files round-trip.

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === '{}') return {};
  if (s === '[]') return [];
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('[') && s.endsWith(']')) return splitInline(s.slice(1, -1)).map(parseScalar);
  return s;
}

function splitInline(body) {
  const out = [];
  let cur = '', q = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"') { cur += body[++i] ?? ''; continue; }
      if (c === q) q = null;
    } else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  if (cur.trim() !== '') out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

// Split "key: value" respecting quotes; returns null when the line is not a pair.
function splitPair(text) {
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === ':' && (i === text.length - 1 || text[i + 1] === ' ')) {
      return [text.slice(0, i).trim().replace(/^["']|["']$/g, ''), text.slice(i + 1)];
    }
  }
  return null;
}

export function parseYaml(src) {
  const lines = [];
  for (const raw of String(src).replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*#/.test(raw) || raw.trim() === '') { lines.push({ blank: true, raw }); continue; }
    lines.push({ indent: raw.match(/^ */)[0].length, text: raw.trim(), raw });
  }
  let i = 0;
  const skip = () => { while (i < lines.length && lines[i].blank) i++; };

  function readBlockString(parentIndent) {
    const buf = [];
    let ind = null;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.blank && l.indent <= parentIndent) break;
      if (l.blank) { buf.push(''); i++; continue; }
      if (ind === null) ind = l.indent;
      buf.push(l.raw.slice(ind));
      i++;
    }
    while (buf.length && buf[buf.length - 1] === '') buf.pop();
    return buf.join('\n');
  }

  function readValue(rest, parentIndent) {
    const r = rest.trim();
    if (r === '|' || r === '|-' || r === '>') return readBlockString(parentIndent);
    if (r !== '') return parseScalar(r);
    skip();
    if (i >= lines.length || lines[i].indent <= parentIndent) {
      // A list may sit at the same indent as its key ("key:\n- a").
      if (i < lines.length && lines[i].indent === parentIndent && lines[i].text.startsWith('- ')) return readNode(parentIndent);
      return null;
    }
    return readNode(lines[i].indent);
  }

  function readNode(indent) {
    skip();
    if (i >= lines.length) return null;
    const isList = lines[i].text === '-' || lines[i].text.startsWith('- ');
    return isList ? readList(indent) : readMap(indent);
  }

  function readMap(indent, seed) {
    const obj = seed || {};
    while (true) {
      skip();
      if (i >= lines.length) break;
      const l = lines[i];
      if (l.indent < indent) break;
      if (l.indent > indent) throw new Error(`YAML: unexpected indent at line ${i + 1}: ${l.raw}`);
      if (l.text.startsWith('- ')) break;
      const pair = splitPair(l.text);
      if (!pair) throw new Error(`YAML: expected "key: value" at line ${i + 1}: ${l.raw}`);
      i++;
      obj[pair[0]] = readValue(pair[1], indent);
    }
    return obj;
  }

  function readList(indent) {
    const arr = [];
    while (true) {
      skip();
      if (i >= lines.length) break;
      const l = lines[i];
      if (l.indent !== indent || !(l.text === '-' || l.text.startsWith('- '))) break;
      const rest = l.text === '-' ? '' : l.text.slice(2);
      const pair = rest.trim() && !/^["'\[]/.test(rest.trim()) ? splitPair(rest) : null;
      i++;
      if (pair) {
        const childIndent = indent + 2;
        const obj = {};
        obj[pair[0]] = readValue(pair[1], childIndent);
        arr.push(readMap(childIndent, obj));
      } else if (rest.trim() === '') {
        arr.push(readNode(lines[i]?.indent ?? indent + 2));
      } else {
        arr.push(parseScalar(rest));
      }
    }
    return arr;
  }

  skip();
  if (i >= lines.length) return {};
  return readNode(lines[i].indent);
}

const PLAIN = /^[A-Za-z0-9_./@()][A-Za-z0-9 _./@()+,'-]*$/;
function fmtScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (s === '') return '""';
  if (PLAIN.test(s) && !/^(true|false|null|~|-?\d+(\.\d+)?)$/.test(s) && !s.endsWith(' ') && !s.includes(': ') && !s.includes(' #')) return s;
  return JSON.stringify(s);
}

function isScalar(v) { return v === null || typeof v !== 'object'; }

export function stringifyYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    let out = '';
    for (const item of value) {
      if (isScalar(item)) out += `${pad}- ${fmtScalar(item)}\n`;
      else if (Array.isArray(item)) out += `${pad}-\n${stringifyYaml(item, indent + 2)}`;
      else {
        const body = stringifyYaml(item, indent + 2);
        out += `${pad}- ${body.slice(indent + 2)}`;
      }
    }
    return out;
  }
  let out = '';
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    if (isScalar(v)) {
      if (typeof v === 'string' && v.includes('\n')) {
        out += `${pad}${k}: |\n${v.split('\n').map((l) => (l ? `${pad}  ${l}` : '')).join('\n')}\n`;
      } else out += `${pad}${k}: ${fmtScalar(v)}\n`;
    } else if (Array.isArray(v)) {
      if (v.length === 0) out += `${pad}${k}: []\n`;
      else if (v.every(isScalar) && v.join(', ').length < 90) out += `${pad}${k}: [${v.map(fmtScalar).join(', ')}]\n`;
      else out += `${pad}${k}:\n${stringifyYaml(v, indent + 2)}`;
    } else if (Object.keys(v).length === 0) out += `${pad}${k}: {}\n`;
    else out += `${pad}${k}:\n${stringifyYaml(v, indent + 2)}`;
  }
  return out;
}

// Markdown file with a YAML frontmatter block.
export function parseFrontmatter(text) {
  const m = String(text).match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: String(text) };
  return { data: parseYaml(m[1]) || {}, body: m[2] };
}

export function stringifyFrontmatter(data, body) {
  return `---\n${stringifyYaml(data)}---\n${body ? (body.startsWith('\n') ? body : `\n${body}`) : ''}`;
}
