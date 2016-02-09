// Copyright (c) Taehoon Moon 2016.
// @author Taehoon Moon

export default {
  VF_CLEF: {
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
  },

  VF_NOTE_TYPE: {
    '1024th': '64',
     '512th': '64',
     '256th': '64',
     '128th': '128',
      '64th': '64',
      '32nd': '32',
      '16th': '16',
    'eighth': '8',
   'quarter': 'q',
      'half': 'h',
     'whole': 'w',
     'breve': 'w', // TODO: breve, long and maxima
      'long': 'w',
    'maxima': 'w',
  },

  VF_DEFAULT_REST_KEYS: ['b/4'],

  VF_ACCIDENTAL: {
          'sharp': '#',
   'double-sharp': '##',
        'natural': 'n',
           'flat': 'b',
      'flat-flat': 'bb',
  },
};
