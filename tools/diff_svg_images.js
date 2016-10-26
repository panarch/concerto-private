/*
# This script runs a visual regression test on all the images
# generated by the VexFlow tests.
#
# Prerequisites: librsvg, ImageMagick
#    * ImageMagick's SVG parsing is broken, which is why we use librsvg.
#
# On OSX:   $ brew install librsvg imagemagick
# On Linux: $ apt-get install librsvg2-dev librsvg2-bin imagemagick
#
# Usage:
#
#  First generate the SVG images from the tests into build/images.
#
#    $ ./tools/generate_svg_images.js
#
#  Run the regression tests against the blessed images in tests/blessed.
#
#    $ ./tools/visual_regression.js
#
#  Check build/images/diff/results.txt for results. This file is sorted
#  by PHASH difference (most different files on top.) The composite diff
#  images for failed tests (i.e., PHASH > 0.001) are stored in build/images/diff.
#
#  If you are satisfied with the differences, copy *.svg from build/images
#  into tests/blessed, and submit your change.
*/

require('shelljs/global');
const fs = require('fs');
const process = require('process');

const THRESHOLD = 0.00001;
const BLESSED = './build/images/blessed';
const CURRENT = './build/images/current';
const DIFF = './build/images/diff';

const type = process.argv[2] ? process.argv[2] : 'all';
const blessedTemp = `${DIFF}/blessed-${type}.png`;
const currentTemp = `${DIFF}/current-${type}.png`;
const diffTemp = `${DIFF}/diff-${type}.png`;
const regex = new RegExp(`^.+_${type}_\\d+.svg$`, 'i');
function getImageNames(path) {
  return fs.readdirSync(path).filter(name => type === 'all' || regex.test(name));
}

const imageNames = getImageNames(CURRENT);
const resultFileName = type === 'all' ? `${DIFF}/results.txt` : `${DIFF}/results-${type}.txt`;
const beginTime = Date.now();

console.log(`[${type}] ${Date()}`);
console.log('');

exec(`mkdir -p ${DIFF}`);

const results = [];

getImageNames(BLESSED).forEach(name => {
  const current = `${CURRENT}/${name}`;

  try {
    fs.statSync(current);
  } catch (error) {
    console.log(`Warning: ${current} missing`);
  }
});

imageNames.forEach(name => {
  const blessed = `${BLESSED}/${name}`;
  const current = `${CURRENT}/${name}`;
  try {
    fs.statSync(blessed);
  } catch (error) {
    console.log(`Warning: ${blessed} missing`);
  }

  // Generate PNG images from SVG
  exec(`rsvg-convert ${blessed} > ${blessedTemp}`);
  exec(`rsvg-convert ${current} > ${currentTemp}`);

  // Calculate the difference metric and store the composite diff image.
  const hash = exec(
    `compare -metric PHASH ${blessedTemp} ${currentTemp} ${diffTemp} 2>&1`,
    { silent: true }
  ).stdout;

  const _name = name.replace(/.svg$/, '');
  results.push([_name, Number(hash)]);

  console.log(`${_name} : ${hash}`);

  if (hash > THRESHOLD) {
    exec(`cp ${diffTemp} ${DIFF}/${_name}.png`);
    exec(`cp ${blessedTemp} ${DIFF}/${_name}-blessed.png`);
    exec(`cp ${currentTemp} ${DIFF}/${_name}-current.png`);
  }
});

exec(`rm ${diffTemp}`);
exec(`rm ${blessedTemp}`);
exec(`rm ${currentTemp}`);

results.sort((a, b) => a[1] < b[1]);
const numWarnings = results.filter(item => item[1] > 0).length;
const numFails = results.filter(item => item[1] > THRESHOLD).length;

let resultString = '';
results.forEach(item => {
  resultString += `${item[0]} ${item[1]}\n`;
});

fs.writeFileSync(`${resultFileName}`, resultString);

console.log('');
console.log(`[${type}] ${Date()}`);
console.log(`[${type}] Running time: ${Date.now() - beginTime}ms`);
console.log(`[${type}] ${numWarnings} warnings, ${numFails} fails`);
/*
console.log(`Results stored in ${resultFileName}`);
console.log(`All images with a difference over threshold, ${THRESHOLD}, are`);
console.log(`available in ${DIFF}, sorted by perceptual hash.`);
*/
