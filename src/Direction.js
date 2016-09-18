// Copyright (c) Taehoon Moon 2016
// @author Taehoon Moon

export default class Direction {
  constructor({ tag, staff, placement, beginDuration, dynamicType, defaultX }) {
    this.tag = tag;
    this.staff = staff;
    this.placement = placement;
    this.dynamicType = dynamicType;

    // mutable
    this.beginDuration = beginDuration;

    // extra read-only
    this.defaultX = defaultX;

    // variables
    this.duration = null;
    this.maxLine = null; // line: VexFlow Stave line number
    this.minLine = null;
    this.vfNote = null; // TextNote, TextDynamics, ...
    this.vfElement = null; // Crescendo
  }

  // Note interface
  getType() { return null; }
  getFull() { return null; }
  getRest() { return null; }

  getTag() { return this.tag; }
  getStaff() { return this.staff; }
  getPlacement() { return this.placement ? this.placement : 'above'; }
  getDynamicType() { return this.dynamicType; }

  getBeginDuration() { return this.beginDuration; }
  setBeginDuration(beginDuration) { this.beginDuration = beginDuration; }

  // extra read-only
  getDefaultX() { return this.defaultX; }

  getDuration() { return this.duration; }
  setDuration(duration) { this.duration = duration; }
  getMaxLine() { return this.maxLine; }
  setMaxLine(maxLine) { this.maxLine = maxLine; }
  getMinLine() { return this.minLine; }
  setMinLine(minLine) { this.minLine = minLine; }
  getVFNote() { return this.vfNote; }
  setVFNote(vfNote) { this.vfNote = vfNote; }
  getVFElement() { return this.vfElement; }
  setVFElement(vfElement) { this.vfElement = vfElement; }
}
