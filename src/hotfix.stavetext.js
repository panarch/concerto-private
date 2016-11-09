import Vex from '@panarch/allegretto';
// [VexFlow](http://vexflow.com) - Copyright (c) Mohit Muthanna 2010.
// Author Taehoon Moon 2014

const StaveModifier = Vex.Flow.StaveModifier;

export class StaveText extends StaveModifier {
  static get CATEGORY() { return 'stavetext'; }

  static get Justification() {
    return {
      LEFT: 1,
      CENTER: 2,
      RIGHT: 3,
    };
  }

  constructor({ text, position, options, line }) {
    super();
    this.setAttribute('type', 'StaveText');

    this.setWidth(16);
    this.line = line;
    this.text = text;
    this.position = position;
    this.options = {
      shift_x: 0,
      shift_y: 0,
      justification: StaveText.Justification.CENTER,
    };
    Vex.Merge(this.options, options);

    this.font = {
      family: 'times',
      size: 16,
      weight: 'normal',
    };
  }

  getCategory() { return StaveText.CATEGORY; }
  setShiftX(x) { this.shift_x = x; return this; }
  setShiftY(y) { this.shift_y = y; return this; }
  setText(text) { this.text = text; return this; }
  setLine(line) { this.line = line; return this; }
  setFont(font) { Vex.Merge(this.font, font); return this; }

  setJustification(justification) {
    this.justification = justification;
    return this;
  }

  draw(stave) {
    if (!stave) stave = this.stave;

    const ctx = stave.checkContext();
    this.setRendered();

    ctx.save();
    ctx.lineWidth = 2;
    ctx.setFont(this.font.family, this.font.size, this.font.weight);
    const text_width = ctx.measureText('' + this.text).width;

    let x;
    let y;
    const Position = StaveModifier.Position;
    const Justification = StaveText.Justification;
    switch (this.position) {
      case Position.LEFT:
      case Position.RIGHT:
        y = (stave.getYForLine(0) + stave.getBottomLineY()) / 2 + this.options.shift_y;
        if (this.position === Position.LEFT) {
          x = stave.getX() - text_width - 24 + this.options.shift_x;
        } else {
          x = stave.getX() + stave.getWidth() + 24 + this.options.shift_x;
        }
        break;
      case Position.ABOVE:
      case Position.BELOW:
        x = stave.getX() + this.options.shift_x;
        if (this.options.justification === Justification.CENTER) {
          x += stave.getWidth() / 2 - text_width / 2;
        } else if (this.options.justification === Justification.RIGHT) {
          x += stave.getWidth() - text_width;
        }

        if (this.line) {
          y = stave.getYForLine(this.line);
        } else if (this.position === Position.ABOVE) {
          y = stave.getYForTopText(2);
        } else {
          y = stave.getYForBottomText(2);
        }

        y += this.options.shift_y;
        break;
      default:
        throw new Vex.RERR('InvalidPosition', 'Value Must be in StaveModifier.Position.');
    }

    ctx.fillText('' + this.text, x, y + 4);
    ctx.restore();
    return this;
  }
}

Vex.Flow.StaveText = StaveText;
