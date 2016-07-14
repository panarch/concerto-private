// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon

import { parseSystemLayout, parseStaffLayout } from './LayoutParser';
import Part from './Part';
import Measure from './Measure';
import Note from './Note';
import ClefNote from './ClefNote';

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

const parseBarline = (data, barlineNote, noteBegin) => {
  const barline = {};
  data[`${noteBegin ? 'right' : 'left'}Barline`] = barline;
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
        };

        if (lineNode)
          clef.line = Number(lineNode.textContent);

        if (clefOctaveChangeNode)
          clef.clefOctaveChange = Number(clefOctaveChangeNode.textContent);

        if (!state.noteBegin) {
          data.clefMap.set(staff, clef);
        } else {
          clef.tag = 'clef';
          data.notesMap.get(state.voice).push(new ClefNote(clef));
        }

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

const sumNotesDuration = notes => {
  return notes.reduce(
    (duration, note) => duration + (note.duration ? note.duration : 0),
    0
  );
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

const parseNoteNotations = (note, head, notationsNode) => {
  if (!notationsNode) return;

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
  if (articulationsNode) parseNoteArticulations(note.notations, articulationsNode);
  if (tupletNodes.length > 0) parseNoteTuplets(note.notations, tupletNodes);
};

const parseNote = (data, noteNode, state) => {
  const staffNode = noteNode.getElementsByTagName('staff')[0];
  const voiceNode = noteNode.getElementsByTagName('voice')[0];
  //const graceNode = noteNode.querySelector('grace');
  const pitchNode = noteNode.getElementsByTagName('pitch')[0];
  const restNode = noteNode.getElementsByTagName('rest')[0];
  const typeNode = noteNode.getElementsByTagName('type')[0];
  const stemNode = noteNode.getElementsByTagName('stem')[0];
  const durationNode = noteNode.getElementsByTagName('duration')[0];
  const accidentalNode = noteNode.getElementsByTagName('accidental')[0];
  const notationsNode = noteNode.getElementsByTagName('notations')[0];
  const beamNodes = [...noteNode.getElementsByTagName('beam')];
  const tieNodes = [...noteNode.getElementsByTagName('tie')];
  const timeModificationNode = noteNode.getElementsByTagName('time-modification')[0];
  const numDots = noteNode.getElementsByTagName('dot').length;
  const staff = staffNode ? Number(staffNode.textContent) : 1;
  const voice = voiceNode ? Number(voiceNode.textContent) : 1;
  //const { onGrace, onChord } = noteState;
  const isNewVoice = data.voices.indexOf(voice) === -1;
  const isNewStaff = data.staffs.indexOf(staff) === -1;
  const isRest = restNode ? true : false;
  const isChord = noteNode.getElementsByTagName('chord')[0] ? true : false;
  const isGrace = noteNode.getElementsByTagName('grace')[0] ? true : false;

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
    // TODO: sonata16.xml grace note handling
    console.error(`notesState.duration(${state.duration}) > notesDuration(${notesDuration})`);
  }

  const note = {
    tag: 'note',
    rest: isRest,
    full: isRest && restNode.getAttribute('measure') === 'yes',
    grace: isGrace,
    heads: [],
    staff: staff,
    voice: voice,
    dot: numDots,
    duration: 0,
    hidden: false, // true for GhostNote
  };

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

      return;
    }

    note.heads.push(pitch);
  }

  if (notationsNode) parseNoteNotations(note, note.heads[0], notationsNode);
  if (durationNode) {
    const duration = Number(durationNode.textContent);
    note.duration = duration;
    state.duration += duration;
  }

  if (typeNode) note.type = typeNode.textContent;
  if (stemNode) note.stem = stemNode.textContent;

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
        parseBarline(data, node, state.noteBegin);
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
        // TODO
        break;
    }
  });
};

const fillNotesMap = notesMap => {
  const maxDuration = [...notesMap.values()].reduce(
    (max, notes) => {
      const sum = sumNotesDuration(notes);
      return max > sum ? max : sum;
    },
    0
  );

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

export const parsePart = partNode => {
  const id = partNode.getAttribute('id');
  const measures = [...partNode.getElementsByTagName('measure')].map(node => {
    const data = {
      number: Number(node.getAttribute('number')),
      width: node.hasAttribute('width') ? Number(node.getAttribute('width')) : 100,
      notesMap: new Map(), // key is voice number
      clefMap: new Map(), // key is staff number
      voices: [],
      staffs: [],
      staffDetailsMap: new Map(), // key is staff number
    };

    if (node.hasAttribute('width'))
      data.width = Number(node.getAttribute('width'));

    parseNotes(data, [...node.childNodes]);
    fillNotesMap(data.notesMap);
    return new Measure(data);
  });

  return new Part({
    id: id,
    measures: measures,
  });
};
