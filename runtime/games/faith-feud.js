// Faith Feud — Family Feud-style team game with faceoff, strikes, steals.

import { RuntimeBase, makeRng, shuffleInPlace, clone, topPlayers } from '../helpers.js';

const SURVEY_PACKS = { general: {
  'Name something you find in a Nigerian kitchen': [
    { text:'Maggi cube', aliases:['seasoning','knorr','cube','maggi'], points:35 },
    { text:'Pot', aliases:['saucepan'], points:25 },
    { text:'Palm oil', aliases:['oil'], points:18 },
    { text:'Rice', aliases:[], points:12 },
    { text:'Mortar', aliases:['pestle'], points:10 },
  ],
  'What do Lagosians complain about most?': [
    { text:'Traffic', aliases:['go-slow','jam','hold-up'], points:40 },
    { text:'NEPA', aliases:['power','electricity','light'], points:30 },
    { text:'Police', aliases:['checkpoint'], points:15 },
    { text:'Money', aliases:['expensive','prices'], points:10 },
    { text:'Rain', aliases:['flooding','water'], points:5 },
  ],
}};

function matchAnswer(text, answers) {
  const norm = text.toLowerCase().trim();
  for (const a of answers) {
    if (norm === a.text.toLowerCase()) return a;
    for (const alias of a.aliases) { if (norm === alias.toLowerCase()) return a; }
  }
  return null;
}

export class FaithFeudRuntime extends RuntimeBase {
  start() {
    const seed = Number(this.context?.settings?.seed) || (Date.now()&0xffffffff);
    this.rng = makeRng(seed);
    this.totalRounds = Math.min(5, Math.max(1, Number(this.context?.settings?.rounds)||3));
    this.maxStrikes = 3;
    this.steals = this.context?.settings?.steals !== false;

    const pack = SURVEY_PACKS[this.context?.settings?.surveyPack||'general']??SURVEY_PACKS.general;
    this.surveys = shuffleInPlace(clone(Object.entries(pack)),this.rng).slice(0,this.totalRounds);
    this.ci = 0; this.rev = []; this.strikes=0; this.stealA=false; this.phase='faceoff';
    this.team1=this.players.slice(0,Math.ceil(this.players.length/2));
    this.team2=this.players.slice(Math.ceil(this.players.length/2));
    this.teamId=0;
    this.subs={};
    this.wrongGuesses=new Set();
    this.state = this.bs();
  }

  bs() {
    const s = this.surveys[this.ci];
    return {
      gameType:this.gameType,name:this.manifest.name,emoji:this.manifest.emoji,
      mode:'feud',phase:this.phase==='finished'?'finished':'playing',
      round:this.ci+1,totalRounds:this.totalRounds,
      challenge:s?{kind:'text',prompt:s[0]}:null,
      totalSlots:s?s[1].length:0, // answer-slot count only — no answer content leaks
      maxStrikes:this.maxStrikes,
      players:clone(this.players.map(p=>({...p}))),
      submittedCount:Object.keys(this.subs).length,submissions:clone(this.subs),
      revealedAnswers:clone(this.rev),strikes:this.strikes,activeTeam:this.teamId,
      team1Ids:this.team1.map(p=>p.id),team2Ids:this.team2.map(p=>p.id),
      stealActive:this.stealA,lastResults:[],winnerPlayerIds:[],
      lastAction:s?'Faceoff! Type your answer.':'Loading...',
    };
  }

  handleIntent(pid, intent, isHost) {
    if(!this.state||this.phase==='finished')return false;
    if(intent?.type==='advance'&&isHost){this.adv();this.state=this.bs();return true;}
    if((intent?.type==='answer_text'||intent?.type==='answer')&&(intent?.text||intent?.answer)){
      // Active team keeps guessing (one answer at a time) until 3 strikes or the board clears,
      // so a 1-per-team game never deadlocks. subs records the latest guess for display only.
      return this.handle(pid,String(intent?.text??intent?.answer??''));
    }
    return false;
  }

  handle(pid, text) {
    const t1=this.team1.some(p=>p.id===pid),t2=this.team2.some(p=>p.id===pid);
    if(!t1&&!t2)return false;
    const pteam=t1?0:1;
    if(pteam!==this.teamId&&!this.stealA)return false;

    const [,ans]=this.surveys[this.ci];
    const norm=text.toLowerCase().trim();
    if(!norm)return false;
    const m=matchAnswer(text,ans);
    // A wrong answer the team already tried this round is a no-op (no extra strike, no spam).
    if(!m&&this.wrongGuesses.has(norm))return false;
    this.subs[pid]={text,correct:!!m,time:Date.now()};

    if(!m){
      this.wrongGuesses.add(norm);
      this.strikes+=1;
      if(this.strikes>=this.maxStrikes){
        if(this.steals&&!this.stealA){this.stealA=true;this.strikes=0;}
        else this.adv();
      }
      this.state=this.bs();
      this.state.lastAction=`Strike ${this.strikes}/${this.maxStrikes} ❌`;
      return true;
    }

    const idx=ans.findIndex(a=>a.text===m.text);
    if(this.rev.some(r=>r.index===idx)){
      this.strikes+=1;this.state=this.bs();
      this.state.lastAction=`Already found! Strike ${this.strikes}/${this.maxStrikes}.`;
      return true;
    }

    if(this.stealA){
      const team=pteam===0?this.team1:this.team2;
      for(const p of team)p.score+=m.points;
      this.rev=[];this.strikes=0;this.stealA=false;this.teamId=pteam;this.adv();
    }else{
      const team=pteam===0?this.team1:this.team2;
      for(const p of team)p.score+=m.points;
      this.rev.push({index:idx,text:m.text,points:m.points});
      if(this.rev.length>=ans.length)this.adv();
    }
    this.state=this.bs();
    this.state.lastAction=`✅ ${m.text} — +${m.points} pts!`;
    return true;
  }

  adv(){this.ci+=1;this.rev=[];this.strikes=0;this.stealA=false;this.teamId=(this.teamId+1)%2;this.subs={};this.wrongGuesses=new Set();
    if(this.ci>=this.totalRounds){this.phase='finished';this.state=this.bs();this.state.phase='finished';
      this.state.winnerPlayerIds=topPlayers(this.players);
      this.state.lastAction=this.state.winnerPlayerIds.length>1?'Draw!':`${this.players.find(p=>p.id===this.state.winnerPlayerIds[0])?.name} wins!`;return;}
    this.phase='faceoff';this.state=this.bs();}

  publicState(){return clone(this.state);}
  privateState(pid){return {seated:this.seated(pid),team:this.team1.some(p=>p.id===pid)?0:1,submitted:!!this.subs[pid],legalIntents:this.legalIntents(pid)};}
  legalIntents(pid){if(!this.state||!this.seated(pid))return[];return [{type:'answer_text',label:'Type your answer'}];}
  // Server-side bot: pick the highest-point answer the board has not revealed yet. This runs on
  // the server through legal intents only and is never exposed to human players' private state.
  rankBotIntent(){
    const survey=this.surveys[this.ci];
    if(!survey)return {type:'answer_text',text:'pass'};
    const [,ans]=survey;
    const remaining=ans.filter((a,i)=>!this.rev.some(r=>r.index===i)).filter(a=>!this.wrongGuesses.has(a.text.toLowerCase()));
    const best=remaining.sort((a,b)=>b.points-a.points)[0];
    return {type:'answer_text',text:best?best.text:'pass'};
  }
  extraSnapshot(){return {surveys:this.surveys,ci:this.ci,rev:this.rev,strikes:this.strikes,stealA:this.stealA,teamId:this.teamId,team1:this.team1,team2:this.team2,phase:this.phase,subs:this.subs,wrongGuesses:[...(this.wrongGuesses??[])]};}
  restoreExtra(e){this.surveys=e?.surveys??[];this.ci=e?.ci??0;this.rev=e?.rev??[];this.strikes=e?.strikes??0;this.stealA=e?.stealA??false;this.teamId=e?.teamId??0;this.team1=e?.team1??[];this.team2=e?.team2??[];this.phase=e?.phase??'faceoff';this.subs=e?.subs??{};this.wrongGuesses=new Set(e?.wrongGuesses??[]);}
}
