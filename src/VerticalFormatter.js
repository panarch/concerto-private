import Vex from '@panarch/allegretto';
import AdvancedFormatter from './AdvancedFormatter';
import {
  getVFClef,
  getVFKeySignature,
} from './Util';

export default class VerticalFormatter extends AdvancedFormatter {
  constructor(score, {
    infinite = true,
    zoomLevel = 100,
    innerWidth = window.innerWidth,
    innerHeight = window.innerHeight,
  }) {
    super(score);

    this.infinite = infinite;
    this.innerWidth = innerWidth;
    this.innerHeight = innerHeight;
    this.ratio = zoomLevel === 'height' ? 1 : 100 / zoomLevel; // based on window.innerWidth;
    this.width = innerWidth * this.ratio;
    this.height = null;
    this.minRatio = null;

    this._originalPageSize = this.defaults.getPageSize();
    this._mockStave = new Vex.Flow.Stave(0, 0, 100);
  }

  getMinRatio() { return this.minRatio; }

  removeTopSystemDistances(startIndex = 0) {
    this.score.getParts()[0].getMeasures().forEach((measure, mi) => {
      if (startIndex <= mi && measure.hasTopSystemDistance()) {
        delete measure.print.systemLayout.topSystemDistance;
      }
    });
  }

  getMeasureBottomY(measure) {
    return Math.max(...measure.staffYMap.values()) + 120;
  }

  updatePageSize() {
    const defaults = this.score.getDefaults();
    const parts = this.score.getParts();
    const measures = parts[parts.length - 1].getMeasures();
    const lastMeasure = measures[measures.length - 1];
    const height = this.infinite ? this.getMeasureBottomY(lastMeasure) : this.height;

    defaults.pageLayout.pageWidth = this.width;
    defaults.pageLayout.pageHeight = height;
  }

  // Merge left margin into page margins
  updateLeftMargins() {
    const defaults = this.score.getDefaults();
    const topPart = this.score.getParts()[0];
    const firstMeasure = topPart.getMeasures()[0];

    let maxLeftMargin = 0;
    topPart.getMeasures().forEach((measure, i) => {
      if (i === 0) return;

      const systemLayout = measure.getSystemLayout();
      if (!systemLayout || !systemLayout.systemMargins) return;

      const { leftMargin } = systemLayout.systemMargins;
      if (maxLeftMargin < leftMargin) maxLeftMargin = leftMargin;
    });

    // Update page margins
    const pageMarginsMap = defaults.getPageMarginsMap();
    if (pageMarginsMap) {
      ['both', 'even', 'odd'].forEach(type => {
        if (!pageMarginsMap.has(type)) return;

        pageMarginsMap.get(type)['leftMargin'] += maxLeftMargin;
      });
    }

    // Update firstMeasure left margin
    const systemLayout = firstMeasure.getSystemLayout();
    if (systemLayout && systemLayout.systemMargins) {
      systemLayout.systemMargins.leftMargin -= maxLeftMargin;
    }

    // Remove all system left margins except the top first measure
    topPart.getMeasures().forEach((measure, i) => {
      if (i === 0) return;

      const systemLayout = measure.getSystemLayout();
      if (!systemLayout || !systemLayout.systemMargins) return;

      systemLayout.systemMargins.leftMargin = 0;
    });

    // Remove defaults system-layout left margin value
    const systemMargins = this.score.getDefaults().getSystemMargins();
    if (systemMargins) systemMargins.leftMargin = 0;
  }

  resetStaveModifiers() {
    this.score.getParts().forEach(part => {
      part.getMeasures().forEach(measure => {
        measure.getStaves().forEach(stave => {
          // remove all stave modifiers except beg & end barlines
          stave.modifiers.splice(2);
          stave.format();
        });
      });
    });
  }

  calculateMinZoomLevel() {
    const measurePacks = this.score.getMeasurePacks();

    let minWidth = 0;
    measurePacks.forEach((measurePack, mi) => {
      const minTotalWidth = measurePack.getMinTotalWidth() +
        this.getBeginAttributesWidth(measurePack, mi, true);

      if (minWidth < minTotalWidth) minWidth = minTotalWidth;
    });

    minWidth += 200;

    const measure = measurePacks[0].getBottomMeasure();
    const minHeight = this.getMeasureBottomY(measure);

    const widthRatio = minWidth / this.innerWidth;
    const heightRatio = minHeight / this.innerHeight;
    this.minRatio = !this.infinite ? Math.max(widthRatio, heightRatio) : widthRatio;

    if (this.infinite && this.width < minWidth) {
      this.ratio = this.minRatio;
      this.width = this.innerWidth * this.ratio;
    } else if (!this.infinite) {
      this.height = this.innerHeight * this.ratio;

      if (this.width < minWidth || this.height < minHeight) {
        this.ratio = this.minRatio;
        this.width = this.innerWidth * this.ratio;
        this.height = this.innerHeight * this.ratio;
      }
    }
  }

  getPageSideMargin() {
    const defaults = this.score.getDefaults();
    return defaults.getPageLeftMargin(0) + defaults.getPageRightMargin(0);
  }

  getBeginAttributesWidth(measurePack, mi, useCache = false) {
    let maxWidth = 0;
    measurePack.measures.forEach((measure, pi) => {
      const measureCache = this.getMeasureCache(pi, mi);
      const _measure = useCache ? measureCache : measure;
      let width = 0;

      if (_measure.hasTime()) {
        const time = _measure.getTime();
        const vfTimeSig = new Vex.Flow.TimeSignature(`${time.beats}/${time.beatType}`)
        width += vfTimeSig.getWidth() + vfTimeSig.getPadding();
      }

      if (_measure.getKey()) {
        const vfKeySig = new Vex.Flow.KeySignature(getVFKeySignature(_measure.getKey()));
        vfKeySig.setStave(this._mockStave);
        width += vfKeySig.getWidth() + vfKeySig.getPadding();
      }

      // find max width... although it should be same
      let maxClefWidth = 0;
      measure.staffs.forEach(staff => {
        const clef = _measure.getClef(staff);
        if (!clef) return;

        const vfClef = new Vex.Flow.Clef(getVFClef(clef));
        vfClef.setStave(this._mockStave);
        const clefWidth = vfClef.getWidth() + vfClef.getPadding();
        if (clefWidth > maxClefWidth) maxClefWidth = clefWidth;
      });

      width += maxClefWidth;

      if (width > maxWidth) maxWidth = width;
    });

    return maxWidth;
  }

  updateMeasureLine({ measurePacks, packIndices, packWidths }) {
    packIndices.forEach((mi, i) => {
      const w = packWidths[i];
      measurePacks[mi].measures.forEach(measure => measure.width = w);
    });

    // no newSystem for the first measure
    if (packIndices[0] === 0) return;

    // add print.newSystem
    measurePacks[packIndices[0]].measures.forEach(measure => {
      if (!measure.hasPrint()) measure.print = {};

      measure.print.newSystem = true;
    });
  }

  reflow() {
    const PADDING = 40;
    const pageSideMargin = this.getPageSideMargin();
    const measurePacks = this.score.getMeasurePacks();

    let packWidths;
    let packIndices;
    let fullWidth;
    let width;
    let started = false; // whether new line started or not
    measurePacks.forEach((measurePack, i) => {
      let packWidth = measurePack.getMinTotalWidth();
      packWidth += PADDING; // default margin including noteStartX & noteEndX
      packWidth += this.getBeginAttributesWidth(measurePack, i, !started);

      if (!started) {
        packWidths = [];
        packIndices = [];
        fullWidth = this.width
            - pageSideMargin
            - measurePack.measures[0].getLeftMargin(0);

        width = fullWidth;
        started = true;
      }

      packWidths.push(packWidth);
      packIndices.push(i);

      width -= packWidth;

      /*
        nWidth: nextWidth
        nPack: nextMeasurePack
        nnPack: nextNextMeasurePack
      */
      let nextWidth;
      let remainingWidth;
      const nPack = measurePacks[i + 1];
      const nnPack = measurePacks[i + 2];
      if (!nPack) {
        remainingWidth = Math.min(width / packWidths.length, 50);
      } else {
        const nBeginAttributesWidth = this.getBeginAttributesWidth(nPack, i + 1);
        nextWidth = nPack.getMinTotalWidth();
        nextWidth += PADDING;
        nextWidth += nBeginAttributesWidth;
        if (nnPack) nextWidth += this.getBeginAttributesWidth(nnPack, i + 2);

        if (nextWidth < width) return; // it's ok to go next!

        // Flush the line, apply attributes width to the last measure of the current line!
        width -= nBeginAttributesWidth;
        packWidths[packWidths.length - 1] += nBeginAttributesWidth;

        remainingWidth = Math.max(width / packWidths.length, 0);
      }

      // Finish the current line
      packWidths = packWidths.map(w => w + remainingWidth);
      this.updateMeasureLine({ measurePacks, packIndices, packWidths });

      started = false;
    });
  }

  /*
  @after
    - reflow
    - formatY
  */
  split() {
    let offset = 0;
    const pageTopMargin = this.defaults.getPageTopMargin(1);
    const topSystemDistance = 60 - pageTopMargin;

    const measurePacks = this.score.getMeasurePacks();
    measurePacks.forEach(measurePack => {
      const topMeasure = measurePack.getTopMeasure();
      if (!topMeasure.isNewLineStarting()) return;

      const y = this.getMeasureBottomY(measurePack.getBottomMeasure()) - 40;
      if (y - offset > this.height) {
        offset = topMeasure.getY() - 60;
        topMeasure.print.systemLayout = { topSystemDistance };

        measurePack.measures.forEach(measure => {
          measure.print.newSystem = false;
          measure.print.newPage = true;
        });
      }
    });
  }

  // not used
  updateStaveWidths() {
    this.score.getParts().forEach(part => {
      part.getMeasures().forEach(measure => {
        measure.getStaves().forEach(stave => stave.setWidth(measure.getWidth()));
      });
    });
  }

  // not used
  updateStaveXYs() {
    this.score.getParts().forEach(part => {
      part.getMeasures().forEach(measure => {
        measure.staffs.forEach(staff => {
          const stave = measure.getStave(staff);
          stave.setX(measure.getX());
          stave.setY(measure.getStaffY(staff));
        });
      });
    });
  }

  /*
  @after
    - updatePageSize
  */
  formatCredits() {
    const pageSize = this.score.getDefaults().getPageSize();
    const { width, height } = this._originalPageSize;
    const midStartX = width / 2 - 100;
    const midEndX = width / 2 + 100;
    const measureTopY = this.measurePacks[0].getTopMeasure().getY();

    this.credits = this.credits.filter(credit => {
      if (credit.getPage() !== 1) return false;

      const words = credit.getWordsList()[0];
      return words &&
        words.defaultX &&
        words.defaultY &&
        height - words.defaultY + 30 < measureTopY;
    });

    this.credits.forEach(credit => {
      const words = credit.getWordsList()[0];

      if (words.defaultX > midStartX && words.defaultX < midEndX) {
        words.defaultX = pageSize.width / 2;
      } else if (words.defaultX >= midEndX) {
        words.defaultX = pageSize.width - (width - words.defaultX);
      }
    });

    this.defaults.pageLayout.pageWidth = width;
    this.defaults.pageLayout.pageHeight = height;

    super.formatCredits();

    this.defaults.pageLayout.pageWidth = pageSize.width;
    this.defaults.pageLayout.pageHeight = pageSize.height;
  }

  format() {
    this.removeNewLineTags();
    this.showAllMeasures();
    this.updateLeftMargins();
    this.applyMaxVerticalDistances();
    this.removeTopSystemDistances(1);

    // BEGIN: parents
    this.resetState();
    this.formatX();
    this.formatY();
    this.createStaves();
    this.formatAttributes();
    this.formatDivisions();
    this.formatNotes();
    this.formatBeam();
    this.formatVoices();
    this.formatLyric();
    this.runFormatter();
    // END

    this.calculateMinZoomLevel();
    this.resetStaveModifiers();

    this.reflow();
    //this.updateStaveWidths();

    // BEGIN: parents
    this.resetState();
    this.formatX();
    this.formatY();
    if (!this.infinite) {
      this.split();
      this.formatY();
    }

    this.createStaves();

    //this.updateStaveXYs();
    this.formatMeasureNumber();
    this.formatAttributes();
    this.formatBarline();
    this.formatPartList();
    this.formatNotes(); // added
    this.formatBeam();
    this.formatVoices();
    this.formatLyric();
    this.runFormatter();
    this.formatTie();
    this.formatSlur();
    // END

    this.updatePageSize();
    this.formatCredits();
  }
}
