// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon
import Note from './Note';

export default class ClefNote extends Note {
  constructor(clef) {
    super(clef);
    this.sign = clef.sign;
    this.line = clef.line;
    this.clefOctaveChange = clef.clefOctaveChange;
  }

  getSign() { return this.sign; }
  getLine() { return this.line; }
  getClefOctaveChange() { return this.clefOctaveChange; }
}
