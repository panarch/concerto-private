import Concerto from '../src/index';

const URLS = [
  './tests/KeyboardFingering.MuseScore.xml',
  './tests/CrossStaffBeam.xml',
  './tests/Sinfonia1.xml',
  './tests/Wedge.xml',
  './tests/Dynamics.xml',
  './tests/SchbAvMaSample.xml',
  './tests/BrookeWestSample.xml',
  './tests/Tuplets.Basic.xml',
  './tests/Tuplets.Complex.xml',
  './tests/Articulations.xml',
  './tests/ActorPreludeSample.xml',
  './tests/BeetAnGeSample.xml',
  './tests/scales.xml',
  './tests/sonata16.xml',
  './tests/adeste.xml',
  './tests/inv4.xml',
  './tests/inv1.xml',
  './tests/test_notations.xml',
  './tests/blank_a7.xml',
];

const TYPES = [
  'original',
  'horizontal',
  'vertical',
  'responsive',
];

function getFormatter(score, type) {
  switch (type) {
  case 'horizontal':
    return new Concerto.HorizontalFormatter(score);
  case 'vertical':
    return new Concerto.VerticalFormatter(score, { infinite: true, zoomLevel: 110 });
  case 'responsive':
    return new Concerto.VerticalFormatter(score, { infinite: false, zoomLevel: 110 });
  }

  // original
  return new Concerto.Formatter(score);
}

function load(url, type) {
  const element = document.getElementById('page');
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }

  const req = new XMLHttpRequest();
  req.open('GET', url, true);
  req.onreadystatechange = () => {
    if (req.readyState !== 4) return;
    else if (req.readyState === 4 && req.status !== 200) {
      console.error('Error loading musicxml', req.status);
      return;
    }

    const data = req.responseText;
      const domParser = new DOMParser();
      const doc = domParser.parseFromString(data, 'application/xml');
      const score = Concerto.parse(doc);
      const formatter = getFormatter(score, type);
      console.log('formatter created');

      formatter.format();
      console.log(score);

      const renderer = new Concerto.Renderer(score, { element });
      console.log('renderer created');
      renderer.render();
      console.log('draw complete');
  };

  req.send(null);
}

const scoreSelectNode = document.getElementById('score-select');
const typeSelectNode = document.getElementById('type-select');

URLS.forEach(url => {
  const optionNode = document.createElement('option');
  optionNode.textContent = url.split('/')[2];
  optionNode.value = url;

  scoreSelectNode.appendChild(optionNode);
});

TYPES.forEach(type => {
  const optionNode = document.createElement('option');
  optionNode.textContent = type;
  optionNode.value = type;

  typeSelectNode.appendChild(optionNode);
});

const onChange = () => {
  localStorage.setItem('score-select', scoreSelectNode.value);
  localStorage.setItem('type-select', typeSelectNode.value);
  load(scoreSelectNode.value, typeSelectNode.value);
};

scoreSelectNode.addEventListener('change', onChange);
typeSelectNode.addEventListener('change', onChange);

const url = localStorage.hasOwnProperty('score-select') ?
              localStorage.getItem('score-select') : URLS[10];
const type = localStorage.hasOwnProperty('type-select') ?
              localStorage.getItem('type-select') : TYPES[0];

scoreSelectNode.value = url;
typeSelectNode.value = type;
load(url, type);
