// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon

export default class Note {
  constructor({ tag, rest, full, grace, staff, voice, dot, duration, hidden,
      heads, stem, type, beam, chord, slur, notations, lyrics, timeModification }) {
    this.tag = tag;
    this.staff = staff;
    this.voice = voice;
    this.dot = dot;
    this.rest = rest;
    this.full = full; // full measure rest
    this.grace = grace;
    this.duration = duration;
    this.hidden = hidden; // true for ghost note
    this.heads = heads;
    this.stem = stem;
    this.type = type;
    this.beam = beam;
    this.chord = chord;
    this.slur = slur;
    this.notations = notations;
    this.lyrics = lyrics;
    this.timeModification = timeModification;

    this.vfNote = null;
    this.vfLyricNotesMap = new Map(); // lyricName -> vfLyricNote(TextNote)
  }

  getTag() { return this.tag; }
  getStaff() { return this.staff; }
  getVoice() { return this.voice; }
  getDuration() { return this.duration; }
  getHeads() { return this.heads; }
  getRest() { return this.rest; }
  getFull() { return this.full; }
  getDot() { return this.dot; }
  getGrace() { return this.grace; }
  getHidden() { return this.hidden; }
  getStem() { return this.stem; }
  getType() { return this.type; }
  getBeam() { return this.beam; }
  getChord() { return this.chord; }
  getSlur() { return this.slur; }
  getNotations() { return this.notations; }
  getLyrics() { return this.lyrics; }
  getTimeModification() { return this.timeModification; }

  getVFNote() { return this.vfNote; }
  setVFNote(vfNote) { this.vfNote = vfNote; }
  getVFLyricNotesMap() { return this.vfLyricNotesMap; }
  setVFLyricNotesMap(vfLyricNotesMap) { this.vfLyricNotesMap = vfLyricNotesMap; }
}
