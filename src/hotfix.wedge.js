import Vex from '@panarch/allegretto';

// New class!
class Wedge extends Vex.Flow.Element {
  constructor({ beginNote, beginStave, beginHeight,
      endNote, endStave, endHeight, line }) {
    super();

    this.beginNote = beginNote;
    this.beginStave = beginStave;
    this.beginHeight = beginHeight;
    this.endNote = endNote;
    this.endStave = endStave;
    this.endHeight = endHeight;
    this.line = line;
  }

  setLine(line) {
    this.line = line;
  }

  draw() {
    const ctx = this.context;
    const stave = this.beginStave || this.endStave || (
      this.beginNote ? this.beginNote.getStave() : this.endNote.getStave()
    );
    const y = stave.getYForLine(this.line);
    const beginH = this.beginHeight / 2;
    const endH = this.endHeight / 2;
    const beginX = this.beginNote ?
      this.beginNote.getAbsoluteX() :
      this.beginStave.getX() + 10;
    const endX = -10 + (
      this.endNote ?
        this.endNote.getAbsoluteX() :
        this.endStave.getX() + this.endStave.getWidth()
    );

    ctx.beginPath();
    ctx.moveTo(beginX, y - beginH);
    ctx.lineTo(endX, y - endH);
    ctx.moveTo(beginX, y + beginH);
    ctx.lineTo(endX, y + endH);
    ctx.stroke();
    ctx.closePath();
  }
}

Vex.Flow.Wedge = Wedge;
