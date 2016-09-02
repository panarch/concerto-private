import AdvancedFormatter from './AdvancedFormatter';

const TOP_SYSTEM_DISTANCE = 80;

export default class HorizontalFormatter extends AdvancedFormatter {
  updatePageSize() {
    const defaults = this.score.getDefaults();
    const parts = this.score.getParts();
    const measures = parts[parts.length - 1].getMeasures();
    const lastMeasure = measures[measures.length - 1];
    const width = lastMeasure.getX() + lastMeasure.getWidth() + 100;
    const height = Math.max(...lastMeasure.staffYMap.values()) + 120;

    defaults.pageLayout.pageWidth = width;
    defaults.pageLayout.pageHeight = height;
  }

  updateTopMargins() {
    const defaults = this.score.getDefaults();
    const firstMeasure = this.score.getParts()[0].getMeasures()[0];

    // Update top-system-distance
    if (firstMeasure.hasTopSystemDistance()) {
      firstMeasure.print.systemLayout.topSystemDistance = TOP_SYSTEM_DISTANCE;
    } else {
      let systemLayout = defaults.getSystemLayout();
      if (!systemLayout) {
        systemLayout = {};
        defaults.systemLayout = systemLayout;
      }

      systemLayout.topSystemDistance = TOP_SYSTEM_DISTANCE;
    }

    // Remove page top margins
    const pageMarginsMap = defaults.getPageMarginsMap();
    if (pageMarginsMap) {
      ['both', 'even', 'odd'].forEach(type => {
        if (!pageMarginsMap.has(type)) return;

        pageMarginsMap.get(type)['topMargin'] = 0;
      });
    }
  }

  updateMeasureNumbering() {
    const measure = this.score.getParts()[0].getMeasures()[0];
    if (!measure.print) measure.print = {};

    measure.print.measureNumbering = 'measure';
  }

  format() {
    this.removeNewLineTags();
    this.showAllMeasures();
    this.updateTopMargins();
    this.applyMaxVerticalDistances();
    this.updateMeasureNumbering();

    super.format();

    this.removeCredits();
    this.updatePageSize();
  }
}
