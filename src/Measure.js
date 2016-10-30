// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon
import { getMaxDuration } from './Util';

export default class Measure {
  constructor({ number, width, voices, staffs, notesMap, key, time, clefsMap, print, divisions,
      barline, directionsMap, staffDetailsMap } = {}) {
    this.number = number;
    this.width = width;
    this.voices = voices;
    this.staffs = staffs;
    this.notesMap = notesMap; // voice -> notes
    this.directionsMap = directionsMap; // staff -> Direction[]
    this.key = key;
    this.time = time;
    this.clefsMap = clefsMap; // staff -> clef[] (clef[] sorted based on duration: ascending)
    this.print = print;
    this.divisions = divisions;
    this.barline = barline; // left | right -> barline
    this.staffDetailsMap = staffDetailsMap;
    this.maxDuration = notesMap ? getMaxDuration(notesMap) : 0;

    // variables
    this.x = null;
    this.y = null;
    this.lyricNamesMap = new Map(); // voice -> Set<lyricName>
    this.boundingBox = null; // VexFlow BoundingBox
    this.staveMap = new Map();
    this.staffYMap = new Map();
    this.staffDisplayedMap = new Map();
    this.vfVoicesMap = new Map(); // staff -> vfVoice[]
    this.vfDirectionVoicesMap = new Map(); // staff -> vfVoice[]
    this.vfLyricVoicesMap = new Map(); // voice -> vfVoice[]
    this.vfBeamsMap = new Map(); // voice -> vfBeams
    this.vfTupletsMap = new Map(); // voice -> vfTuplets
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

  getStaffDisplayedMap() { return this.staffDisplayedMap; }
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

  getBoundingBox() { return this.boundingBox; }
  setBoundingBox(boundingBox) { this.boundingBox = boundingBox; }
  getLyricNamesMap() { return this.lyricNamesMap; }
  setLyricNamesMap(lyricNamesMap) { this.lyricNamesMap = lyricNamesMap; }

  getStaffY(staff = 1) { return this.staffYMap.get(staff); }
  setStaffY(staff, y) { this.staffYMap.set(staff, y); }

  getStaves() { return [...this.staveMap.values()]; }
  getStaveMap() { return this.staveMap; }
  getStave(staff = 1) { return this.staveMap.get(staff); }
  setStave(staff, stave) { this.staveMap.set(staff, stave); }

  getBarline() { return this.barline; }
  getKey() { return this.key; }
  setKey(key) { this.key = key; }
  hasTime() { return this.time !== undefined; }
  getTime() { return this.time; }
  setTime(time) { this.time = time; }
  getClefsMap() { return this.clefsMap; }
  setClefsMap(clefsMap) { this.clefsMap = clefsMap; }
  getClefs(staff = 1) { return this.clefsMap.get(staff); }
  addClef(staff, clef) {
    if (this.clefsMap.has(staff)) this.clefsMap.get(staff).push(clef);
    else this.clefsMap.set(staff, [clef]);
  }
  getDivisions() { return this.divisions; }
  setDivisions(divisions) { this.divisions = divisions; }
  getDirectionsMap() { return this.directionsMap; }
  setDirections(staff, directions) { this.directionsMap.set(staff, directions); }
  getDirections() { return [...this.directionsMap.values()].reduce((a, b) => a.concat(b), []); }

  getNotesMap() { return this.notesMap; }
  getMaxDuration() { return this.maxDuration; }
  getVoices() { return this.voices; }
  getStaffs() { return this.staffs; }
  getVFDirectionVoices() {
    return [...this.vfDirectionVoicesMap.values()].reduce((a, b) => a.concat(b), []);
  }
  getVFDirectionVoicesMap() { return this.vfDirectionVoicesMap; }
  setVFDirectionVoicesMap(vfDirectionVoicesMap) { this.vfDirectionVoicesMap = vfDirectionVoicesMap }
  getVFLyricVoices() {
    return [...this.vfLyricVoicesMap.values()].reduce((a, b) => a.concat(b), []);
  }
  getVFLyricVoicesMap() { return this.vfLyricVoicesMap; }
  setVFLyricVoicesMap(vfLyricVoicesMap) { this.vfLyricVoicesMap = vfLyricVoicesMap; }
  getVFVoices(staff) {
    if (staff) return this.vfVoicesMap.has(staff) ? this.vfVoicesMap.get(staff) : [];
    else return [...this.vfVoicesMap.values()].reduce((a, b) => a.concat(b), []);
  }
  getVFVoicesMap() { return this.vfVoicesMap; }
  setVFVoicesMap(vfVoicesMap) { this.vfVoicesMap = vfVoicesMap; }
  getVFBeams() { return [...this.vfBeamsMap.values()].reduce((a, b) => a.concat(b), []); }
  getVFBeamsMap() { return this.vfBeamsMap; }
  setVFBeamsMap(vfBeamsMap) { this.vfBeamsMap = vfBeamsMap; }
  getVFTuplets() { return [...this.vfTupletsMap.values()].reduce((a, b) => a.concat(b), []); }
  getVFTupletsMap() { return this.vfTupletsMap; }
  setVFTupletsMap(vfTupletsMap) { this.vfTupletsMap = vfTupletsMap; }
}

Measure.STAFF_HEIGHT = 40;
Measure.LEFT_MARGIN = 0;
Measure.RIGHT_MARGIN = 0;
Measure.TOP_SYSTEM_DISTANCE = 0;
Measure.SYSTEM_DISTANCE = 40;
Measure.STAFF_DISTANCE = 0;
