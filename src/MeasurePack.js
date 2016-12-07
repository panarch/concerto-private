// Copyright (c) Taehoon Moon 2016.
// @author Taehoon Moon

export default class MeasurePack {
  constructor({ measures }) {
    this.measures = measures;

    this.notesWidth = null;
    this.minTotalWidth = null;
    this.connectors = [];
    this.vfFormatter = null;
  }

  getMeasure(i) { return this.measures[i]; }
  getTopMeasure() { return this.getMeasure(0); }
  getBottomMeasure() { return this.getMeasure(this.measures.length - 1); }
  getMeasures() { return this.measures; }

  getNotesWidth() { return this.notesWidth; }
  setNotesWidth(notesWidth) {
    this.notesWidth = notesWidth;
    this.measures.forEach(measure => measure.setNotesWidth(notesWidth));
  }

  getMinTotalWidth() { return this.minTotalWidth; }
  setMinTotalWidth(minTotalWidth) { this.minTotalWidth = minTotalWidth; }

  getConnectors() { return this.connectors; }
  setConnectors(connectors) { this.connectors = connectors; }

  getVFFormatter() { return this.vfFormatter; }
  setVFFormatter(vfFormatter) { this.vfFormatter = vfFormatter; }

  getAllVFVoices() {
    return this.getVFVoices().concat(this.getVFDirectionVoices()).concat(this.getVFLyricVoices());
  }

  getVFVoices() {
    return this.measures.reduce((vfVoices, measure) => vfVoices.concat(measure.getVFVoices()), []);
  }

  getVFDirectionVoices() {
    return this.measures.reduce((vfDirectionVoices, measure) => (
      vfDirectionVoices.concat(measure.getVFDirectionVoices())
    ), []);
  }

  getVFLyricVoices() {
    return this.measures.reduce((vfLyricVoices, measure) => (
      vfLyricVoices.concat(measure.getVFLyricVoices())
    ), []);
  }

  getVFStaves() {
    return this.measures.reduce((vfStaves, measure) => vfStaves.concat(measure.getStaves()), []);
  }
}
