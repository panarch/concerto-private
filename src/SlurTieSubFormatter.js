import Vex from '@panarch/allegretto';
const VF = Vex.Flow;

import Note from './Note';
import { convertToStaffNotesMap } from './Util';

export default class SlurTieSubFormatter {
  constructor({ formatter, score }) {
    this.formatter = formatter;
    this.score = score;
  }

  _calculateSlurControlPoints(vfSlur) {
    vfSlur.preFormat();

    const [x1, x2, y1, y2] = [
      vfSlur.first_x, vfSlur.last_x, vfSlur.first_y, vfSlur.last_y,
    ];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const s = Math.sqrt(dx * dx + dy * dy);
    const l = Math.min(2 + s * 0.1, 20);
    const r = 0.2; // 20%

    const p1 = { x: -vfSlur.direction * l * dy / s, y: l * dx / s };
    const p2 = { x: p1.x, y: p1.y };

    p1.x += dx * r;
    p2.x -= dx * r;
    p1.y += dy * r * vfSlur.direction;
    p2.y -= dy * r * vfSlur.direction;

    vfSlur.render_options.cps = [p1, p2];
    vfSlur.render_options.thickness = 1.5;
  }

  _getSlurPosition(note, placement) {
    if (!note) return;
    else if (!placement) placement = note.getPlacement();

    let position;

    switch (placement) {
    case Note.Placement.ABOVE:
      position = note.getStem() === 'up' ?
        VF.Curve.Position.NEAR_TOP : VF.Curve.Position.NEAR_HEAD;
      break;
    case Note.Placement.BELOW:
      position = note.getStem() === 'up' ?
        VF.Curve.Position.NEAR_HEAD : VF.Curve.Position.NEAR_TOP;
      break;
    }

    return position;
  }

  _getSlurInvert({ from, to, placement }) {
    const note = to ? to : from;
    const stem = note.getStem();
    const invert = (
      (stem === 'up' && placement === Note.Placement.ABOVE) ||
      (stem === 'down' && placement === Note.Placement.BELOW)
    );

    return invert;
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
          const options = {};
          const placement = slurState.from.getPlacement();

          const position = this._getSlurPosition(slurState.from, placement);
          if (position) {
            options.position = position;
            options.position_end = position;
          }

          options.invert = this._getSlurInvert({
            from: slurState.from,
            to: undefined,
            placement,
          });

          const curve = new VF.Curve(
            slurState.from.getVFNote(), undefined, options
          );
          vfSlursMap.get(`${mi - 1}/${voice}`).push(curve);
          slurState.from = undefined;
          slurState.partial = true;
          slurState.placement = placement;
        }

        const vfSlurs = [];
        notesMap.get(voice).forEach(note => {
          if (note.getTag() !== 'note') return;
          if (note.getGrace()) return; // TODO
          if (!note.getSlur()) return;

          const slur = note.getSlur();

          switch (slur.type) {
            case 'start':
              slurStateMap.set(voice, { from: note });
              break;
            case 'stop':
              const slurState = slurStateMap.get(voice);
              slurState.to = note;

              if (slurState.from === undefined && !slurState.partial) return; // TODO: grace note
              let { from, to, placement } = slurState;
              placement = placement ?
                placement :
                (from ? from.getPlacement() : to.getPlacement());

              const options = {};
              const position = this._getSlurPosition(from, placement);
              const positionEnd = this._getSlurPosition(to, placement);
              options.position_end = positionEnd;
              options.position = position ? position : positionEnd;
              options.invert = this._getSlurInvert({ from, to, placement });

              const vfSlur = new VF.Curve(
                from ? from.getVFNote() : undefined,
                to ? to.getVFNote() : undefined,
                options
              );
              this._calculateSlurControlPoints(vfSlur);

              vfSlurs.push(vfSlur);
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
    this.score.getParts().forEach(part => this._formatSlur(part));
  }

  _setTiePlacement(vfTie, placement) {
    if (placement === Note.Placement.ABOVE) {
      vfTie.setDirection(-1);
    } else if (placement !== Note.Placement.SINGLE){
      vfTie.setDirection(1);
    }
  }

  _formatTie(part) {
    const vfTiesMap = new Map(); // {start mi}/{stop mi}/{staff} -> VF.Tie[]
    const tieParamMap = new Map(); // {staff}/{pitch/alter/octave} -> param { mi, headIndex, note }

    part.getMeasures().forEach((measure, mi) => {
      if (measure.isNewLineStarting()) {
        tieParamMap.forEach((tieParam, tieParamKey) => {
          if (!tieParam.note) {
            tieParamMap.delete(tieParamKey);
            return;
          }

          const note = tieParam.note;
          const vfTie = new VF.StaveTie({
            first_note: note.getVFNote(),
            first_indices: [tieParam.headIndex],
          });

          this._setTiePlacement(vfTie, tieParam.note.getPlacement());
          const key = `${tieParam.mi}/${tieParam.note.getStaff()}`;
          vfTiesMap.has(key) ?
            vfTiesMap.get(key).push(vfTie) :
            vfTiesMap.set(key, [vfTie]);

          delete tieParam.note;
          delete tieParam.headIndex;
        });
      }

      const staffNotesMap = convertToStaffNotesMap(measure.getNotesMap());
      staffNotesMap.forEach((notes, staff) => {
        if (!measure.getStave(staff)) return;

        for (const note of notes) {
          const heads = note.getHeads();

          if (!heads) continue;

          // 1. stop tie
          heads.forEach((head, index) => {
            if (!/^stop/.test(head.tied)) return;

            const alter = head.alter !== undefined ? head.alter : 0;
            const tieParamKey = `${staff}/${head.step}/${alter}/${head.octave}`;
            const tieParam = tieParamMap.get(tieParamKey);

            const vfTie = new VF.StaveTie({
              first_note: tieParam.note ? tieParam.note.getVFNote() : undefined,
              first_indices: tieParam.note ? [tieParam.headIndex] : undefined,
              last_note: note.getVFNote(),
              last_indices: [index],
            });

            const key = `${tieParam.note ? tieParam.mi : mi}/${staff}`; // temp
            vfTiesMap.has(key) ?
              vfTiesMap.get(key).push(vfTie) :
              vfTiesMap.set(key, [vfTie]);

            const placement = tieParam.note ?
              tieParam.note.getPlacement() :
              note.getPlacement();
            
            this._setTiePlacement(vfTie, placement);
            tieParamMap.delete(tieParamKey);
          });

          // 2. start tie
          heads.forEach((head, index) => {
            if (!/start$/.test(head.tied)) return;

            const tieParam = { headIndex: index, note, mi };
            const alter = head.alter !== undefined ? head.alter : 0;
            const tieParamKey = `${staff}/${head.step}/${alter}/${head.octave}`;
            tieParamMap.set(tieParamKey, tieParam);
          });
        }
      });

      part.setVFTiesMap(vfTiesMap);
    });
  }

  formatTie() {
    this.score.getParts().forEach(part => this._formatTie(part));
  }
}
