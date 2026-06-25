// Curated catalog for Half & Half — midpoint-estimation party game.
// Each object has a normalized "true" midpoint along the chosen axis (0..1).
// `axis` is the axis the player slices along on the controller / display.
// `shape` is a hint for the renderer (which built-in SVG silhouette to draw).

export type HalfHalfAxis = 'horizontal' | 'vertical';
export type HalfHalfCategory = 'food' | 'naija' | 'object' | 'map' | 'animal';
export type HalfHalfShape =
  | 'potato'
  | 'baguette'
  | 'rope'
  | 'jollofPan'
  | 'suyaStick'
  | 'mapNigeria'
  | 'danfoBus'
  | 'agbadaSleeve'
  | 'banana'
  | 'cucumber'
  | 'pencil'
  | 'carrot'
  | 'fish'
  | 'plantain'
  | 'palmFrond'
  | 'wineBottle'
  | 'guitar'
  | 'goat'
  | 'sausage'
  | 'pawpaw'
  | 'amalaSwallow'
  | 'agege'
  | 'meatPie'
  | 'eggRoll'
  | 'chinChin'
  | 'sugarcane'
  | 'okra'
  | 'pepper'
  | 'snail'
  | 'tortoise'
  | 'cocaCola'
  | 'paintBrush'
  | 'umbrella'
  | 'fanMilk'
  | 'kekeNapep'
  | 'mapLagos'
  | 'mapAfrica'
  | 'mortar'
  | 'broom'
  | 'gele';

export interface HalfHalfObject {
  id: string;
  name: string;
  shape: HalfHalfShape;
  axis: HalfHalfAxis;
  /** True midpoint along the axis (0..1). Where the perfect equal-mass cut lies. */
  truth: number;
  category: HalfHalfCategory;
  /** Optional one-line flavor text shown on reveal. */
  flavor?: string;
}

// Truth values are tuned by visual proportion — fatter end pulls the
// equal-mass midpoint toward it. (E.g. baguette is roughly even → ~0.5;
// a banana fattens toward the middle-stem so cut sits ~0.46.)
export const HALFHALF_OBJECTS: HalfHalfObject[] = [
  { id: 'potato',       name: 'Potato',           shape: 'potato',       axis: 'horizontal', truth: 0.47, category: 'food',   flavor: 'Lumpy on one side — eyeball it.' },
  { id: 'baguette',     name: 'Baguette',         shape: 'baguette',     axis: 'horizontal', truth: 0.50, category: 'food' },
  { id: 'rope',         name: 'Rope',             shape: 'rope',         axis: 'horizontal', truth: 0.50, category: 'object' },
  { id: 'jollofPan',    name: 'Pan of Jollof',    shape: 'jollofPan',    axis: 'horizontal', truth: 0.52, category: 'naija',  flavor: 'Handle adds weight on one side.' },
  { id: 'suyaStick',    name: 'Suya Stick',       shape: 'suyaStick',    axis: 'horizontal', truth: 0.55, category: 'naija',  flavor: 'Meat clusters mid-to-tip.' },
  { id: 'mapNigeria',   name: 'Map of Nigeria',   shape: 'mapNigeria',   axis: 'horizontal', truth: 0.49, category: 'map' },
  { id: 'danfoBus',     name: 'Danfo Bus',        shape: 'danfoBus',     axis: 'horizontal', truth: 0.55, category: 'naija',  flavor: 'Engine block is at the front.' },
  { id: 'agbadaSleeve', name: 'Agbada Sleeve',    shape: 'agbadaSleeve', axis: 'horizontal', truth: 0.48, category: 'naija' },
  { id: 'banana',       name: 'Banana',           shape: 'banana',       axis: 'horizontal', truth: 0.46, category: 'food' },
  { id: 'cucumber',     name: 'Cucumber',         shape: 'cucumber',     axis: 'horizontal', truth: 0.50, category: 'food' },
  { id: 'pencil',       name: 'Pencil',           shape: 'pencil',       axis: 'horizontal', truth: 0.48, category: 'object', flavor: 'Eraser-end is heavier than the tip.' },
  { id: 'carrot',       name: 'Carrot',           shape: 'carrot',       axis: 'horizontal', truth: 0.40, category: 'food',   flavor: 'Fat at the leafy end.' },
  { id: 'fish',         name: 'Tilapia',          shape: 'fish',         axis: 'horizontal', truth: 0.45, category: 'food',   flavor: 'Mass sits near the head.' },
  { id: 'plantain',     name: 'Plantain',         shape: 'plantain',     axis: 'horizontal', truth: 0.47, category: 'naija' },
  { id: 'palmFrond',    name: 'Palm Frond',       shape: 'palmFrond',    axis: 'horizontal', truth: 0.55, category: 'naija',  flavor: 'Leaflets bunch toward the tip.' },
  { id: 'wineBottle',   name: 'Wine Bottle',      shape: 'wineBottle',   axis: 'horizontal', truth: 0.42, category: 'object', flavor: 'Base is dense; neck is thin.' },
  { id: 'guitar',       name: 'Guitar',           shape: 'guitar',       axis: 'horizontal', truth: 0.38, category: 'object', flavor: 'Body is way heavier than the neck.' },
  { id: 'goat',         name: 'Goat',             shape: 'goat',         axis: 'horizontal', truth: 0.50, category: 'animal' },
  { id: 'sausage',      name: 'Sausage',          shape: 'sausage',      axis: 'horizontal', truth: 0.50, category: 'food' },
  { id: 'pawpaw',       name: 'Pawpaw',           shape: 'pawpaw',       axis: 'horizontal', truth: 0.55, category: 'food',   flavor: 'Fattens toward the bottom.' },
  { id: 'amalaSwallow', name: 'Amala Swallow',    shape: 'amalaSwallow', axis: 'vertical',   truth: 0.50, category: 'naija' },
  { id: 'agege',        name: 'Agege Bread',      shape: 'agege',        axis: 'horizontal', truth: 0.50, category: 'naija' },
  { id: 'meatPie',      name: 'Meat Pie',         shape: 'meatPie',      axis: 'horizontal', truth: 0.50, category: 'naija' },
  { id: 'eggRoll',      name: 'Egg Roll',         shape: 'eggRoll',      axis: 'horizontal', truth: 0.50, category: 'naija',  flavor: 'Egg sits dead-center.' },
  { id: 'chinChin',     name: 'Chin Chin Pile',   shape: 'chinChin',     axis: 'horizontal', truth: 0.50, category: 'naija' },
  { id: 'sugarcane',    name: 'Sugarcane',        shape: 'sugarcane',    axis: 'horizontal', truth: 0.50, category: 'food' },
  { id: 'okra',         name: 'Okra',             shape: 'okra',         axis: 'horizontal', truth: 0.45, category: 'food' },
  { id: 'pepper',       name: 'Atarodo Pepper',   shape: 'pepper',       axis: 'horizontal', truth: 0.42, category: 'naija' },
  { id: 'snail',        name: 'Snail',            shape: 'snail',        axis: 'horizontal', truth: 0.55, category: 'animal' },
  { id: 'tortoise',     name: 'Tortoise',         shape: 'tortoise',     axis: 'horizontal', truth: 0.50, category: 'animal' },
  { id: 'cocaCola',     name: 'Coke Bottle',      shape: 'cocaCola',     axis: 'horizontal', truth: 0.43, category: 'object' },
  { id: 'paintBrush',   name: 'Paint Brush',      shape: 'paintBrush',   axis: 'horizontal', truth: 0.55, category: 'object' },
  { id: 'umbrella',     name: 'Umbrella',         shape: 'umbrella',     axis: 'vertical',   truth: 0.40, category: 'object', flavor: 'Canopy wins on weight.' },
  { id: 'fanMilk',      name: 'FanMilk Sachet',   shape: 'fanMilk',      axis: 'vertical',   truth: 0.50, category: 'naija' },
  { id: 'kekeNapep',    name: 'Keke Napep',       shape: 'kekeNapep',    axis: 'horizontal', truth: 0.52, category: 'naija' },
  { id: 'mapLagos',     name: 'Map of Lagos',     shape: 'mapLagos',     axis: 'horizontal', truth: 0.55, category: 'map',    flavor: 'Mainland skews the balance east.' },
  { id: 'mapAfrica',    name: 'Map of Africa',    shape: 'mapAfrica',    axis: 'horizontal', truth: 0.45, category: 'map' },
  { id: 'mortar',       name: 'Mortar (Odo)',     shape: 'mortar',       axis: 'vertical',   truth: 0.55, category: 'naija',  flavor: 'Base is the heavy part.' },
  { id: 'broom',        name: 'Naija Broom',      shape: 'broom',        axis: 'horizontal', truth: 0.42, category: 'naija',  flavor: 'Bristles fan out at the head.' },
  { id: 'gele',         name: 'Gele Wrap',        shape: 'gele',         axis: 'horizontal', truth: 0.50, category: 'naija' },
];

export function objectById(id: string): HalfHalfObject | null {
  return HALFHALF_OBJECTS.find((o) => o.id === id) ?? null;
}
