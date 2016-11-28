// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon

import { parseSystemLayout, parseStaffLayout } from './LayoutParser';
import Part from './Part';
import Measure from './Measure';
import Note from './Note';
import Direction from './Direction';
import { sumNotesDuration, getMaxDuration } from './Util';

const parsePrint = (data, printNode) => {
  const print = {};
  const measureNumberingNode = printNode.getElementsByTagName('measure-numbering')[0];
  const systemLayoutNode = printNode.getElementsByTagName('system-layout')[0];
  const staffLayoutNodes = [...printNode.getElementsByTagName('staff-layout')];

  if (printNode.getAttribute('new-page') === 'yes')
    print.newPage = true;
  else if (printNode.getAttribute('new-system') === 'yes')
    print.newSystem = true;

  if (measureNumberingNode)
    print.measureNumbering = measureNumberingNode.textContent;

  if (systemLayoutNode)
    print.systemLayout = parseSystemLayout(systemLayoutNode);

  if (staffLayoutNodes.length > 0)
    print.staffLayoutMap = parseStaffLayout(staffLayoutNodes);

  data.print = print;
};

const parseBarline = (data, barlineNode) => {
  const barStyleNode = barlineNode.querySelector('bar-style');
  const repeatNode = barlineNode.querySelector('repeat');
  const endingNode = barlineNode.querySelector('ending');
  const barline = {
    location: (
      barlineNode.hasAttribute('location') ? barlineNode.getAttribute('location') : 'right'
    ),
  };

  if (barStyleNode) barline.barStyle = barStyleNode.textContent;
  if (repeatNode) barline.repeat = { direction: repeatNode.getAttribute('direction') }
  if (endingNode) {
    barline.ending = {
      type: endingNode.getAttribute('type'),
      number: endingNode.getAttribute('number'),
      text: (
        endingNode.textContent.lenght > 0 ?
          endingNote.textContent.trim() :
          `${endingNode.getAttribute('number')}.`
      ),
    };
  }

  data.barline[barline.location] = barline;
};

const parseAttributes = (data, attrNode, state) => {
  [...attrNode.childNodes].forEach(node => {
    switch (node.tagName) {
      case 'divisions':
        data.divisions = Number(node.textContent);
        break;
      case 'time':
        data.time = {
          beats: Number(node.getElementsByTagName('beats')[0].textContent),
          beatType: Number(node.getElementsByTagName('beat-type')[0].textContent),
        };

        if (node.hasAttribute('symbol'))
          data.time.symbol = node.getAttribute('symbol');

        break;
      case 'key':
        const cancelNode = node.getElementsByTagName('cancel')[0];
        const modeNode = node.getElementsByTagName('mode')[0];
        data.key = {
          fifths: Number(node.getElementsByTagName('fifths')[0].textContent),
        };

        if (cancelNode) data.key.cancel = Number(cancelNode.textContent);
        if (modeNode) data.key.mode = modeNode.textContent;

        break;
      case 'clef':
        const staff = node.hasAttribute('number') ?
          Number(node.getAttribute('number')) : state.staff;
        const lineNode = node.getElementsByTagName('line')[0];
        const clefOctaveChangeNode = node.getElementsByTagName('clef-octave-change')[0];
        const clef = {
          sign: node.getElementsByTagName('sign')[0].textContent,
          duration: state.duration,
        };

        if (lineNode)
          clef.line = Number(lineNode.textContent);

        if (clefOctaveChangeNode)
          clef.clefOctaveChange = Number(clefOctaveChangeNode.textContent);

        if (data.clefsMap.has(staff)) data.clefsMap.get(staff).push(clef);
        else data.clefsMap.set(staff, [clef]);

        break;
      case 'staff-details':
        const staffSizeNode = node.getElementsByTagName('staff-size')[0];
        const staffDetails = {};

        if (node.hasAttribute('print-object'))
          staffDetails.printObject = node.getAttribute('print-object') === 'yes';

        staffDetails.number = node.hasAttribute('number') ?
          Number(node.getAttribute('number')) : 1;

        if (staffSizeNode)
          staffDetails.staffSize = Number(staffSizeNode.textContent);

        data.staffDetailsMap.set(staffDetails.number, staffDetails);
        break;
      case 'transpose':
        // TODO
        break;
    }
  });
};

const parseDirection = (data, directionNode, state) => {
  const staffNode = directionNode.querySelector('staff');
  const voiceNode = directionNode.querySelector('voice');
  const directionTypeNode = directionNode.querySelector('direction-type');
  const offsetNode = directionNode.querySelector('offset'); // number based on divisions
  const contentNode = directionTypeNode.firstElementChild;

  const direction = {
    tag: 'direction',
    directionType: contentNode.tagName,
    beginDuration: state.duration,
    staff: staffNode ? Number(staffNode.textContent) : state.staff,
    voice: voiceNode ? Number(voiceNode.textContent) : state.voice,
  };

  if (offsetNode) direction.beginDuration += Number(offsetNode.textContent);

  function _toCamel(str) { return str.replace(/\-\w/g, s => s[1].toUpperCase()); }

  switch (contentNode.tagName) {
  case 'dynamics':
    direction.dynamicType = contentNode.firstElementChild.tagName;
    break;
  case 'wedge':
    direction.wedge = {
      type: contentNode.getAttribute('type'), // crescendo | diminuendo | stop
    };

    if (contentNode.hasAttribute('number')) {
      direction.wedge.number = contentNode.getAttribute('number');
    }

    break;
  case 'words':
    direction.wordsList = [...directionTypeNode.children].map(wordsNode => {
      const words = {
        text: wordsNode.textContent.trim(),
      };

      const attrList = [
        'justify', 'valign', 'halign', 'font-size', 'font-weight', 'font-family', 'font-style',
      ];

      attrList.filter(attr => wordsNode.hasAttribute(attr)).forEach(attr => {
        words[_toCamel(attr)] = wordsNode.getAttribute(attr);
      });

      /* VexFlow tweaks
        VexFlow handle font-style using font-weight,
        so font-weight should contain both font-style & font-weight
      */
      if (words.fontStyle) words.fontWeight += ` ${words.fontStyle}`;

      return words;
    });

    break;
  case 'octave-shift':
    direction.octaveShift = {
      type: contentNode.getAttribute('type'),
      size: contentNode.hasAttribute('size') ?
        Number(contentNode.getAttribute('size')) : 8,
    };

    if (contentNode.hasAttribute('number')) {
      direction.octaveShift.number = contentNode.getAttribute('number');
    }

    break;
  case 'segno':
    direction.segno = true;
    break;
  case 'coda':
    direction.coda = true;
    break;
  }

  if (contentNode.hasAttribute('default-x')) {
    direction.defaultX = Number(contentNode.getAttribute('default-x'));
  }

  if (directionNode.hasAttribute('placement')) {
    direction.placement = directionNode.getAttribute('placement');
  }

  if (data.directionsMap.has(direction.staff)) {
    data.directionsMap.get(direction.staff).push(new Direction(direction));
  } else {
    data.directionsMap.set(direction.staff, [new Direction(direction)]);
  }

};

const parseNoteArticulations = (notations, articulationsNode) => {
  notations.articulations = [...articulationsNode.childNodes]
      .filter(node => node.tagName).map(node => {
    if (!node.tagName) return;

    const articulation = { tag: node.tagName };

    function _parseAttr(attr, key, isNumber = true) {
      if (node.hasAttribute(attr)) {
        const value = node.getAttribute(attr);
        articulation[key] = isNumber ? Number(value) : value;
      }
    }

    _parseAttr('default-x', 'defaultX');
    _parseAttr('default-y', 'defaultY');
    _parseAttr('placement', 'placement', false);

    return articulation;
  });
};

const parseNoteTuplets = (notations, tupletNodes) => {
  notations.tuplets = [];

  tupletNodes.forEach(node => {
    const tuplet = {
      type: node.getAttribute('type'),
    };

    if (node.hasAttribute('number')) tuplet.number = Number(node.getAttribute('number'));
    if (node.hasAttribute('placement')) tuplet.placement = node.getAttribute('placement');
    if (node.hasAttribute('bracket')) tuplet.bracket = node.getAttribute('bracket') === 'yes';
    if (node.hasAttribute('show-number')) tuplet.showNumber = node.getAttribute('show-number');

    function getTupletNumber(_node) {
      return Number(_node.getElementsByTagName('tuplet-number')[0].textContent);
    }

    const actualNode = node.getElementsByTagName('tuplet-actual')[0];
    const normalNode = node.getElementsByTagName('tuplet-normal')[0];
    if (actualNode) tuplet.actual = { number: getTupletNumber(actualNode) };
    if (normalNode) tuplet.normal = { number: getTupletNumber(normalNode) };

    notations.tuplets.push(tuplet);
  });
};

const parseNoteTechnical = (note, head, technicalNode) => {
  const fretNode = technicalNode.querySelector('fret');
  const stringNode = technicalNode.querySelector('string');
  const fingeringNode = technicalNode.querySelector('fingering');

  if (fretNode) head.fret = Number(fretNode.textContent);
  if (stringNode) head.string = Number(stringNode.textContent);
  if (fingeringNode) {
    head.fingering = {
      text: fingeringNode.textContent,
    };

    if (fingeringNode.hasAttribute('placement')) {
      head.fingering.placement = fingeringNode.getAttribute('placement');
    }
  }
};

const parseNoteNotations = (note, head, notationsNode) => {
  const arpeggiateNode = notationsNode.getElementsByTagName('arpeggiate')[0];
  const articulationsNode = notationsNode.getElementsByTagName('articulations')[0];
  const tupletNodes = [...notationsNode.getElementsByTagName('tuplet')];
  const tiedNodes = notationsNode.getElementsByTagName('tied');
  const slurNodes = [...notationsNode.getElementsByTagName('slur')].filter(node => {
    return node.getAttribute('type') !== 'continue';
  });

  if (head && tiedNodes.length > 0) {
    head.tied = tiedNodes.length > 1 ? 'stop-and-start' : tiedNodes[0].getAttribute('type');
  }

  if (slurNodes.length > 0) {
    const slurNode = slurNodes[0]; // support only single slur
    note.slur = { type: slurNode.getAttribute('type') };
    if (slurNode.hasAttribute('placement')) {
      note.slur.placement = slurNode.getAttribute('placement');
    }
  }

  note.notations = {};

  if (arpeggiateNode) {
    const arpeggiate = {};
    if (arpeggiateNode.hasAttribute('direction')) {
      arpeggiate.direction = arpeggiateNode.getAttribute('direction');
    }

    note.notations.arpeggiate = arpeggiate;
  }

  if (articulationsNode) parseNoteArticulations(note.notations, articulationsNode);
  if (tupletNodes.length > 0) parseNoteTuplets(note.notations, tupletNodes);
};

const parseNoteLyrics = (note, lyricNodes) => {
  note.lyrics = [];

  lyricNodes.forEach(lyricNode => {
    const lyric = {
      text: lyricNode.getElementsByTagName('text')[0].textContent,
    };

    const syllabicNode = lyricNode.getElementsByTagName('syllabic')[0];
    if (syllabicNode) lyric.syllabic = syllabicNode.textContent;

    function _parseAttr(attr, key, isNumber = false) {
      if (!lyricNode.hasAttribute(attr)) return;

      const value = lyricNode.getAttribute(attr);
      lyric[key] = isNumber ? Number(value) : value;
    }

    _parseAttr('number', 'number');
    _parseAttr('name', 'name');
    _parseAttr('justify', 'justify');
    _parseAttr('placement', 'placement');
    _parseAttr('default-x', 'defaultX', true);
    _parseAttr('default-y', 'defaultY', true);

    note.lyrics.push(lyric);
  });

};

const parseNote = (data, noteNode, state) => {
  const staffNode = noteNode.getElementsByTagName('staff')[0];
  const voiceNode = noteNode.getElementsByTagName('voice')[0];
  const graceNode = noteNode.getElementsByTagName('grace')[0];
  const pitchNode = noteNode.getElementsByTagName('pitch')[0];
  const restNode = noteNode.getElementsByTagName('rest')[0];
  const typeNode = noteNode.getElementsByTagName('type')[0];
  const stemNode = noteNode.getElementsByTagName('stem')[0];
  const durationNode = noteNode.getElementsByTagName('duration')[0];
  const accidentalNode = noteNode.getElementsByTagName('accidental')[0];
  const notationsNode = noteNode.getElementsByTagName('notations')[0];
  const technicalNode = noteNode.getElementsByTagName('technical')[0];
  const lyricNodes = [...noteNode.getElementsByTagName('lyric')];
  const beamNodes = [...noteNode.getElementsByTagName('beam')];
  const tieNodes = [...noteNode.getElementsByTagName('tie')];
  const timeModificationNode = noteNode.getElementsByTagName('time-modification')[0];
  const numDots = noteNode.getElementsByTagName('dot').length;
  const staff = staffNode ? Number(staffNode.textContent) : state.staff;
  const voice = voiceNode ? Number(voiceNode.textContent) : state.voice;
  //const { onGrace, onChord } = noteState;
  const isNewVoice = data.voices.indexOf(voice) === -1;
  const isNewStaff = data.staffs.indexOf(staff) === -1;
  const isRest = restNode ? true : false;
  const isChord = noteNode.getElementsByTagName('chord')[0] ? true : false;
  const isGrace = graceNode ? true : false;

  state.onGrace = isGrace;
  state.onChord = isChord;
  if (state.staff !== staff) state.staff = staff;
  if (state.voice !== voice) state.voice = voice;

  if (isNewVoice) {
    data.voices.push(voice);
    data.notesMap.set(voice, []);
  }

  if (isNewStaff) {
    data.staffs.push(staff);
  }

  const notes = data.notesMap.get(voice);
  const notesDuration = sumNotesDuration(notes);

  if (state.duration > notesDuration) {
    notes.push(new Note({
      tag: 'note',
      duration: state.duration - notesDuration,
      hidden: true,
    }));
  } else if (state.duration < notesDuration) {
    /*
    // TODO: sonata16.xml grace note handling
    console.error(`notesState.duration(${state.duration}) > notesDuration(${notesDuration})`);
    */
  }

  const note = {
    tag: 'note',
    rest: isRest,
    full: isRest && restNode.getAttribute('measure') === 'yes',
    heads: [],
    staff: staff,
    voice: voice,
    dot: numDots,
    duration: 0,
    hidden: false, // true for GhostNote
  };

  if (noteNode.hasAttribute('default-x')) {
    note.defaultX = Number(noteNode.getAttribute('default-x'));
  }

  if (pitchNode) {
    const pitch = {
      step: pitchNode.getElementsByTagName('step')[0].textContent,
      octave: Number(pitchNode.getElementsByTagName('octave')[0].textContent),
    };

    const alterNode = pitchNode.getElementsByTagName('alter')[0];
    if (alterNode) pitch.alter = Number(alterNode.textContent);
    if (accidentalNode) pitch.accidental = accidentalNode.textContent;
    if (tieNodes.length > 0) {
      pitch.tie = tieNodes.length > 1 ? 'stop-and-start' : tieNodes[0].getAttribute('type');
    }

    if (isChord) {
      notes[notes.length - 1].heads.push(pitch);
      if (notationsNode) parseNoteNotations(note, pitch, notationsNode);
      if (technicalNode) parseNoteTechnical(note, pitch, technicalNode);

      return;
    }

    note.heads.push(pitch);
  }

  if (notationsNode) parseNoteNotations(note, note.heads[0], notationsNode);
  if (technicalNode) parseNoteTechnical(note, note.heads[0], technicalNode);
  if (durationNode) {
    const duration = Number(durationNode.textContent);
    note.duration = duration;
    state.duration += duration;
  }

  if (graceNode) note.grace = { slash: graceNode.getAttribute('slash') === 'yes' };
  if (typeNode) note.type = typeNode.textContent;
  if (stemNode) note.stem = stemNode.textContent;
  if (lyricNodes.length > 0) parseNoteLyrics(note, lyricNodes);

  if (beamNodes.length > 0 && beamNodes[0].hasAttribute('number')) {
    beamNodes.sort((prev, next) => {
      return Number(prev.getAttribute('number')) - Number(next.getAttribute('number'));
    });

    note.beam = beamNodes[0].textContent;
  }

  if (timeModificationNode) {
    note.timeModification = {
      actualNotes: Number(timeModificationNode.getElementsByTagName('actual-notes')[0].textContent),
      normalNotes: Number(timeModificationNode.getElementsByTagName('normal-notes')[0].textContent),
    };
  }

  notes.push(new Note(note));
};

const parseNotes = (data, noteNodes) => {
  const state = {
    onGrace: false,
    onChord: false,
    duration: 0,
    staff: 1,
    voice: 1,
    noteBegin: false,
  };

  const getDuration = node => Number(node.getElementsByTagName('duration')[0].textContent);
  noteNodes.forEach(node => {
    switch (node.tagName) {
      case 'print':
        parsePrint(data, node);
        break;
      case 'barline':
        parseBarline(data, node);
        break;
      case 'attributes':
        parseAttributes(data, node, state);
        break;
      case 'note':
        if (node.getAttribute('print-object') === 'no') { // it is forward
          state.duration += getDuration(node);
          break;
        }

        state.noteBegin = true;
        parseNote(data, node, state);
        break;
      case 'forward':
        state.duration += getDuration(node);
        break;
      case 'backup':
        state.duration -= getDuration(node);
        break;
      case 'direction':
        parseDirection(data, node, state);
        break;
    }
  });
};

const fillNotesMap = notesMap => {
  const maxDuration = getMaxDuration(notesMap);

  notesMap.forEach(notes => {
    const duration = maxDuration - sumNotesDuration(notes);
    if (duration <= 0) return;

    notes.push(new Note({
      tag: 'note',
      hidden: true,
      duration,
    }));
  });
};

const setNotePlacements = ({ notesMap: _notesMap, staffs, voices }) => {
  if (voices.length === 1) return; // ALL SINGLE

  const notesMap = new Map(); // clone
  _notesMap.forEach((notes, voice) => (
    notesMap.set(
      voice,
      notes.filter(note => !note.getGrace())
    )
  ));

  let count = 0; // backup for preventing infinite-loop bug
  let duration = 0;
  const notesDurationMap = new Map();
  for (const voice of voices) { notesDurationMap.set(voice, 0); }

  const noteMap = new Map(); // voice -> note
  while (voices.some(voice => notesMap.get(voice).length > 0)) {
    if (count++ > 100) {
      console.warn('setNotePlacements error');
      break;
    }

    const minDuration = voices.reduce((min, voice) => {
      const n = notesMap.get(voice)[0];
      const d = n ? n.getDuration() : Infinity;
      return d < min ? d : min;
    }, Infinity);

    duration += minDuration;

    for (const voice of voices) {
      const notes = notesMap.get(voice);
      if (notes.length === 0) continue;

      let notesDuration = notesDurationMap.get(voice);
      if (notesDuration < duration) {
        noteMap.set(voice, notes[0]);
        notesDuration += notes[0].getDuration();
        notes.splice(0, 1);
      }

      notesDurationMap.set(voice, notesDuration);
    }

    const STEPS = 'CDEFGAB';
    function _compare(note, note2) {
      const heads = note.getHeads();
      const heads2 = note2.getHeads();
      if (heads.length === 0 || heads2.length === 0) {
        return note.getVoice() < note2.getVoice();
      }

      const head = heads[0];
      const head2 = heads2[0];

      if (head.octave !== head2.octave) {
        return head.octave > head2.octave;
      }

      return STEPS.indexOf(head.step) > STEPS.indexOf(head2.step);
    }

    // find staff top/bottom note
    const staffNoteMap = new Map(); // {staff}/(top|bottom) -> Note
    noteMap.forEach((note, voice) => {
      const staff = note.getStaff();
      const [topKey, bottomKey] = [`${staff}/top`, `${staff}/bottom`];
      const topNote = staffNoteMap.get(topKey);
      const bottomNote = staffNoteMap.get(bottomKey);

      if (!topNote) staffNoteMap.set(topKey, note);
      else if (_compare(note, topNote)) staffNoteMap.set(topKey, note);

      if (!bottomNote) staffNoteMap.set(bottomKey, note);
      else if (_compare(bottomNote, note)) staffNoteMap.set(bottomKey, note);
    });

    noteMap.forEach((note, voice) => {
      if (note.getPlacement() !== Note.Placement.SINGLE) return;

      const staff = note.getStaff();
      const [topKey, bottomKey] = [`${staff}/top`, `${staff}/bottom`];
      const topNote = staffNoteMap.get(topKey);
      const bottomNote = staffNoteMap.get(bottomKey);
      let placement;

      if (note === topNote && note === bottomNote)
        placement = staff === 1 ? Note.Placement.ABOVE : Note.Placement.BELOW;
      else if (note === topNote) placement = Note.Placement.ABOVE;
      else if (note === bottomNote) placement = Note.Placement.BELOW;
      else placement = Note.Placement.MID;

      note.setPlacement(placement);
    });
  }
};

const sortClefsMap = clefsMap => {
  clefsMap.forEach(clefs => clefs.sort((a, b) => a.duration > b.duration));
};

const _applyOctaveShift = ({ direction, measures, mi, staff }) => {
  const octaveShift = direction.getOctaveShift();

  let beginDuration = direction.getBeginDuration();
  for (; mi < measures.length; mi++) {
    const measure = measures[mi];
    // check end direction

    let endDuration = Infinity;
    const directions = (measure.getDirectionsMap().has(staff) ?
      measure.getDirectionsMap().get(staff).filter(d => (
        d.getDirectionType() === 'octave-shift' &&
        d.getOctaveShift().type === 'stop' &&
        d.getOctaveShift().number === direction.getOctaveShift().number
      )) : []
    );

    if (directions.length > 0) {
      endDuration = directions[0].getBeginDuration();
    }

    const notesMap = measure.getNotesMap();
    notesMap.forEach(notes => {
      let duration = 0;
      for (const note of notes) {
        if (duration < beginDuration) {
          duration += note.getDuration();
          continue;
        } else if (duration >= endDuration) {
          break;
        }

        duration += note.getDuration();
        if (note.getStaff() !== staff) continue;

        let octaveChange = (octaveShift.size / 7) | 0;
        if (octaveShift.type === 'down') octaveChange = -octaveChange;

        note.setOctaveChange(octaveChange);
      }
    });

    beginDuration = 0;
    if (endDuration < Infinity) break;
  }
};

// direction-type: octave-shift
const applyOctaveShift = measures => {
  measures.forEach((measure, mi) => {
    const directionsMap = measure.getDirectionsMap();

    directionsMap.forEach((directions, staff) => directions.forEach(direction => {
      if (direction.getDirectionType() !== 'octave-shift' ||
          direction.getOctaveShift().type === 'stop') return;

      _applyOctaveShift({ direction, measures, mi, staff });
    }));
  });
};

const _splitMultiMeasureDirection = ({ direction, measures, mi, staff }) => {
  if (['continue', 'stop'].includes(direction.getContent().type)) return;

  const maxDuration = getMaxDuration(measures[mi].getNotesMap());
  if (direction.getBeginDuration() >= maxDuration) {
    direction.setBeginDuration(maxDuration / 2);
  }

  let started = false;
  let stopped = false;
  let nextDirection = direction;
  let stopDirection;
  let stopDirectionIndex;

  for (; mi < measures.length; mi++) {
    const measure = measures[mi];
    const directions = measure.getDirectionsMap().has(staff) ?
      measure.getDirectionsMap().get(staff) : [];

    if (directions.length === 0) measure.setDirections(staff, directions);

    if (started) { // replace next
      nextDirection.setNextDirection(direction.clone());
      nextDirection = nextDirection.getNextDirection();
      nextDirection.getContent().type = 'continue';
      nextDirection.setBeginDuration(0);

      directions.splice(0, 0, nextDirection);
    }

    for (let i = 0; i < directions.length; i++) {
      stopDirection = directions[i];

      if (!started) { // find starting direction first
        if (stopDirection === direction) started = true;

        continue;
      }

      // stop found!
      if (stopDirection.getDirectionType() === direction.getDirectionType() &&
          stopDirection.getContent().number === direction.getContent().number &&
          stopDirection.getContent().type === 'stop') {
        stopped = true;
        stopDirectionIndex = i;

        nextDirection.setDuration(
          stopDirection.getBeginDuration() - nextDirection.getBeginDuration()
        );

        break;
      }
    }

    if (stopped) {
      directions.splice(stopDirectionIndex, 1);
      break;
    }

    const duration = getMaxDuration(measure.getNotesMap()) - nextDirection.getBeginDuration();
    nextDirection.setDuration(duration);
  }

};

// split multi-measure directions
const splitMultiMeasureDirection = measures => {
  const DIRECTIONS = ['wedge', 'octave-shift'];

  measures.forEach((measure, mi) => {
    const directionsMap = measure.getDirectionsMap();

    directionsMap.forEach((directions, staff) => directions.forEach(direction => {
      if (!DIRECTIONS.includes(direction.getDirectionType())) return;

      _splitMultiMeasureDirection({ direction, measures, mi, staff });
    }));
  });
}

export const parsePart = partNode => {
  const id = partNode.getAttribute('id');
  const measures = [...partNode.getElementsByTagName('measure')].map(node => {
    const data = {
      number: Number(node.getAttribute('number')),
      width: node.hasAttribute('width') ? Number(node.getAttribute('width')) : 100,
      notesMap: new Map(), // key is voice number
      directionsMap: new Map(), // key is staff number
      clefsMap: new Map(), // key is staff number -> clef[]
      voices: [],
      staffs: [],
      staffDetailsMap: new Map(), // key is staff number
      barline: {}, // key is left | right
    };

    if (node.hasAttribute('width'))
      data.width = Number(node.getAttribute('width'));

    parseNotes(data, [...node.childNodes]);
    fillNotesMap(data.notesMap);
    setNotePlacements(data);
    sortClefsMap(data.clefsMap);
    return new Measure(data);
  });

  applyOctaveShift(measures);
  splitMultiMeasureDirection(measures);

  return new Part({
    id: id,
    measures: measures,
  });
};
