// Copyright (c) Taehoon Moon 2015.
// @author Taehoon Moon

import 'babel-polyfill';
import './hotfix';
import Vex from '@panarch/allegretto';
import Score from './Score';
import Defaults from './Defaults';
import Movement from './Movement';
import Identification from './Identification';
import Part from './Part';
import Measure from './Measure';
import { parse } from './Parser';
import Formatter from './Formatter';
import VerticalFormatter from './VerticalFormatter';
import HorizontalFormatter from './HorizontalFormatter';
import Renderer from './Renderer';
import Util from './Util';

// use module.exports for node.js compatibility
module.exports = {
  Vex,
  Score,
  Defaults,
  Movement,
  Identification,
  Part,
  Measure,
  Formatter,
  VerticalFormatter,
  HorizontalFormatter,
  Renderer,
  Util,
  parse,
};
