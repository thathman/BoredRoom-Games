// Word Wahala — layered dictionary.
//
// MVP approach:
//   - `pidgin` / `slang` / `indigenous` are small curated, hand-checked lists.
//   - `standard` is a compact embedded common-English wordlist (~2k entries)
//     covering the most-played Scrabble words. A larger lazy-loaded tier will
//     replace this in v1.1 (see plan.md Word Wahala open questions).
//
// Each tier carries a multiplier or flat bonus applied to the word's base
// letter score (after letter-bonus squares, before word-bonus squares).
//
// Indigenous inclusion rule: a word is `indigenous` when it is widely used in
// Nigerian English across multiple ethnic groups (Yoruba/Igbo/Hausa). New
// additions MUST cite this rule in the PR description.

export type DictionaryTier = 'standard' | 'pidgin' | 'slang' | 'indigenous';

export interface TierConfig {
  tier: DictionaryTier;
  /** Multiplier applied to the per-letter base score sum (before word bonus). */
  multiplier: number;
  /** Flat bonus added on top. */
  flatBonus: number;
  /** Display label for score breakdown. */
  label: string;
}

export const TIER_CONFIGS: Record<DictionaryTier, TierConfig> = {
  standard:    { tier: 'standard',   multiplier: 1.0, flatBonus: 0, label: 'English'    },
  pidgin:      { tier: 'pidgin',     multiplier: 1.5, flatBonus: 5, label: 'Pidgin'     },
  slang:       { tier: 'slang',      multiplier: 2.0, flatBonus: 0, label: 'Slang'      },
  indigenous:  { tier: 'indigenous', multiplier: 2.0, flatBonus: 0, label: 'Indigenous' },
};

// ──────────────────────────────────────────────────────────────────────────
// Pidgin tier — Nigerian Pidgin words and short phrases
// ──────────────────────────────────────────────────────────────────────────
export const PIDGIN_WORDS: string[] = [
  'wahala', 'sabi', 'abeg', 'chop', 'oga', 'pikin', 'wetin', 'comot',
  'gist', 'yawa', 'gbese', 'japa', 'wahalla', 'naija', 'jare', 'shey',
  'dey', 'una', 'wey', 'no', 'yes', 'sef', 'shaa', 'biko', 'nawa', 'haba',
  'kpele', 'pele', 'bros', 'sister', 'mumu', 'gbam', 'yarn', 'soso',
  'kpalava', 'palava', 'shakara', 'gobe', 'kasala', 'kpomo', 'kobo',
];

// ──────────────────────────────────────────────────────────────────────────
// Slang tier — current Naija slang & Twitter / TikTok-era words
// ──────────────────────────────────────────────────────────────────────────
export const SLANG_WORDS: string[] = [
  'cap', 'fr', 'fam', 'vibe', 'vibes', 'mood', 'tea', 'shade', 'slay',
  'lit', 'goat', 'fire', 'snitch', 'pressed', 'ratio', 'simp', 'bet',
  'stan', 'ship', 'salty', 'flex', 'flexin', 'ginger', 'soft', 'rizz',
  'gyatt', 'maga', 'omo', 'mad', 'hard', 'baba', 'cruise', 'cruising',
  'banger', 'kelvin',
];

// ──────────────────────────────────────────────────────────────────────────
// Indigenous tier — common across NG (Yoruba / Igbo / Hausa loanwords)
// ──────────────────────────────────────────────────────────────────────────
export const INDIGENOUS_WORDS: string[] = [
  'jollof', 'egusi', 'amala', 'eba', 'fufu', 'suya', 'akara', 'puffpuff',
  'moimoi', 'gari', 'iyan', 'ewedu', 'ogbono', 'efo', 'edikang', 'tuwo',
  'masa', 'kunu', 'zobo', 'palmwine', 'ogogoro', 'owambe', 'aso', 'gele',
  'agbada', 'iro', 'buba', 'fila', 'okada', 'keke', 'danfo', 'molue',
  'nepa', 'yoruba', 'igbo', 'hausa', 'edo', 'tiv', 'ijaw', 'fulani',
  'ogbene', 'oga', 'oyibo', 'ojuju', 'akpu', 'ugu', 'utazi', 'ofada',
  'anambra', 'lagos', 'abuja', 'kano', 'kaduna', 'enugu', 'oyo',
];

// ──────────────────────────────────────────────────────────────────────────
// Standard tier — compact embedded common English wordlist for MVP.
// ~1200 frequent Scrabble-legal short words. A full lazy-loaded ENABLE-style
// list will replace this in v1.1.
// ──────────────────────────────────────────────────────────────────────────
export const STANDARD_WORDS: string[] = [
  // 2-letter (common Scrabble openers)
  'aa','ab','ad','ae','ag','ah','ai','al','am','an','ar','as','at','aw','ax','ay',
  'ba','be','bi','bo','by','de','do','ed','ef','eh','el','em','en','er','es','et','ex',
  'fa','fe','go','ha','he','hi','hm','ho','id','if','in','is','it','jo','ka','ki',
  'la','li','lo','ma','me','mi','mm','mo','mu','my','na','no','nu','od','oe','of','oh',
  'oi','om','on','op','or','os','ou','ow','ox','oy','pa','pe','pi','qi','re','sh','si',
  'so','ta','ti','to','uh','um','un','up','us','ut','we','wo','xi','xu','ya','ye','yo','za',
  // 3-letter common
  'act','add','age','ago','aid','aim','air','all','and','any','arc','are','arm','art',
  'ash','ask','ate','axe','bad','bag','ban','bar','bat','bay','bed','bee','beg','bet',
  'bid','big','bin','bit','boa','bog','boy','box','bud','bug','bun','bus','but','buy',
  'bye','cab','cap','car','cat','cob','cod','cog','con','cop','cot','cow','cry','cub',
  'cue','cup','cut','dab','dad','day','den','dew','did','die','dig','dim','dip','dog',
  'dot','dry','dub','due','dug','duo','dye','ear','eat','ebb','egg','ego','elf','elk',
  'elm','end','era','ere','eve','ewe','eye','fab','fad','fan','far','fat','fax','fed',
  'fee','few','fib','fig','fin','fir','fit','fix','fly','foe','fog','for','fox','fry',
  'fun','fur','gab','gag','gal','gap','gas','gel','gem','get','gig','gin','god','got',
  'gum','gun','gut','guy','gym','had','hag','ham','has','hat','hay','hem','hen','her',
  'hew','hex','hey','hid','him','hip','his','hit','hoe','hog','hop','hot','how','hub',
  'hue','hug','hum','hut','ice','icy','imp','ink','inn','ion','ire','irk','its','ivy',
  'jab','jag','jam','jar','jaw','jay','jet','jig','job','jog','jot','joy','jug','jut',
  'keg','key','kid','kin','kip','kit','lab','lad','lag','lap','law','lax','lay','led',
  'lee','leg','let','lid','lie','lip','lit','log','lop','lot','low','mad','man','map',
  'mar','mat','may','men','met','mid','mix','mob','mod','mom','moo','mop','mow','mud',
  'mug','nab','nag','nap','nay','net','new','nib','nip','nit','nod','nor','not','now',
  'nub','nun','nut','oaf','oak','oar','oat','odd','off','oft','oil','old','ore','our',
  'out','owe','owl','own','pad','pal','pan','par','pat','paw','pay','pea','peg','pen',
  'pep','per','pet','pew','pie','pig','pin','pit','ply','pod','pop','pot','pow','pro',
  'pry','pub','pug','pun','pup','pur','put','rag','rah','ram','ran','rap','rat','raw',
  'ray','red','ref','rib','rid','rig','rim','rip','rob','rod','roe','rot','row','rub',
  'rue','rug','rum','run','rut','rye','sac','sad','sag','sap','sat','saw','say','sea',
  'see','set','sew','sex','she','shy','sin','sip','sir','sit','six','ski','sky','sly',
  'sob','sod','son','sop','sow','soy','spa','spy','sub','sue','sum','sun','sup','tab',
  'tad','tag','tan','tap','tar','tax','tea','tee','ten','the','thy','tic','tie','tin',
  'tip','toe','too','top','tot','tow','toy','try','tub','tug','two','use','van','vat',
  'vet','vex','via','vie','vow','war','was','wax','way','web','wed','wee','wet','who',
  'why','wig','win','wit','woe','wok','won','woo','wow','wry','yak','yam','yap','yard',
  'yaw','yea','yen','yes','yet','yew','yip','you','zag','zap','zed','zen','zip','zoo',
  // 4-letter common
  'able','acid','aged','also','area','army','away','baby','back','ball','band','bank',
  'base','bath','bear','beat','been','beer','bell','belt','best','bias','bike','bill',
  'bird','blow','blue','boat','body','bond','bone','book','boom','born','boss','both',
  'bowl','bulk','burn','bush','busy','call','calm','came','camp','card','care','case',
  'cash','cast','cell','chat','chip','city','club','coal','coat','code','cold','come',
  'cook','cool','cope','copy','core','cost','crew','crop','dark','data','date','dawn',
  'days','dead','deal','dean','dear','debt','deep','deny','desk','dial','dick','diet',
  'disc','disk','does','done','door','dose','down','draw','drew','drop','drug','dual',
  'duke','dust','duty','each','earn','ease','east','easy','edge','else','even','ever',
  'evil','exit','face','fact','fail','fair','fall','farm','fast','fate','fear','feed',
  'feel','feet','fell','felt','file','fill','film','find','fine','fire','firm','fish',
  'five','flag','flat','flow','food','foot','ford','form','fort','four','free','from',
  'fuel','full','fund','gain','game','gate','gave','gear','gene','gift','girl','give',
  'glad','goal','goes','gold','golf','gone','good','gray','grew','grey','grow','gulf',
  'hair','half','hall','hand','hang','hard','harm','hate','have','head','hear','heat',
  'held','help','here','hero','high','hill','hire','hold','hole','holy','home','hope',
  'host','hour','huge','hung','hunt','hurt','idea','inch','into','iron','item','jack',
  'jane','jean','john','join','jump','jury','just','keen','keep','kept','kick','kill',
  'kind','king','knee','knew','know','lack','lady','laid','lake','land','lane','last',
  'late','lead','left','less','life','lift','like','line','link','list','live','load',
  'loan','lock','logo','long','look','lord','lose','loss','lost','love','luck','made',
  'mail','main','make','male','many','mark','mass','matt','mean','meat','meet','menu',
  'mere','mike','mile','milk','mill','mind','mine','miss','mode','mood','moon','more',
  'most','move','much','must','name','navy','near','neck','need','news','next','nice',
  'nick','nine','none','nose','note','okay','once','only','onto','open','oral','over',
  'pace','pack','page','paid','pain','pair','palm','park','part','pass','past','path',
  'peak','pick','pink','pipe','plan','play','plot','plug','plus','poll','pool','poor',
  'port','post','pull','pure','push','race','rail','rain','rank','rare','rate','read',
  'real','rear','rely','rent','rest','rice','rich','ride','ring','rise','risk','road',
  'rock','role','roll','roof','room','root','rope','rose','rule','rush','ruth','safe',
  'said','sake','sale','salt','same','sand','save','seat','seed','seek','seem','seen',
  'self','sell','send','sent','sept','ship','shop','shot','show','shut','sick','side',
  'sign','site','size','skin','slip','slow','snow','soft','soil','sold','sole','some',
  'song','soon','sort','soul','spot','star','stay','step','stop','such','suit','sure',
  'take','tale','talk','tall','tank','tape','task','team','tech','tell','tend','term',
  'test','text','than','that','them','then','they','thin','this','thus','tide','time',
  'tiny','told','toll','tone','tony','took','tool','tour','town','tree','trip','true',
  'tune','turn','twin','type','unit','upon','used','user','vary','vast','very','vice',
  'view','vote','wage','wait','wake','walk','wall','want','ward','warm','wash','wave',
  'ways','weak','wear','week','well','went','were','west','what','when','whom','wide',
  'wife','wild','will','wind','wine','wing','wire','wise','wish','with','wood','word',
  'wore','work','yard','yeah','year','your','zero','zone',
  // 5-letter (common Scrabble openers)
  'about','above','abuse','actor','acute','admit','adopt','adult','after','again','agent',
  'agree','ahead','alarm','album','alert','alike','alive','allow','alone','along','alter',
  'among','anger','angle','angry','apart','apple','apply','arena','argue','arise','array',
  'aside','asset','audio','avoid','awake','award','aware','badly','baker','bases','basic',
  'basis','beach','began','begin','begun','being','below','bench','billy','birth','black',
  'blame','blind','block','blood','board','boost','booth','bound','brain','brand','bread',
  'break','breed','brief','bring','broad','broke','brown','build','built','buyer','cable',
  'calif','carry','catch','cause','chain','chair','chart','chase','cheap','check','chest',
  'chief','child','china','chose','civil','claim','class','clean','clear','click','clock',
  'close','coach','coast','could','count','court','cover','craft','crash','cream','crime',
  'cross','crowd','crown','curve','cycle','daily','dance','dated','dealt','death','debut',
  'delay','depth','doing','doubt','dozen','draft','drama','drawn','dream','dress','drill',
  'drink','drive','drove','dying','eager','early','earth','eight','elite','empty','enemy',
  'enjoy','enter','entry','equal','error','event','every','exact','exist','extra','faith',
  'false','fault','fiber','field','fifth','fifty','fight','final','first','fixed','flash',
  'fleet','floor','fluid','focus','force','forth','forty','forum','found','frame','frank',
  'fraud','fresh','front','fruit','fully','funny','giant','given','glass','globe','going',
  'grace','grade','grand','grant','grass','great','green','gross','group','grown','guard',
  'guess','guest','guide','happy','harry','heart','heavy','hence','henry','horse','hotel',
  'house','human','ideal','image','index','inner','input','issue','japan','jimmy','joint',
  'jones','judge','known','label','large','laser','later','laugh','layer','learn','lease',
  'least','leave','legal','level','lewis','light','limit','links','lives','local','logic',
  'loose','lower','lucky','lunch','lying','magic','major','maker','march','maria','match',
  'maybe','mayor','meant','media','metal','might','minor','minus','mixed','model','money',
  'month','moral','motor','mount','mouse','mouth','movie','music','needs','never','newly',
  'night','noise','north','noted','novel','nurse','occur','ocean','offer','often','order',
  'other','ought','paint','panel','paper','party','peace','peter','phase','phone','photo',
  'piece','pilot','pitch','place','plain','plane','plant','plate','point','pound','power',
  'press','price','pride','prime','print','prior','prize','proof','proud','prove','queen',
  'quick','quiet','quite','radio','raise','range','rapid','ratio','reach','ready','refer',
  'right','rival','river','robin','roger','roman','rough','round','route','royal','rural',
  'scale','scene','scope','score','sense','serve','seven','shall','shape','share','sharp',
  'sheet','shelf','shell','shift','shirt','shock','shoot','short','shown','sight','since',
  'sixth','sixty','sized','skill','sleep','slide','small','smart','smile','smith','smoke',
  'solid','solve','sorry','sound','south','space','spare','speak','speed','spend','spent',
  'split','spoke','sport','staff','stage','stake','stand','start','state','steam','steel',
  'stick','still','stock','stone','stood','store','storm','story','strip','stuck','study',
  'stuff','style','sugar','suite','super','sweet','table','taken','taste','taxes','teach',
  'teeth','terry','texas','thank','theft','their','theme','there','these','thick','thing',
  'think','third','those','three','threw','throw','tight','times','tired','title','today',
  'topic','total','touch','tough','tower','track','trade','train','treat','trend','trial',
  'tried','tries','truck','truly','trust','truth','twice','under','undue','union','unity',
  'until','upper','upset','urban','usage','usual','valid','value','video','virus','visit',
  'vital','voice','waste','watch','water','wheel','where','which','while','white','whole',
  'whose','woman','women','world','worry','worse','worst','worth','would','wound','write',
  'wrong','wrote','yield','young','youth',
];

// Build O(1) lookup sets
function toSet(words: string[]): Set<string> {
  return new Set(words.map((w) => w.toLowerCase()));
}

const TIER_SETS: Record<DictionaryTier, Set<string>> = {
  standard: toSet(STANDARD_WORDS),
  pidgin: toSet(PIDGIN_WORDS),
  slang: toSet(SLANG_WORDS),
  indigenous: toSet(INDIGENOUS_WORDS),
};

// ──────────────────────────────────────────────────────────────────────────
// Extended standard tier (lazy)
// 178k SOWPODS-derived word list lives in data/sowpods.txt.gz.
// Loaded on first lookup miss against the embedded set, then merged in.
// Server-only (Node) — uses zlib + fs. Browser code never calls this path.
// ──────────────────────────────────────────────────────────────────────────
let extendedLoaded = false;
let extendedLoading: Promise<void> | null = null;

async function loadExtendedDictionary(): Promise<void> {
  if (extendedLoaded) return;
  if (extendedLoading) return extendedLoading;
  // Only load in Node — guard against bundlers / browser environments.
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
    extendedLoaded = true;
    return;
  }
  extendedLoading = (async () => {
    try {
      const [{ readFile }, { gunzipSync }, { fileURLToPath }, path] = await Promise.all([
        import('node:fs/promises'),
        import('node:zlib'),
        import('node:url'),
        import('node:path'),
      ]);
      const here = path.dirname(fileURLToPath(import.meta.url));
      // dictionary.ts compiles to dist/games/wordwahala/dictionary.js — the
      // data file ships alongside the source, so try a few resolution paths.
      const candidates = [
        path.join(here, 'data', 'sowpods.txt.gz'),
        path.join(here, '..', '..', '..', 'src', 'games', 'wordwahala', 'data', 'sowpods.txt.gz'),
        path.join(process.cwd(), 'shared', 'src', 'games', 'wordwahala', 'data', 'sowpods.txt.gz'),
      ];
      let buf: Buffer | null = null;
      for (const p of candidates) {
        try {
          buf = await readFile(p);
          break;
        } catch { /* try next */ }
      }
      if (!buf) {
        console.warn('[wordwahala] extended dictionary not found, using compact list only');
        extendedLoaded = true;
        return;
      }
      const text = gunzipSync(buf).toString('utf8');
      let added = 0;
      for (const line of text.split('\n')) {
        const w = line.trim();
        if (w && !TIER_SETS.standard.has(w)) {
          TIER_SETS.standard.add(w);
          added++;
        }
      }
      console.log(`[wordwahala] extended standard dictionary loaded: +${added} words (total ${TIER_SETS.standard.size})`);
      extendedLoaded = true;
    } catch (err) {
      console.warn('[wordwahala] failed to load extended dictionary:', err);
      extendedLoaded = true;
    }
  })();
  return extendedLoading;
}

/** Kick off background load. Idempotent. Server room calls this on boot. */
export function preloadExtendedDictionary(): Promise<void> {
  return loadExtendedDictionary();
}

/** True once extended list has finished loading (or failed gracefully). */
export function isExtendedDictionaryLoaded(): boolean {
  return extendedLoaded;
}

export interface LookupResult {
  found: boolean;
  tier: DictionaryTier | null;
}

/**
 * Resolve a word against the layered dictionary. Higher-tier matches win
 * when a word appears in multiple tiers (e.g. 'omo' is slang AND indigenous —
 * indigenous wins because it scores higher base, but tier order is checked
 * to favor non-standard tiers for the bonus payout).
 */
export function lookupWord(raw: string): LookupResult {
  const w = raw.trim().toLowerCase();
  if (!w) return { found: false, tier: null };
  // Order: indigenous → slang → pidgin → standard. First match wins.
  if (TIER_SETS.indigenous.has(w)) return { found: true, tier: 'indigenous' };
  if (TIER_SETS.slang.has(w)) return { found: true, tier: 'slang' };
  if (TIER_SETS.pidgin.has(w)) return { found: true, tier: 'pidgin' };
  if (TIER_SETS.standard.has(w)) return { found: true, tier: 'standard' };
  return { found: false, tier: null };
}

export function tierConfig(tier: DictionaryTier): TierConfig {
  return TIER_CONFIGS[tier];
}

/** Diagnostics — used by tests and admin endpoints. */
export function dictionarySize(tier: DictionaryTier): number {
  return TIER_SETS[tier].size;
}
