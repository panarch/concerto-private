// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon

export default class Score {
  constructor({ version, movement, identification, defaults, credits,
      partList, parts, measurePacks }) {
    this.formatted = false;
    this.version = version;
    this.movement = movement;
    this.identification = identification;
    this.defaults = defaults;
    this.credits = credits;
    this.partList = partList;
    this.parts = parts;
    this.measurePacks = measurePacks;
  }

  getFormatted() { return this.formatted; }
  getMovement() { return this.movement; }
  getIdentification() { return this.identification; }
  getDefaults() { return this.defaults; }
  getCredits() { return this.credits; }
  getPartList() { return this.partList; }
  getParts() { return this.parts; }
  getMeasurePacks() { return this.measurePacks; }

  getNumPages() {
    let num = 1;
    this.parts[0].getMeasures().forEach((measure, mi) => {
      if (mi > 0 && measure.hasNewPage()) num++;
    });

    return num;
  }
}
