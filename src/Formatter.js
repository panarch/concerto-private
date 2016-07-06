// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon

import Vex from '@panarch/allegretto';
//import VFStaveFormatter from './VFStaveFormatter';
import Measure from './Measure';
import Table from './Table';
import {
  getVFClef,
  getVFDuration,
  getVFKeySignature,
  getVFConnectorType,
} from './Util';

export default class Formatter {
  constructor(score) {
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

  getMeasureCache(pi, mi) {
    const key = `${pi}/${mi}`;
    if (!this.measureCacheMap.has(key))
      this.measureCacheMap.set(key, new Measure());

    return this.measureCacheMap.get(key);
  }

  formatX() {
    this.state.pageNumber = 1;
    const pageLeftMargin = this.defaults.getPageLeftMargin(this.state.pageNumber);
    const systemLeftMargin = this.defaults.getSystemLeftMargin();

    let x = 0;
    this.parts.forEach((part, pi) => {
      part.getMeasures().forEach((measure, mi) => {
        const printMeasure = this.parts[0].getMeasures()[mi];

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

    const getDisplayed = (pi, numStaffs) => {
      for (let staff = 1; staff <= numStaffs; staff++) {
        if (this.state.staffDisplayedMap.get(`${pi}/${staff}`))
          return true;
      }

      return false;
    };

    this.parts.forEach((part, pi) => {
      const measure = part.getMeasures()[mi];
      const numStaffs = part.getNumStaffs();
      const topSystemDistance = this.state.topSystemDistanceMap.get(pi);
      const pageTopMargin = this.defaults.getPageTopMargin(this.state.pageNumber);
      const systemDistance = this.state.systemDistanceMap.get(pi);
      const staffDistance = this.state.staffDistanceMap.get(`${pi}/1`);
      const displayed = getDisplayed(pi, numStaffs);

      if (displayed === false) {
        measureTopYs.push(undefined);
        measureBottomYs.push(undefined);
        return;
      }

      let height = Measure.STAFF_HEIGHT;
      for (let staff = 2; staff <= numStaffs; staff++) {
        height += Measure.STAFF_HEIGHT + this.state.staffDistanceMap.get(`${pi}/${staff}`);
      }

      const measureTopY = pi === 0 && (measure.hasNewPage() || mi === 0) ?
        topSystemDistance + pageTopMargin :
        aboveBottomY + (pi === 0 ? systemDistance : staffDistance);
      const measureBottomY = measureTopY + height;

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

          this.updateStaffDisplayed(mi);

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
          measure.setStaffDisplayed(staff, this.state.staffDisplayedMap.get(`${pi}/${staff}`));
        }

        measure.setY(measureTopY);
      });
    }
  }

  createStaves() {
    this.parts.forEach(part => {
      const numStaffs = part.getNumStaffs();
      const measures = part.getMeasures();
      let printMeasure = measures[0];

      measures.forEach((measure, mi) => {
        if (measure.isNewLineStarting())
          printMeasure = measure;

        const x = measure.getX();
        const width = measure.getWidth();
        const options = {
          space_above_staff_ln: 0,
        };

        for (let staff = 1; staff <= numStaffs; staff++) {
          const y = measure.getStaffY(staff);

          if (printMeasure.isStaffDisplayed(staff)) {
            const stave = new Vex.Flow.Stave(x, y, width, options);
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

  formatClef() {
    this.parts.forEach((part, pi) => {
      const clefMap = new Map(); // {staff}
      const measures = part.getMeasures();

      measures.forEach((measure, mi) => {
        measure.getClefMap().forEach((clef, staff) => clefMap.set(staff, clef));

        if (mi === 0 || measure.isNewLineStarting()) {
          measure.getStaveMap().forEach((stave, staff) => {
            const vfClef = getVFClef(clefMap.get(staff));
            if (vfClef) stave.addClef(vfClef);
          });
        }

        // update cache
        this.getMeasureCache(pi, mi).setClefMap(new Map(clefMap));

        const clefUpdated = new Map(); // {staff}
        measure.getNotesMap().forEach(notes => {
          let staff = 1;
          notes.forEach(note => {
            if (note.staff && note.staff !== staff) staff = note.staff;
            if (note.tag === 'clef') {
              clefMap.set(staff, note);
              clefUpdated.set(staff, true);
            }
          });
        });

        const nextMeasure = measures[mi + 1];
        if (!nextMeasure || !nextMeasure.isNewLineStarting()) return;

        nextMeasure.getClefMap().forEach((clef, staff) => {
          if (clefUpdated.has(staff)) return;

          const vfClef = getVFClef(clef);
          const stave = measure.getStave(staff);
          if (stave) stave.addEndClef(vfClef, 'small');
        });
      });
    });
  }

  formatKeySignature() {
    this.parts.forEach((part, pi) => {
      let prevMeasure;
      let key;

      part.getMeasures().forEach((measure, mi) => {
        let keyUpdated = false;

        if (measure.getKey()) {
          key = measure.getKey();
          keyUpdated = true;
        }

        if (mi === 0 || measure.isNewLineStarting() || keyUpdated) {
          measure.getStaves().forEach(stave => {
            const vfKey = getVFKeySignature(key);
            if (key) stave.addKeySignature(vfKey);
          })
        }

        if (measure.isNewLineStarting() && keyUpdated) {
          prevMeasure.getStaves().forEach(stave => {
            const vfKey = getVFKeySignature(key);
            // TODO: replace it to use StaveModifier later
            const END = 6; // Vex.Flow.StaveModifier.Position.END
            if (key) stave.addKeySignature(vfKey, undefined, END);
          });
        }

        // update cache
        this.getMeasureCache(pi, mi).setKey(key);
        prevMeasure = measure;
      });
    });
  }

  formatTimeSignature() {
    this.parts.forEach((part, pi) => {
      //const numStaffs = part.getNumStaffs();
      let prevMeasure;
      let time;

      part.getMeasures().forEach((measure, mi) => {
        let timeUpdated = false;

        if (measure.getTime()) {
          time = measure.getTime();
          timeUpdated = true;
        }

        if (mi === 0 || timeUpdated) {
          measure.getStaves().forEach(stave => {
            if (time) stave.addTimeSignature(`${time.beats}/${time.beatType}`);
          });
        }

        if (measure.isNewLineStarting() && timeUpdated) {
          prevMeasure.getStaves().forEach(stave => {
            stave.addEndTimeSignature(`${time.beats}/${time.beatType}`);
          });
        }

        // update cache
        this.getMeasureCache(pi, mi).setTime(time);
        prevMeasure = measure;
      });
    });
  }

  formatAttributes() {
    this.formatClef();
    this.formatKeySignature();
    this.formatTimeSignature();
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

  formatCredits() {
    const getTextAnchor = value => {
      switch (value) {
        case 'left': return 'start';
        case 'right': return 'end';
        case 'center': return 'middle';
      }
    };

    const getDominantBaseline = value => {
      switch (value) {
        case 'top': return 'hanging';
        case 'middle': return 'middle';
        case 'bottom':
        case 'baseline': return 'alphabetical';
      }
    };

    const pageSize = this.score.getDefaults().getPageSize();
    // words.fontSize = Number(/(\d+)\w*/.exec(node.getAttribute('font-size')[1]));
    this.credits.forEach(credit => {
      const texts = [];
      let x;
      let y;
      let fontSize;
      let textAnchor = 'hanging'; // TODO: full justify & halign support
      let baseline = 'start';

      credit.getWordsList().forEach(words => {
        if (!/\w+/.test(words.content)) return; // ignore empty line-break

        const text = {
          content: words.content,
          attributes: new Map(),
        };

        if (words.defaultX !== undefined) x = words.defaultX;
        if (words.defaultY !== undefined) y = pageSize.height - words.defaultY;
        if (words.justify !== undefined) textAnchor = getTextAnchor(words.justify);
        if (words.halign !== undefined) textAnchor = getTextAnchor(words.halign);
        if (words.valign !== undefined) baseline = getDominantBaseline(words.valign);

        if (textAnchor) text.attributes.set('text-anchor', textAnchor);
        if (baseline) text.attributes.set('dominant-baseline', baseline);

        this.context.save();
        if (words.fontSize !== undefined) {
          fontSize = words.fontSize;
          if (/\d+$/.test(fontSize)) {
            fontSize = Number(fontSize) * 2.5; // TODO
            fontSize += 'px';
          }

          text.attributes.set('font-size', fontSize);
          this.context.attributes['font-size'] = fontSize; // svgcontext only
        }

        // default font: "times", no custom font support
        text.attributes.set('font-family', 'times');
        this.context.attributes['font-family'] = 'times';

        const bbox = this.context.measureText(text.content);
        this.context.restore();

        text.x = x;
        text.y = y;
        texts.push(text);
        y += bbox.height;
      });

      credit.setTexts(texts);
    });
  }

  formatPartList() {
    const partGroups = this.partList.getPartGroups();
    const scoreParts = this.partList.getScoreParts();
    const numMeasures = this.measurePacks.length;

    const findTopStave = (pi, mi, max) => {
      for (; pi < max; pi++) {
        const staves = this.parts[pi].getMeasures()[mi].getStaves();
        if (staves && staves.length > 0)
          return staves[0];

      }
    };

    const findBottomStave = (pi, mi, min) => {
      for (; pi > min; pi--) {
        const staves = this.parts[pi].getMeasures()[mi].getStaves();
        if (staves && staves.length > 0)
          return staves[staves.length - 1];

      }
    };

    const setText = ({ stave, staveConnector, text }) => {
      const contents = text.split(/\n/);
      const topY = (1 - contents.length) * 10;
      contents.forEach((content, i) => {
        const textOptions = { shift_y: topY + i * 20 };
        if (stave) {
          const position = Vex.Flow.Modifier.Position.LEFT;
          textOptions.shift_x = 8;
          stave.setText(content, position, textOptions);
        }
        else staveConnector.setText(content, textOptions);
      });
    };

    let page = 1;

    for (let mi = 0; mi < numMeasures; mi++) {
      const connectors = [];
      this.measurePacks[mi].setConnectors(connectors);

      const firstPartMeasure = this.parts[0].getMeasures()[mi];
      const isNewLineStarting = mi === 0 || firstPartMeasure.isNewLineStarting();
      if (firstPartMeasure.hasNewPage()) page++;

      if (isNewLineStarting) {
        const topStave = findTopStave(0, mi, this.parts.length - 1);
        const bottomStave = findBottomStave(this.parts.length - 1, mi, 0);
        if (topStave && bottomStave) {
          const staveConnector = new Vex.Flow.StaveConnector(topStave, bottomStave);
          staveConnector.setType(Vex.Flow.StaveConnector.type.SINGLE_LEFT);
          connectors.push({ page, staveConnector });
        }
      }

      partGroups.forEach(partGroup => {
        const { startPartIndex, stopPartIndex } = partGroup;
        let topStave = findTopStave(startPartIndex, mi, stopPartIndex);
        let bottomStave = findBottomStave(stopPartIndex, mi, startPartIndex);
        if (!topStave || !bottomStave) {
          if (!isNewLineStarting) return;

          topStave = findTopStave(startPartIndex, mi, stopPartIndex + 1);
          bottomStave = findBottomStave(stopPartIndex, mi, startPartIndex - 1);
          if (!topStave || !bottomStave) return;

          const staveConnector = new Vex.Flow.StaveConnector(topStave, bottomStave);
          const connectorType = partGroup.groupSymbol === 'bracket' ?
            Vex.Flow.StaveConnector.type.BRACKET :
            Vex.Flow.StaveConnector.type.SINGLE_LEFT;
          staveConnector.setType(connectorType);

          /* TODO: Current vexflow StaveConnector only provides a single text
          if (mi === 0 && partGroup.groupName)
            setText({ staveConnector, text: partGroup.partName });
          */
          if (mi > 0 && partGroup.groupAbbreviation)
            setText({ staveConnector, text: partGroup.groupAbbreviation });

          connectors.push({ page, staveConnector });
          return;
        }

        if (partGroup.groupBarline) {
          const staveConnector = new Vex.Flow.StaveConnector(topStave, bottomStave);
          staveConnector.setType(Vex.Flow.StaveConnector.type.SINGLE_RIGHT);
          connectors.push({ page, staveConnector });
        }

        if (!isNewLineStarting) return;

        const staveConnector = new Vex.Flow.StaveConnector(topStave, bottomStave);
        let hasGroupSymbol = false;
        if (partGroup.groupSymbol) {
          hasGroupSymbol = true;
          const connectorType = getVFConnectorType(partGroup.groupSymbol);
          staveConnector.setType(connectorType);
          staveConnector.setXShift(0);
        }

        if (mi === 0 && partGroup.groupName)
          setText({ staveConnector, text: partGroup.groupName });
        else if (mi > 0 && partGroup.groupAbbreviation)
          setText({ staveConnector, text: partGroup.groupAbbreviation });

        // TODO: update vexflow StaveConnector NONE type
        if (!hasGroupSymbol) staveConnector.setType(Vex.Flow.StaveConnector.type.SINGLE_LEFT);

        connectors.push({ page, staveConnector });
      });

      // single part && multiple-staff
      this.parts.forEach((part, pi) => {
        const scorePart = scoreParts[pi];
        const staves = part.getMeasures()[mi].getStaves();

        if (staves.length === 1) {
          const stave = staves[0];
          if (mi === 0 && scorePart.partName)
            setText({ stave, text: scorePart.partName });
          else if (mi > 0 && isNewLineStarting && scorePart.partAbbreviation)
            setText({ stave, text: scorePart.partAbbreviation });

          return;
        } else if (!staves) return;

        const [topStave, bottomStave] = [staves[0], staves[staves.length - 1]];
        if (!topStave || !bottomStave) return;

        if (isNewLineStarting) {
          let staveConnector = new Vex.Flow.StaveConnector(topStave, bottomStave);
          staveConnector.setType(Vex.Flow.StaveConnector.type.BRACE);
          connectors.push({ page, staveConnector });

          if (mi === 0 && scorePart.partName)
            setText({ staveConnector, text: scorePart.partName });
          else if (mi > 0 && isNewLineStarting && scorePart.partAbbreviation)
            setText({ staveConnector, text: scorePart.partAbbreviation });

          staveConnector = new Vex.Flow.StaveConnector(topStave, bottomStave);
          staveConnector.setType(Vex.Flow.StaveConnector.type.SINGLE_LEFT);
          connectors.push({ page, staveConnector });
        }

        const staveConnector = new Vex.Flow.StaveConnector(topStave, bottomStave);
        staveConnector.setType(Vex.Flow.StaveConnector.type.SINGLE_RIGHT);
        connectors.push({ page, staveConnector });
      });
    }
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

  _formatNote(note, clef, divisions) {
    if (note.getHidden()) {
      return new Vex.Flow.GhostNote({ duration: getVFDuration(note, divisions) });
    }

    const data = {
      keys: [],
      duration: getVFDuration(note, divisions),
      clef: note.getRest() ? 'treble' : getVFClef(clef),
    };

    const accidentals = [];
    note.getHeads().forEach(({step, octave, accidental}) => {
      data.keys.push(`${step}/${octave}`);
      accidentals.push(accidental ? accidental : null);
    });

    if (data.keys.length === 0) data.keys = Table.VF_DEFAULT_REST_KEYS;
    if (note.getFull()) data.align_center = true;
    if (note.getStem()) data.stem_direction = note.getStem() === 'up' ?
      Vex.Flow.StaveNote.STEM_UP : Vex.Flow.StaveNote.STEM_DOWN;

    const staveNote = new Vex.Flow.StaveNote(data);
    accidentals.forEach((accidental, index) => {
      if (!accidental) return;

      const vfAccidental = new Vex.Flow.Accidental(Table.VF_ACCIDENTAL[accidental]);
      staveNote.addAccidental(index, vfAccidental);
    });

    for (let i = 0; i < note.dot; i++) staveNote.addDotToAll();

    return staveNote;
  }

  _formatNotes(part, pi) {
    part.getMeasures().forEach((measure, mi) => {
      const notesMap = measure.getNotesMap();
      const measureCache = this.getMeasureCache(pi, mi);
      const vfVoiceMap = new Map();

      measure.getVoices().forEach(voice => {
        if (measure.getStaves().length === 0) return;

        const vfNotes = [];
        let staff = 1;
        notesMap.get(voice).forEach(note => {
          switch (note.getTag()) {
            case 'note':
              if (note.getGrace()) break; // TODO

              const clef = measureCache.getClef(note.getStaff());
              const divisions = measureCache.getDivisions();
              const staveNote = this._formatNote(note, clef, divisions);
              staveNote.setStave(measure.getStave(note.getStaff()));
              note.setVFNote(staveNote);
              vfNotes.push(staveNote);

              staff = note.staff;
              break;
            case 'clef':
              const clefNote = new Vex.Flow.ClefNote(getVFClef(note), 'small');
              clefNote.setStave(measure.getStave(staff));
              vfNotes.push(clefNote);
              measureCache.setClef(staff, note);
              break;
          }
        });

        const { beats = 4, beatType = 4 } = measureCache.hasTime() ? measureCache.getTime() : {};
        const vfVoice = new Vex.Flow.Voice({ num_beats: beats, beat_value: beatType });
        vfVoice.setMode(Vex.Flow.Voice.Mode.SOFT);
        vfVoice.addTickables(vfNotes);
        vfVoiceMap.set(voice, vfVoice);
      });

      measure.setVFVoiceMap(vfVoiceMap);
    });
  }

  formatNotes() {
    this.parts.forEach((part, pi) => this._formatNotes(part, pi));
  }

  formatVoices() {
    this.measurePacks.forEach((measurePack, mi) => {
      const vfStaves = measurePack.getVFStaves();
      const vfVoices = measurePack.getVFVoices();

      if (vfVoices.length === 0) return;
      // TODO: it should find minimum, not simply using the first stave
      const width = vfStaves[0].getNoteEndX() - vfStaves[0].getNoteStartX() - 10;
      const vfFormatter = (new Vex.Flow.Formatter()).joinVoices(vfVoices);
      const minTotalWidth = vfFormatter.preCalculateMinTotalWidth(vfVoices);

      vfFormatter.format(vfVoices, width);

      measurePack.setMinTotalWidth(minTotalWidth);
      measurePack.setVFFormatter(vfFormatter);
    });
  }

  _formatBeam(part) {
    part.getMeasures().forEach((measure, mi) => {
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
    });
  }

  formatBeam() {
    this.parts.forEach(part => this._formatBeam(part));
  }

  _formatTie(part) {
    const vfTiesMap = new Map();
    // key: voice
    const tieNotesMap = new Map();
    const tieStartIndicesMap = new Map();
    const tieStopIndicesMap = new Map();

    part.getMeasures().forEach((measure, mi) => {
      const notesMap = measure.getNotesMap();

      measure.getVoices().forEach(voice => {
        if (measure.getStaves().length === 0) return;

        if (!tieNotesMap.has(voice)) tieNotesMap.set(voice, []);

        if (measure.isNewLineStarting() && tieNotesMap.get(voice).length > 0) {
          vfTiesMap.get(`${mi - 1}/${voice}`).push(new Vex.Flow.StaveTie({
            first_note: tieNotesMap.get(voice)[0],
            first_indices: tieStartIndicesMap.get(voice),
            last_indices: tieStartIndicesMap.get(voice),
          }));

          tieNotesMap.get(voice)[0] = undefined;
        }

        const vfTies = [];
        notesMap.get(voice).forEach(note => {
          if (note.getTag() !== 'note') return;
          if (note.getGrace()) return; // TODO

          const staveNote = note.getVFNote();

          // 1. stop tie
          if (note.heads &&
              note.heads.filter(head => /^stop/.test(head.tied)).length > 0) {
            let tieNotes = tieNotesMap.get(voice);
            tieNotes.push(staveNote);

            note.heads.forEach((head, index) => {
              if (!/^stop/.test(head.tied)) return;

              if (!tieStopIndicesMap.has(voice)) tieStopIndicesMap.set(voice, []);
              tieStopIndicesMap.get(voice).push(index);
            });

            vfTies.push(new Vex.Flow.StaveTie({
              first_note: tieNotes[0],
              last_note: tieNotes[1],
              first_indices: tieStartIndicesMap.get(voice),
              last_indices: tieStopIndicesMap.get(voice),
            }));

            tieNotesMap.set(voice, []);
            tieStartIndicesMap.set(voice, []);
            tieStopIndicesMap.set(voice, []);
          }

          // 2. start tie
          if (note.heads &&
              note.heads.filter(head => /start$/.test(head.tied)).length > 0) {
            tieNotesMap.set(voice, [staveNote]);
            note.heads.forEach((head, index) => {
              if (!/start$/.test(head.tied)) return;

              if (!tieStartIndicesMap.has(voice)) tieStartIndicesMap.set(voice, []);
              tieStartIndicesMap.get(voice).push(index);
            });
          }
        });

        vfTiesMap.set(`${mi}/${voice}`, vfTies);
      });

      part.setVFTiesMap(vfTiesMap);
    });
  }

  formatTie() {
    this.parts.forEach(part => this._formatTie(part));
  }

  _formatSlur(part) {
    const vfSlursMap = new Map();
    // key: voice
    const slurStateMap = new Map();

    part.getMeasures().forEach((measure, mi) => {
      const notesMap = measure.getNotesMap();

      measure.getVoices().forEach(voice => {
        if (measure.getStaves().length === 0) return;

        if (!slurStateMap.has(voice)) slurStateMap.set(voice, {});

        const slurState = slurStateMap.get(voice);
        if (measure.isNewLineStarting() && slurState.from) {
          const curve = new Vex.Flow.Curve(
            slurState.from, undefined
          );
          vfSlursMap.get(`${mi - 1}/${voice}`).push(curve);
          slurState.from = undefined;
          slurState.partial = true;
        }

        const vfSlurs = [];
        notesMap.get(voice).forEach(note => {
          if (note.getTag() !== 'note') return;
          if (note.getGrace()) return; // TODO
          if (!note.getSlur()) return;

          const slur = note.getSlur();
          const staveNote = note.getVFNote();

          switch (slur.type) {
            case 'start':
              const options = {};
              /* TODO: slur Position.NEAR_BOTTOM required
              if (slur.placement) {
                options.position = slur.placement === 'below' ?
                  Vex.Flow.Curve.Position.NEAR_HEAD :
                  Vex.Flow.Curve.Position.NEAR_TOP;
              }
              */

              slurStateMap.set(voice, { from: staveNote, options });
              break;
            case 'stop':
              const slurState = slurStateMap.get(voice);
              slurState.to = staveNote;

              if (slurState.from === undefined && !slurState.partial) return; // TODO: grace note

              vfSlurs.push(new Vex.Flow.Curve(
                slurState.from, slurState.to, slurState.options
              ));

              slurStateMap.set(voice, {});
              break;
          }
        });

        vfSlursMap.set(`${mi}/${voice}`, vfSlurs);
      });

      part.setVFSlursMap(vfSlursMap);
    });
  }

  formatSlur() {
    this.parts.forEach(part => this._formatSlur(part));
  }

  format() {
    this.resetState();
    this.formatX();
    this.formatY();
    this.createStaves();
    this.formatMeasureNumber();
    this.formatAttributes();
    this.formatDivisions();
    this.formatCredits();
    this.formatPartList();
    //this.formatStaves();
    this.formatNotes();
    this.formatVoices();
    this.formatBeam();
    this.formatTie();
    this.formatSlur();
  }
}
