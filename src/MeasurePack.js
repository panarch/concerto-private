// Copyright (c) Taehoon Moon 2016.
// @author Taehoon Moon

export default class MeasurePack {
  constructor({ measures }) {
    this.measures = measures;

    this.connectors = [];
  }

  getMeasure(i) { return this.measures[i]; }
  getTopMeasure() { return this.getMeasure[0]; }
  getBottomMeasure() { return this.getMeasure[this.measures.length - 1]; }

  getConnectors() { return this.connectors; }
  setConnectors(connectors) { this.connectors = connectors; }
}
