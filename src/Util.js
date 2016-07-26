// Copyright (c) Taehoon Moon 2016.
// @author Taehoon Moon

import Vex from '@panarch/allegretto';
import Table from './Table';

export const getVFClef = clef => {
  if (clef === undefined) return;

  let vfClef;
  switch (clef.sign) {
    case 'G':
    case 'C':
    case 'F':
      vfClef = Table.VF_CLEF[`${clef.sign}/${clef.line}`];
      break;
    default:
      vfClef = Table.VF_CLEF[clef.sign];
  }

  return vfClef;
};

export const getVFDuration = (note, divisions) => {
  const type = note.getType();
  let duration;

  if (type) {
    duration = Table.VF_NOTE_TYPE_MAP.get(type);
    duration += 'd'.repeat(note.getDot());
  } else if (note.getFull()) {
    duration = 'w';
  } else {
    let d = note.getDuration();
    let i = Math.floor(Math.log2(d / divisions));
    duration = Table.VF_NOTE_TYPES[i + Table.NOTE_QUARTER_INDEX];

    for (; i < 3; i++) {
      d -= divisions / Math.pow(2, -i);
      if (d <= 0) break;

      duration += 'd';
    }
  }

  if (note.getRest()) duration += 'r';

  return duration;
};

export const getVFKeySignature = keySig => {
  if (keySig === undefined) return;

  const fifths = keySig.fifths;
  const keySpecs = Vex.Flow.keySignature.keySpecs;

  let vfKey;
  Object.keys(keySpecs).forEach(key => {
    const { acc, num } = keySpecs[key];
    if (/m/.test(key) || Math.abs(fifths) !== num) return;

    if (fifths === 0 ||
        (fifths > 0 && acc === '#') ||
        (fifths < 0 && acc === 'b')) {
      vfKey = key;
    }
  });

  return vfKey;
};

export const getVFConnectorType = groupSymbol => {
  let connectorType;
  switch (groupSymbol) {
    case 'brace':
      connectorType = Vex.Flow.StaveConnector.type.BRACE;
      break;
    case 'bracket':
      connectorType = Vex.Flow.StaveConnector.type.BRACKET;
      break;
      case 'line':
    default:
      connectorType = Vex.Flow.StaveConnector.type.DOUBLE;
  }

  return connectorType;
};

export const getVFJustification = justify => {
  const Justification = Vex.Flow.TextNote.Justification;
  switch (justify) {
    case 'left':  return Justification.LEFT;
    case 'right': return Justification.RIGHT;
  }

  return Justification.CENTER;
};

export const splitVFDuration = vfDuration => {
  const [type, dot] = /^([whqb0-9]{1,2})(d*)$/.exec(vfDuration).slice(1, 3);

  return String(Number(Vex.Flow.sanitizeDuration(type)) * 2) + dot;
}

export class Stack {
  constructor() { this.items = []; }
  push(item) { this.items.splice(0, 0, item); }
  pop() { return this.items.splice(0, 1)[0]; }
  top() { return this.items[0]; }
  clear() { this.items = []; }
  empty() { return this.items.length === 0; }
}

export default {
  getVFClef,
  getVFDuration,
  getVFKeySignature,
  getVFConnectorType,
  Stack,
};
