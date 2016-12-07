import Formatter from './Formatter';

export default class AdvancedFormatter extends Formatter {
  getMeasures() {
    const parts = this.score.getParts();
    const measures = [];
    for (let p = 0; p < parts.length; p++) {
      measures.push(...parts[p].getMeasures());
    }

    return measures;
  }

  // set all measures visible and update width values
  showAllMeasures() {
    for (const measure of this.getMeasures()) {
      measure.staffs.forEach(staff => measure.setStaffDisplayed(staff, true));
    }

    // fill empty widths
    const parts = this.score.getParts();
    const numMeasures = parts[0].getMeasures().length;
    for (let i = 0; i < numMeasures; i++) {
      let maxWidth = 0;
      const measures = [];
      parts.forEach(part => measures.push(part.getMeasures()[i]));
      measures.forEach(measure => {
        const width = measure.getWidth();
        if (width > maxWidth) maxWidth = width;
      });

      measures.forEach(measure => {
        measure.setWidth(maxWidth);
      });
    }
  }

  // remove print newPage & newSystem
  removeNewLineTags() {
    for (const measure of this.getMeasures()) {
      if (!measure.isNewLineStarting()) continue;

      measure.print.newPage = false;
      measure.print.newSystem = false;
    }
  }

  _applyMaxVerticalDistances(part) {
    const measures = part.getMeasures();
    let systemDistance = this.score.getDefaults().getSystemDistance();
    let staffDistanceMap = new Map();

    measures.forEach(measure => {
      if (measure.hasSystemDistance()) {
        const _systemDistance = measure.getSystemDistance();
        if (!systemDistance || systemDistance < _systemDistance) {
          systemDistance = _systemDistance;
        }
      }

      const staffLayoutMap = measure.getStaffLayoutMap();
      measure.staffs.forEach(staff => {
        if (!measure.hasStaffDistances() || !staffLayoutMap.has(staff)) return;

        const _staffDistance = staffLayoutMap.get(staff).staffDistance;
        if (!staffDistanceMap.has(staff) || staffDistanceMap.get(staff) < _staffDistance) {
          staffDistanceMap.set(staff, _staffDistance);
        }
      });
    });

    // TODO: should be calculated in the future, not simply choosing maximum
    systemDistance = Math.max(Math.min(systemDistance, 100), 80);

    const measure = measures[0];
    if (!measure.print) measure.print = {};
    const print = measure.print;

    if (systemDistance) {
      if (!print.systemLayout) print.systemLayout = {};

      print.systemLayout.systemDistance = systemDistance;
    }

    if (staffDistanceMap.size > 0) {
      if (!print.staffLayoutMap) print.staffLayoutMap = new Map();

      for (const [staff, staffDistance] of staffDistanceMap.entries()) {
        let staffLayout = print.staffLayoutMap.get(staff);

        if (!staffLayout) {
          staffLayout = {};
          print.staffLayoutMap.set(staff, staffLayout);
        }

        staffLayout.staffDistance = staffDistance;
      }
    }
  }

  applyMaxVerticalDistances() {
    // Update first measure print's system-distance and staff-distance values.
    this.score.getParts().forEach(part => this._applyMaxVerticalDistances(part));

    // remove all system distance and staff distances after the first
    this.score.getMeasurePacks().forEach((measurePack, mi) => {
      if (mi === 0) return;

      measurePack.measures.forEach(measure => {
        if (!measure.hasPrint()) return;

        if (measure.print.systemLayout) delete measure.print.systemLayout.systemDistance;
        if (measure.print.staffLayoutMap) measure.print.staffLayoutMap.clear();
      });
    });
  }

  removeCredits() {
    this.score.credits = [];
  }
}
