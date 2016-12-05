// VexFlow - Music Engraving for HTML5
// Copyright Mohit Muthanna 2010
//
// This class implements curves (for slurs)

import Vex from '@panarch/allegretto';
const Element = Vex.Flow.Element;
const Stem = Vex.Flow.Stem;

export class Curve extends Element {
  static get Position() {
    return {
      NEAR_HEAD: 1,
      NEAR_TOP: 2,
    };
  }

  static get PositionString() {
    return {
      nearHead: Curve.Position.NEAR_HEAD,
      nearTop: Curve.Position.NEAR_TOP,
    };
  }

  // from: Start note
  // to: End note
  // options:
  //    cps: List of control points
  //    x_shift: pixels to shift
  //    y_shift: pixels to shift
  constructor(from, to, options) {
    super();
    this.setAttribute('type', 'Curve');

    this.preFormatted = false;
    this.render_options = {
      thickness: 2,
      x_shift: 0,
      y_shift: 10,
      position: Curve.Position.NEAR_HEAD,
      position_end: Curve.Position.NEAR_HEAD,
      invert: false,
      cps: [{ x: 0, y: 10 }, { x: 0, y: 10 }],
    };

    Vex.Merge(this.render_options, options);
    this.setNotes(from, to);
  }

  setNotes(from, to) {
    if (!from && !to) {
      throw new Vex.RuntimeError(
        'BadArguments', 'Curve needs to have either first_note or last_note set.'
      );
    }

    this.from = from;
    this.to = to;
    return this;
  }

  /**
   * @return {boolean} Returns true if this is a partial bar.
   */
  isPartial() {
    return (!this.from || !this.to);
  }

  renderCurve() {
    const ctx = this.context;
    const cps = this.render_options.cps;

    const first_x = this.first_x;
    const first_y = this.first_y;
    const last_x = this.last_x;
    const last_y = this.last_y;
    const thickness = this.render_options.thickness;

    ctx.beginPath();
    ctx.moveTo(first_x, first_y);
    ctx.bezierCurveTo(
      first_x + cps[0].x,
      first_y + (cps[0].y * this.direction),
      last_x + cps[1].x,
      last_y + (cps[1].y * this.direction),
      last_x,
      last_y
    );
    ctx.bezierCurveTo(
      last_x + cps[1].x,
      last_y + ((cps[1].y + thickness) * this.direction),
      first_x + cps[0].x,
      first_y + ((cps[0].y + thickness) * this.direction),
      first_x,
      first_y
    );
    ctx.stroke();
    ctx.closePath();
    ctx.fill();
  }

  preFormat() {
    const first_note = this.from;
    const last_note = this.to;
    let first_x;
    let last_x;
    let first_y;
    let last_y;
    let stem_direction;

    let metric = 'baseY';
    let end_metric = 'baseY';

    function getPosition(position) {
      return typeof(position) === 'string'
        ? Curve.PositionString[position]
        : position;
    }
    const position = getPosition(this.render_options.position);
    const position_end = getPosition(this.render_options.position_end);

    if (position === Curve.Position.NEAR_TOP) {
      metric = 'topY';
      end_metric = 'topY';
    }

    if (position_end === Curve.Position.NEAR_HEAD) {
      end_metric = 'baseY';
    } else if (position_end === Curve.Position.NEAR_TOP) {
      end_metric = 'topY';
    }

    if (first_note) {
      stem_direction = first_note.getStemDirection();
      first_x = first_note.getTieRightX();
      first_y = first_note.getStemExtents()[metric];
      // --- UPDATED ---
      if (metric === 'topY' && stem_direction === Stem.DOWN) {
        first_x += first_note.getTieLeftX();
        first_x /= 2;
      }
    } else {
      first_x = last_note.getStave().getTieStartX();
      first_y = last_note.getStemExtents()[metric];
    }

    if (last_note) {
      stem_direction = last_note.getStemDirection();
      last_x = last_note.getTieLeftX();
      last_y = last_note.getStemExtents()[end_metric];
      // --- UPDATED ---
      if (end_metric === 'topY' && stem_direction === Stem.UP) {
        last_x += last_note.getTieRightX();
        last_x /= 2;
      }
    } else {
      last_x = first_note.getStave().getTieEndX();
      last_y = first_note.getStemExtents()[end_metric];
    }

    this.direction = stem_direction * (this.render_options.invert === true ? -1 : 1);
    const x_shift = this.render_options.x_shift;
    const y_shift = this.render_options.y_shift * this.direction;

    this.first_x = first_x + x_shift;
    this.first_y = first_y + y_shift;
    this.last_x = last_x - x_shift;
    this.last_y = last_y + y_shift;
    this.preFormatted = true;
  }

  draw() {
    if (!this.preFormatted) this.preFormat();
    this.checkContext();
    this.setRendered();
    this.renderCurve();
    return true;
  }
}

Vex.Flow.Curve = Curve;
