// Copyright (c) Taehoon Moon 2016
// @author Taehoon Moon

export default class Direction {
  constructor({ tag, directionType, wedge, wordsList,
      staff, voice, placement, beginDuration, dynamicType, defaultX }) {
    this.tag = tag;
    this.directionType = directionType;
    this.staff = staff;
    this.voice = voice;
    this.placement = placement;

    this.wedge = wedge;
    this.wordsList = wordsList;
    this.dynamicType = dynamicType;

    // mutable
    this.beginDuration = beginDuration;

    // extra read-only
    this.defaultX = defaultX;

    // variables
    this.duration = null;
    this.line = null; // line: VexFlow Stave line number
    this.maxLine = null;
    this.minLine = null;
    this.vfNote = null; // TextNote, TextDynamics, ...
    this.vfEndNote = null; // it is for Crescendo etc...
    this.vfElement = null; // Crescendo (VF StaveHairpin)
    this.nextDirection = null;
  }

  clone() {
    return new Direction({
      tag: this.tag,
      directionType: this.directionType,
      staff: this.staff,
      placement: this.placement,
      wedge: Object.assign({}, this.wedge),
      dynamicType: this.dynamicType,
      beginDuration: this.beginDuration,
      defaultX: this.defaultX,
    });
  }

  // Note interface
  getType() { return null; }
  getFull() { return null; }
  getRest() { return null; }

  getTag() { return this.tag; }
  getDirectionType() { return this.directionType; }
  getStaff() { return this.staff; }
  getVoice() { return this.voice; }
  getPlacement() { return this.placement ? this.placement : 'above'; }

  getWedge() { return this.wedge; }
  getWordsList() { return this.wordsList; }
  getDynamicType() { return this.dynamicType; }

  getBeginDuration() { return this.beginDuration; }
  setBeginDuration(beginDuration) { this.beginDuration = beginDuration; }

  // extra read-only
  getDefaultX() { return this.defaultX; }

  getDuration() { return this.duration; }
  setDuration(duration) { this.duration = duration; }
  getLine() { return this.line; }
  setLine(line) { this.line = line; }
  getMaxLine() { return this.maxLine; }
  setMaxLine(maxLine) { this.maxLine = maxLine; }
  getMinLine() { return this.minLine; }
  setMinLine(minLine) { this.minLine = minLine; }
  getNextDirection() { return this.nextDirection; }
  setNextDirection(direction) { this.nextDirection = direction; }
  getVFNote() { return this.vfNote; }
  setVFNote(vfNote) { this.vfNote = vfNote; }
  getVFEndNote() { return this.vfEndNote; }
  setVFEndNote(vfEndNote) { this.vfEndNote = vfEndNote; }
  getVFElement() { return this.vfElement; }
  setVFElement(vfElement) { this.vfElement = vfElement; }
}
