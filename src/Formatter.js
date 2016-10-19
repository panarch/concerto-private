// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon

import Vex from '@panarch/allegretto';
const VF = Vex.Flow;
//import VFStaveFormatter from './VFStaveFormatter';
import Note from './Note';
import Measure from './Measure';
import Table from './Table';
import {
  getVFClef,
  getVFDuration,
  getVFKeySignature,
  getVFConnectorType,
  getVFBarlineType,
  getVFJustification,
  convertVFBarlineTypeToVFConnectorType,
  splitVFDuration,
  Stack,
  getLineGenerator,
  getMaxDuration,
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
      const clef = measures[0].getClef();
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
            const StaveClass = clef.sign === 'TAB' ? Vex.Flow.TabStave : Vex.Flow.Stave;
            const stave = new StaveClass(x, y, width, options);
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

    // format clef width
    this.score.getMeasurePacks().forEach((measurePack, mi) => {
      if (mi > 0 && !measurePack.getTopMeasure().isNewLineStarting()) {
        return;
      }

      function _getVFClef(vfStave) {
        // TODO: update vexflow
        const vfPosition = 5; //Vex.Flow.StaveModifier.Position.BEGIN;
        const vfCategory = Vex.Flow.Clef.CATEGORY;
        return vfStave.getModifiers(vfPosition, vfCategory)[0];
      }

      const vfStaves = measurePack.getVFStaves();
      let maxWidth = -Infinity;

      vfStaves.forEach(vfStave => {
        const vfClef = _getVFClef(vfStave);
        if (vfClef && vfClef.width > maxWidth) maxWidth = vfClef.width;
      });

      if (maxWidth < 0) return;

      vfStaves.forEach(vfStave => {
        const vfClef = _getVFClef(vfStave);
        if (vfClef) vfClef.setWidth(maxWidth);
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
            if (stave instanceof Vex.Flow.TabStave) return;

            const vfKey = getVFKeySignature(key);
            if (key) stave.addKeySignature(vfKey);
          })
        }

        if (mi > 0 && measure.isNewLineStarting() && keyUpdated) {
          prevMeasure.getStaves().forEach(stave => {
            if (stave instanceof Vex.Flow.TabStave) return;

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

        if (mi > 0 && measure.isNewLineStarting() && timeUpdated) {
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
      if (mi > 0 && firstPartMeasure.hasNewPage()) page++;

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
          topStave.format();

          const staveConnector = new Vex.Flow.StaveConnector(topStave, bottomStave);
          const shiftX = topStave.modifiers[1].getX() - (topStave.getX() + topStave.getWidth());
          staveConnector.setXShift(shiftX);
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

        if (!hasGroupSymbol) staveConnector.setType(Vex.Flow.StaveConnector.type.NONE);

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

        topStave.format();

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

          const vfBarlineType = topStave.modifiers[0].getType();
          const connectorType = convertVFBarlineTypeToVFConnectorType(vfBarlineType, true);
          if (connectorType !== Vex.Flow.StaveConnector.type.SINGLE_LEFT) {
            staveConnector = new Vex.Flow.StaveConnector(topStave, bottomStave);
            const vfBarlineType = topStave.modifiers[0].getType();
            const connectorType = convertVFBarlineTypeToVFConnectorType(vfBarlineType, true);
            const shiftX = topStave.modifiers[0].getX() - topStave.getX();
            staveConnector.setType(connectorType);
            staveConnector.setXShift(shiftX);
            connectors.push({ page, staveConnector });
          }
        }

        const staveConnector = new Vex.Flow.StaveConnector(topStave, bottomStave);
        const vfBarlineType = topStave.modifiers[1].getType();
        const connectorType = convertVFBarlineTypeToVFConnectorType(vfBarlineType, false);
        const shiftX = topStave.modifiers[1].getX() - (topStave.getX() + topStave.getWidth());
        staveConnector.setXShift(shiftX);
        staveConnector.setType(connectorType);
        connectors.push({ page, staveConnector });
      });
    }
  }

  formatBarline() {
    this.parts.forEach(part => part.getMeasures().forEach(measure => {
      const barline = measure.getBarline();
      const vfStaves = measure.getStaves();

      if (barline.left) {
        const vfBarlineType = getVFBarlineType(barline.left);
        vfStaves.forEach(vfStave => vfStave.setBegBarType(vfBarlineType));
      }

      if (barline.right) {
        const vfBarlineType = getVFBarlineType(barline.right);
        vfStaves.forEach(vfStave => vfStave.setEndBarType(vfBarlineType));
      }

    }));
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
    note.getHeads().forEach(({ step, octave, accidental, fret, string }) => {
      data.keys.push(`${step}/${octave}`);
      accidentals.push(accidental ? accidental : null);

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

      const vfAccidental = new Vex.Flow.Accidental(Table.VF_ACCIDENTAL[accidental]);
      staveNote.addAccidental(index, vfAccidental);
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

  _formatNotes(part, pi) {
    part.getMeasures().forEach((measure, mi) => {
      const notesMap = measure.getNotesMap();
      const lyricNamesMap = measure.getLyricNamesMap();
      const measureCache = this.getMeasureCache(pi, mi);
      const vfVoiceMap = new Map();
      const vfLyricVoicesMap = new Map();
      const vfTupletsMap = new Map();

      measure.getVoices().forEach(voice => {
        if (measure.getStaves().length === 0) return;

        const vfNotes = [];
        const vfLyricNotesMap = new Map(); // lyricName -> notes
        let graceNotes = [];
        let staff = 1;
        let clefModifier;
        const lyricNames = lyricNamesMap.has(voice) ? lyricNamesMap.get(voice) : [];
        const notes = notesMap.get(voice);
        notes.forEach(note => {
          switch (note.getTag()) {
            case 'note':
              const clef = measureCache.getClef(note.getStaff());
              const divisions = measureCache.getDivisions();
              const {
                vfNote,
                vfLyricNotesMap: _vfLyricNotesMap = new Map(),
              } = this._formatNote(note, clef, divisions, lyricNames);

              const vfStave = measure.getStave(note.getStaff());

              vfNote.setStave(vfStave);
              _vfLyricNotesMap.forEach(vfLyricNotes => {
                vfLyricNotes.forEach(vfLyricNote => {
                  vfLyricNote.setContext(this.context);
                  vfLyricNote.setStave(vfStave)
                });
              });

              if (clefModifier) {
                vfNote.addModifier(0, clefModifier);
                clefModifier = null;
              }

              note.setVFLyricNotesMap(_vfLyricNotesMap);
              note.setVFNote(vfNote);
              if (note.grace) {
                graceNotes.push(note);
              } else {
                this._formatGraceNotes(vfNote, graceNotes);
                vfNotes.push(vfNote);
                graceNotes = [];
              }

              _vfLyricNotesMap.forEach((_vfLyricNotes, lyricName) => {
                let vfLyricNotes = vfLyricNotesMap.has(lyricName) ?
                  vfLyricNotesMap.get(lyricName) : [];

                vfLyricNotes = vfLyricNotes.concat(_vfLyricNotes);
                vfLyricNotesMap.set(lyricName, vfLyricNotes);
              });

              staff = note.staff;
              break;
            case 'clef':
              const clefNote = new Vex.Flow.ClefNote(getVFClef(note), 'small');
              clefNote.setStave(measure.getStave(staff));
              measureCache.setClef(staff, note);

              clefModifier = new Vex.Flow.NoteSubGroup([clefNote]);
              break;
          }
        });

        if (clefModifier) {
          measure.getStave(staff).addEndClef(clefModifier.subNotes[0].type, 'small');
        }

        vfTupletsMap.set(voice, this._formatTuplet(notes));

        const { beats = 4, beatType = 4 } = measureCache.hasTime() ? measureCache.getTime() : {};
        const voiceOptions = { num_beats: beats, beat_value: beatType };
        const vfVoice = new Vex.Flow.Voice(voiceOptions);
        vfVoice.setMode(Vex.Flow.Voice.Mode.SOFT);
        vfVoice.addTickables(vfNotes);
        vfVoiceMap.set(voice, vfVoice);

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

      measure.setVFVoiceMap(vfVoiceMap);
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
    const maxYMap = new Map(); // voice -> maxY
    measures.forEach(measure => measure.getVoices().forEach(voice => {
      const vfVoice = measure.getVFVoice(voice);
      if (!vfVoice) return; // empty measure

      const vfBoundingBox = vfVoice.getBoundingBox();
      if (!vfBoundingBox) return;

      if (!maxYMap.has(voice)) maxYMap.set(voice, -Infinity);

      const { y, h } = vfBoundingBox;
      const maxY = y + h;
      if (maxY > maxYMap.get(voice)) maxYMap.set(voice, maxY);

    }));

    measures.forEach(measure => {
      measure.getNotesMap().forEach((notes, voice) => {
        const y = maxYMap.get(voice);
        let line;

        notes.forEach(note => {
          note.getVFLyricNotesMap().forEach((vfLyricNotes, i) => vfLyricNotes.forEach(vfLyricNote => {
            if (vfLyricNote instanceof Vex.Flow.GhostNote) return;

            if (!line) {
              const vfStave = vfLyricNote.getStave();
              const height = y - vfStave.getYForLine(0);
              line = height / vfStave.getSpacingBetweenLines();
              line += 3 + 0.2;
            }

            vfLyricNote.setLine(line + i * 2);
          }));
        });
      });
    });
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

  _formatDirectionBeginDurations(measure, measureCache) {
    const directionsMap = measure.getDirectionsMap();
    const notesMap = measure.getNotesMap();

    directionsMap.forEach((directions, staff) => directions.forEach(direction => {
      // 1. if begin duration >= measure duration
      // => set begin duration as measure duration / 2
      const duration = getMaxDuration(notesMap);
      if (direction.getBeginDuration() >= duration) {
        direction.setBeginDuration(duration / 2);
        return;
      }

      if (direction.getDirectionType() !== 'dynamics') return; // TODO
      else if (direction.getBeginDuration() > 0 || direction.getDefaultX() == null) return;

      const defaultX = direction.getDefaultX();
      let maxDuration = 0;

      // Ensure all notes have defaultX
      notesMap.forEach(notes => {
        if (notes.length === 0 || notes[0].getDefaultX() == null) return;

        let lastDuration = 0;
        let sumDuration = 0;
        let gap = Infinity;

        for (const note of notes) {
          if (note.getDefaultX() == null) return; // not break, return

          const newGap = Math.abs(note.getDefaultX() - defaultX);

          if (gap < newGap) break;
          else gap = newGap;

          sumDuration += lastDuration;
          lastDuration = note.getDuration();
        }

        if (sumDuration > maxDuration) maxDuration = sumDuration;
      });

      if (maxDuration > direction.getBeginDuration()) direction.setBeginDuration(maxDuration);
    }));

  }

  _calculateDirectionBoundingBox({ direction, notesMap, vfStave }) {
    let boundingBox;
    const endDuration = direction.getBeginDuration() + direction.getDuration();

    notesMap.forEach(notes => {
      let duration = 0;

      for (const note of notes) {
        if (duration > endDuration) break;

        duration += note.getDuration();
        if (note.getStaff() !== direction.getStaff() ||
              duration < direction.getBeginDuration()) {
          continue;
        }

        const noteBoundingBox = note.getVFNote().getBoundingBox();
        if (boundingBox) boundingBox.mergeWith(noteBoundingBox);
        else boundingBox = noteBoundingBox;
      }
    });

    return boundingBox;
  }

  // @support dynamics
  _formatDirectionDurations(measure, measureCache) {
    const directionsMap = measure.getDirectionsMap();
    const notesMap = measure.getNotesMap();
    const divisions = measureCache.getDivisions();
    const maxDuration = getMaxDuration(notesMap);

    directionsMap.forEach((directions, staff) => directions.forEach(direction => {
      const directionType = direction.getDirectionType();
      if (!['dynamics', 'wedge'].includes(directionType)) return;

      const vfStave = measure.getStave(staff);

      let vfDirectionNote;
      switch (directionType) {
      case 'dynamics':
        direction.setDuration(divisions);
        vfDirectionNote = new VF.TextDynamics({
          text: direction.getDynamicType(),
          duration: getVFDuration(direction, divisions),
        });
        vfDirectionNote.setStave(vfStave).preFormat();
        break;
      case 'wedge':
        if (direction.getDuration() === 0) {
          console.warn(`[warn] measure number ${measure.number}, found duration 0 direction`);
          return;
        }

        const vfDuration = getVFDuration(direction, divisions);
        const sumDuration = direction.getBeginDuration() + direction.getDuration();
        vfDirectionNote = new VF.GhostNote({ duration: vfDuration });

        if (sumDuration < maxDuration) {
          const vfDirectionEndNote = new VF.GhostNote({
            duration: getVFDuration(new Note({ duration: maxDuration - sumDuration }), divisions),
          });

          vfDirectionEndNote.setStave(vfStave);
          direction.setVFEndNote(vfDirectionEndNote);
        }

        vfDirectionNote.setStave(vfStave);
        break;
      }

      direction.setVFNote(vfDirectionNote);

      const spacing = vfStave.getSpacingBetweenLines();
      const placement = direction.getPlacement();
      const boundingBox = this._calculateDirectionBoundingBox({ direction, notesMap, vfStave });

      if (placement === 'above') {
        const maxY = boundingBox.getY();
        const maxLine = 1.5 + Math.min(0, (maxY - vfStave.getYForLine(0)) / spacing);

        direction.setMaxLine(maxLine);
      } else {
        const numLines = vfStave.getNumLines();
        const minY = boundingBox.getY() + boundingBox.getH();
        const minLine = numLines + 1 + Math.max(0, (minY - vfStave.getBottomLineY()) / spacing);

        direction.setMinLine(minLine);
      }

    }));
  }

  _formatDirection(measure, measureCache) {
    const directionsMap = measure.getDirectionsMap();
    const divisions = measureCache.getDivisions();
    const { beats = 4, beatType = 4 } = measureCache.hasTime() ? measureCache.getTime() : {};
    const voiceOptions = { num_beats: beats, beat_value: beatType };

    // 1. calculate begin duration of directions.
    this._formatDirectionBeginDurations(measure, measureCache);

    // 2. calculate duration of directions.(make [beginDuration, duration] pairs)
    this._formatDirectionDurations(measure, measureCache);

    // 3. Fill vfDirectionVoicesMap
    const vfDirectionVoicesMap = new Map(); // staff -> vfVoice[]

    directionsMap.forEach((directions, staff) => {
      directions.forEach(direction => {
        const vfNote = direction.getVFNote();
        if (!vfNote) return;

        const line = direction.getPlacement() === 'above' ?
          direction.getMaxLine() : direction.getMinLine() + 4;

        direction.setLine(line);

        if (vfNote instanceof VF.GhostNote) return;

        direction.getVFNote().setLine(line);
      });

      // TODO: Join multiple directions into same voice
      directions.forEach(direction => {
        const vfNote = direction.getVFNote();
        const vfEndNote = direction.getVFEndNote();
        if (!vfNote) return;

        const vfDirectionVoice = new VF.Voice(voiceOptions);
        vfDirectionVoice.setMode(VF.Voice.Mode.SOFT);

        const vfTickables = [];

        if (direction.getBeginDuration() > 0) {
          const vfDuration = getVFDuration(new Note({ duration: direction.getBeginDuration() }), divisions);
          const ghostNote = new VF.GhostNote(vfDuration);
          const vfStave = measure.getStave(direction.getStaff());
          ghostNote.setStave(vfStave)
          vfTickables.push(ghostNote);
        }

        vfTickables.push(vfNote);
        if (vfEndNote) vfTickables.push(vfEndNote);

        vfDirectionVoice.addTickables(vfTickables);
        vfDirectionVoice.setStave(measure.getStave(staff));

        if (vfDirectionVoicesMap.has(staff)) {
          vfDirectionVoicesMap.get(staff).push(vfDirectionVoice);
        } else {
          vfDirectionVoicesMap.set(staff, [vfDirectionVoice]);
        }
      });

    });

    measure.setVFDirectionVoicesMap(vfDirectionVoicesMap);
  }

  _createVFElementFromDirection({ measure, mi, pi }) {
    const directions = measure.getDirections().filter(direction => (
      direction.getDirectionType() === 'wedge' &&
      !['continue'].includes(direction.getWedge().type)
    ));

    const initGetNextMeasure = mi => {
      let _mi = mi;
      return () => this.parts[pi].getMeasures()[++_mi];
    }

    directions.forEach(direction => {
      const getNextMeasure = initGetNextMeasure(mi);
      const vfNote = direction.getVFNote();
      if (!vfNote) return;

      const isCrescendo = direction.getWedge().type === 'crescendo';
      const line = direction.getLine();

      let lineDirection = direction; // first direction of line
      let lastDirection = direction;
      let nextDirection = direction.getNextDirection();
      let lineChanged = false;

      while (nextDirection) {
        const _measure = getNextMeasure();
        const isNewLine = _measure.isNewLineStarting();

        if (isNewLine) { // flush!
          lineChanged = true;

          lineDirection.setVFElement(new VF.Wedge({
            beginNote: lineDirection.getVFNote(),
            endStave: lastDirection.getVFNote().getStave(),
            beginHeight: isCrescendo ? 0 : 10,
            endHeight: isCrescendo ? 8 : 4,
            line,
          }));

          lineDirection = nextDirection;
        }

        lastDirection = nextDirection;
        nextDirection = lastDirection.getNextDirection();
      }

      const options = {
        endHeight: isCrescendo ? 10 : 0,
        line,
      };

      if (!lastDirection.getVFNote()) return;

      const vfEndNote = lastDirection.getVFEndNote();
      if (vfEndNote) options.endNote = vfEndNote;
      else options.endStave = lastDirection.getVFNote().getStave();

      if (lineChanged) {
        options.beginStave = lineDirection.getVFNote().getStave();
        options.beginHeight = isCrescendo ? 4 : 8;
      } else {
        options.beginNote = lineDirection.getVFNote();
        options.beginHeight = isCrescendo ? 0 : 10;
      }

      lineDirection.setVFElement(new VF.Wedge(options));
    });
  }

  // @before formatLyric
  formatDirection() {
    // reset
    this.parts.forEach(part => part.getMeasures().forEach(measure => {
      measure.getDirections().forEach(direction => {
        direction.setVFNote(null);
        direction.setVFEndNote(null);
        direction.setVFElement(null);
      });
    }));

    this.parts.forEach((part, pi) => {
      part.getMeasures().forEach((measure, mi) => {
        const measureCache = this.getMeasureCache(pi, mi);
        this._formatDirection(measure, measureCache);
      });
    });

    // create VFElement from GhostNote (Wedge...)
    this.parts.forEach((part, pi) => {
      part.getMeasures().forEach((measure, mi) => {
        this._createVFElementFromDirection({ measure, mi, pi });
      });
    });

    // joinVoices to existing formatters!
    this.measurePacks.forEach(measurePack => {
      const vfDirectionVoices = measurePack.getVFDirectionVoices();
      if (vfDirectionVoices.length === 0) return;

      measurePack.getVFFormatter().joinVoices(vfDirectionVoices);
    });
  }

  formatVoices() {
    this.measurePacks.forEach((measurePack, mi) => {
      const vfStaves = measurePack.getVFStaves();
      const vfLyricVoices = measurePack.getVFLyricVoices();
      const vfVoices = measurePack.getVFVoices().concat(vfLyricVoices);

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

      const width = minEndX - maxStartX - 10;
      const vfFormatter = new Vex.Flow.Formatter();
      vfVoices.forEach(_vfVoice => vfFormatter.joinVoices([_vfVoice]));

      minTotalWidth = Math.max(vfFormatter.preCalculateMinTotalWidth(vfVoices), minTotalWidth);

      //vfFormatter.format(vfVoices, width); -> runFormatter
      measurePack.setWidth(width);
      measurePack.setMinTotalWidth(minTotalWidth);
      measurePack.setVFFormatter(vfFormatter);
    });
  }

  runFormatter() {
    this.measurePacks.forEach(measurePack => {
      const vfVoices = measurePack.getAllVFVoices();
      const width = measurePack.getWidth();
      const vfFormatter = measurePack.getVFFormatter();
      if (!vfFormatter) return;

      vfFormatter.format(vfVoices, width - 5);
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
    this.formatTie();
    this.formatSlur();
  }
}
