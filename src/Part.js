// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon

export default class Part {
  constructor({ id, measures }) {
    this.id = id;
    this.measures = measures;
    this.numStaffs = null;

    this.vfTiesMap = new Map(); // begin measure index -> vfTies
  }

  getMeasures() { return this.measures; }

  getNumStaffs() {
    if (this.numStaffs !== null) return this.numStaffs;

    this.numStaffs = 0;
    this.measures.forEach(measure => {
      this.numStaffs = Math.max(this.numStaffs, measure.getNumStaffs())
    });

    return this.numStaffs;
  }

  getVFTies(mi) {
    if (mi === undefined) return [...this.vfTiesMap.values()].reduce((a, b) => a.concat(b), []);

    return this.vfTiesMap.has(mi) ? this.vfTiesMap.get(mi) : [];
  }
  setVFTiesMap(vfTiesMap) { this.vfTiesMap = vfTiesMap; }
}
