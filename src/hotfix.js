/*
 * hotfix script
 */

import Vex from '@panarch/allegretto';

// Get the bounding box for the voice
Vex.Flow.Voice.prototype.getBoundingBox = function getBoundingBox() {
  //let stave;
  let boundingBox;
  let bb;
  let i;

  if (!this.boundingBox) {
    //if (!this.stave) throw new Vex.RERR('NoStave', "Can't get bounding box without stave.");
    //stave = this.stave;
    boundingBox = null;

    for (i = 0; i < this.tickables.length; ++i) {
      //this.tickables[i].setStave(stave);

      bb = this.tickables[i].getBoundingBox();
      if (!bb) continue;

      boundingBox = boundingBox ? boundingBox.mergeWith(bb) : bb;
    }

    this.boundingBox = boundingBox;
  }

  return this.boundingBox;
};
