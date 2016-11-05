// Copyright (c) Taehoon Moon 2016.
// @author Taehoon Moon

function _rectifyDirectionFingering(measure) {
  // check 1 & 4
  const FINGERS = [1,2,3,4,5].map(a => String(a));
  const fingeringDirections = measure.getDirections().filter(direction => (
    direction.getDirectionType() === 'words' &&
    direction.getWordsList().every(words => FINGERS.indexOf(words.text) >= 0)
  )).filter(direction => {
    // check 2
    const beginDuration = direction.getBeginDuration();
    const notes = measure.getNotesMap().get(direction.getVoice());
    let fingeringNote;
    let duration = 0;

    for (const note of notes) {
      if (beginDuration < duration) break;
      else if (beginDuration > duration) {
        duration += note.getDuration();
        continue;
      }

      if (!note.getRest() && note.getHeads() &&
          note.getVoice() === direction.getVoice() &&
          note.getStaff() === direction.getStaff()) {
        fingeringNote = note;
        break;
      }
    }

    // check 3
    if (!fingeringNote ||
        fingeringNote.getHeads().length !== direction.getWordsList().length) return false;

    // replace this direction to note.heads->fingering
    const heads = fingeringNote.getHeads();
    const wordsList = direction.getWordsList().slice().reverse();
    heads.forEach((head, i) => head.fingering = { text: wordsList[i].text });

    return true;
  });

  fingeringDirections.forEach(direction => {
    const directions = measure.getDirectionsMap().get(direction.getStaff());
    directions.splice(directions.indexOf(direction), 1);
  });
}

/*
 * Sibelius 8.x
 * Convert direction for displaying keyboard fingering to technical fingering
 * 1 Direction with only words
 * 2 Note exists; Note->duration == Direction->beginDuration and same staff, voice
 * 3 words.length == Note keys.length
 * 4 words.textContent should be one of [1, 2, 3, 4, 5]
 */
function rectifyDirectionFingering(score) {
  score.getParts().forEach(part => {
    part.getMeasures().forEach(measure => _rectifyDirectionFingering(measure));
  });
}

export function rectify(score) {
  rectifyDirectionFingering(score);
}

/*
function _rectifySingleStaffCrossStemBeam({ notes, numStaffs }) {
  if (numStaffs !== 2) return;

  const beamNotesList = []; // (Note[])[]
  let beamNotes;

  for (const note of notes) {
    const beam = note.getBeam();

    if (beam === 'begin') {
      beamNotes = [note];
    } else if (beam === 'end') {
      beamNotesList.push(beamNotes);
      beamNotes = null;
    } else if (beamNotes) {
      beamNotes.push(note);
    }
  }

  for (const beamNotes of beamNotesList) {
    let staffSet = new Set();
    let stemSet = new Set();
    beamNotes.forEach(note => {
      staffSet.add(note.getStaff());
      const stem = note.getStem();
      if (stem) stemSet.add(stem); // skip rest
    });

    // check all notes having same staff => if not, pass!
    // all notes have same stem => pass!
    if (staffSet.size > 1 || stemSet.size === 1) continue;
    console.log('hey!;)()');

    // different stem => different staff
    for (const note of notes) {
      const stem = note.getStem();
      if (!stem) continue;
      else if (stem === 'up') note.staff = 1;
      else note.staff = 2;
    }
  }
}

export function rectifySingleStaffCrossStemBeam(score) {
  score.getParts().forEach(part => {
    const numStaffs = part.getNumStaffs();

    part.getMeasures().forEach(measure => {
      measure.getNotesMap().forEach(notes => {
        _rectifySingleStaffCrossStemBeam({ notes, numStaffs });
      });
    });
  });
}
*/
