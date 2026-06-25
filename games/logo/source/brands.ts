// Curated brand list for Logo Guesser.
// `domain` is the canonical domain used by logo.dev to fetch the asset:
//   https://img.logo.dev/{domain}?token=...
// `name` is the canonical display name (used as the answer key).
// `aliases` are accepted alternate spellings for free-text fuzzy matching.
// `region` lets us bias picks for naija/global rounds in future modes.

export type LogoBrandRegion = 'naija' | 'africa' | 'global';

export interface LogoBrand {
  /** Stable id derived from domain (e.g. 'mtn-com-ng'). */
  id: string;
  /** Canonical answer / display name. */
  name: string;
  /** logo.dev domain. */
  domain: string;
  /** Accepted alternate strings for free-text matching (lowercase). */
  aliases: string[];
  region: LogoBrandRegion;
  /** Difficulty hint — used for round mixing. */
  difficulty: 'easy' | 'medium' | 'hard';
}

function id(domain: string): string {
  return domain.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

const RAW: Array<Omit<LogoBrand, 'id'>> = [
  // ── Naija (telecom, banks, fintech, fmcg, media) ──
  { name: 'MTN', domain: 'mtn.com', aliases: ['mtn nigeria'], region: 'naija', difficulty: 'easy' },
  { name: 'Glo', domain: 'gloworld.com', aliases: ['globacom', 'glo mobile'], region: 'naija', difficulty: 'easy' },
  { name: 'Airtel', domain: 'airtel.com', aliases: ['airtel nigeria'], region: 'naija', difficulty: 'easy' },
  { name: '9mobile', domain: '9mobile.com.ng', aliases: ['etisalat', '9 mobile'], region: 'naija', difficulty: 'medium' },
  { name: 'GTBank', domain: 'gtbank.com', aliases: ['gtb', 'guaranty trust'], region: 'naija', difficulty: 'easy' },
  { name: 'Access Bank', domain: 'accessbankplc.com', aliases: ['access'], region: 'naija', difficulty: 'medium' },
  { name: 'Zenith Bank', domain: 'zenithbank.com', aliases: ['zenith'], region: 'naija', difficulty: 'medium' },
  { name: 'First Bank', domain: 'firstbanknigeria.com', aliases: ['fbn', 'first bank of nigeria'], region: 'naija', difficulty: 'medium' },
  { name: 'UBA', domain: 'ubagroup.com', aliases: ['united bank for africa'], region: 'naija', difficulty: 'medium' },
  { name: 'Kuda', domain: 'kuda.com', aliases: ['kuda bank'], region: 'naija', difficulty: 'medium' },
  { name: 'Opay', domain: 'opayweb.com', aliases: ['opay'], region: 'naija', difficulty: 'medium' },
  { name: 'PalmPay', domain: 'palmpay.com', aliases: ['palm pay'], region: 'naija', difficulty: 'medium' },
  { name: 'Paystack', domain: 'paystack.com', aliases: [], region: 'naija', difficulty: 'medium' },
  { name: 'Flutterwave', domain: 'flutterwave.com', aliases: ['flutter wave'], region: 'naija', difficulty: 'medium' },
  { name: 'Jumia', domain: 'jumia.com.ng', aliases: [], region: 'naija', difficulty: 'easy' },
  { name: 'Konga', domain: 'konga.com', aliases: [], region: 'naija', difficulty: 'medium' },
  { name: 'Bolt', domain: 'bolt.eu', aliases: ['taxify'], region: 'global', difficulty: 'easy' },
  { name: 'Indomie', domain: 'indomie.com', aliases: [], region: 'naija', difficulty: 'easy' },
  { name: 'Dangote', domain: 'dangote.com', aliases: ['dangote group', 'dangote cement'], region: 'naija', difficulty: 'easy' },
  { name: 'Nestlé', domain: 'nestle.com', aliases: ['nestle'], region: 'global', difficulty: 'easy' },
  { name: 'Maggi', domain: 'maggi.com', aliases: [], region: 'naija', difficulty: 'easy' },
  { name: 'Peak Milk', domain: 'peakmilk.com.ng', aliases: ['peak'], region: 'naija', difficulty: 'medium' },
  { name: 'Star Lager', domain: 'nbplc.com', aliases: ['star beer', 'star'], region: 'naija', difficulty: 'hard' },
  { name: 'Guinness', domain: 'guinness.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Coca-Cola', domain: 'coca-cola.com', aliases: ['coke', 'cocacola'], region: 'global', difficulty: 'easy' },
  { name: 'Pepsi', domain: 'pepsi.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Fanta', domain: 'fanta.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Sprite', domain: 'sprite.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'DStv', domain: 'dstv.com', aliases: ['multichoice', 'd stv'], region: 'naija', difficulty: 'easy' },
  { name: 'GOtv', domain: 'gotvafrica.com', aliases: ['go tv'], region: 'naija', difficulty: 'medium' },
  { name: 'Showmax', domain: 'showmax.com', aliases: [], region: 'africa', difficulty: 'medium' },
  { name: 'Channels TV', domain: 'channelstv.com', aliases: ['channels television', 'channels'], region: 'naija', difficulty: 'medium' },
  { name: 'BBC', domain: 'bbc.com', aliases: ['british broadcasting corporation'], region: 'global', difficulty: 'easy' },
  { name: 'CNN', domain: 'cnn.com', aliases: [], region: 'global', difficulty: 'easy' },

  // ── Global tech ──
  { name: 'Google', domain: 'google.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'YouTube', domain: 'youtube.com', aliases: ['you tube'], region: 'global', difficulty: 'easy' },
  { name: 'Apple', domain: 'apple.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Microsoft', domain: 'microsoft.com', aliases: ['ms'], region: 'global', difficulty: 'easy' },
  { name: 'Meta', domain: 'meta.com', aliases: ['facebook inc'], region: 'global', difficulty: 'medium' },
  { name: 'Facebook', domain: 'facebook.com', aliases: ['fb'], region: 'global', difficulty: 'easy' },
  { name: 'Instagram', domain: 'instagram.com', aliases: ['ig'], region: 'global', difficulty: 'easy' },
  { name: 'WhatsApp', domain: 'whatsapp.com', aliases: ['whats app'], region: 'global', difficulty: 'easy' },
  { name: 'TikTok', domain: 'tiktok.com', aliases: ['tik tok'], region: 'global', difficulty: 'easy' },
  { name: 'X', domain: 'x.com', aliases: ['twitter'], region: 'global', difficulty: 'easy' },
  { name: 'Snapchat', domain: 'snapchat.com', aliases: ['snap'], region: 'global', difficulty: 'easy' },
  { name: 'LinkedIn', domain: 'linkedin.com', aliases: ['linked in'], region: 'global', difficulty: 'easy' },
  { name: 'Netflix', domain: 'netflix.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Spotify', domain: 'spotify.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Amazon', domain: 'amazon.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'eBay', domain: 'ebay.com', aliases: ['e bay'], region: 'global', difficulty: 'easy' },
  { name: 'PayPal', domain: 'paypal.com', aliases: ['pay pal'], region: 'global', difficulty: 'easy' },
  { name: 'Stripe', domain: 'stripe.com', aliases: [], region: 'global', difficulty: 'medium' },
  { name: 'Visa', domain: 'visa.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Mastercard', domain: 'mastercard.com', aliases: ['master card'], region: 'global', difficulty: 'easy' },
  { name: 'Uber', domain: 'uber.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Airbnb', domain: 'airbnb.com', aliases: ['air bnb'], region: 'global', difficulty: 'easy' },
  { name: 'Slack', domain: 'slack.com', aliases: [], region: 'global', difficulty: 'medium' },
  { name: 'Zoom', domain: 'zoom.us', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Adobe', domain: 'adobe.com', aliases: [], region: 'global', difficulty: 'medium' },
  { name: 'GitHub', domain: 'github.com', aliases: ['git hub'], region: 'global', difficulty: 'medium' },

  // ── Auto / fashion / lifestyle ──
  { name: 'Toyota', domain: 'toyota.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Honda', domain: 'honda.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Mercedes-Benz', domain: 'mercedes-benz.com', aliases: ['mercedes', 'benz'], region: 'global', difficulty: 'easy' },
  { name: 'BMW', domain: 'bmw.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Tesla', domain: 'tesla.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Nike', domain: 'nike.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Adidas', domain: 'adidas.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Puma', domain: 'puma.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Gucci', domain: 'gucci.com', aliases: [], region: 'global', difficulty: 'medium' },
  { name: 'Louis Vuitton', domain: 'louisvuitton.com', aliases: ['lv'], region: 'global', difficulty: 'medium' },

  // ── Food chains ──
  { name: "McDonald's", domain: 'mcdonalds.com', aliases: ['mcdonalds', 'mcd'], region: 'global', difficulty: 'easy' },
  { name: 'KFC', domain: 'kfc.com', aliases: ['kentucky fried chicken'], region: 'global', difficulty: 'easy' },
  { name: 'Burger King', domain: 'bk.com', aliases: ['bk'], region: 'global', difficulty: 'easy' },
  { name: 'Starbucks', domain: 'starbucks.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Domino’s Pizza', domain: 'dominos.com', aliases: ['dominos', 'dominos pizza'], region: 'global', difficulty: 'easy' },
  { name: 'Chicken Republic', domain: 'chicken-republic.com', aliases: [], region: 'naija', difficulty: 'easy' },

  // ── Sports / entertainment ──
  { name: 'FIFA', domain: 'fifa.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'NBA', domain: 'nba.com', aliases: [], region: 'global', difficulty: 'easy' },
  { name: 'Premier League', domain: 'premierleague.com', aliases: ['epl'], region: 'global', difficulty: 'medium' },
  { name: 'UEFA Champions League', domain: 'uefa.com', aliases: ['ucl', 'champions league', 'uefa'], region: 'global', difficulty: 'medium' },

  // ── African pan / regional ──
  { name: 'Safaricom', domain: 'safaricom.co.ke', aliases: ['mpesa', 'm-pesa'], region: 'africa', difficulty: 'medium' },
  { name: 'Vodacom', domain: 'vodacom.com', aliases: [], region: 'africa', difficulty: 'medium' },
];

export const LOGO_BRANDS: LogoBrand[] = RAW.map((b) => ({ ...b, id: id(b.domain) }));

export function brandById(id: string): LogoBrand | undefined {
  return LOGO_BRANDS.find((b) => b.id === id);
}

export function brandsByRegion(region: LogoBrandRegion): LogoBrand[] {
  return LOGO_BRANDS.filter((b) => b.region === region);
}
