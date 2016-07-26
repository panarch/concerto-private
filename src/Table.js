// Copyright (c) Taehoon Moon 2016.
// @author Taehoon Moon

const Table = {};
Table.VF_CLEF = {
  'G/2': 'treble',
  'F/3': 'barriton-f',
  'F/4': 'bass',
  'F/5': 'subbass',
  'C/1': 'soprano',
  'C/2': 'mezzo-soprano',
  'C/3': 'alto',
  'C/4': 'tenor',
  'C/5': 'barriton-c',
  'percussion': 'percussion',
  'TAB': 'tab',
};

Table.NOTE_QUARTER_INDEX = 8;
Table.NOTE_TYPES = [
  '1024th', '512th', '256th', '128th', '64th', '32nd', '16th',
  'eighth', 'quarter', 'half', 'whole', 'breve', 'long', 'maxima',
];

Table.VF_NOTE_TYPES = [
  '128', '128', '128', '128', '64', '32', '16',
  '8', 'q', 'h', 'w', 'w', 'w', 'w',
];

// NOTE_TYPES -> VF_NOTE_TYPES
// TODO: breve, long and maxima
Table.VF_NOTE_TYPE_MAP = Table.NOTE_TYPES.reduce(
  (map, key, i) => map.set(key, Table.VF_NOTE_TYPES[i]),
  new Map()
);

Table.VF_DEFAULT_REST_KEYS = ['b/4'];

Table.VF_ACCIDENTAL = {
        'sharp': '#',
 'double-sharp': '##',
      'natural': 'n',
         'flat': 'b',
    'flat-flat': 'bb',
};

export default Table;
