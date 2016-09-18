// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon

import Vex from '@panarch/allegretto';

export default class Renderer {
  constructor(score, { element }) {
    this.score = score;
    this.element = element;
    this.numPages = score.getNumPages();
    this.pageSize = this.score.getDefaults().getPageSize();
    this.contexts = [];
  }

  getContexts() { return this.contexts; }

  createContext(element, width, height) {
    return Vex.Flow.Renderer.getSVGContext(element, width, height);
  }

  setupRenderers() {
    const { width, height } = this.pageSize;

    this.contexts = [];
    for (let i = 0; i < this.numPages; i++) {
      const context = this.createContext(this.element, width, height);
      this.contexts.push(context);
    }
  }

  renderStaves() {
    this.score.getParts().forEach((part, pi) => {
      let index = 0;
      let context = this.contexts[index];

      part.getMeasures().forEach((measure, mi) =>{
        if (mi > 0 && measure.hasNewPage()) {
          index++;
          context = this.contexts[index];
        }

        measure.getStaves().forEach(stave => {
          stave.setContext(context).draw();
        });
      });
    });
  }

  renderVoices() {
    this.score.getParts().forEach((part, pi) => {
      let index = 0;
      let context = this.contexts[index];

      part.getMeasures().forEach((measure, mi) =>{
        if (mi > 0 && measure.hasNewPage()) {
          index++;
          context = this.contexts[index];
        }

        measure.getVFVoices().forEach(vfVoice => vfVoice.draw(context));
        measure.getVFLyricVoices().forEach(vfVoice => vfVoice.draw(context));
        measure.getVFDirectionVoices().forEach(vfVoice => vfVoice.draw(context));
      });
    });
  }

  renderBeams() {
    this.score.getParts().forEach((part, pi) => {
      let index = 0;
      let context = this.contexts[index];

      part.getMeasures().forEach((measure, mi) => {
        if (mi > 0 && measure.hasNewPage()) {
          index++;
          context = this.contexts[index];
        }

        measure.getVFBeams().forEach(beam => beam.setContext(context).draw());
      });
    });
  }

  renderTuplets() {
    this.score.getParts().forEach((part, pi) => {
      let index = 0;
      let context = this.contexts[index];

      part.getMeasures().forEach((measure, mi) => {
        if (mi > 0 && measure.hasNewPage()) {
          index++;
          context = this.contexts[index];
        }

        measure.getVFTuplets().forEach(vfTuplet => vfTuplet.setContext(context).draw());
      });
    });
  }

  renderTies() {
    this.score.getParts().forEach((part, pi) => {
      let index = 0;
      let context = this.contexts[index];

      part.getMeasures().forEach((measure, mi) => {
        if (mi > 0 && measure.hasNewPage()) {
          index++;
          context = this.contexts[index];
        }

        measure.getVoices().forEach(voice => {
          part.getVFTies(`${mi}/${voice}`).forEach(tie => tie.setContext(context).draw());
        });
      });
    });
  }

  renderSlurs() {
    this.score.getParts().forEach((part, pi) => {
      let index = 0;
      let context = this.contexts[index];

      part.getMeasures().forEach((measure, mi) => {
        if (mi > 0 && measure.hasNewPage()) {
          index++;
          context = this.contexts[index];
        }

        measure.getVoices().forEach(voice => {
          part.getVFSlurs(`${mi}/${voice}`).forEach(slur => slur.setContext(context).draw());
        });
      });
    });
  }

  renderConnectors() {
    this.score.getMeasurePacks().forEach(measurePack => {
      measurePack.getConnectors().forEach(connector => {
        const context = this.contexts[connector.page - 1];
        connector.staveConnector.setContext(context).draw();
      });
    });
  }

  renderCredits() {
    this.score.getCredits().forEach(credit => {
      const context = this.contexts[credit.getPage() - 1];

      credit.getTexts().forEach(({ content, x, y, attributes }) => {
        context.save();
        attributes.forEach((value, key) => context.attributes[key] = value);
        context.fillText(content, x, y);
        context.restore();
      });
    });
  }

  render() {
    this.setupRenderers();
    this.renderStaves();
    this.renderVoices();
    this.renderBeams();
    this.renderTuplets();
    this.renderTies();
    this.renderSlurs();
    this.renderConnectors();
    this.renderCredits();
  }
}
