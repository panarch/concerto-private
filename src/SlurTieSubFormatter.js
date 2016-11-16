import Vex from '@panarch/allegretto';
const VF = Vex.Flow;

import Note from './Note';

export default class SlurTieSubFormatter {
  constructor({ formatter, score }) {
    this.formatter = formatter;
    this.score = score;
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

              vfSlurs.push(new VF.Curve(
                from ? from.getVFNote() : undefined,
                to ? to.getVFNote() : undefined,
                options
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
    this.score.getParts().forEach(part => this._formatSlur(part));
  }

  _formatTie(part) {
    const vfTiesMap = new Map();
    // key: voice
    const tieNotesMap = new Map();
    const tieStartIndicesMap = new Map();
    const tieStopIndicesMap = new Map();

    function setPlacement(vfTie, placement) {
      if (placement === Note.Placement.ABOVE) {
        vfTie.setDirection(-1);
      } else if (placement !== Note.Placement.SINGLE){
        vfTie.setDirection(1);
      }
    }

    part.getMeasures().forEach((measure, mi) => {
      const notesMap = measure.getNotesMap();

      measure.getVoices().forEach(voice => {
        if (measure.getStaves().length === 0) return;

        if (!tieNotesMap.has(voice)) tieNotesMap.set(voice, []);

        if (measure.isNewLineStarting() && tieNotesMap.get(voice).length > 0) {
          const firstNote = tieNotesMap.get(voice)[0];
          const vfTie = new VF.StaveTie({
            first_note: firstNote.getVFNote(),
            first_indices: tieStartIndicesMap.get(voice),
            last_indices: tieStartIndicesMap.get(voice),
          });

          setPlacement(vfTie, firstNote.getPlacement());
          vfTiesMap.get(`${mi - 1}/${voice}`).push(vfTie);
          tieNotesMap.get(voice)[0] = undefined;
        }

        const vfTies = [];
        notesMap.get(voice).forEach(note => {
          if (note.getTag() !== 'note') return;
          if (note.getGrace()) return; // TODO

          // 1. stop tie
          if (note.heads &&
              note.heads.filter(head => /^stop/.test(head.tied)).length > 0) {
            let tieNotes = tieNotesMap.get(voice);
            tieNotes.push(note);

            note.heads.forEach((head, index) => {
              if (!/^stop/.test(head.tied)) return;

              if (!tieStopIndicesMap.has(voice)) tieStopIndicesMap.set(voice, []);
              tieStopIndicesMap.get(voice).push(index);
            });

            const vfTie = new VF.StaveTie({
              first_note: tieNotes[0] ? tieNotes[0].getVFNote() : undefined,
              last_note: tieNotes[1].getVFNote(),
              first_indices: tieStartIndicesMap.get(voice),
              last_indices: tieStopIndicesMap.get(voice),
            });

            const placement = tieNotes[0] ?
              tieNotes[0].getPlacement() :
              tieNotes[1].getPlacement();

            setPlacement(vfTie, placement);
            vfTies.push(vfTie);
            tieNotesMap.set(voice, []);
            tieStartIndicesMap.set(voice, []);
            tieStopIndicesMap.set(voice, []);
          }

          // 2. start tie
          if (note.heads &&
              note.heads.filter(head => /start$/.test(head.tied)).length > 0) {
            tieNotesMap.set(voice, [note]);
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
    this.score.getParts().forEach(part => this._formatTie(part));
  }
}
