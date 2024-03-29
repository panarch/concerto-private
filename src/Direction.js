// Copyright (c) Taehoon Moon 2016
// @author Taehoon Moon

export default class Direction {
  static get LineHeight() {
    return {
      'dynamics': 2,
      'wedge': 3,
      'words': 2,
      'octave-shift': 2,
      'segno': 3,
      'coda': 3,
      'harmony': 3,
    };
  }

  constructor({ tag, directionType, wedge, wordsList, octaveShift, harmony,
      staff, voice, placement, beginDuration, dynamicType, defaultX }) {
    this.tag = tag;
    this.directionType = directionType;
    this.staff = staff;
    this.voice = voice;
    this.placement = placement;

    this.wedge = wedge;
    this.wordsList = wordsList;
    this.dynamicType = dynamicType;
    this.octaveShift = octaveShift;
    this.harmony = harmony;

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
    this.vfOptions = null; // font, etc...
    this.nextDirection = null;
    this.offset = null; // Temp value for DirectionSubFormatter
  }

  clone() {
    return new Direction({
      tag: this.tag,
      directionType: this.directionType,
      staff: this.staff,
      placement: this.placement,
      wedge: Object.assign({}, this.wedge),
      octaveShift: Object.assign({}, this.octaveShift),
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
  getOctaveShift() { return this.octaveShift; }
  getHarmony() { return this.harmony; }

  getContent() {
    switch (this.directionType) {
      case 'wedge': return this.wedge;
      case 'words': return this.wordsList;
      case 'dynamics': return this.dynamicType;
      case 'octave-shift': return this.octaveShift;
      case 'harmony': return this.harmony;
    }
  }

  getLineHeight() {
    return Direction.LineHeight[this.directionType];
  }

  getBeginDuration() { return this.beginDuration; }
  setBeginDuration(beginDuration) { this.beginDuration = beginDuration; }

  // extra read-only
  getDefaultX() { return this.defaultX; }

  // get full duration of direction; including next direction's duration
  getFullDuration() {
    const nextDirection = this.getNextDirection();
    return this.duration +
      (nextDirection ? nextDirection.getFullDuration() : 0);
  }

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
  getOffset() { return this.offset; }
  setOffset(offset) { this.offset = offset; }
  getVFNote() { return this.vfNote; }
  setVFNote(vfNote) { this.vfNote = vfNote; }
  getVFEndNote() { return this.vfEndNote; }
  setVFEndNote(vfEndNote) { this.vfEndNote = vfEndNote; }
  getVFElement() { return this.vfElement; }
  setVFElement(vfElement) { this.vfElement = vfElement; }
  getVFOptions() { return this.vfOptions; }
  setVFOptions(vfOptions) { this.vfOptions = vfOptions; }
}
