// Oga Landlord — board properties.
// Re-themed from christelbuchanan/Monopoly-Game (Sydney) → Lagos / Nigerian.
// Same 40-tile structure, same rents, same group → same gameplay balance.
// Currency is conceptually Naira (₦); engine stores raw numbers.
//
// Group → color mapping uses our HSL design tokens (set in tailwind), but
// here we keep the bare semantic group key (`brown`, `light-blue`, etc.) so
// the UI layer can map to its own tokens.

export type LandlordPropertyType =
  | 'property'
  | 'railroad'
  | 'utility'
  | 'chance'
  | 'community'
  | 'tax'
  | 'corner';

export type LandlordGroup =
  | 'brown'
  | 'light-blue'
  | 'purple'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'railroad'
  | 'utility'
  | 'special'
  | 'corner';

/** Static, never-mutated tile metadata. */
export interface LandlordPropertyDef {
  id: number;
  position: number;
  name: string;
  type: LandlordPropertyType;
  group: LandlordGroup;
  /** Purchase price (₦). 0 for non-purchasable. */
  price: number;
  /**
   * Rent ladder.
   * - property: [base, 1h, 2h, 3h, 4h, hotel]
   * - railroad: [1 owned, 2 owned, 3 owned, 4 owned]
   * - utility:  [1 owned multiplier, 2 owned multiplier] (multiplied by dice total)
   * - tax:      [flat amount]
   * - chance/community/corner: [0]
   */
  rent: number[];
  /** Cost to build a house on this property (after monopoly). 0 if N/A. */
  housePrice: number;
  /** Mortgage value (= price / 2 by Monopoly rules). 0 if N/A. */
  mortgageValue: number;
}

const half = (n: number) => Math.floor(n / 2);

export const LANDLORD_PROPERTIES: LandlordPropertyDef[] = [
  { id: 0,  position: 0,  name: 'GO',                 type: 'corner',    group: 'corner',    price: 0,   rent: [0],                                      housePrice: 0,   mortgageValue: 0 },
  { id: 1,  position: 1,  name: 'Ojuelegba',          type: 'property',  group: 'brown',     price: 60,  rent: [2, 10, 30, 90, 160, 250],               housePrice: 50,  mortgageValue: half(60) },
  { id: 2,  position: 2,  name: 'Community Pot',      type: 'community', group: 'special',   price: 0,   rent: [0],                                      housePrice: 0,   mortgageValue: 0 },
  { id: 3,  position: 3,  name: 'Mushin',             type: 'property',  group: 'brown',     price: 60,  rent: [4, 20, 60, 180, 320, 450],              housePrice: 50,  mortgageValue: half(60) },
  { id: 4,  position: 4,  name: 'Income Tax',         type: 'tax',       group: 'special',   price: 0,   rent: [200],                                    housePrice: 0,   mortgageValue: 0 },
  { id: 5,  position: 5,  name: 'Iddo Terminal',      type: 'railroad',  group: 'railroad',  price: 200, rent: [25, 50, 100, 200],                       housePrice: 0,   mortgageValue: 100 },
  { id: 6,  position: 6,  name: 'Yaba',               type: 'property',  group: 'light-blue',price: 100, rent: [6, 30, 90, 270, 400, 550],              housePrice: 50,  mortgageValue: 50 },
  { id: 7,  position: 7,  name: 'Owambe',             type: 'chance',    group: 'special',   price: 0,   rent: [0],                                      housePrice: 0,   mortgageValue: 0 },
  { id: 8,  position: 8,  name: 'Surulere',           type: 'property',  group: 'light-blue',price: 100, rent: [6, 30, 90, 270, 400, 550],              housePrice: 50,  mortgageValue: 50 },
  { id: 9,  position: 9,  name: 'Ebute Metta',        type: 'property',  group: 'light-blue',price: 120, rent: [8, 40, 100, 300, 450, 600],             housePrice: 50,  mortgageValue: 60 },
  { id: 10, position: 10, name: 'Kirikiri / Visiting',type: 'corner',    group: 'corner',    price: 0,   rent: [0],                                      housePrice: 0,   mortgageValue: 0 },
  { id: 11, position: 11, name: 'Bariga',             type: 'property',  group: 'purple',    price: 140, rent: [10, 50, 150, 450, 625, 750],            housePrice: 100, mortgageValue: 70 },
  { id: 12, position: 12, name: 'Lagos Water Corp',   type: 'utility',   group: 'utility',   price: 150, rent: [4, 10],                                  housePrice: 0,   mortgageValue: 75 },
  { id: 13, position: 13, name: 'Gbagada',            type: 'property',  group: 'purple',    price: 140, rent: [10, 50, 150, 450, 625, 750],            housePrice: 100, mortgageValue: 70 },
  { id: 14, position: 14, name: 'Ojota',              type: 'property',  group: 'purple',    price: 160, rent: [12, 60, 180, 500, 700, 900],            housePrice: 100, mortgageValue: 80 },
  { id: 15, position: 15, name: 'Apapa Port',         type: 'railroad',  group: 'railroad',  price: 200, rent: [25, 50, 100, 200],                       housePrice: 0,   mortgageValue: 100 },
  { id: 16, position: 16, name: 'Ikeja',              type: 'property',  group: 'orange',    price: 180, rent: [14, 70, 200, 550, 750, 950],            housePrice: 100, mortgageValue: 90 },
  { id: 17, position: 17, name: 'Community Pot',      type: 'community', group: 'special',   price: 0,   rent: [0],                                      housePrice: 0,   mortgageValue: 0 },
  { id: 18, position: 18, name: 'Maryland',           type: 'property',  group: 'orange',    price: 180, rent: [14, 70, 200, 550, 750, 950],            housePrice: 100, mortgageValue: 90 },
  { id: 19, position: 19, name: 'Ogba',               type: 'property',  group: 'orange',    price: 200, rent: [16, 80, 220, 600, 800, 1000],           housePrice: 100, mortgageValue: 100 },
  { id: 20, position: 20, name: 'Free Parking',       type: 'corner',    group: 'corner',    price: 0,   rent: [0],                                      housePrice: 0,   mortgageValue: 0 },
  { id: 21, position: 21, name: 'Festac Town',        type: 'property',  group: 'red',       price: 220, rent: [18, 90, 250, 700, 875, 1050],           housePrice: 150, mortgageValue: 110 },
  { id: 22, position: 22, name: 'Owambe',             type: 'chance',    group: 'special',   price: 0,   rent: [0],                                      housePrice: 0,   mortgageValue: 0 },
  { id: 23, position: 23, name: 'Amuwo Odofin',       type: 'property',  group: 'red',       price: 220, rent: [18, 90, 250, 700, 875, 1050],           housePrice: 150, mortgageValue: 110 },
  { id: 24, position: 24, name: 'Satellite Town',     type: 'property',  group: 'red',       price: 240, rent: [20, 100, 300, 750, 925, 1100],          housePrice: 150, mortgageValue: 120 },
  { id: 25, position: 25, name: 'Murtala Airport',    type: 'railroad',  group: 'railroad',  price: 200, rent: [25, 50, 100, 200],                       housePrice: 0,   mortgageValue: 100 },
  { id: 26, position: 26, name: 'Magodo',             type: 'property',  group: 'yellow',    price: 260, rent: [22, 110, 330, 800, 975, 1150],          housePrice: 150, mortgageValue: 130 },
  { id: 27, position: 27, name: 'Omole',              type: 'property',  group: 'yellow',    price: 260, rent: [22, 110, 330, 800, 975, 1150],          housePrice: 150, mortgageValue: 130 },
  { id: 28, position: 28, name: 'Eko Electric',       type: 'utility',   group: 'utility',   price: 150, rent: [4, 10],                                  housePrice: 0,   mortgageValue: 75 },
  { id: 29, position: 29, name: 'GRA Ikeja',          type: 'property',  group: 'yellow',    price: 280, rent: [24, 120, 360, 850, 1025, 1200],         housePrice: 150, mortgageValue: 140 },
  { id: 30, position: 30, name: 'Go to Kirikiri',     type: 'corner',    group: 'corner',    price: 0,   rent: [0],                                      housePrice: 0,   mortgageValue: 0 },
  { id: 31, position: 31, name: 'Lekki Phase 1',      type: 'property',  group: 'green',     price: 300, rent: [26, 130, 390, 900, 1100, 1275],         housePrice: 200, mortgageValue: 150 },
  { id: 32, position: 32, name: 'Ajah',               type: 'property',  group: 'green',     price: 300, rent: [26, 130, 390, 900, 1100, 1275],         housePrice: 200, mortgageValue: 150 },
  { id: 33, position: 33, name: 'Community Pot',      type: 'community', group: 'special',   price: 0,   rent: [0],                                      housePrice: 0,   mortgageValue: 0 },
  { id: 34, position: 34, name: 'Chevron Drive',      type: 'property',  group: 'green',     price: 320, rent: [28, 150, 450, 1000, 1200, 1400],        housePrice: 200, mortgageValue: 160 },
  { id: 35, position: 35, name: 'Tin Can Port',       type: 'railroad',  group: 'railroad',  price: 200, rent: [25, 50, 100, 200],                       housePrice: 0,   mortgageValue: 100 },
  { id: 36, position: 36, name: 'Owambe',             type: 'chance',    group: 'special',   price: 0,   rent: [0],                                      housePrice: 0,   mortgageValue: 0 },
  { id: 37, position: 37, name: 'Ikoyi',              type: 'property',  group: 'blue',      price: 350, rent: [35, 175, 500, 1100, 1300, 1500],        housePrice: 200, mortgageValue: 175 },
  { id: 38, position: 38, name: 'Luxury Tax',         type: 'tax',       group: 'special',   price: 0,   rent: [100],                                    housePrice: 0,   mortgageValue: 0 },
  { id: 39, position: 39, name: 'Banana Island',      type: 'property',  group: 'blue',      price: 400, rent: [50, 200, 600, 1400, 1700, 2000],        housePrice: 200, mortgageValue: 200 },
];

export const LANDLORD_BOARD_SIZE = 40;
export const LANDLORD_GO_BONUS = 200;
export const LANDLORD_STARTING_CASH = 1500;
export const LANDLORD_JAIL_FINE = 50;
export const LANDLORD_JAIL_POSITION = 10;
export const LANDLORD_GOTO_JAIL_POSITION = 30;

export function propertyAt(position: number): LandlordPropertyDef {
  const p = ((position % LANDLORD_BOARD_SIZE) + LANDLORD_BOARD_SIZE) % LANDLORD_BOARD_SIZE;
  return LANDLORD_PROPERTIES[p];
}

export function propertyById(id: number): LandlordPropertyDef | undefined {
  return LANDLORD_PROPERTIES.find((p) => p.id === id);
}

/** Total properties in a color group (for monopoly detection). */
export function groupSize(group: LandlordGroup): number {
  return LANDLORD_PROPERTIES.filter((p) => p.group === group).length;
}
