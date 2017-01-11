// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon

import Vex from '@panarch/allegretto';
const VF = Vex.Flow;
//import VFStaveFormatter from './VFStaveFormatter';
import Measure from './Measure';
import Table from './Table';
import {
  getVFClef,
  getVFDuration,
  getVFJustification,
  splitVFDuration,
  Stack,
  getLineGenerator,
} from './Util';
import SlurTieSubFormatter from './SlurTieSubFormatter';
import DirectionSubFormatter from './DirectionSubFormatter';
import AttributesSubFormatter from './AttributesSubFormatter';
import BarlineSubFormatter from './BarlineSubFormatter';
import PartListSubFormatter from './PartListSubFormatter';
import CreditsSubFormatter from './CreditsSubFormatter';

export default class Formatter {
  constructor(score) {
    const subFormatterOptions = { formatter: this, score };
    this.slurTieSubFormatter = new SlurTieSubFormatter(subFormatterOptions);
    this.directionSubFormatter = new DirectionSubFormatter(subFormatterOptions);
    this.attributesSubFormatter = new AttributesSubFormatter(subFormatterOptions);
    this.barlineSubFormatter = new BarlineSubFormatter(subFormatterOptions);
    this.partListSubFormatter = new PartListSubFormatter(subFormatterOptions);
    this.creditsSubFormatter = new CreditsSubFormatter(subFormatterOptions);
    this.score = score;

    this.defaults = this.score.getDefaults();
    this.credits = this.score.getCredits();
    this.parts = this.score.getParts();
    this.partList = this.score.getPartList();
    this.measurePacks = this.score.getMeasurePacks();
    this.context = this.createContext();

    this.measureCacheMap = new Map();
  }

  createContext() {
    // Fake context for using measureText function
    const div = document.createElement('div');
    div.style.width = '1px';
    div.style.height = '1px';
    div.style.opacity = 0;
    div.style.zIndex = -1;
    document.getElementsByTagName('body')[0].appendChild(div);

    return Vex.Flow.Renderer.getSVGContext(div, 100, 100);
  }

  getContext() { return this.context; }

  resetState() {
    this.state = {
      numParts: this.parts.length,
      numMeasures: this.measurePacks.length,
      pageNumber: 1,
      topSystemDistanceMap: new Map(),
      systemDistanceMap: new Map(),
      staffDistanceMap: new Map(), // ${pi}/{staff}
      staffDisplayedMap: new Map(), // ${pi}/{staff}
    };

    const topSystemDistance = this.defaults.getTopSystemDistance();
    const systemDistance = this.defaults.getSystemDistance();
    const staffDistance = this.defaults.getStaffDistance();

    for (let pi = 0; pi < this.state.numParts; pi++) {
      this.state.topSystemDistanceMap.set(pi, topSystemDistance);
      this.state.systemDistanceMap.set(pi, systemDistance);

      const numStaffs = this.parts[pi].getNumStaffs();
      for (let staff = 1; staff <= numStaffs; staff++) {
        const key = `${pi}/${staff}`;
        this.state.staffDistanceMap.set(key, staffDistance);
        this.state.staffDisplayedMap.set(key, true);
      }
    }
  }

  getLyricName(lyric) { return lyric.number ? lyric.number : lyric.name; }

  getMeasureCache(pi, mi) {
    const key = `${pi}/${mi}`;
    if (!this.measureCacheMap.has(key))
      this.measureCacheMap.set(key, new Measure());

    return this.measureCacheMap.get(key);
  }

  getDisplayed(measure) {
    const staffDisplayedMap = measure.getStaffDisplayedMap();
    const numStaffs = measure.getNumStaffs();

    for (let staff = 1; staff <= numStaffs; staff++) {
      if (staffDisplayedMap.get(staff)) return true;
    }

    return false;
  }

  getPrintMeasure({ parts, mi }) {
    for (let pi = 0; pi < parts.length; pi++) {
      const measure = parts[pi].getMeasures()[mi];
      const numStaffs = measure.getNumStaffs();
      const staffDisplayedMap = measure.getStaffDisplayedMap();

      for (let staff = 1; staff <= numStaffs; staff++) {
        if (staffDisplayedMap.get(staff)) return measure;
      }
    }

    // Unexpected
    console.error('Formatter->getPrintMeasure, failed to find print measure');
    return parts[0].getMeasures()[mi];
  }

  formatStaffDisplayed() {
    for (let mi = 0; mi < this.state.numMeasures; mi++) {
      this.parts.forEach((part, pi) => {
        this.updateStaffDisplayed(mi);

        const numStaffs = part.getNumStaffs();
        const measure = part.getMeasures()[mi];

        for (let staff = 1; staff <= numStaffs; staff++) {
          const key = `${pi}/${staff}`;
          const staffDisplayed = this.state.staffDisplayedMap.get(key);
          measure.setStaffDisplayed(staff, staffDisplayed);
        }
      });
    }
  }

  formatX() {
    this.state.pageNumber = 1;
    const pageLeftMargin = this.defaults.getPageLeftMargin(this.state.pageNumber);
    const systemLeftMargin = this.defaults.getSystemLeftMargin();

    let x = 0;
    this.parts.forEach((part, pi) => {
      part.getMeasures().forEach((measure, mi) => {
        const printMeasure = this.getPrintMeasure({ parts: this.parts, mi });

        if (printMeasure.hasNewPage())
          this.state.pageNumber++;

        if (printMeasure.isNewLineStarting() || mi === 0)
          x = pageLeftMargin + printMeasure.getLeftMargin(systemLeftMargin);

        measure.setX(x);
        x += measure.getWidth();
      });
    });
  }

  updateMeasureDistances(mi) {
    this.parts.forEach((part, pi) => {
      const measure = part.getMeasures()[mi];
      if (!measure.hasPrint()) return;

      if (measure.hasTopSystemDistance())
        this.state.topSystemDistanceMap.set(pi, measure.getTopSystemDistance());

      if (measure.hasSystemDistance())
        this.state.systemDistanceMap.set(pi, measure.getSystemDistance());

      if (measure.hasStaffDistances()) {
        [...measure.getStaffLayoutMap().keys()].forEach(staff => {
          this.state.staffDistanceMap.set(`${pi}/${staff}`, measure.getStaffDistance(staff));
        });
      }

    });
  }

  updateMeasureYs({ aboveBottomY, mi }) {
    const measureTopYs = [];
    const measureBottomYs = [];
    let measureDisplayed = false;

    this.parts.forEach((part, pi) => {
      const measure = part.getMeasures()[mi];
      const numStaffs = part.getNumStaffs();
      const topSystemDistance = this.state.topSystemDistanceMap.get(pi);
      const pageTopMargin = this.defaults.getPageTopMargin(this.state.pageNumber);
      const systemDistance = this.state.systemDistanceMap.get(pi);
      const staffDistance = this.state.staffDistanceMap.get(`${pi}/1`);
      const displayed = this.getDisplayed(measure);

      if (displayed === false) {
        measureTopYs.push(undefined);
        measureBottomYs.push(undefined);
        return;
      }

      let height = Measure.STAFF_HEIGHT;
      for (let staff = 2; staff <= numStaffs; staff++) {
        height += Measure.STAFF_HEIGHT + this.state.staffDistanceMap.get(`${pi}/${staff}`);
      }

      /*
        `aboveBottomY + (pi === 0 ? systemDistance : staffDistance);`
        => Above code is correct, but Sibelius(8.4.1) uses system-distance between part...
           So below code used:
        `aboveBottomY + (pi === 0 || staffDistance === 0 ? systemDistance : staffDistance);`
      */
      const measureTopY = !measureDisplayed && (measure.hasNewPage() || mi === 0) ?
        topSystemDistance + pageTopMargin :
        aboveBottomY + (!measureDisplayed || staffDistance === 0 ? systemDistance : staffDistance);
      const measureBottomY = measureTopY + height;

      measureDisplayed = true;
      aboveBottomY = measureBottomY;
      measureTopYs.push(measureTopY);
      measureBottomYs.push(measureBottomY);
    });

    return { measureTopYs, measureBottomYs };
  }

  updateStaffDisplayed(mi) {
    this.parts.forEach((part, pi) => {
      const numStaffs = part.getNumStaffs();
      const measure = part.getMeasures()[mi];

      for (let staff = 1; staff <= numStaffs; staff++) {
        const staffDisplayed = measure.isStaffDisplayed(staff, null);

        if (staffDisplayed !== null) {
          this.state.staffDisplayedMap.set(`${pi}/${staff}`, staffDisplayed);
        }
      }
    });
  }

  formatY() {
    this.state.pageNumber = 1;

    let measureTopYs = [];
    let measureBottomYs = [
      this.defaults.getPageTopMargin(this.state.pageNumber),
    ];

    for (let mi = 0; mi < this.state.numMeasures; mi++) {
      this.updateMeasureDistances(mi);

      this.parts.forEach((part, pi) => {
        const numStaffs = part.getNumStaffs();
        const measure = part.getMeasures()[mi];

        if ((measure.isNewLineStarting() || mi === 0) && pi === 0) {
          if (measure.hasNewPage()) this.state.pageNumber++;

          ({ measureTopYs, measureBottomYs } = this.updateMeasureYs({
            aboveBottomY: measureBottomYs[measureBottomYs.length - 1],
            mi,
          }));
        }

        const measureTopY = measureTopYs[pi];
        for (let staff = 1; staff <= numStaffs; staff++) {
          const key = `${pi}/${staff}`;
          const staffDistance = this.state.staffDistanceMap.has(key) ?
            this.state.staffDistanceMap.get(key) : 0;

          measure.setStaffY(staff,
            measureTopY + (Measure.STAFF_HEIGHT + staffDistance) * (staff - 1)
          );
        }

        measure.setY(measureTopY);
      });
    }
  }

  createStaves() {
    this.parts.forEach(part => {
      const numStaffs = part.getNumStaffs();
      const measures = part.getMeasures();
      const clef = measures[0].getClefs()[0];
      let printMeasure = measures[0];

      measures.forEach((measure, mi) => {
        if (measure.isNewLineStarting())
          printMeasure = measure;

        const x = measure.getX();
        const width = measure.getWidth();
        const options = {
          space_above_staff_ln: 0,
          // top_text_position: 0,
          // bottom_text_position: 0,
        };

        for (let staff = 1; staff <= numStaffs; staff++) {
          const y = measure.getStaffY(staff);

          if (printMeasure.isStaffDisplayed(staff)) {
            const StaveClass = clef.sign === 'TAB' ? Vex.Flow.TabStave : Vex.Flow.Stave;
            const stave = new StaveClass(x, y, width, options);
            // stave.options.bottom_text_position = 0;
            stave.setBegBarType(Vex.Flow.Barline.type.NONE);
            measure.setStave(staff, stave);
          }
        }
      });
    });
  }

  formatMeasureNumber() {
    let measureNumbering = 'system'; // default value

    this.parts[0].getMeasures().forEach((measure, mi) => {
      const print = measure.getPrint();
      if (print && print.measureNumbering) measureNumbering = print.measureNumbering;

      const topStave = measure.getStaves()[0];
      if (!topStave) return;

      if (measureNumbering === 'measure' ||
          (measureNumbering === 'system' && measure.isNewLineStarting())) {
        topStave.setMeasure(mi + 1);
      }
    });
  }

  formatDivisions() {
    this.parts.forEach((part, pi) => {
      let divisions;
      part.getMeasures().forEach((measure, mi) => {
        if (measure.getDivisions() !== undefined)
          divisions = measure.getDivisions();

        // update cache
        this.getMeasureCache(pi, mi).setDivisions(divisions);
      });
    });
  }

  /*
  formatStaves() {
    this.parts[0].getMeasures().forEach((_, mi) => {
      const vfStaveFormatter = new VFStaveFormatter();
      let vfStaves = [];
      this.parts.forEach((part, pi) => {
        const measure = part.getMeasures()[mi];
        vfStaves = vfStaves.concat(measure.getStaves());
      });

      vfStaveFormatter.format(vfStaves);
    });
  }
  */

  _formatNoteArticulations(staveNote, note) {
    if (!note.notations.articulations) return;

    const notations = note.notations;
    const HEAD_ATTACHINGS = [
      'staccato',
      'staccatissimo',
      'accent',
      'spiccato',
      'tenuto',
    ];
    const ARTICULATION_MAP = {
      staccato: 'a.',
      staccatissimo: 'av',
      tenuto: 'a-',
      accent: 'a>',
      'strong-accent': 'a^',
      'breath-mark': 'a,',
    };
    const { ABOVE, BELOW } = Vex.Flow.Modifier.Position;

    const articulations = notations.articulations ? notations.articulations : [];
    articulations.forEach(articulation => {
      const value = ARTICULATION_MAP[articulation.tag];
      if (!value) return;

      const vfArticulation = new Vex.Flow.Articulation(value);
      const vfPosition = HEAD_ATTACHINGS.indexOf(articulation.tag) !== -1 ?
        (note.getStem() === 'up' ? BELOW : ABOVE) :
        ABOVE;

      staveNote.addArticulation(0, vfArticulation.setPosition(vfPosition));
    });
  }

  _formatNoteNotations(staveNote, note) {
    if (!note.notations) return;

    this._formatNoteArticulations(staveNote, note);

    // arpeggiate
    if (note.notations.arpeggiate) {
      const vfStrokeType = note.notations.arpeggiate.direction === 'down' ?
        VF.Stroke.Type.ROLL_UP : VF.Stroke.Type.ROLL_DOWN;

      staveNote.addStroke(0, new VF.Stroke(vfStrokeType));
    }

    if (note.notations.fermata) {
      staveNote.addArticulation(0, new VF.Articulation('a@a').setPosition(3));
    }
  }

  _formatNote(note, clef, divisions, lyricNames) {
    if (note.getHidden()) {
      return { vfNote: new Vex.Flow.GhostNote({ duration: getVFDuration(note, divisions) }) };
    }

    const data = {
      keys: [],
      positions: [],
      duration: getVFDuration(note, divisions),
      clef: note.getRest() ? 'treble' : getVFClef(clef),
    };

    const accidentals = [];
    const fingerings = [];
    note.getHeads().map(head => { // Notice that it is not hard copy
      const headSoftClone = Object.assign({}, head);
      headSoftClone.octave += note.getOctaveChange();
      return headSoftClone;
    }).forEach(({ step, octave, accidental, fret, string, fingering }) => {
      data.keys.push(`${step}/${octave}`);
      accidentals.push(accidental ? accidental : null);
      fingerings.push(fingering ? fingering : null);

      if (data.clef === 'tab') data.positions.push({ str: string, fret });
    });

    if (data.keys.length === 0) data.keys = Table.VF_DEFAULT_REST_KEYS;
    if (note.getGrace()) data.slash = note.getGrace().slash;
    if (note.getFull()) data.align_center = true;
    if (note.getStem()) data.stem_direction = note.getStem() === 'up' ?
      Vex.Flow.StaveNote.STEM_UP : Vex.Flow.StaveNote.STEM_DOWN;

    const VFNote = data.clef === 'tab' ?
      Vex.Flow.TabNote :
      (note.grace ? Vex.Flow.GraceNote : Vex.Flow.StaveNote);

    const staveNote = new VFNote(data);

    this._formatNoteNotations(staveNote, note);

    const lyrics = note.lyrics ? note.lyrics : [];
    const vfLyricNotesMap = new Map();

    if (note.getGrace()) lyricNames = [];
    lyricNames.forEach(lyricName => {
      const lyric = lyrics.filter(_lyric => this.getLyricName(_lyric) === lyricName)[0];
      const vfLyricNotes = [];

      if (lyric) {
        const syllabicExists = ['begin', 'middle'].includes(lyric.syllabic);
        const vfDuration = syllabicExists ? splitVFDuration(data.duration) : data.duration;
        const textNote = new Vex.Flow.TextNote({ text: lyric.text, duration: vfDuration });
        textNote.setJustification(getVFJustification(lyric.justify));
        vfLyricNotes.push(textNote);

        if (syllabicExists) {
          vfLyricNotes.push(new Vex.Flow.TextNote({ text: '-', duration: vfDuration }));
        }
      } else {
        vfLyricNotes.push(new Vex.Flow.GhostNote({ duration: data.duration }));
      }

      vfLyricNotesMap.set(lyricName, vfLyricNotes);
    });

    if (data.clef === 'tab') return { vfNote: staveNote, vfLyricNotesMap };

    accidentals.forEach((accidental, index) => {
      if (!accidental) return;

      const vfAccidental = new VF.Accidental(Table.VF_ACCIDENTAL[accidental]);
      staveNote.addAccidental(index, vfAccidental);
    });

    fingerings.forEach((fingering, index) => {
      if (!fingering) return;

      const vfFingering = new VF.Annotation(fingering.text);
      vfFingering.setFont('times', 9, 'bold');
      if (fingering.placement === 'below') {
        vfFingering.setVerticalJustification(VF.Annotation.VerticalJustify.BELOW);
      }

      staveNote.addModifier(index, vfFingering);
    });

    for (let i = 0; i < note.dot; i++) {
      staveNote.addDotToAll();
      staveNote.dots -= staveNote.keys.length;
    }

    return {
      vfNote: staveNote,
      vfLyricNotesMap,
    };
  }

  _formatGraceNotes(vfNote, graceNotes) {
    if (graceNotes.length === 0) return;

    let beamExists = false;
    let slurExists = false;
    graceNotes.forEach(note => {
      if (note.beam) beamExists = true;
      if (note.slur) slurExists = true;
    });

    const vfGraceNotes = graceNotes.map(note => note.getVFNote());
    const vfGraceNoteGroup = new Vex.Flow.GraceNoteGroup(vfGraceNotes, slurExists);
    if (beamExists) vfGraceNoteGroup.beamNotes();

    vfNote.addModifier(0, vfGraceNoteGroup);
  }

  _formatNoteClef(measure) {
    const notesMap = measure.getNotesMap();
    const maxDuration = measure.getMaxDuration();
    const clefsMap = measure.getClefsMap();

    clefsMap.forEach((clefs, staff) => clefs.forEach(clef => {
      if (clef.duration === 0 || clef.duration >= maxDuration) return;

      let clefNote;
      let gap = Infinity;
      notesMap.forEach((notes, voice) => {
        let duration = 0;
        for (const note of notes) {
          if (!note.getDuration() || staff !== note.getStaff()) continue;

          if (duration <= clef.duration &&
              duration + note.getDuration() > clef.duration) {
            const newGap = clef.duration - duration;
            if (newGap < gap) {
              gap = newGap;
              clefNote = note;
            }

            break;
          }

          if (note.getDuration()) duration += note.getDuration();
        }
      });

      if (!clefNote) console.warn('Failed to find note to add mid-measure clef!');

      const vfClefNote = clefNote.getVFNote();
      const clefModifier = new VF.NoteSubGroup([
        new VF.ClefNote(getVFClef(clef), 'small').setStave(measure.getStave(staff)),
      ]);

      vfClefNote.addModifier(0, clefModifier);
    }));
  }

  _formatNotes(part, pi) {
    part.getMeasures().forEach((measure, mi) => {
      const notesMap = measure.getNotesMap();
      const lyricNamesMap = measure.getLyricNamesMap();
      const measureCache = this.getMeasureCache(pi, mi);
      const vfVoicesMap = new Map(); // staff -> vfVoice[]
      const vfLyricVoicesMap = new Map();
      const vfTupletsMap = new Map();

      measure.getVoices().forEach(voice => {
        if (measure.getStaves().length === 0) return;

        const vfNotesMap = new Map(); // staff -> vfNote[]
        const vfLyricNotesMap = new Map(); // lyricName -> notes
        let graceNotes = [];
        let duration = 0;
        const vfDurations = [];
        const lyricNames = lyricNamesMap.has(voice) ? lyricNamesMap.get(voice) : [];
        const notes = notesMap.get(voice);
        notes.forEach(note => {
          if (note.getTag() !== 'note') {
            console.error('Unexpected note type exists');
            return;
          }

          const staff = note.getStaff();
          const clefs =  measureCache.getClefs(staff).filter(clef => clef.duration <= duration);
          const clef = clefs[clefs.length - 1];
          const divisions = measureCache.getDivisions();
          const {
            vfNote,
            vfLyricNotesMap: _vfLyricNotesMap = new Map(),
          } = this._formatNote(note, clef, divisions, lyricNames);

          const vfStave = measure.getStave(staff);

          vfNote.setStave(vfStave);
          _vfLyricNotesMap.forEach(vfLyricNotes => {
            vfLyricNotes.forEach(vfLyricNote => {
              vfLyricNote.setContext(this.context);
              vfLyricNote.setStave(vfStave);
            });
          });

          note.setVFLyricNotesMap(_vfLyricNotesMap);
          note.setVFNote(vfNote);
          if (note.grace) {
            graceNotes.push(note);
          } else {
            this._formatGraceNotes(vfNote, graceNotes);
            if (!vfNotesMap.has(staff)) {
              const ghostNotes = vfDurations.map(vfDuration =>
                new VF.GhostNote({ duration: vfDuration })
              );

              ghostNotes.forEach(ghostNote => ghostNote.setStave(vfStave));
              vfNotesMap.set(staff, ghostNotes);
            }

            vfNotesMap.forEach((vfNotes, _staff) => {
              if (_staff === staff) {
                vfNotes.push(vfNote);
              } else {
                const ghostNote = new VF.GhostNote({ duration: vfNote.getDuration() });
                ghostNote.setStave(vfStave);
                vfNotes.push(ghostNote);
              }
            });

            vfDurations.push(vfNote.getDuration());
            graceNotes = [];
          }

          _vfLyricNotesMap.forEach((_vfLyricNotes, lyricName) => {
            let vfLyricNotes = vfLyricNotesMap.has(lyricName) ?
              vfLyricNotesMap.get(lyricName) : [];

            vfLyricNotes = vfLyricNotes.concat(_vfLyricNotes);
            vfLyricNotesMap.set(lyricName, vfLyricNotes);
          });

          if (note.getDuration()) duration += note.getDuration();
        });

        vfTupletsMap.set(voice, this._formatTuplet(notes));

        const { beats = 4, beatType = 4 } = measureCache.hasTime() ? measureCache.getTime() : {};
        const voiceOptions = { num_beats: beats, beat_value: beatType };
        vfNotesMap.forEach((vfNotes, staff) => {
          const vfVoice = new Vex.Flow.Voice(voiceOptions);
          vfVoice.setMode(Vex.Flow.Voice.Mode.SOFT);
          vfVoice.addTickables(vfNotes);
          if (!vfVoicesMap.has(staff)) vfVoicesMap.set(staff, []);

          vfVoicesMap.get(staff).push(vfVoice);
        });

        lyricNames.forEach(lyricName => {
          const vfLyricNotes = vfLyricNotesMap.get(lyricName).map(vfLyricNote => {
            return vfLyricNote.setContext(this.context);
          });
          const vfLyricVoice = new Vex.Flow.Voice(voiceOptions);
          vfLyricVoice.setMode(Vex.Flow.Voice.Mode.SOFT);
          vfLyricVoice.addTickables(vfLyricNotes);

          const vfLyricVoices = vfLyricVoicesMap.get(voice);
          if (vfLyricVoices) {
            vfLyricVoices.push(vfLyricVoice);
          } else {
            vfLyricVoicesMap.set(voice, [vfLyricVoice]);
          }

        });
      });

      this._formatNoteClef(measure);

      measure.setVFVoicesMap(vfVoicesMap);
      measure.setVFLyricVoicesMap(vfLyricVoicesMap);
      measure.setVFTupletsMap(vfTupletsMap);
    });
  }

  _formatLyricNamesMap() {
    this.parts.forEach(part => part.getMeasures().forEach(measure => {
      const notesMap = measure.getNotesMap();
      const lyricNamesMap = new Map(); // voice -> Set<lyricName>
      notesMap.forEach((notes, voice) => {
        const lyricNames = new Set();

        notes.forEach(note => {
          if (!note.lyrics) return;

          note.lyrics.forEach(lyric => lyricNames.add(this.getLyricName(lyric)));
        });

        if (lyricNames.size > 0) lyricNamesMap.set(voice, lyricNames);
      });

      measure.setLyricNamesMap(lyricNamesMap);
    }));
  }

  formatNotes() {
    this._formatLyricNamesMap();
    this.parts.forEach((part, pi) => this._formatNotes(part, pi));
  }

  _formatLyric(measures) {
    // calculate voice boundary first
    // staff -> maxY
    const maxYMap = new Map();
    measures.forEach(measure => measure.getStaffs().forEach(staff => {
      const vfVoices = measure.getVFVoices(staff);
      if (vfVoices.length === 0) return;

      let vfBoundingBox;
      vfVoices.forEach(vfVoice => {
        if (!vfBoundingBox) vfBoundingBox = vfVoice.getBoundingBox();
        else vfBoundingBox.mergeWith(vfVoice.getBoundingBox);
      });

      if (!vfBoundingBox) return;

      if (!maxYMap.has(staff)) maxYMap.set(staff, -Infinity);

      const { y, h } = vfBoundingBox;
      const maxY = y + h;
      if (maxY > maxYMap.get(staff)) maxYMap.set(staff, maxY);

    }));

    measures.forEach(measure => measure.getNotesMap().forEach((notes, voice) => {
      const staff = notes[0].getStaff();
      const maxY = maxYMap.get(staff);
      let line;

      notes.forEach(note => {
        let i = 1;
        note.getVFLyricNotesMap().forEach(vfLyricNotes => {
          vfLyricNotes.forEach(vfLyricNote => {
            if (vfLyricNote instanceof Vex.Flow.GhostNote) return;

            if (!line) {
              const vfStave = vfLyricNote.getStave();
              const height = maxY - vfStave.getYForLine(0);
              line = height / vfStave.getSpacingBetweenLines();
              line += 3 + 0.2;
            }

            vfLyricNote.setLine(line + i * 2);
          });

          i++;
        });
      });
    }));
  }

  // @after formatDirection
  formatLyric() {
    this.parts.forEach(part => {
      const lineGenerator = getLineGenerator(part);
      for (const measures of lineGenerator) {
        this._formatLyric(measures);
      }
    });

    // join lyric voices to VFFormatter
    this.measurePacks.forEach(measurePack => {
      const vfLyricVoices = measurePack.getVFLyricVoices();
      const vfFormatter = measurePack.getVFFormatter();
      if (!vfFormatter || vfLyricVoices.length === 0) return;

      vfFormatter.joinVoices(vfLyricVoices);
    });
  }

  formatVoices() {
    this.measurePacks.forEach((measurePack, mi) => {
      const vfStaves = measurePack.getVFStaves();
      const vfVoices = measurePack.getVFVoices();
      const vfLyricVoices = measurePack.getVFLyricVoices();

      if (vfVoices.length === 0) return;

      let maxStartX = -Infinity;
      let minEndX = Infinity;
      vfStaves.forEach(vfStave => {
        minEndX = Math.min(minEndX, vfStave.getNoteEndX());
        maxStartX = Math.max(maxStartX, vfStave.getNoteStartX());
      });

      vfStaves.forEach(vfStave => {
        vfStave.start_x = maxStartX;
        vfStave.end_x = minEndX;
      });

      const vfTabVoices = vfVoices.filter(vfVoice => {
        for (const vfNote of vfVoice.getTickables()) {
          if (vfNote instanceof Vex.Flow.TabNote) return true;
        }

        return false;
      });

      // Extra space is required for tab notes, multiply 2.4
      let minTotalWidth = 2.4 * Math.max(0, ...vfTabVoices.map(vfTabVoice => {
        const vfTabFormatter = (new Vex.Flow.Formatter()).joinVoices([vfTabVoice]);
        return vfTabFormatter.preCalculateMinTotalWidth([vfTabVoice]);
      }));

      const notesWidth = minEndX - maxStartX - 10;
      const vfFormatter = new Vex.Flow.Formatter();

      measurePack.getMeasures().forEach(measure => {
        measure.getVFVoicesMap().forEach(vfVoices => {
          if (vfVoices.length === 0) return;

          vfFormatter.joinVoices(vfVoices);
        });
      })

      minTotalWidth = Math.max(
        vfFormatter.preCalculateMinTotalWidth(vfVoices.concat(vfLyricVoices)),
        minTotalWidth
      );

      //vfFormatter.format(vfVoices, width); -> runFormatter
      measurePack.setNotesWidth(notesWidth);
      measurePack.setMinTotalWidth(minTotalWidth);
      measurePack.setVFFormatter(vfFormatter);
    });
  }

  runFormatter() {
    this.measurePacks.forEach(measurePack => {
      const vfVoices = measurePack.getAllVFVoices();
      const notesWidth = measurePack.getNotesWidth();
      const vfFormatter = measurePack.getVFFormatter();
      if (!vfFormatter) return;

      vfFormatter.format(vfVoices, notesWidth - 5);
    });
  }

  _formatBeam(measure) {
    const notesMap = measure.getNotesMap();
    const vfBeamsMap = new Map();

    measure.getVoices().forEach(voice => {
      if (measure.getStaves().length === 0) return;

      const vfBeams = [];
      let vfBeamNotes = [];
      notesMap.get(voice).forEach(note => {
        if (note.getTag() !== 'note') return;
        if (note.getGrace()) return; // TODO

        const staveNote = note.getVFNote();
        switch (note.beam) {
          case 'begin':
            vfBeamNotes = [staveNote];
            break;
          case 'continue':
            vfBeamNotes.push(staveNote);
            break;
          case 'end':
            vfBeamNotes.push(staveNote);
            vfBeams.push(new Vex.Flow.Beam(vfBeamNotes));
            break;
        }
      });

      vfBeamsMap.set(voice, vfBeams);
    });

    measure.setVFBeamsMap(vfBeamsMap);
  }

  formatBeam() {
    this.parts.forEach(part => {
      part.getMeasures().forEach(measure => this._formatBeam(measure));
    });
  }

  _formatTuplet(notes) {
    const vfTuplets = [];
    const tupletStack = new Stack();
    notes.forEach((note, i) => {
      if (note.getTag() !== 'note') return;
      if (note.getGrace()) return; // TODO
      if (!note.notations || !note.notations.tuplets ||
          !note.notations.tuplets.length === 0) {
        return;
      }

      note.notations.tuplets.forEach(tuplet => {
        switch (tuplet.type) {
        case 'start':
          tupletStack.push({
            index: i,
            numActual: (tuplet.actual ?
              tuplet.actual.number : note.timeModification.actualNotes),
            numNormal: (tuplet.normal ?
              tuplet.normal.number : note.timeModification.normalNotes),
            placement: tuplet.placement,
            bracket: tuplet.bracket !== undefined ? tuplet.bracket : !note.beam,
            showNumber: tuplet.showNumber !== undefined ? tuplet.showNumber : 'actual',
          });

          break;
        case 'stop':
          const { index, numActual, numNormal, placement, bracket, showNumber } = tupletStack.pop();
          const vfNotes = [];
          const vfLyricNotesMap = new Map();
          // if placement value exists => use placement, no need to auto calculation
          const hasPlacement = placement != null;
          let [hasUp, hasDown] = [false, false];
          let vfLocation = !hasPlacement || placement === 'above' ?
            VF.Tuplet.LOCATION_TOP : VF.Tuplet.LOCATION_BOTTOM;

          notes.slice(index, i + 1).filter(_note => !_note.getGrace()).forEach(_note => {
            const vfNote = _note.getVFNote();

            if (!hasPlacement && !vfNote.isRest()) {
              switch (vfNote.getStemDirection()) {
              case VF.Stem.UP: hasUp = true; break;
              case VF.Stem.DOWN: hasDown = true; break;
              }

              vfLocation = hasUp && hasDown || !hasDown ?
                VF.Tuplet.LOCATION_TOP :
                VF.Tuplet.LOCATION_BOTTOM;
            }

            vfNotes.push(vfNote);

            _note.getVFLyricNotesMap().forEach((_vfLyricNotes, lyricName) => {
              let vfLyricNotes = vfLyricNotesMap.has(lyricName) ?
                vfLyricNotesMap.get(lyricName) : [];

              vfLyricNotes = vfLyricNotes.concat(_vfLyricNotes);
              vfLyricNotesMap.set(lyricName, vfLyricNotes);
            });
          });

          const tupletOptions = {
            num_notes: numActual,
            notes_occupied: numNormal,
            bracketed: bracket,
          };

          switch (showNumber) {
          case 'actual':
            tupletOptions.ratioed = false;
            tupletOptions.numbered = true;
            break;
          case 'both':
            tupletOptions.ratioed = true;
            tupletOptions.numbered = true;
            break;
          case 'none':
            tupletOptions.ratioed = false;
            tupletOptions.numbered = false;
            break;
          default:
            console.warn('Formatter.formatTuplet, unexpected showNumber option', showNumber);
          }

          const vfTuplet = new Vex.Flow.Tuplet(vfNotes, tupletOptions);

          vfLyricNotesMap.forEach(vfLyricNotes => {
            new Vex.Flow.Tuplet(vfLyricNotes, tupletOptions);
          });

          vfTuplet.setTupletLocation(vfLocation);
          vfTuplets.push(vfTuplet);
          break;
        }
      });
    });

    return vfTuplets;
  }

  formatAttributes() { this.attributesSubFormatter.formatAttributes(); }
  formatPartList() { this.partListSubFormatter.formatPartList(); }
  formatCredits(credits) { this.creditsSubFormatter.formatCredits(credits); }
  formatBarline() { this.barlineSubFormatter.formatBarline(); }
  formatTie() { this.slurTieSubFormatter.formatTie(); }
  formatSlur() { this.slurTieSubFormatter.formatSlur(); }
  formatDirection() { this.directionSubFormatter.formatDirection(); }
  postFormatDirection() { this.directionSubFormatter.postFormatDirection(); }

  postFormatBeam() {
    this.parts.forEach(part => part.getMeasures().forEach(measure => {
      const vfBeams = measure.getVFBeams();
      for (const vfBeam of vfBeams) {
        vfBeam.postFormat();
      }

    }));
  }

  format() {
    this.resetState();
    this.formatStaffDisplayed();
    this.formatX();
    this.formatY();
    this.createStaves();
    this.formatMeasureNumber();
    this.formatAttributes();
    this.formatDivisions();
    this.formatCredits();
    this.formatBarline();
    this.formatPartList();
    //this.formatStaves();
    this.formatNotes();
    this.formatBeam();
    this.formatVoices();
    this.formatDirection();
    this.formatLyric();
    this.runFormatter();
    this.postFormatDirection();
    this.postFormatBeam();
    this.formatTie();
    this.formatSlur();
  }
}
