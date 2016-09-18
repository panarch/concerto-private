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
  if (!divisions) {
    console.error('[Util.getVFDuration] No divisions')
    return;
  }

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

export const getVFBarlineType = barline => {
  const Barline = Vex.Flow.Barline;

  if (barline.repeat) {
    return barline.repeat.direction === 'forward' ?
      Barline.type.REPEAT_BEGIN : Barline.type.REPEAT_END;
  }

  // regular, dotted, dashed, heavy, light-light, light-heavy, heavy-light, heavy-heavy
  switch (barline.barStyle) {
    case 'light-light':
      return Barline.type.DOUBLE;
    case 'heavy':
    case 'light-heavy':
      return Barline.type.END;
  }

  return Barline.type.SINGLE;
};

export const convertVFBarlineTypeToVFConnectorType = (vfBarlineType, isLeft) => {
  const Barline = Vex.Flow.Barline;
  const StaveConnector = Vex.Flow.StaveConnector;

  switch (vfBarlineType) {
    case Barline.type.DOUBLE:
      return StaveConnector.type.THIN_DOUBLE;
    case Barline.type.END:
    case Barline.type.REPEAT_END:
      return StaveConnector.type.BOLD_DOUBLE_RIGHT;
    case Barline.type.REPEAT_BEGIN:
      return StaveConnector.type.BOLD_DOUBLE_LEFT;
  }

  return isLeft ? StaveConnector.type.SINGLE_LEFT : StaveConnector.type.SINGLE_RIGHT;
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

// notes -> integer
export function sumNotesDuration(notes) {
  return notes.reduce(
    (duration, note) => duration + (note.duration ? note.duration : 0),
    0
  );
}

// notesMap -> integer
export function getMaxDuration(notesMap) {
  return [...notesMap.values()].reduce(
    (max, notes) => {
      const sum = sumNotesDuration(notes);
      return max > sum ? max : sum;
    },
    0
  );
}

export function getLineGenerator(part) {
  function* lineGenerator() {
    const measures = part.getMeasures();
    let lineMeasures = [];

    for (let mi = 0; mi < measures.length; mi++) {
      const measure = measures[mi];

      if (mi > 0 && measure.isNewLineStarting()) {
        yield lineMeasures;
        lineMeasures = [measure];
      } else {
        lineMeasures.push(measure);
      }
    }

    if (lineMeasures.length > 0) yield lineMeasures;
  }

  return lineGenerator();
}

export default {
  getVFClef,
  getVFDuration,
  getVFKeySignature,
  getVFConnectorType,
  Stack,
  sumNotesDuration,
  getMaxDuration,
  getLineGenerator,
};
