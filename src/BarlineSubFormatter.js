import Vex from '@panarch/allegretto';
const VF = Vex.Flow;

import { hasSameContents } from './Util';

export const getVFBarlineType = barline => {
  const Barline = VF.Barline;

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

export default class BarlineSubFormatter {
  constructor({ formatter, score }) {
    this.formatter = formatter;
    this.score = score;
  }

  // formatBarline -> _formatVolta
  _formatVolta(measures) {
    let onVolta = false;

    for (const measure of measures) {
      const barline = measure.getBarline();

      let type;
      let text;
      if (onVolta && barline.right && barline.right.ending) {
        const ending = barline.right.ending;
        if (ending.type === 'discontinue') {
          type = VF.Volta.type.MID;
        } else { // stop
          type = VF.Volta.type.END;
        }

        onVolta = false;
      } else if (!onVolta && barline.left && barline.left.ending
          && barline.right && barline.right.ending) {
        const types = [barline.left.ending.type, barline.right.ending.type];

        if (hasSameContents(types, ['start', 'discontinue'])) {
          type = VF.Volta.type.BEGIN;
        } else if (hasSameContents(types, ['start', 'stop'])) {
          type = VF.Volta.type.BEGIN_END;
        } else if (hasSameContents(types, ['discontinue', 'stop'])) {
          type = VF.Volta.type.END;
        } else { // ['discontinue', 'discontinue']
          type = VF.Volta.type.MID;
        }

        text = barline.left.ending.text;
      } else if (!onVolta && barline.left && barline.left.ending) {
        const ending = barline.left.ending;
        if (ending.type === 'start') {
          type = VF.Volta.type.BEGIN;
        } else if (ending.type === 'discontinue') {
          type = VF.Volta.type.MID;
        }

        text = ending.text;
        onVolta = true;
      } else if (onVolta) {
        type = VF.Volta.type.MID;
      }

      const vfStave = measure.getStaves()[0];
      if (vfStave && type) {
        //vfStave.setVoltaType(type, text, 0);
        vfStave.modifiers.push(new VF.Volta(type, text, vfStave.x, 20));
      }
    }
  }

  formatBarline() {
    const parts = this.score.getParts();
    parts.forEach(part => part.getMeasures().forEach(measure => {
      const barline = measure.getBarline();
      const vfStaves = measure.getStaves();

      if (barline.left) {
        const vfBarlineType = getVFBarlineType(barline.left);
        vfStaves.forEach(vfStave => vfStave.setBegBarType(vfBarlineType));
      }

      if (barline.right) {
        const vfBarlineType = getVFBarlineType(barline.right);
        vfStaves.forEach(vfStave => vfStave.setEndBarType(vfBarlineType));
      }

    }));

    parts.forEach(part => {
      const measures = part.getMeasures();
      this._formatVolta(measures);
    });
  }
}
