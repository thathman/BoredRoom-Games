// BoredRoom Game Runtime — entry point for all 15 official games.

import { RuntimeBase, makeRng, shuffleInPlace, clone, normalize, topPlayers } from './helpers.js';
export { RuntimeBase, makeRng, shuffleInPlace, clone, normalize, topPlayers };

import { createTimer, TIMER_PHASES, SCORING_MODES } from './timer.js';
export { createTimer, TIMER_PHASES, SCORING_MODES };

import { WhotRuntime, WHOT_SHAPES, WHOT_DECK, createWhotDeck } from './games/whot.js';
import { LudoRuntime } from './games/ludo.js';
import { Connect4Runtime } from './games/connect4.js';
import { EtttRuntime } from './games/ettt.js';
import { HustleRuntime } from './games/hustle.js';
import { BibleTimelineRuntime } from './games/bible-timeline.js';
import { ColorWahalaRuntime } from './games/color-wahala.js';
import { WhoSabiPassRuntime } from './games/who-sabi-pass.js';
import { HalfHalfRuntime } from './games/half-half.js';
import { FaithFeudRuntime } from './games/faith-feud.js';
import { LogoGuesserRuntime } from './games/logo-guesser.js';
import { MarketPriceRuntime } from './games/market-price.js';
import { PidginTranslatorRuntime } from './games/pidgin-translator.js';
import { LandlordRuntime } from './games/landlord.js';
import { WordWahalaRuntime } from './games/word-wahala.js';

export {
  WhotRuntime, WHOT_SHAPES, WHOT_DECK, createWhotDeck,
  LudoRuntime, Connect4Runtime, EtttRuntime, HustleRuntime,
  BibleTimelineRuntime, ColorWahalaRuntime, WhoSabiPassRuntime,
  HalfHalfRuntime, FaithFeudRuntime, LogoGuesserRuntime,
  MarketPriceRuntime, PidginTranslatorRuntime, LandlordRuntime,
  WordWahalaRuntime,
};

const RUNTIMES = {
  'bible-timeline': BibleTimelineRuntime,
  'color-wahala': ColorWahalaRuntime,
  'connect-4': Connect4Runtime,
  'ettt': EtttRuntime,
  'faith-feud': FaithFeudRuntime,
  'half-half': HalfHalfRuntime,
  'hustle': HustleRuntime,
  'landlord': LandlordRuntime,
  'logo': LogoGuesserRuntime,
  'ludo': LudoRuntime,
  'market-price': MarketPriceRuntime,
  'pidgin-translator': PidginTranslatorRuntime,
  'trivia': WhoSabiPassRuntime,
  'whot': WhotRuntime,
  'word-wahala': WordWahalaRuntime,
};

export function createRuntime(manifest) {
  const Ctor = RUNTIMES[manifest.id];
  if (Ctor) return new Ctor(manifest);
  throw new Error(`game_definition_missing: ${manifest.id}`);
}

export function createPlugin(manifest) {
  return {
    id: manifest.id,
    version: manifest.version,
    createRuntime: () => createRuntime(manifest),
  };
}
