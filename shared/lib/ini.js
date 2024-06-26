const { hasOwnProperty } = Object.prototype;

const eol =
  typeof process !== "undefined" && process.platform === "win32"
    ? "\r\n"
    : "\n";

const encode = (obj, opt) => {
  const children = [];
  let out = "";

  if (typeof opt === "string") {
    opt = {
      section: opt,
      whitespace: false,
    };
  } else {
    opt = opt || Object.create(null);
    opt.whitespace = opt.whitespace === true;
  }

  const separator = opt.whitespace ? " = " : "=";

  for (const k of Object.keys(obj)) {
    let val = obj[k];
    if (val && typeof val === "boolean" && val) {
      if (val) {
        val = "yes";
      } else {
        val = "no";
      }
      out += safe(k) + separator + safe(val) + eol;
    } else if (val && Array.isArray(val)) {
      for (const item of val)
        out += safe(k + "[]") + separator + safe(item) + "\n";
    } else if (val && typeof val === "object") children.push(k);
    else out += safe(k) + separator + safe(val) + eol;
  }

  if (opt.section && out.length)
    out = "[" + safe(opt.section) + "]" + eol + out;

  for (const k of children) {
    const nk = k;
    const section = (opt.section ? opt.section + "." : "") + nk;
    const { whitespace } = opt;
    const child = encode(obj[k], {
      section,
      whitespace,
    });
    if (out.length && child.length) out += eol;

    out += child;
  }

  return out;
};

const decode = (str) => {
  const out = Object.create(null);
  let p = out;
  let section = null;
  //          section     |key      = value
  const re = /^\[(.*)\]$|^([^=]+)(=(.*))?$/i;
  const lines = str.split(/[\r\n]+/g);

  for (const line of lines) {
    if (!line || line.match(/^\s*[#]/)) continue;
    const match = line.match(re);
    if (!match) continue;
    if (match[1] !== undefined) {
      section = unsafe(match[1]);
      if (section === "__proto__") {
        // not allowed
        // keep parsing the section, but don't attach it.
        p = Object.create(null);
        continue;
      }
      p = out[section] = out[section] || Object.create(null);
      continue;
    }
    const keyRaw = unsafe(match[2]);
    const isArray = keyRaw.length > 2 && keyRaw.slice(-2) === "[]";
    const key = isArray ? keyRaw.slice(0, -2) : keyRaw;
    if (key === "__proto__") continue;
    const valueRaw = match[3] ? unsafe(match[4]) : true;
    const value =
      { true: true, false: false, yes: true, no: false, null: null }[
        valueRaw
      ] ?? valueRaw;

    // Convert keys with '[]' suffix to an array
    if (isArray) {
      if (!hasOwnProperty.call(p, key)) p[key] = [];
      else if (!Array.isArray(p[key])) p[key] = [p[key]];
    }

    // safeguard against resetting a previously defined
    // array by accidentally forgetting the brackets
    if (Array.isArray(p[key])) p[key].push(value);
    else p[key] = value;
  }

  // {a:{y:1},"a.b":{x:2}} --> {a:{y:1,b:{x:2}}}
  // use a filter to return the keys that have to be deleted.
  const remove = [];
  for (const k of Object.keys(out)) {
    if (
      !hasOwnProperty.call(out, k) ||
      typeof out[k] !== "object" ||
      Array.isArray(out[k])
    )
      continue;

    // see if the parent section is also an object.
    // if so, add it to that, and mark this one for deletion
    const parts = [k];
    let p = out;
    const l = parts.pop();
    const nl = l;
    for (const part of parts) {
      if (part === "__proto__") continue;
      if (!hasOwnProperty.call(p, part) || typeof p[part] !== "object")
        p[part] = Object.create(null);
      p = p[part];
    }
    if (p === out && nl === l) continue;

    p[nl] = out[k];
    remove.push(k);
  }
  for (const del of remove) delete out[del];

  return out;
};

const isQuoted = (val) =>
  (val.charAt(0) === '"' && val.slice(-1) === '"') ||
  (val.charAt(0) === "'" && val.slice(-1) === "'");


const regBackslash = /\\/g;
const unsafe = (val) => {
  let val2 = (val || "").trim();
  if (isQuoted(val2)) {
    val2 = val2.substr(1, val2.length - 2);
  }
  val2 = val2.replace(regBackslash, '').normalize();
  /*const val3 = unsafe2(val);
  if(val3 !== val2) {
    console.error('Needs parsing !!!', val, val2, ' -> ', val3);
  }*/
  return val2;
}

const safe = (val) =>
  typeof val !== "string" ||
  val.match(/[=\r\n]/) ||
  val.match(/^\[/) ||
  (val.length > 1 && isQuoted(val)) ||
  val !== val.trim()
    ? JSON.stringify(val)
    : val.replace(/#/g, "\\#");

const unsafe2 = (val, doUnesc) => {
  val = (val || "").trim();
  if (isQuoted(val)) {
    // remove the single quotes before calling JSON.parse
    if (val.charAt(0) === "'") val = val.substr(1, val.length - 2);
    try {
      val = JSON.parse(val);
    } catch (_) {}
  } else {
    // walk the val to find the first not-escaped ; character
    let esc = false;
    let unesc = "";
    for (let i = 0, l = val.length; i < l; i++) {
      const c = val.charAt(i);
      if (esc) {
        if ("#".indexOf(c) !== -1) unesc += c;
        else unesc += "\\" + c;

        esc = false;
      } else if ("#".indexOf(c) !== -1) break;
      else if (c === "\\") esc = true;
      else unesc += c;
    }
    if (esc) unesc += "\\";

    return unesc.trim();
  }
  return val;
};

export default {
  parse: decode,
  decode,
  stringify: encode,
  encode,
  safe,
  unsafe,
};
