// MEMORY*.RC0 model — byte-safe surgical editing.
//
// The RC-5's own parser is strict and every memory file carries a per-file
// trailer after </database> (MEMORY1 ends with "8\0\0\0", MEMORY2 with
// "9\0\0\0"; a wrong trailer triggers "LOOPER DATA READ ERR" on boot).
// The invariant of this module: any byte we were not explicitly asked to
// change is reproduced exactly. Files are handled as latin1 strings so the
// trailer and any non-ASCII bytes round-trip unharmed.

export const SLOT_COUNT = 99;
export const NAME_LENGTH = 12;
export const TAIL_MARKERS = { 1: 0x38, 2: 0x39 };

const CLOSING_TAG = '</database>';

export function splitFile(text) {
  const at = text.indexOf(CLOSING_TAG);
  if (at === -1) throw new Error('not an RC0 memory file: missing </database>');
  return {
    document: text.substring(0, at + CLOSING_TAG.length),
    tail: text.substring(at + CLOSING_TAG.length),
  };
}

export function assertMemoryFile(text) {
  const { document } = splitFile(text);
  const seen = new Set();
  const re = /<mem id="(\d+)">/g;
  let m;
  while ((m = re.exec(document))) seen.add(parseInt(m[1], 10));
  if (seen.size !== SLOT_COUNT)
    throw new Error(`expected ${SLOT_COUNT} <mem> entries, found ${seen.size}`);
  for (let id = 0; id < SLOT_COUNT; id++)
    if (!seen.has(id)) throw new Error(`missing <mem id="${id}">`);
  return text;
}

function memRegion(text, slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT)
    throw new Error(`slot out of range 1..${SLOT_COUNT}: ${slot}`);
  const open = `<mem id="${slot - 1}">`;
  const start = text.indexOf(open);
  if (start === -1) throw new Error(`missing <mem id="${slot - 1}">`);
  const end = text.indexOf('</mem>', start);
  if (end === -1) throw new Error(`unterminated <mem id="${slot - 1}">`);
  return { bodyStart: start + open.length, bodyEnd: end };
}

export function getSlotBody(text, slot) {
  const { bodyStart, bodyEnd } = memRegion(text, slot);
  return text.substring(bodyStart, bodyEnd);
}

export function replaceSlotBody(text, slot, newBody) {
  const { bodyStart, bodyEnd } = memRegion(text, slot);
  return text.substring(0, bodyStart) + newBody + text.substring(bodyEnd);
}

export function getField(body, tag) {
  const matches = body.match(new RegExp(`<${tag}>(-?\\d+)</${tag}>`, 'g'));
  if (!matches || matches.length !== 1)
    throw new Error(`<${tag}> occurs ${matches ? matches.length : 0} times, expected exactly 1`);
  return parseInt(matches[0].slice(tag.length + 2), 10);
}

export function setField(body, tag, value) {
  if (!Number.isInteger(value)) throw new Error(`<${tag}>: integer value required, got ${value}`);
  getField(body, tag); // enforces exactly-one occurrence
  return body.replace(new RegExp(`<${tag}>-?\\d+</${tag}>`), `<${tag}>${value}</${tag}>`);
}

// --- slot names: 12 chars stored as decimal char codes in <C01>..<C12> ---

export function encodeName(name) {
  if (typeof name !== 'string' || name.length === 0)
    throw new Error('name must be a non-empty string');
  if (name.length > NAME_LENGTH)
    throw new Error(`name longer than ${NAME_LENGTH} characters: "${name}"`);
  if (!/^[\x20-\x7e]+$/.test(name))
    throw new Error(`name must be printable ASCII (the pedal display cannot show anything else): "${name}"`);
  return name.padEnd(NAME_LENGTH, ' ');
}

export function decodeName(body) {
  const codes = body.match(/<C\d\d>(\d+)<\/C\d\d>/g);
  if (!codes || codes.length !== NAME_LENGTH)
    throw new Error(`expected ${NAME_LENGTH} <Cxx> name entries, found ${codes ? codes.length : 0}`);
  return codes.map((c) => String.fromCharCode(parseInt(c.match(/>(\d+)</)[1], 10))).join('');
}

export function setName(body, name) {
  const padded = encodeName(name);
  const block = body.match(/<NAME>[\s\S]*?<\/NAME>/);
  if (!block) throw new Error('missing <NAME> block');
  let replacement = '<NAME>\n';
  for (let i = 0; i < NAME_LENGTH; i++) {
    const tag = 'C' + String(i + 1).padStart(2, '0');
    replacement += `\t<${tag}>${padded.charCodeAt(i)}</${tag}>\n`;
  }
  replacement += '</NAME>';
  return body.replace(block[0], replacement);
}

// --- trailer ---

export function tailMarker(text) {
  const { tail } = splitFile(text);
  if (tail.length < 4) return null;
  const last4 = tail.slice(-4);
  if (last4.charCodeAt(1) !== 0 || last4.charCodeAt(2) !== 0 || last4.charCodeAt(3) !== 0) return null;
  return last4.charCodeAt(0);
}

export function setTailMarker(text, fileNo) {
  const marker = TAIL_MARKERS[fileNo];
  if (!marker) throw new Error(`fileNo must be 1 or 2, got ${fileNo}`);
  if (tailMarker(text) === null)
    throw new Error('unrecognized trailer after </database>; refusing to rewrite it');
  return text.slice(0, -4) + String.fromCharCode(marker) + '\0\0\0';
}
