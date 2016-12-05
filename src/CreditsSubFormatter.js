export const getTextAnchor = value => {
  switch (value) {
    case 'left': return 'start';
    case 'right': return 'end';
    case 'center': return 'middle';
  }
};

export const getDominantBaseline = value => {
  switch (value) {
    case 'top': return 'hanging';
    case 'middle': return 'middle';
    case 'bottom':
    case 'baseline': return 'alphabetical';
  }
};

export default class CreditsSubFormatter {
  constructor({ formatter, score }) {
    this.formatter = formatter;
    this.score = score;
  }

  formatCredits(credits = this.score.getCredits()) {
    const DEFAULT_FONT_SIZE = 16;

    const context = this.formatter.getContext();
    const pageSize = this.score.getDefaults().getPageSize();
    // words.fontSize = Number(/(\d+)\w*/.exec(node.getAttribute('font-size')[1]));
    credits.forEach(credit => {
      const texts = [];
      let x;
      let y;
      let fontSize;
      let textAnchor = 'hanging'; // TODO: full justify & halign support
      let baseline = 'start';

      credit.getWordsList().forEach(words => {
        if (!/\w+/.test(words.content)) return; // ignore empty line-break

        const text = {
          content: words.content,
          attributes: new Map(),
        };

        if (words.defaultX !== undefined) x = words.defaultX;
        if (words.defaultY !== undefined) y = pageSize.height - words.defaultY;
        if (words.justify !== undefined) textAnchor = getTextAnchor(words.justify);
        if (words.halign !== undefined) textAnchor = getTextAnchor(words.halign);
        if (words.valign !== undefined) baseline = getDominantBaseline(words.valign);

        if (textAnchor) text.attributes.set('text-anchor', textAnchor);
        if (baseline) text.attributes.set('dominant-baseline', baseline);

        context.save();
        if (words.fontSize !== undefined) {
          fontSize = words.fontSize;
          if (/\d+$/.test(fontSize)) {
            fontSize = Number(fontSize) * 2.2; // TODO
            //fontSize += 'px'; svgcontext uses pt
          }

          text.attributes.set('font-size', fontSize);
          context.attributes['font-size'] = fontSize; // svgcontext only
        } else {
          text.attributes.set('font-size', DEFAULT_FONT_SIZE);
          context.attributes['font-size'] = DEFAULT_FONT_SIZE;
        }

        // default font: "times", no custom font support
        text.attributes.set('font-family', 'times');
        context.attributes['font-family'] = 'times';

        const bbox = context.measureText(text.content);
        context.restore();

        text.x = x;
        text.y = y;
        texts.push(text);
        y += bbox.height;
      });

      credit.setTexts(texts);
    });
  }
}
