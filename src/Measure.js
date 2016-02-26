// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon

export default class Measure {
  constructor({ number, width, voices, staffs, notesMap, key, time, clefMap, print, divisions,
      leftBarline, rightBarline, staffDetailsMap } = {}) {
    this.number = number;
    this.width = width;
    this.voices = voices;
    this.staffs = staffs;
    this.notesMap = notesMap;
    this.key = key;
    this.time = time;
    this.clefMap = clefMap;
    this.print = print;
    this.divisions = divisions;
    this.leftBarline = leftBarline;
    this.rightBarline = rightBarline;
    this.staffDetailsMap = staffDetailsMap;

    // variables
    this.x = null;
    this.y = null;
    this.staveMap = new Map();
    this.staffYMap = new Map();
    this.staffDisplayedMap = new Map();
    this.vfVoiceMap = new Map(); // voice -> vfVoice
    this.vfBeamsMap = new Map(); // voice -> vfBeams
  }

  getPrint() { return this.print; }
  hasPrint() {
    return this.print ? true : false;
  }

  hasNewSystem() {
    return this.print && this.print.newSystem ? true : false;
  }

  hasNewPage() {
    return this.print && this.print.newPage ? true : false;
  }

  hasTopSystemDistance() {
    const systemLayout = this.getSystemLayout();
    return systemLayout && systemLayout.topSystemDistance !== undefined;
  }

  hasSystemDistance() {
    const systemLayout = this.getSystemLayout();
    return systemLayout && systemLayout.systemDistance !== undefined;
  }

  hasStaffDistances() {
    const staffLayoutMap = this.getStaffLayoutMap();
    return staffLayoutMap && staffLayoutMap.size > 0;
  }

  isNewLineStarting() {
    return this.hasPrint() && (this.hasNewSystem() || this.hasNewPage());
  }

  isStaffDisplayed(staff = 1, defaultValue = true) {
    if (this.staffDisplayedMap.has(staff)) return this.staffDisplayedMap.get(staff);

    const staffDetails = this.staffDetailsMap.get(staff);
    return staffDetails && staffDetails.printObject !== undefined ?
      staffDetails.printObject :
      defaultValue;
  }

  setStaffDisplayed(staff = 1, displayed) {
    this.staffDisplayedMap.set(staff, displayed);
  }

  getWidth() { return this.width; }

  getHeight(numStaffs = 1, staffDistance = Measure.STAFF_DISTANCE) {
    let _numStaffs = 0;
    for (let staff = 1; staff <= numStaffs; staff++) {
      if (this.isStaffDisplayed(staff))
        _numStaffs++;
    }

    return Measure.STAFF_HEIGHT * _numStaffs +
      staffDistance * (Math.max(_numStaffs - 1, 0));
  }

  getNumStaffs() {
    const staffLayoutMap = this.getStaffLayoutMap();
    return Math.max(
      this.staffs.length,
      staffLayoutMap ? staffLayoutMap.size : 1
    );
  }

  getSystemLayout() {
    return this.print && this.print.systemLayout ?
      this.print.systemLayout :
      undefined;
  }

  getStaffLayoutMap() {
    return this.print && this.print.staffLayoutMap ?
      this.print.staffLayoutMap :
      undefined;
  }

  getLeftMargin(defaultValue = Measure.LEFT_MARGIN) {
    const systemLayout = this.getSystemLayout();
    return systemLayout && systemLayout.systemMargins ?
      systemLayout.systemMargins.leftMargin :
      defaultValue;
  }

  getRightMargin(defaultValue = Measure.RIGHT_MARGIN) {
    const systemLayout = this.getSystemLayout();
    return systemLayout && systemLayout.systemMargins ?
      systemLayout.systemMargins.rightMargin :
      defaultValue;
  }

  getTopSystemDistance(defaultValue = Measure.TOP_SYSTEM_DISTANCE) {
    return this.hasTopSystemDistance() ?
      this.getSystemLayout().topSystemDistance :
      defaultValue;
  }

  getSystemDistance(defaultValue = Measure.SYSTEM_DISTANCE) {
    return this.hasSystemDistance() ?
      this.getSystemLayout().systemDistance :
      defaultValue;
  }

  getStaffDistance(staff = 1, defaultValue = Measure.STAFF_DISTANCE) {
    return this.hasStaffDistances() ?
      this.getStaffLayoutMap().get(staff).staffDistance :
      defaultValue;
  }

  getX() { return this.x; }
  setX(x) { this.x = x; }

  getY() { return this.y; }
  setY(y) { this.y = y; }

  getPosition() {
    return {
      x: this.x,
      y: this.y,
    };
  }

  setPosition({ x, y }) {
    this.x = x;
    this.y = y;
  }

  getStaffY(staff = 1) { return this.staffYMap.get(staff); }
  setStaffY(staff, y) { this.staffYMap.set(staff, y); }

  getStaves() { return [...this.staveMap.values()]; }
  getStaveMap() { return this.staveMap; }
  getStave(staff = 1) { return this.staveMap.get(staff); }
  setStave(staff, stave) { this.staveMap.set(staff, stave); }

  getKey() { return this.key; }
  setKey(key) { this.key = key; }
  hasTime() { return this.time !== undefined; }
  getTime() { return this.time; }
  setTime(time) { this.time = time; }
  getClefMap() { return this.clefMap; }
  setClefMap(clefMap) { this.clefMap = clefMap; }
  getClef(staff = 1) { return this.clefMap.get(staff); }
  setClef(staff, clef) { this.clefMap.set(staff, clef); }
  getDivisions() { return this.divisions; }
  setDivisions(divisions) { this.divisions = divisions; }

  getNotesMap() { return this.notesMap; }
  getVoices() { return this.voices; }
  getVFVoices() { return [...this.vfVoiceMap.values()]; }
  getVFVoiceMap() { return this.vfVoiceMap; }
  setVFVoiceMap(vfVoiceMap) { this.vfVoiceMap = vfVoiceMap; }
  getVFBeams() { return [...this.vfBeamsMap.values()].reduce((a, b) => a.concat(b), []); }
  getVFBeamsMap() { return this.vfBeamsMap; }
  setVFBeamsMap(vfBeamsMap) { this.vfBeamsMap = vfBeamsMap; }
}

Measure.STAFF_HEIGHT = 40;
Measure.LEFT_MARGIN = 0;
Measure.RIGHT_MARGIN = 0;
Measure.TOP_SYSTEM_DISTANCE = 0;
Measure.SYSTEM_DISTANCE = 40;
Measure.STAFF_DISTANCE = 30;
