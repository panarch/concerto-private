/*
 * hotfix script
 */

import Vex from '@panarch/allegretto';

const TextDynamics = Vex.Flow.TextDynamics;
Vex.Flow.TextDynamics.prototype.preFormat = function preFormat() {
  if (this.preFormatted) return this; // ADDED

  this.glyphs = []; // ADDED
  let total_width = 0;
  // Iterate through each letter
  this.sequence.split('').forEach(letter => {
    // Get the glyph data for the letter
    const glyph_data = TextDynamics.GLYPHS[letter];
    if (!glyph_data) throw new Vex.RERR('Invalid dynamics character: ' + letter);

    const size =  this.render_options.glyph_font_size;
    const glyph = new Glyph(glyph_data.code, size);

    // Add the glyph
    this.glyphs.push(glyph);

    total_width += glyph_data.width;
  });

  // Store the width of the text
  this.setWidth(total_width);
  this.preFormatted = true;
  return this;
};

//TODO: remove after PR merged
Vex.Flow.BoundingBox.prototype.mergeWith = function mergeWith(boundingBox, ctx) {
  const that = boundingBox;

  const new_x = this.x < that.x ? this.x : that.x;
  const new_y = this.y < that.y ? this.y : that.y;
  const new_w = Math.max(this.x + this.w, that.x + that.w) - new_x;
  const new_h = Math.max(this.y + this.h, that.y + that.h) - new_y;

  this.x = new_x;
  this.y = new_y;
  this.w = new_w;
  this.h = new_h;

  if (ctx) this.draw(ctx);
  return this;
};

// Get the bounding box for the voice
Vex.Flow.Voice.prototype.getBoundingBox = function getBoundingBox() {
  //let stave;
  let boundingBox;
  let bb;
  let i;

  if (!this.boundingBox) {
    //if (!this.stave) throw new Vex.RERR('NoStave', "Can't get bounding box without stave.");
    //stave = this.stave;
    boundingBox = null;

    for (i = 0; i < this.tickables.length; ++i) {
      //this.tickables[i].setStave(stave);

      bb = this.tickables[i].getBoundingBox();
      if (!bb) continue;

      boundingBox = boundingBox ? boundingBox.mergeWith(bb) : bb;
    }

    this.boundingBox = boundingBox;
  }

  return this.boundingBox;
};

// StaveConnector
function drawBoldDoubleLine(ctx, type, topX, topY, botY) {
  if (
    type !== StaveConnector.type.BOLD_DOUBLE_LEFT &&
    type !== StaveConnector.type.BOLD_DOUBLE_RIGHT
  ) {
    throw new Vex.RERR(
      'InvalidConnector', 'A REPEAT_BEGIN or REPEAT_END type must be provided.'
    );
  }

  let x_shift = 3;
  let variableWidth = 3.5; // Width for avoiding anti-aliasing width issues
  const thickLineOffset = 2; // For aesthetics

  if (type === StaveConnector.type.BOLD_DOUBLE_RIGHT) {
    x_shift = -5; // Flips the side of the thin line
    variableWidth = 3;
  }

  // Thin line
  ctx.fillRect(topX + x_shift, topY, 1, botY - topY);
  // Thick line
  ctx.fillRect(topX - thickLineOffset, topY, variableWidth, botY - topY);
}

const Glyph = Vex.Flow.Glyph;
const StaveConnector = Vex.Flow.StaveConnector;
Vex.Flow.StaveConnector.prototype.draw = function draw() {
  if (!this.ctx) {
    throw new Vex.RERR('NoContext', "Can't draw without a context.");
  }

  let topY = this.top_stave.getYForLine(0);
  let botY = this.bottom_stave.getYForLine(this.bottom_stave.getNumLines() - 1) +
    this.thickness;
  let width = this.width;
  let topX = this.top_stave.getX() + this.x_shift;

  const isRightSidedConnector = (
    this.type === StaveConnector.type.SINGLE_RIGHT ||
    this.type === StaveConnector.type.BOLD_DOUBLE_RIGHT ||
    this.type === StaveConnector.type.THIN_DOUBLE
  );

  if (isRightSidedConnector) {
    topX += this.top_stave.width;
  }

  let attachment_height = botY - topY;
  switch (this.type) {
    case StaveConnector.type.SINGLE:
      width = 1;
      break;
    case StaveConnector.type.SINGLE_LEFT:
      width = 1;
      break;
    case StaveConnector.type.SINGLE_RIGHT:
      width = 1;
      break;
    case StaveConnector.type.DOUBLE:
      topX -= (this.width + 2);
      break;
    case StaveConnector.type.BRACE: {
      width = 12;
      // May need additional code to draw brace
      const x1 = this.top_stave.getX() - 2;
      const y1 = topY;
      const x3 = x1;
      const y3 = botY;
      const x2 = x1 - width;
      const y2 = y1 + attachment_height / 2.0;
      const cpx1 = x2 - (0.90 * width);
      const cpy1 = y1 + (0.2 * attachment_height);
      const cpx2 = x1 + (1.10 * width);
      const cpy2 = y2 - (0.135 * attachment_height);
      const cpx3 = cpx2;
      const cpy3 = y2 + (0.135 * attachment_height);
      const cpx4 = cpx1;
      const cpy4 = y3 - (0.2 * attachment_height);
      const cpx5 = x2 - width;
      const cpy5 = cpy4;
      const cpx6 = x1 + (0.40 * width);
      const cpy6 = y2 + (0.135 * attachment_height);
      const cpx7 = cpx6;
      const cpy7 = y2 - (0.135 * attachment_height);
      const cpx8 = cpx5;
      const cpy8 = cpy1;
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, x2, y2);
      this.ctx.bezierCurveTo(cpx3, cpy3, cpx4, cpy4, x3, y3);
      this.ctx.bezierCurveTo(cpx5, cpy5, cpx6, cpy6, x2, y2);
      this.ctx.bezierCurveTo(cpx7, cpy7, cpx8, cpy8, x1, y1);
      this.ctx.fill();
      this.ctx.stroke();
      break;
    } case StaveConnector.type.BRACKET:
      topY -= 4;
      botY += 4;
      attachment_height = botY - topY;
      Glyph.renderGlyph(this.ctx, topX - 5, topY - 3, 40, 'v1b', true);
      Glyph.renderGlyph(this.ctx, topX - 5, botY + 3, 40, 'v10', true);
      topX -= (this.width + 2);
      break;
    case StaveConnector.type.BOLD_DOUBLE_LEFT:
      drawBoldDoubleLine(this.ctx, this.type, topX, topY, botY);
      break;
    case StaveConnector.type.BOLD_DOUBLE_RIGHT:
      drawBoldDoubleLine(this.ctx, this.type, topX, topY, botY);
      break;
    case StaveConnector.type.THIN_DOUBLE:
      width = 1;
      break;
    case StaveConnector.type.NONE:
      break;
    default:
      throw new Vex.RERR(
        'InvalidType', `The provided StaveConnector.type (${this.type}) is invalid`
      );
  }

  if (
    this.type !== StaveConnector.type.BRACE &&
    this.type !== StaveConnector.type.BOLD_DOUBLE_LEFT &&
    this.type !== StaveConnector.type.BOLD_DOUBLE_RIGHT &&
    this.type !== StaveConnector.type.NONE
  ) {
    this.ctx.fillRect(topX, topY, width, attachment_height);
  }

  // If the connector is a thin double barline, draw the paralell line
  if (this.type === StaveConnector.type.THIN_DOUBLE) {
    this.ctx.fillRect(topX - 3, topY, width, attachment_height);
  }

  this.ctx.save();
  this.ctx.lineWidth = 2;
  this.ctx.setFont(this.font.family, this.font.size, this.font.weight);
  // Add stave connector text
  for (let i = 0; i < this.texts.length; i++) {
    const text = this.texts[i];
    const text_width = this.ctx.measureText('' + text.content).width;
    const x = this.top_stave.getX() - text_width - 24 + text.options.shift_x;
    const y = (this.top_stave.getYForLine(0) + this.bottom_stave.getBottomLineY()) / 2 +
      text.options.shift_y;

    this.ctx.fillText('' + text.content, x, y + 4);
  }
  this.ctx.restore();

}
