import $ from 'jquery';
import Concerto from '../src/index';

const urls = [
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

function load(url) {
  const element = document.getElementById('page');
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }

  $.ajax({
    url: url,
    dataType: 'text',
    success: data => {
      const domParser = new DOMParser();
      const doc = domParser.parseFromString(data, 'application/xml');
      const score = Concerto.parse(doc);

      const formatter = new Concerto.Formatter(score);
      console.log('formatter created')
      formatter.format();
      console.log(score);

      const renderer = new Concerto.Renderer(score, { element });
      console.log('renderer created');
      renderer.render();
      console.log('draw complete');
    },
  });
}

const selectNode = document.getElementById('select');

urls.forEach(url => {
  const optionNode = document.createElement('option');
  optionNode.textContent = url.split('/')[2];
  optionNode.value = url;

  selectNode.appendChild(optionNode);
});

selectNode.addEventListener('change', () => load(selectNode.value));
load(urls[0]);