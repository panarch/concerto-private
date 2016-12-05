import Vex from '@panarch/allegretto';
const VF = Vex.Flow;

export const getVFConnectorType = groupSymbol => {
  let connectorType;
  switch (groupSymbol) {
    case 'brace':
      connectorType = VF.StaveConnector.type.BRACE;
      break;
    case 'bracket':
      connectorType = VF.StaveConnector.type.BRACKET;
      break;
      case 'line':
    default:
      connectorType = VF.StaveConnector.type.DOUBLE;
  }

  return connectorType;
};

export const convertVFBarlineTypeToVFConnectorType = (vfBarlineType, isLeft) => {
  const Barline = VF.Barline;
  const StaveConnector = VF.StaveConnector;

  switch (vfBarlineType) {
    case Barline.type.DOUBLE:
      return StaveConnector.type.THIN_DOUBLE;
    case Barline.type.END:
    case Barline.type.REPEAT_END:
      return StaveConnector.type.BOLD_DOUBLE_RIGHT;
    case Barline.type.REPEAT_BEGIN:
      return StaveConnector.type.BOLD_DOUBLE_LEFT;
  }

  return isLeft ? StaveConnector.type.SINGLE_LEFT : StaveConnector.type.SINGLE_RIGHT;
};

export default class PartListSubFormatter {
  constructor({ formatter, score }) {
    this.formatter = formatter;
    this.score = score;
  }

  formatPartList() {
    const parts = this.score.getParts();
    const partList = this.score.getPartList();
    const measurePacks = this.score.getMeasurePacks();

    const partGroups = partList.getPartGroups();
    const scoreParts = partList.getScoreParts();
    const numMeasures = measurePacks.length;

    const findTopStave = (pi, mi, max) => {
      for (; pi < max; pi++) {
        const staves = parts[pi].getMeasures()[mi].getStaves();
        if (staves && staves.length > 0)
          return staves[0];

      }
    };

    const findBottomStave = (pi, mi, min) => {
      for (; pi > min; pi--) {
        const staves = parts[pi].getMeasures()[mi].getStaves();
        if (staves && staves.length > 0)
          return staves[staves.length - 1];

      }
    };

    const setText = ({ stave, staveConnector, text }) => {
      const contents = text.split(/\n/);
      const topY = (1 - contents.length) * 10;
      contents.forEach((content, i) => {
        const textOptions = { shift_y: topY + i * 20 };
        if (stave) {
          const position = VF.Modifier.Position.LEFT;
          textOptions.shift_x = 8;
          stave.setText(content, position, textOptions);
        }
        else staveConnector.setText(content, textOptions);
      });
    };

    let page = 1;

    for (let mi = 0; mi < numMeasures; mi++) {
      const connectors = [];
      measurePacks[mi].setConnectors(connectors);

      const firstPartMeasure = parts[0].getMeasures()[mi];
      const isNewLineStarting = mi === 0 || firstPartMeasure.isNewLineStarting();
      if (mi > 0 && firstPartMeasure.hasNewPage()) page++;

      if (isNewLineStarting) {
        const topStave = findTopStave(0, mi, parts.length - 1);
        const bottomStave = findBottomStave(parts.length - 1, mi, 0);
        if (topStave && bottomStave) {
          const staveConnector = new VF.StaveConnector(topStave, bottomStave);
          staveConnector.setType(VF.StaveConnector.type.SINGLE_LEFT);
          connectors.push({ page, staveConnector });
        }
      }

      partGroups.forEach(partGroup => {
        const { startPartIndex, stopPartIndex } = partGroup;
        let topStave = findTopStave(startPartIndex, mi, stopPartIndex);
        let bottomStave = findBottomStave(stopPartIndex, mi, startPartIndex);
        if (!topStave || !bottomStave) {
          if (!isNewLineStarting) return;

          topStave = findTopStave(startPartIndex, mi, stopPartIndex + 1);
          bottomStave = findBottomStave(stopPartIndex, mi, startPartIndex - 1);
          if (!topStave || !bottomStave) return;

          const staveConnector = new VF.StaveConnector(topStave, bottomStave);
          const connectorType = partGroup.groupSymbol === 'bracket' ?
            VF.StaveConnector.type.BRACKET :
            VF.StaveConnector.type.SINGLE_LEFT;
          staveConnector.setType(connectorType);

          /* TODO: Current vexflow StaveConnector only provides a single text
          if (mi === 0 && partGroup.groupName)
            setText({ staveConnector, text: partGroup.partName });
          */
          if (mi > 0 && partGroup.groupAbbreviation)
            setText({ staveConnector, text: partGroup.groupAbbreviation });

          connectors.push({ page, staveConnector });
          return;
        }

        if (partGroup.groupBarline) {
          topStave.format();

          const staveConnector = new VF.StaveConnector(topStave, bottomStave);
          const shiftX = topStave.modifiers[1].getX() - (topStave.getX() + topStave.getWidth());
          staveConnector.setXShift(shiftX);
          staveConnector.setType(VF.StaveConnector.type.SINGLE_RIGHT);
          connectors.push({ page, staveConnector });
        }

        if (!isNewLineStarting) return;

        const staveConnector = new VF.StaveConnector(topStave, bottomStave);
        let hasGroupSymbol = false;
        if (partGroup.groupSymbol) {
          hasGroupSymbol = true;
          const connectorType = getVFConnectorType(partGroup.groupSymbol);
          staveConnector.setType(connectorType);
          staveConnector.setXShift(0);
        }

        if (mi === 0 && partGroup.groupName)
          setText({ staveConnector, text: partGroup.groupName });
        else if (mi > 0 && partGroup.groupAbbreviation)
          setText({ staveConnector, text: partGroup.groupAbbreviation });

        if (!hasGroupSymbol) staveConnector.setType(VF.StaveConnector.type.NONE);

        connectors.push({ page, staveConnector });
      });

      // single part && multiple-staff
      parts.forEach((part, pi) => {
        const scorePart = scoreParts[pi];
        const staves = part.getMeasures()[mi].getStaves();

        if (staves.length === 1) {
          const stave = staves[0];
          if (mi === 0 && scorePart.partName)
            setText({ stave, text: scorePart.partName });
          else if (mi > 0 && isNewLineStarting && scorePart.partAbbreviation)
            setText({ stave, text: scorePart.partAbbreviation });

          return;
        } else if (!staves) return;

        const [topStave, bottomStave] = [staves[0], staves[staves.length - 1]];
        if (!topStave || !bottomStave) return;

        topStave.format();

        if (isNewLineStarting) {
          let staveConnector = new VF.StaveConnector(topStave, bottomStave);
          staveConnector.setType(VF.StaveConnector.type.BRACE);
          connectors.push({ page, staveConnector });

          if (mi === 0 && scorePart.partName)
            setText({ staveConnector, text: scorePart.partName });
          else if (mi > 0 && isNewLineStarting && scorePart.partAbbreviation)
            setText({ staveConnector, text: scorePart.partAbbreviation });

          staveConnector = new VF.StaveConnector(topStave, bottomStave);
          staveConnector.setType(VF.StaveConnector.type.SINGLE_LEFT);
          connectors.push({ page, staveConnector });

          const vfBarlineType = topStave.modifiers[0].getType();
          const connectorType = convertVFBarlineTypeToVFConnectorType(vfBarlineType, true);
          if (connectorType !== VF.StaveConnector.type.SINGLE_LEFT) {
            staveConnector = new VF.StaveConnector(topStave, bottomStave);
            const vfBarlineType = topStave.modifiers[0].getType();
            const connectorType = convertVFBarlineTypeToVFConnectorType(vfBarlineType, true);
            const shiftX = topStave.modifiers[0].getX() - topStave.getX();
            staveConnector.setType(connectorType);
            staveConnector.setXShift(shiftX);
            connectors.push({ page, staveConnector });
          }
        }

        const staveConnector = new VF.StaveConnector(topStave, bottomStave);
        const vfBarlineType = topStave.modifiers[1].getType();
        const connectorType = convertVFBarlineTypeToVFConnectorType(vfBarlineType, false);
        const shiftX = topStave.modifiers[1].getX() - (topStave.getX() + topStave.getWidth());
        staveConnector.setXShift(shiftX);
        staveConnector.setType(connectorType);
        connectors.push({ page, staveConnector });
      });
    }
  }
}
