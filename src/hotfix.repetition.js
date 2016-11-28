import Vex from '@panarch/allegretto';
const Repetition = Vex.Flow.Repetition;
const Glyph = Vex.Flow.Glyph;

/*
Vex.Flow.Repetition.type = {
  NONE: 1,         // no coda or segno
  CODA_LEFT: 2,    // coda at beginning of stave
  CODA_RIGHT: 3,   // coda at end of stave
  SEGNO_LEFT: 4,   // segno at beginning of stave
  SEGNO_RIGHT: 5,  // segno at end of stave
  DC: 6,           // D.C. at end of stave
  DC_AL_CODA: 7,   // D.C. al coda at end of stave
  DC_AL_FINE: 8,   // D.C. al Fine end of stave
  DS: 9,           // D.S. at end of stave
  DS_AL_CODA: 10,  // D.S. al coda at end of stave
  DS_AL_FINE: 11,  // D.S. al Fine at end of stave
  FINE: 12,        // Fine at end of stave
  TO_CODA: 13,
};
*/

Vex.Flow.Repetition.prototype.drawCodaFixed = function(stave, x) {
  const y = stave.getYForTopText(stave.options.num_lines) + this.y_shift;
  Glyph.renderGlyph(stave.context, this.x + x + this.x_shift, y, 40, 'v4d', true);
  // y + 25 => y
  return this;
}

Vex.Flow.Repetition.prototype.drawSignoFixed = function(stave, x) {
  const y = stave.getYForTopText(stave.options.num_lines) + this.y_shift;
  Glyph.renderGlyph(stave.context, this.x + x + this.x_shift, y, 30, 'v8c', true);
  return this;
}

Vex.Flow.Repetition.prototype.drawSymbolText = function(stave, x, text, draw_coda) {
  const ctx = stave.checkContext();

  ctx.save();
  ctx.setFont(this.font.family, this.font.size, this.font.weight);
    // Default to right symbol
  let text_x = 0 + this.x_shift;
  let symbol_x = x + this.x_shift;
  if (this.symbol_type === Repetition.type.CODA_LEFT) {
      // Offset Coda text to right of stave beginning
    text_x = this.x + stave.options.vertical_bar_width;
    symbol_x = text_x + ctx.measureText(text).width + 12;
  } else {
      // Offset Segno text to left stave end
    symbol_x = this.x + stave.width - 5 + this.x_shift;
    text_x = symbol_x - ctx.measureText(text).width - 12;
  }

  const y = stave.getYForTopText(stave.options.num_lines) + this.y_shift;
  if (draw_coda) {
    Glyph.renderGlyph(ctx, symbol_x, y, 40, 'v4d', true);
  } else {
    text_x += 17;
  }

  ctx.fillText(text, text_x, y + 5);
  ctx.restore();

  return this;
}

Vex.Flow.Repetition.prototype.draw = function draw(stave, x) {
  this.setRendered();

  switch (this.symbol_type) {
    case Repetition.type.CODA_RIGHT:
      this.drawCodaFixed(stave, x + stave.width);
      break;
    case Repetition.type.CODA_LEFT:
      //this.drawSymbolText(stave, x, 'Coda', true);
      this.drawCodaFixed(stave, x);
      break;
    case Repetition.type.SEGNO_LEFT:
      this.drawSignoFixed(stave, x);
      break;
    case Repetition.type.SEGNO_RIGHT:
      this.drawSignoFixed(stave, x + stave.width);
      break;
    case Repetition.type.DC:
      this.drawSymbolText(stave, x, 'D.C.', false);
      break;
    case Repetition.type.DC_AL_CODA:
      this.drawSymbolText(stave, x, 'D.C. al', true);
      break;
    case Repetition.type.DC_AL_FINE:
      this.drawSymbolText(stave, x, 'D.C. al Fine', false);
      break;
    case Repetition.type.DS:
      this.drawSymbolText(stave, x, 'D.S.', false);
      brea;
    case Repetition.type.DS_AL_CODA:
      this.drawSymbolText(stave, x, 'D.S. al', true);
      break;
    case Repetition.type.DS_AL_FINE:
      this.drawSymbolText(stave, x, 'D.S. al Fine', false);
      break;
    case Repetition.type.FINE:
      this.drawSymbolText(stave, x, 'Fine', false);
      break;
    case 'to_coda':
      this.drawSymbolText(stave, x, 'To Coda', false);
    default:
      break;
  }

  return this;
};
