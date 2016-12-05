import Vex from '@panarch/allegretto';
const VF = Vex.Flow;

import { getVFClef, getVFKeySignature } from './Util';

export default class AttributesSubFormatter {
  constructor({ formatter, score }) {
    this.formatter = formatter;
    this.score = score;
  }

  formatClef() {
    this.score.getParts().forEach((part, pi) => {
      const clefsMap = new Map(); // {staff} -> clef[]
      const measures = part.getMeasures();

      measures.forEach((measure, mi) => {
        // Reset existing clefsMap!
        clefsMap.forEach((clefs, staff) => {
          if (clefs.length === 1 && clefs[0].duration === 0) return;

          const clef = Object.assign({}, clefs[clefs.length - 1]);
          clef.duration = 0;
          clefs.splice(0, clefs.length, clef);
        });

        measure.getClefsMap().forEach((clefs, staff) => {
          clefs.forEach(clef => {
            if (clef.duration === 0) clefsMap.set(staff, [clef]);
            else clefsMap.get(staff).push(clef);
          });
        });

        if (mi === 0 || measure.isNewLineStarting()) {
          measure.getStaveMap().forEach((stave, staff) => {
            const vfClef = getVFClef(clefsMap.get(staff)[0]);
            if (vfClef) stave.addClef(vfClef);
          });
        }

        // check end-clef
        clefsMap.forEach((clefs, staff) => {
          const lastClef = clefs[clefs.length - 1];
          if (lastClef.duration > 0 && lastClef.duration >= measure.getMaxDuration()) {
            const vfClef = getVFClef(lastClef);
            const vfStave = measure.getStave(staff);
            if (vfStave) vfStave.addEndClef(vfClef, 'small');
          }
        })

        // update cache
        const cacheClefsMap = new Map();
        clefsMap.forEach((clefs, staff) => cacheClefsMap.set(staff, clefs.slice()));
        this.formatter.getMeasureCache(pi, mi).setClefsMap(cacheClefsMap);

        const nextMeasure = measures[mi + 1];
        if (!nextMeasure || !nextMeasure.isNewLineStarting()) return;

        nextMeasure.getClefsMap().forEach((clefs, staff) => {
          if (clefs[0].duration > 0) return;

          // same clef with prev measure => pass!
          const lastClefs = clefsMap.get(staff);
          const lastClef = lastClefs[lastClefs.length - 1];
          if (lastClef.sign === clefs[0].sign &&
              lastClef.line === clefs[0].line &&
              lastClef.clefOctaveChange === clefs[0].clefOctaveChange) {
            return;
          }

          const vfClef = getVFClef(clefs[0]);
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
        const vfPosition = VF.StaveModifier.Position.BEGIN;
        const vfCategory = VF.Clef.CATEGORY;
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
    this.score.getParts().forEach((part, pi) => {
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
            if (stave instanceof VF.TabStave) return;

            const vfKey = getVFKeySignature(key);
            if (key) stave.addKeySignature(vfKey);
          })
        }

        if (mi > 0 && measure.isNewLineStarting() && keyUpdated) {
          prevMeasure.getStaves().forEach(stave => {
            if (stave instanceof VF.TabStave) return;

            const vfKey = getVFKeySignature(key);
            // TODO: replace it to use StaveModifier later
            const END = 6; // Vex.Flow.StaveModifier.Position.END
            if (key) stave.addKeySignature(vfKey, undefined, END);
          });
        }

        // update cache
        this.formatter.getMeasureCache(pi, mi).setKey(key);
        prevMeasure = measure;
      });
    });
  }

  formatTimeSignature() {
    this.score.getParts().forEach((part, pi) => {
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
        this.formatter.getMeasureCache(pi, mi).setTime(time);
        prevMeasure = measure;
      });
    });
  }

  formatAttributes() {
    this.formatClef();
    this.formatKeySignature();
    this.formatTimeSignature();
  }
}
