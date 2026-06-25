import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, FastForward, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getNewGameMeta } from '@/lib/newGames';

interface NativeGameSurfaceProps {
  gameType: string;
  publicState: unknown;
  privateState: unknown;
  role: 'display' | 'controller' | 'crowd' | 'companion';
  sendIntent: (intent: Record<string, unknown>) => void;
}

type PlayerScore = { id: string; name?: string; displayName?: string; score: number };
type TimelineEvent = { id: string; label: string };
type FeudAnswer = { text: string; points: number };
type NativeState = {
  phase?: string;
  round?: number;
  players?: PlayerScore[];
  teams?: PlayerScore[];
  currentItem?: { name?: string; price?: number };
  currentPrompt?: {
    direction?: 'en_to_pcm' | 'pcm_to_en';
    source?: string;
    options?: string[];
  };
  currentQuestion?: { prompt?: string; answers?: FeudAnswer[] };
  revealed?: number[];
  strikes?: number;
  deal?: TimelineEvent[];
};
type NativePrivateState = {
  submitted?: boolean;
  guess?: number;
  answer?: number;
  order?: string[];
};

function Scores({ players }: { players: PlayerScore[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {[...players]
        .sort((a, b) => b.score - a.score)
        .map((player, index) => (
          <div key={player.id} className="rounded-xl border border-border bg-card/80 px-4 py-2">
            <span className="mr-2 text-xs text-muted-foreground">#{index + 1}</span>
            <span className="font-medium">{player.name ?? player.displayName ?? 'Player'}</span>
            <span className="ml-3 font-mono text-primary">{player.score}</span>
          </div>
        ))}
    </div>
  );
}

export function NativeGameSurface({
  gameType,
  publicState,
  privateState,
  role,
  sendIntent,
}: NativeGameSurfaceProps) {
  const isHost = role === 'display' || role === 'companion';
  const meta = getNewGameMeta(gameType);
  const state = publicState as NativeState;
  const mine = (privateState ?? {}) as NativePrivateState;
  const [value, setValue] = useState('');
  const [order, setOrder] = useState<string[]>([]);

  const timelineDeal = useMemo(() => (Array.isArray(state.deal) ? state.deal : []), [state.deal]);
  const effectiveOrder = useMemo(
    () => (order.length === timelineDeal.length ? order : timelineDeal.map((event) => event.id)),
    [order, timelineDeal],
  );

  const players: PlayerScore[] = Array.isArray(state.players)
    ? state.players
    : Array.isArray(state.teams)
      ? state.teams
      : [];

  const moveTimeline = (index: number, delta: -1 | 1) => {
    const next = [...effectiveOrder];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  };

  const advanceLabel =
    state.phase === 'guessing' || state.phase === 'answer' || state.phase === 'arranging'
      ? 'Reveal answers'
      : 'Next round';

  return (
    <div className="min-h-screen bg-background px-5 py-8 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col items-center justify-center gap-7 text-center">
        <div>
          <p className="text-sm text-muted-foreground">
            Round {state.round ?? 1}
          </p>
          <h1 className="mt-1 text-4xl font-display font-bold md:text-6xl">
            {meta?.emoji} {meta?.name ?? gameType}
          </h1>
        </div>

        {gameType === 'market-price' && (
          <div className="w-full max-w-xl space-y-5">
            <p className="text-sm uppercase tracking-widest text-muted-foreground">What is the market price?</p>
            <h2 className="text-3xl font-bold">{state.currentItem?.name}</h2>
            {state.phase !== 'guessing' && state.currentItem?.price > 0 && (
              <p className="text-4xl font-mono text-primary">₦{Number(state.currentItem.price).toLocaleString()}</p>
            )}
            {!isHost && state.phase === 'guessing' && (
              <div className="mx-auto flex max-w-sm gap-2">
                <Input
                  inputMode="numeric"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="Your price in ₦"
                  disabled={mine.submitted}
                />
                <Button
                  disabled={mine.submitted || !value}
                  onClick={() => sendIntent({ type: 'guess', amount: Number(value) })}
                >
                  {mine.submitted ? <Check className="h-4 w-4" /> : 'Lock'}
                </Button>
              </div>
            )}
          </div>
        )}

        {gameType === 'pidgin-translator' && (
          <div className="w-full max-w-2xl space-y-5">
            <p className="text-sm uppercase tracking-widest text-muted-foreground">
              {state.currentPrompt?.direction === 'en_to_pcm' ? 'Translate to Pidgin' : 'Translate to English'}
            </p>
            <h2 className="text-3xl font-bold">“{state.currentPrompt?.source}”</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(state.currentPrompt?.options ?? []).map((option: string, index: number) => (
                <Button
                  key={option}
                  size="lg"
                  variant={mine.answer === index ? 'default' : 'outline'}
                  disabled={isHost || mine.submitted || state.phase !== 'answer'}
                  onClick={() => sendIntent({ type: 'answer', optionIndex: index })}
                  className="h-auto min-h-16 whitespace-normal text-base"
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
        )}

        {gameType === 'faith-feud' && (
          <div className="w-full max-w-2xl space-y-5">
            <h2 className="text-3xl font-bold">{state.currentQuestion?.prompt}</h2>
            <div className="space-y-2">
              {(state.currentQuestion?.answers ?? []).map((answer, index) => {
                const revealed = state.revealed?.includes(index);
                return (
                  <div key={index} className="flex justify-between rounded-xl border border-border bg-card p-4">
                    <span>{revealed ? answer.text : `${index + 1}. •••••••`}</span>
                    <span className="font-mono text-primary">{revealed ? answer.points : '—'}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-destructive">Strikes: {'✕'.repeat(state.strikes ?? 0)}</p>
            {!isHost && state.phase === 'guessing' && (
              <div className="flex gap-2">
                <Input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Type an answer" />
                <Button
                  disabled={!value.trim()}
                  onClick={() => {
                    sendIntent({ type: 'guess', guess: value.trim() });
                    setValue('');
                  }}
                >
                  Guess
                </Button>
              </div>
            )}
          </div>
        )}

        {gameType === 'bible-timeline' && (
          <div className="w-full max-w-2xl space-y-4">
            <h2 className="text-2xl font-bold">Put these events in chronological order</h2>
            <div className="space-y-2 text-left">
              {effectiveOrder.map((id, index) => {
                const event = timelineDeal.find((item) => item.id === id);
                return (
                  <div key={id} className="flex items-center gap-2 rounded-xl border border-border bg-card p-3">
                    <span className="w-8 text-center font-mono text-muted-foreground">{index + 1}</span>
                    <span className="flex-1 font-medium">{event?.label}</span>
                    {!isHost && !mine.submitted && (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => moveTimeline(index, -1)} aria-label="Move earlier">
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => moveTimeline(index, 1)} aria-label="Move later">
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {!isHost && (
              <Button
                className="w-full"
                disabled={mine.submitted}
                onClick={() => sendIntent({ type: 'submit_order', orderedIds: effectiveOrder })}
              >
                {mine.submitted ? 'Order locked' : 'Lock order'}
              </Button>
            )}
          </div>
        )}

        {players.length > 0 && <Scores players={players} />}

        {isHost && state.phase !== 'finished' && (
          <Button size="lg" onClick={() => sendIntent({ type: 'advance' })}>
            <FastForward className="mr-2 h-5 w-5" />
            {advanceLabel}
          </Button>
        )}

        {state.phase === 'finished' && (
          <div className="flex items-center gap-3 text-2xl font-bold text-primary">
            <Trophy className="h-8 w-8" /> Game complete
          </div>
        )}
      </div>
    </div>
  );
}
