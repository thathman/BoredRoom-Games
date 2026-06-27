// Faith Feud — Family Feud-style team game with faceoff, strikes, steals.

import { RuntimeBase, makeRng, shuffleInPlace, clone } from '../helpers.js';

const SURVEY_PACKS = {
  general: {
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
    'Name a popular Nigerian food': [
      { text:'Jollof rice', aliases:['jollof'], points:38 },
      { text:'Pounded yam', aliases:['poundo','iyan'], points:24 },
      { text:'Egusi', aliases:['egusi soup'], points:16 },
      { text:'Suya', aliases:[], points:12 },
      { text:'Akara', aliases:['bean cake'], points:10 },
    ],
    'Name something people do at an owambe': [
      { text:'Spray money', aliases:['spraying','spray'], points:36 },
      { text:'Dance', aliases:['dancing'], points:28 },
      { text:'Eat', aliases:['chop','eating'], points:18 },
      { text:'Wear aso ebi', aliases:['aso ebi','asoebi'], points:12 },
      { text:'Take photos', aliases:['snap','pictures'], points:6 },
    ],
    'Name a way Nigerians greet elders': [
      { text:'Kneel', aliases:['kneeling'], points:34 },
      { text:'Prostrate', aliases:['dobale','lie down'], points:30 },
      { text:'Bow', aliases:['bowing'], points:18 },
      { text:'Good morning sir', aliases:['greet','good morning'], points:12 },
      { text:'Handshake', aliases:['shake hands'], points:6 },
    ],
    'Name something you hear in a Lagos danfo': [
      { text:'Owa o', aliases:['owa','bus stop'], points:34 },
      { text:'Conductor shouting', aliases:['conductor','shouting'], points:26 },
      { text:'Enter with your change', aliases:['change','your change'], points:20 },
      { text:'Music', aliases:['fuji','afrobeats'], points:12 },
      { text:'Arguments', aliases:['quarrel','fight'], points:8 },
    ],
  },
  church: {
    'Name something you find in church': [
      { text:'Bible', aliases:['holy book','scripture'], points:34 },
      { text:'Choir', aliases:['singers','praise team'], points:26 },
      { text:'Pulpit', aliases:['altar'], points:16 },
      { text:'Offering basket', aliases:['offering','collection'], points:14 },
      { text:'Drums', aliases:['instruments','keyboard'], points:10 },
    ],
    'Name a book of the Bible': [
      { text:'Genesis', aliases:[], points:30 },
      { text:'Psalms', aliases:['psalm'], points:26 },
      { text:'John', aliases:['gospel of john'], points:18 },
      { text:'Matthew', aliases:[], points:14 },
      { text:'Revelation', aliases:['revelations'], points:12 },
    ],
    'Name a fruit of the Spirit': [
      { text:'Love', aliases:[], points:30 },
      { text:'Joy', aliases:[], points:24 },
      { text:'Peace', aliases:[], points:20 },
      { text:'Patience', aliases:['longsuffering'], points:16 },
      { text:'Kindness', aliases:['gentleness','goodness'], points:10 },
    ],
    'Name something people say to start a prayer': [
      { text:'Our Father', aliases:['father lord','heavenly father'], points:34 },
      { text:'In Jesus name', aliases:['jesus name'], points:28 },
      { text:'Hallelujah', aliases:['halleluyah'], points:18 },
      { text:'Let us pray', aliases:['pray'], points:12 },
      { text:'Almighty God', aliases:['almighty'], points:8 },
    ],
  },
};

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
    const pack = SURVEY_PACKS[this.context?.settings?.surveyPack||'general']??SURVEY_PACKS.general;
    // Merge AI-generated surveys (server-validated) ahead of the local pack; local pack is the
    // fail-soft fallback so the game always has enough surveys offline.
    const aiSurveys = Array.isArray(this.context?.settings?.aiSurveys) ? this.context.settings.aiSurveys : [];
    const aiEntries = aiSurveys
      .filter((s) => s && typeof s.question === 'string' && Array.isArray(s.answers) && s.answers.length >= 3)
      .map((s) => [s.question, s.answers.map((a) => ({ text: a.text, aliases: a.aliases ?? [], points: a.points }))]);
    this.baseSurveys = [...aiEntries, ...Object.entries(pack)];
    this.maxStrikes = 3;
    this.steals = this.context?.settings?.steals !== false;
    this.requestedRounds = Math.max(1, Number(this.context?.settings?.rounds)||3);
    this.surveyCollectionEnabled = this.context?.settings?.surveyCollection !== false;
    this.collectionPrompts = (Array.isArray(this.context?.settings?.surveyQuestions)
      ? this.context.settings.surveyQuestions
      : ['Name something that makes a Nigerian party memorable', 'Name something people do before Sunday service'])
      .map(String).map((value) => value.trim()).filter(Boolean).slice(0, 4);
    this.collectionIndex = 0;
    this.collectionResponses = {};
    this.collectedSurveys = [];
    this.surveys = [];
    this.totalRounds = this.requestedRounds;
    this.ci = 0; this.rev = []; this.strikes=0; this.phase=this.surveyCollectionEnabled&&this.collectionPrompts.length?'survey_collection':'faceoff_buzz';
    this.team1=this.players.slice(0,Math.ceil(this.players.length/2));
    this.team2=this.players.slice(Math.ceil(this.players.length/2));
    this.teamId=0;
    this.subs={};
    this.wrongGuesses=new Set();
    this.buzzedPlayerId=null;
    this.firstBuzzedPlayerId=null;
    this.faceoffAnswers=[];
    this.roundBank=0;
    this.teamScores=[0,0];
    if (this.phase !== 'survey_collection') this.finalizeSurveyDeck();
    this.state = this.bs();
  }

  bs() {
    const s = this.surveys[this.ci];
    const collecting = this.phase === 'survey_collection';
    const challengePrompt = collecting ? this.collectionPrompts[this.collectionIndex] : s?.[0];
    return {
      gameType:this.gameType,name:this.manifest.name,emoji:this.manifest.emoji,
      mode:'feud',phase:this.phase,
      round:this.ci+1,totalRounds:this.totalRounds,
      challenge:challengePrompt?{kind:'text',prompt:challengePrompt}:null,
      totalSlots:collecting?0:(s?.[1].length??0), // answer-slot count only — no answer content leaks
      maxStrikes:this.maxStrikes,
      players:clone(this.players.map(p=>({...p}))),
      submittedCount:collecting?Object.keys(this.collectionResponses).length:Object.keys(this.subs).length,
      revealedAnswers:clone(this.rev),strikes:this.strikes,activeTeam:this.teamId,
      team1Ids:this.team1.map(p=>p.id),team2Ids:this.team2.map(p=>p.id),
      stealActive:this.phase==='steal',roundBank:this.roundBank,teamScores:clone(this.teamScores),
      faceoffPlayerIds:this.faceoffPlayerIds(),buzzedPlayerId:this.buzzedPlayerId,
      collectionIndex:this.collectionIndex,collectionTotal:this.collectionPrompts.length,
      lastResults:[],winnerPlayerIds:this.state?.winnerPlayerIds??[],
      lastAction:this.state?.lastAction??(collecting?'Answer privately. Your responses build tonight’s survey board.':'Faceoff representatives: get ready to buzz!'),
    };
  }

  handleIntent(pid, intent, isHost) {
    if(!this.state||this.phase==='finished')return false;
    if(intent?.type==='advance'&&isHost&&this.phase==='round_reveal'){this.advanceRound();return true;}
    if(this.phase==='survey_collection'&&intent?.type==='survey_answer')return this.collectSurveyAnswer(pid,intent);
    if(this.phase==='faceoff_buzz'&&intent?.type==='buzz')return this.handleBuzz(pid);
    if((intent?.type==='answer_text'||intent?.type==='answer')&&(intent?.text||intent?.answer)){
      return this.handleAnswer(pid,String(intent?.text??intent?.answer??''));
    }
    return false;
  }

  collectSurveyAnswer(pid, intent) {
    if(!this.seated(pid)||this.collectionResponses[pid])return false;
    const values=(Array.isArray(intent.answers)?intent.answers:[intent.text]).map(String).map(v=>v.trim().slice(0,80)).filter(Boolean).slice(0,3);
    if(values.length===0)return false;
    this.collectionResponses[pid]=values;
    if(Object.keys(this.collectionResponses).length>=this.players.length)this.completeCollectionQuestion();
    this.state=this.bs();
    this.state.lastAction=this.phase==='survey_collection'?`${Object.keys(this.collectionResponses).length}/${this.players.length} survey responses received.`:'Survey complete. Faceoff representatives: buzz in!';
    return true;
  }

  completeCollectionQuestion(){
    const counts=new Map();
    for(const answers of Object.values(this.collectionResponses))for(const raw of answers){
      const key=raw.toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();
      if(!key)continue;
      const current=counts.get(key)??{text:raw.trim(),count:0};current.count+=1;counts.set(key,current);
    }
    const ranked=[...counts.values()].sort((a,b)=>b.count-a.count||a.text.localeCompare(b.text)).slice(0,8);
    const total=Math.max(1,ranked.reduce((sum,item)=>sum+item.count,0));
    const answers=ranked.map(item=>({text:item.text,aliases:[],points:Math.max(5,Math.round(item.count/total*100))}));
    if(answers.length>0)this.collectedSurveys.push([this.collectionPrompts[this.collectionIndex],answers]);
    this.collectionIndex+=1;this.collectionResponses={};
    if(this.collectionIndex>=this.collectionPrompts.length){this.finalizeSurveyDeck();this.phase='faceoff_buzz';}
  }

  finalizeSurveyDeck(){
    const remaining=shuffleInPlace(clone(this.baseSurveys),this.rng);
    this.surveys=[...this.collectedSurveys,...remaining].slice(0,this.requestedRounds);
    this.totalRounds=this.surveys.length;
  }

  faceoffPlayerIds(){
    if(!this.team1?.length||!this.team2?.length)return[];
    return [this.team1[this.ci%this.team1.length].id,this.team2[this.ci%this.team2.length].id];
  }

  teamFor(pid){return this.team1.some(p=>p.id===pid)?0:this.team2.some(p=>p.id===pid)?1:-1;}

  handleBuzz(pid){
    if(!this.faceoffPlayerIds().includes(pid)||this.buzzedPlayerId)return false;
    this.buzzedPlayerId=pid;this.firstBuzzedPlayerId=pid;this.phase='faceoff_answer';
    this.state=this.bs();this.state.lastAction=`${this.playerName(pid)} buzzed first — give an answer!`;
    return true;
  }

  handleAnswer(pid,text){
    text=text.trim().slice(0,80);const norm=text.toLowerCase();if(!norm||!this.seated(pid))return false;
    if(this.phase==='faceoff_answer')return this.handleFaceoffAnswer(pid,text);
    if(this.phase==='play')return this.handleTeamAnswer(pid,text,false);
    if(this.phase==='steal')return this.handleTeamAnswer(pid,text,true);
    return false;
  }

  handleFaceoffAnswer(pid,text){
    if(pid!==this.buzzedPlayerId)return false;
    const answers=this.surveys[this.ci][1];const matched=matchAnswer(text,answers);
    const index=matched?answers.findIndex(answer=>answer.text===matched.text):-1;
    if(matched&&!this.rev.some(answer=>answer.index===index))this.revealAnswer(pid,matched,index);
    this.faceoffAnswers.push({playerId:pid,team:this.teamFor(pid),index});
    if(index===0){
      const team=this.teamFor(pid);
      if(this.rev.length>=answers.length)this.finishRound(team,`${this.playerName(pid)} cleared the board from the faceoff!`);
      else this.beginTeamPlay(team,`${this.playerName(pid)} found the top answer!`);
      return true;
    }
    if(this.faceoffAnswers.length===1){
      this.buzzedPlayerId=this.faceoffPlayerIds().find(id=>id!==pid)??null;
      this.state=this.bs();this.state.lastAction=`${this.playerName(pid)} answered. ${this.playerName(this.buzzedPlayerId)} gets the second faceoff answer.`;return true;
    }
    const winner=[...this.faceoffAnswers].sort((a,b)=>(a.index<0?999:a.index)-(b.index<0?999:b.index))[0];
    const winningTeam=winner.index<0?this.teamFor(this.firstBuzzedPlayerId):winner.team;
    if(this.rev.length>=answers.length)this.finishRound(winningTeam,'The faceoff cleared the board!');
    else this.beginTeamPlay(winningTeam,'Faceoff decided. The winning team has control.');
    return true;
  }

  beginTeamPlay(team,message){
    this.teamId=team;this.phase='play';this.strikes=0;this.buzzedPlayerId=null;this.subs={};
    this.state=this.bs();this.state.lastAction=message;
  }

  handleTeamAnswer(pid,text,isSteal){
    const playerTeam=this.teamFor(pid);const allowedTeam=isSteal?1-this.teamId:this.teamId;
    if(playerTeam!==allowedTeam)return false;
    const answers=this.surveys[this.ci][1];const norm=text.toLowerCase().trim();
    if(this.wrongGuesses.has(norm))return false;
    const matched=matchAnswer(text,answers);const index=matched?answers.findIndex(answer=>answer.text===matched.text):-1;
    this.subs[pid]={text,correct:!!matched,time:Date.now()};
    if(matched&&this.rev.some(answer=>answer.index===index)){
      this.registerStrike(norm,`Already found!`);return true;
    }
    if(!matched){
      if(isSteal){this.finishRound(this.teamId,`${this.playerName(pid)} missed the steal. Team ${this.teamId+1} keeps the bank.`);return true;}
      this.registerStrike(norm,'No survey match.');return true;
    }
    this.revealAnswer(pid,matched,index);
    if(isSteal){this.finishRound(playerTeam,`${this.playerName(pid)} stole the ₦${this.roundBank} point bank!`);return true;}
    if(this.rev.length>=answers.length){this.finishRound(this.teamId,'The board is clear!');return true;}
    this.state=this.bs();this.state.lastAction=`✅ ${matched.text} — ${matched.points} added to the bank.`;return true;
  }

  revealAnswer(pid,matched,index){
    this.rev.push({index,text:matched.text,points:matched.points});this.roundBank+=matched.points;
    const player=this.players.find(candidate=>candidate.id===pid);if(player)player.score+=matched.points;
  }

  registerStrike(norm,prefix){
    this.wrongGuesses.add(norm);this.strikes+=1;
    if(this.strikes>=this.maxStrikes){
      if(this.steals){this.phase='steal';this.strikes=this.maxStrikes;this.state=this.bs();this.state.lastAction=`${prefix} Strike three — Team ${2-this.teamId} can steal!`;return;}
      this.finishRound(this.teamId,`${prefix} Team ${this.teamId+1} keeps the bank.`);return;
    }
    this.state=this.bs();this.state.lastAction=`${prefix} Strike ${this.strikes}/${this.maxStrikes} ❌`;
  }

  finishRound(winningTeam,message){
    this.teamScores[winningTeam]+=this.roundBank;const answers=this.surveys[this.ci][1];
    this.rev=answers.map((answer,index)=>({index,text:answer.text,points:answer.points}));
    this.phase='round_reveal';this.state=this.bs();this.state.lastAction=message;
  }

  advanceRound(){
    this.ci+=1;
    if(this.ci>=this.totalRounds){
      this.phase='finished';const high=Math.max(...this.teamScores);const winningTeams=this.teamScores.map((score,index)=>score===high?index:-1).filter(index=>index>=0);
      const winnerPlayerIds=[...this.team1,...this.team2].filter(player=>winningTeams.includes(this.teamFor(player.id))).map(player=>player.id);
      this.state=this.bs();this.state.winnerPlayerIds=winnerPlayerIds;
      this.state.lastAction=winningTeams.length>1?'The feud ends in a draw!':`Team ${winningTeams[0]+1} wins Faith Feud!`;return;
    }
    this.rev=[];this.strikes=0;this.teamId=this.ci%2;this.subs={};this.wrongGuesses=new Set();this.buzzedPlayerId=null;this.firstBuzzedPlayerId=null;this.faceoffAnswers=[];this.roundBank=0;this.phase='faceoff_buzz';
    this.state=this.bs();this.state.lastAction='Next round. Faceoff representatives: buzz in!';
  }

  publicState(){return clone(this.state);}
  privateState(pid){return {seated:this.seated(pid),team:this.teamFor(pid),submitted:!!this.subs[pid]||!!this.collectionResponses[pid],isFaceoffRepresentative:this.faceoffPlayerIds().includes(pid),legalIntents:this.legalIntents(pid)};}
  legalIntents(pid){
    if(!this.state||!this.seated(pid)||this.phase==='finished'||this.phase==='round_reveal')return[];
    if(this.phase==='survey_collection')return this.collectionResponses[pid]?[]:[{type:'survey_answer',label:'Submit survey answer'}];
    if(this.phase==='faceoff_buzz')return this.faceoffPlayerIds().includes(pid)?[{type:'buzz',label:'BUZZ!'}]:[];
    if(this.phase==='faceoff_answer')return this.buzzedPlayerId===pid?[{type:'answer_text',label:'Give faceoff answer'}]:[];
    if(this.phase==='play')return this.teamFor(pid)===this.teamId?[{type:'answer_text',label:'Answer for your team'}]:[];
    if(this.phase==='steal')return this.teamFor(pid)===1-this.teamId?[{type:'answer_text',label:'Give one steal answer'}]:[];
    return[];
  }
  // Server-side bot: pick the highest-point answer the board has not revealed yet. This runs on
  // the server through legal intents only and is never exposed to human players' private state.
  rankBotIntent(pid){
    const legal=this.legalIntents(pid);if(legal.length===0)return null;
    if(legal[0].type==='survey_answer')return {type:'survey_answer',answers:['Music','Food','Friends']};
    if(legal[0].type==='buzz')return {type:'buzz'};
    const survey=this.surveys[this.ci];
    if(!survey)return {type:'answer_text',text:'pass'};
    const [,ans]=survey;
    const remaining=ans.filter((a,i)=>!this.rev.some(r=>r.index===i)).filter(a=>!this.wrongGuesses.has(a.text.toLowerCase()));
    const best=remaining.sort((a,b)=>b.points-a.points)[0];
    return {type:'answer_text',text:best?best.text:'pass'};
  }
  playerName(id){return this.players.find(player=>player.id===id)?.name??'A player';}
  extraSnapshot(){return {baseSurveys:this.baseSurveys,surveys:this.surveys,requestedRounds:this.requestedRounds,totalRounds:this.totalRounds,ci:this.ci,rev:this.rev,strikes:this.strikes,teamId:this.teamId,team1:this.team1,team2:this.team2,phase:this.phase,subs:this.subs,wrongGuesses:[...(this.wrongGuesses??[])],roundBank:this.roundBank,teamScores:this.teamScores,buzzedPlayerId:this.buzzedPlayerId,firstBuzzedPlayerId:this.firstBuzzedPlayerId,faceoffAnswers:this.faceoffAnswers,surveyCollectionEnabled:this.surveyCollectionEnabled,collectionPrompts:this.collectionPrompts,collectionIndex:this.collectionIndex,collectionResponses:this.collectionResponses,collectedSurveys:this.collectedSurveys};}
  restoreExtra(e){this.baseSurveys=e?.baseSurveys??[];this.surveys=e?.surveys??[];this.requestedRounds=e?.requestedRounds??3;this.totalRounds=e?.totalRounds??this.surveys.length;this.ci=e?.ci??0;this.rev=e?.rev??[];this.strikes=e?.strikes??0;this.teamId=e?.teamId??0;this.team1=e?.team1??[];this.team2=e?.team2??[];this.phase=e?.phase??'faceoff_buzz';this.subs=e?.subs??{};this.wrongGuesses=new Set(e?.wrongGuesses??[]);this.roundBank=e?.roundBank??0;this.teamScores=e?.teamScores??[0,0];this.buzzedPlayerId=e?.buzzedPlayerId??null;this.firstBuzzedPlayerId=e?.firstBuzzedPlayerId??null;this.faceoffAnswers=e?.faceoffAnswers??[];this.surveyCollectionEnabled=e?.surveyCollectionEnabled??false;this.collectionPrompts=e?.collectionPrompts??[];this.collectionIndex=e?.collectionIndex??0;this.collectionResponses=e?.collectionResponses??{};this.collectedSurveys=e?.collectedSurveys??[];}
}
