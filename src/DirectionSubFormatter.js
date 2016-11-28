import Vex from '@panarch/allegretto';
const VF = Vex.Flow;

import Note from './Note';
import { getVFDuration, getMaxDuration } from './Util';

export default class DirectionSubFormatter {
  constructor({ formatter, score }) {
    this.formatter = formatter;
    this.score = score;
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

        if (note.getStaff() !== direction.getStaff() ||
              duration < direction.getBeginDuration()) {
          duration += note.getDuration();
          continue;
        }

        duration += note.getDuration();

        const noteBoundingBox = note.getVFNote().getBoundingBox();
        if (boundingBox) boundingBox.mergeWith(noteBoundingBox);
        else boundingBox = noteBoundingBox;
      }
    });

    return boundingBox;
  }

  _findBracketTypeEndNote({ notesMap, direction, staff, divisions, vfStave }) {
    const sumDuration = direction.getBeginDuration() + direction.getDuration();
    let endNote;
    let beginDuration;
    let minGap = Infinity;

    notesMap.forEach(notes => {
      let duration = 0;
      for (const note of notes) {
        duration += note.getDuration();

        if (note.getStaff() !== staff) continue;

        if (duration >= sumDuration) {
          const gap = duration - sumDuration;
          if (gap < minGap) {
            minGap = gap;
            endNote = note;
            beginDuration = duration - note.getDuration();
          }

          break;
        }
      }
    });

    let vfEndNote;

    // replace ghost note if bracket is only for a single note
    if (direction.getContent().type !== 'continue' &&
        direction.getBeginDuration() === beginDuration) {
      vfEndNote = new VF.GhostNote({
        duration: getVFDuration(
          new Note({ duration: direction.getDuration() / 2 }), divisions
        ),
      });

      vfEndNote.setStave(vfStave);
    } else {
      vfEndNote = endNote.getVFNote();
    }

    return vfEndNote;
  }

  // @support dynamics
  _formatDirectionDurations(measure, measureCache) {
    const directionsMap = measure.getDirectionsMap();
    const notesMap = measure.getNotesMap();
    const divisions = measureCache.getDivisions();
    const maxDuration = getMaxDuration(notesMap);

    directionsMap.forEach((directions, staff) => directions.forEach(direction => {
      const directionType = direction.getDirectionType();
      if (!['dynamics', 'wedge', 'words', 'octave-shift'].includes(directionType)) return;

      const vfStave = measure.getStave(staff);

      let sumDuration;
      let vfDuration;
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
      case 'words': // StaveText will be used
        direction.setDuration(divisions * 2);
        vfDirectionNote = new VF.GhostNote({ duration: getVFDuration(direction, divisions) });
        vfDirectionNote.setStave(vfStave);
        break;
      case 'octave-shift':
        vfDuration = getVFDuration(direction, divisions);
        sumDuration = direction.getBeginDuration() + direction.getDuration();
        vfDirectionNote = new VF.GhostNote({ duration: vfDuration });

        // stop, find bracket end note
        if (!direction.getNextDirection()) {
          let vfDirectionEndNote = this._findBracketTypeEndNote({
            notesMap: measure.getNotesMap(),
            direction,
            staff,
            divisions,
            vfStave,
          });


          direction.setVFEndNote(vfDirectionEndNote);
        }

        vfDirectionNote.setStave(vfStave);
        break;
      case 'wedge':
        if (direction.getDuration() === 0) {
          console.warn(`[warn] measure number ${measure.number}, found duration 0 direction`);
          return;
        }

        vfDuration = getVFDuration(direction, divisions);
        sumDuration = direction.getBeginDuration() + direction.getDuration();
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
        const vfStaveTopLineY = vfStave.getTopLineTopY();
        const maxY = boundingBox ? boundingBox.getY() : vfStaveTopLineY;
        const maxLine = -2 + Math.min(0, (maxY - vfStaveTopLineY) / spacing);

        direction.setMaxLine(maxLine);
      } else {
        const vfStaveBottomLineY = vfStave.getBottomLineBottomY();
        const numLines = vfStave.getNumLines();
        const minY = boundingBox ? boundingBox.getY() + boundingBox.getH() : vfStaveBottomLineY;
        const minLine = numLines + 1 + Math.max(0, (minY - vfStaveBottomLineY) / spacing);

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
          direction.getMaxLine() : direction.getMinLine();

        direction.setLine(line);

        if (vfNote instanceof VF.GhostNote) return;

        direction.getVFNote().setLine(line + 3.5);
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
        if (vfEndNote && vfEndNote instanceof VF.GhostNote) vfTickables.push(vfEndNote);

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

  _getMockTextBracketNote(vfStave, isEnd) {
    const x = isEnd ?
      vfStave.getX() + vfStave.getWidth() :
      vfStave.getX();

    return {
      getAbsoluteX: () => x,
      getGlyph: () => ({
        getWidth: () => 0,
      }),
      getStave: () => vfStave,
    };
  }

  _getOctaveShiftText(content) {
    return {
      text: content.size,
      superscript: content.type === 'up' ?
        (content.size === 8 ? 'vb' : 'mb') :
        (content.size === 8 ? 'va' : 'ma'),
      position: content.type === 'up' ? -1 : 1,
    };
  }
  /*
   * wedge
   */
  _createMultiMeasureDirectionVFElement({ measure, mi, pi }) {
    const directions = measure.getDirections().filter(direction => (
      ['wedge', 'octave-shift'].includes(direction.getDirectionType()) &&
      !['continue'].includes(direction.getContent().type)
    ));

    const initGetNextMeasure = mi => {
      let _mi = mi;
      return () => this.score.getParts()[pi].getMeasures()[++_mi];
    }

    directions.forEach(direction => {
      const getNextMeasure = initGetNextMeasure(mi);
      const vfNote = direction.getVFNote();
      if (!vfNote) return;

      const directionType = direction.getDirectionType();
      // wedge
      const isCrescendo = direction.getContent().type === 'crescendo';
      // octave-shift
      const content = direction.getContent();
      let line = direction.getLine();
      let lineDirection = direction; // first direction of line
      let lastDirection = direction;
      let nextDirection = direction.getNextDirection();
      let lineChanged = false;

      while (nextDirection) {
        const _measure = getNextMeasure();
        const isNewLine = _measure.isNewLineStarting();

        if (isNewLine) { // flush!
          lineChanged = true;
          let vfElement;

          switch (directionType) {
          case 'wedge':
            vfElement = new VF.Wedge({
              beginNote: lineDirection.getVFNote(),
              endStave: lastDirection.getVFNote().getStave(),
              beginHeight: isCrescendo ? 0 : 10,
              endHeight: isCrescendo ? 8 : 4,
              line,
            });
            break;
          case 'octave-shift':
            const { text, superscript, position } = this._getOctaveShiftText(content);
            vfElement = new VF.TextBracket({
              start: lineDirection.getVFNote(),
              stop: this._getMockTextBracketNote(lastDirection.getVFNote().getStave(), true),
              text,
              superscript,
              position,
            });


            vfElement.render_options.show_bracket = false;
            break;
          }

          lineDirection.setVFElement(vfElement);
          lineDirection = nextDirection;
        }

        line = line > 0 ?
          Math.max(line, nextDirection.getLine()) :
          Math.min(line, nextDirection.getLine());

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

      let vfElement;
      switch (directionType) {
      case 'wedge':
        vfElement = new VF.Wedge(options);
        break;
      case 'octave-shift':
        const { text, superscript, position } = this._getOctaveShiftText(content);
        vfElement = new VF.TextBracket({
          start: lineDirection.getVFNote(),
          stop: options.endNote,
          text,
          superscript,
          position,
        });
        break;
      }

      lineDirection.setVFElement(vfElement);
    });
  }

  // @before formatLyric
  // @after formatVoices: measure width
  formatDirection() {
    // reset
    const parts = this.score.getParts();
    parts.forEach(part => part.getMeasures().forEach(measure => {
      measure.getDirections().forEach(direction => {
        direction.setVFNote(null);
        direction.setVFEndNote(null);
        direction.setVFElement(null);
      });
    }));

    parts.forEach((part, pi) => {
      part.getMeasures().forEach((measure, mi) => {
        const measureCache = this.formatter.getMeasureCache(pi, mi);
        this._formatDirection(measure, measureCache);
      });
    });

    // create VFElement from GhostNote (Wedge...)
    parts.forEach((part, pi) => {
      part.getMeasures().forEach((measure, mi) => {
        this._createMultiMeasureDirectionVFElement({ measure, mi, pi });
      });
    });

    // joinVoices to existing formatters!
    this.score.getMeasurePacks().forEach(measurePack => {
      const vfDirectionVoices = measurePack.getVFDirectionVoices();
      if (vfDirectionVoices.length === 0) return;

      measurePack.getVFFormatter().joinVoices(vfDirectionVoices);
    });
  }

  _postFormatWordsTypeDirection(measure) {
    const directions = measure.getDirections().filter(direction => (
      direction.getDirectionType() === 'words' &&
        !this._isRepetitionWords(direction.getWordsList()[0].text)
    ));

    directions.forEach(direction => {
      const vfStave = measure.getStave(direction.getStaff());
      const vfNote = direction.getVFNote();
      const shiftX = vfNote.getAbsoluteX() - vfStave.getX();
      const shiftY = vfStave.getYForLine(direction.getLine()) - vfStave.getYForLine(0);

      const words = direction.getWordsList()[0];
      const font = {};
      if (words.fontFamily) font.family = words.fontFamily;
      if (words.fontWeight) font.weight = words.fontWeight;
      if (words.fontSize) {
        font.size = isNaN(Number(words.fontSize)) ?
          words.fontSize :
          Math.min(Number(words.fontSize) * 1.3, 14);
      }

      const vfStaveText = new VF.StaveText({
        text: words.text,
        line: direction.getLine(),
        position: VF.StaveModifier.Position.ABOVE,
        options: {
          shift_x: shiftX,
          shift_y: -shiftY * 0,
          justification: VF.StaveText.Justification.LEFT,
        },
      });

      vfStaveText.setFont(font);
      vfStaveText.setStave(vfStave);
      vfStave.modifiers.push(vfStaveText);
      // Prevent vfStave not to cancel formatted
      //vfStave.addModifier(vfStaveText);
    });
  }

  _isRepetitionWords(text) {
    text = text.toLowerCase();
    return ['d.c. al coda', 'd.c. al fine', 'd.s. al coda', 'd.s. al fine',
      'fine', 'd.c.', 'd.s.', 'to coda'].includes(text);
  }

  _getVFRepetitionType(direction) {
    const directionType = direction.getDirectionType();
    const isBegin = direction.getBeginDuration() === 0;
    const Type = VF.Repetition.type;

    if (directionType === 'coda') {
      return isBegin ? Type.CODA_LEFT : Type.CODA_RIGHT;
    } else if (directionType === 'segno') {
      return isBegin ? Type.SEGNO_LEFT : Type.SEGNO_RIGHT;
    } else if (directionType === 'words') {
      switch (direction.getWordsList()[0].text.toLowerCase()) {
      case 'd.c. al coda': return Type.DC_AL_CODA;
      case 'd.c. al fine': return Type.DC_AL_FINE;
      case 'd.s. al coda': return Type.DS_AL_CODA;
      case 'd.s. al fine': return Type.DS_AL_FINE;
      case 'fine': return Type.FINE;
      case 'd.c.': return Type.DC;
      case 'd.s.': return Type.DS;
      case 'to coda': return 'to_coda';
      }
    }

    return vfType;
  }

  // coda, segno
  _postFormatCodaTypeDirection(measure) {
    measure.getDirections().filter(direction => (
      ['coda', 'segno'].includes(direction.getDirectionType()) ||
      (direction.getDirectionType() === 'words' &&
        this._isRepetitionWords(direction.getWordsList()[0].text))
    )).forEach(direction => {
      const vfStave = measure.getStave(direction.getStaff());
      const vfRepetitionType = this._getVFRepetitionType(direction);
      const vfRepetition = new VF.Repetition(vfRepetitionType, vfStave.x, 25);

      vfStave.modifiers.push(vfRepetition);
    });
  }

  /*
   * Format VF.StaveModifier type directions!
   * words
   */
  postFormatDirection() {
    this.score.getParts().forEach((part, pi) => {
      part.getMeasures().forEach((measure, mi) => {
        this._postFormatWordsTypeDirection(measure);
        this._postFormatCodaTypeDirection(measure);
      });
    });
  }
}
