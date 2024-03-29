// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon

export default class Part {
  constructor({ id, measures }) {
    this.id = id;
    this.measures = measures;
    this.numStaffs = null;

    // this.vfTiesMap = new Map(); // {begin measure index}/{voice} -> vfTies
    this.vfTiesMap = new Map(); // {begin mi}/{staff} -> vfTies
    this.vfSlursMap = new Map(); // {begin measure index}/{voice} -> vfSlurs
  }

  getMeasure(i) { return this.measures[i]; }
  getMeasures() { return this.measures; }

  getNumStaffs() {
    if (this.numStaffs !== null) return this.numStaffs;

    this.numStaffs = 0;
    this.measures.forEach(measure => {
      this.numStaffs = Math.max(this.numStaffs, measure.getNumStaffs())
    });

    return this.numStaffs;
  }

  getVFTies(key) {
    if (key === undefined) return [...this.vfTiesMap.values()].reduce((a, b) => a.concat(b), []);

    return this.vfTiesMap.has(key) ? this.vfTiesMap.get(key) : [];
  }
  setVFTiesMap(vfTiesMap) { this.vfTiesMap = vfTiesMap; }

  getVFSlurs(key) {
    if (key === undefined) return [...this.vfSlursMap.values()].reduce((a, b) => a.concat(b), []);

    return this.vfSlursMap.has(key) ? this.vfSlursMap.get(key) : [];
  }
  setVFSlursMap(vfSlursMap) { this.vfSlursMap = vfSlursMap; }
}
