// WordWahalaRoom — Naija Scrabble. Server-authoritative dictionary, scoring,
// and rack management. Bag tiles + per-seat rack are private (never broadcast).
//
// Mirrors the structure of HustleRoom for consistency.

import { Client, Room } from '@colyseus/core';
import {
  DEFAULT_REACTION_POLICY,
  DEFAULT_TAUNT_POLICY,
  GameType,
  Intent,
  JoinAuth,
  PROTOCOL_VERSION,
  PendingJoinRequest,
  PrivateSeatState,
  PublicRoomState,
  RoomMember,
  ServerEvent,
} from '../../../shared/src/contracts/index.js';
import {
  DEFAULT_WORDWAHALA_SETTINGS,
  WordWahalaPlayerState,
  WordWahalaPublicState,
  WordWahalaSettings,
  applyPass,
  applyPlay,
  applySwap,
  applyTimeout,
  createInitialWordWahalaState,
  finishGame,
  makeInitialPlayer,
  validateAndScore,
} from '../../../shared/src/games/wordwahala/engine.js';
import {
  RACK_SIZE,
  buildTileBag,
  type TileLetter,
} from '../../../shared/src/games/wordwahala/tiles.js';
import { preloadExtendedDictionary } from '../../../shared/src/games/wordwahala/dictionary.js';
import { createReactionStats } from '../../../shared/src/reactions/policy.js';
import { ReactionSubsystem } from './reactions.js';
import { hostTokenStore } from '../auth/hostTokens.js';
import { buildMatchKey, persistFinishedMatch } from '../matchPersistence.js';
import { log } from '../logger.js';
import { projectCanonicalPhaseFromStatus } from './_base.js';
import { removeRoom, upsertRoom } from '../roomDirectory.js';

const MAX_SEATS = 4;
const SEAT_COLORS = ['emerald', 'amber', 'rose', 'sky'] as const;

interface AttachedClient {
  deviceId: string;
  role: 'host' | 'player';
  displayName: string;
}

function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class WordWahalaRoom extends Room {
  private public!: PublicRoomState;
  private privateBySeat = new Map<string, PrivateSeatState>();
  private rackBySeat = new Map<string, TileLetter[]>();
  private attached = new Map<string, AttachedClient>();
  private sessionByDevice = new Map<string, string>();

  private reactions!: ReactionSubsystem;
  private game!: WordWahalaPublicState;
  private settings: WordWahalaSettings = { ...DEFAULT_WORDWAHALA_SETTINGS };
  private bag: TileLetter[] = [];
  private hostPartyId: string | null = null;
  private matchStartedAt = 0;
  private persistedMatchKeys = new Set<string>();
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimerToken = 0;

  override onCreate(options: { code?: string; gameType?: GameType; partyId?: string }) {
    const code = (options?.code ?? 'TEMP').toUpperCase();
    this.roomId = code;
    this.hostPartyId = typeof options?.partyId === 'string' && options.partyId.length > 0
      ? options.partyId
      : null;

    // Kick off background load of the 178k SOWPODS-derived dictionary.
    // First plays use the embedded compact list; the extended set merges in
    // within ~100ms on Node — well before any real word submission.
    void preloadExtendedDictionary();

    this.game = createInitialWordWahalaState([], this.settings);

    this.public = {
      protocolVersion: PROTOCOL_VERSION,
      code,
      hostId: '',
      status: 'lobby',
      members: [],
      gameState: null,
      reactions: [],
      pendingJoinRequests: [],
      aiStatus: 'active',
      roomPolicy: 'open',
      reactionPolicy: { ...DEFAULT_REACTION_POLICY },
      tauntPolicy: { ...DEFAULT_TAUNT_POLICY },
      reactionStats: createReactionStats(),
      reactionMoments: [],
      pauseState: { paused: false, reason: null, requestedBy: null, since: null, message: null },
      presenceBySeat: {},
      maxPlayers: MAX_SEATS,
      roomSettings: {
        aiAssistance: true,
        maxPlayers: MAX_SEATS,
        whotPenaltyStreaks: false,
        reactionBursts: true,
      },
      gameType: 'word-wahala',
      whotState: null,
      triviaState: null,
      connect4State: null,
      etttState: null,
      wordWahalaState: this.game,
    };

    this.reactions = new ReactionSubsystem({
      sendToClient: (sessionId, evt) => {
        const c = this.clients.find((x) => x.sessionId === sessionId);
        c?.send('event', evt);
      },
      broadcastPublic: () => this.broadcastPublic(),
    });

    this.onMessage('intent', (client, intent: Intent) => this.handleIntent(client, intent));
    this.syncRoomDirectory();
    log('info', 'room_instance_created', { room: code, gameType: 'word-wahala' });
  }

  override async onAuth(_client: Client, options: JoinAuth) {
    if (!options || options.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error('protocol_mismatch');
    }
    if (!options.deviceId) throw new Error('deviceId_required');
    if (options.role === 'host') {
      const ok = hostTokenStore.verify(this.public.code, options.deviceId, options.hostToken);
      if (!ok) throw new Error('host_token_invalid');
    }
    return options;
  }

  override onJoin(client: Client, options: JoinAuth) {
    const att: AttachedClient = {
      deviceId: options.deviceId,
      role: options.role,
      displayName: options.displayName || 'Player',
    };
    this.attached.set(client.sessionId, att);

    const prevSession = this.sessionByDevice.get(options.deviceId);
    if (prevSession && prevSession !== client.sessionId) {
      this.clients.find((c) => c.sessionId === prevSession)?.leave(4000, 'replaced_by_new_session');
    }
    this.sessionByDevice.set(options.deviceId, client.sessionId);

    if (att.role === 'host') {
      this.public.hostId = att.deviceId;
      this.hostPartyId = options.partyId || this.hostPartyId;
    } else {
      this.handlePlayerArrival(att, client);
      this.markPresence(att.deviceId, { connected: true, hidden: false, pauseRequested: false });
    }

    this.broadcastPublic();
    this.sendPrivateTo(client, att.deviceId);
  }

  override onLeave(client: Client) {
    const att = this.attached.get(client.sessionId);
    this.attached.delete(client.sessionId);
    if (!att) return;
    if (this.sessionByDevice.get(att.deviceId) === client.sessionId) {
      this.sessionByDevice.delete(att.deviceId);
    }
    if (att.role === 'player') this.markPresence(att.deviceId, { connected: false });
  }

  override onDispose() {
    this.clearTurnTimer();
    hostTokenStore.release(this.public.code);
    removeRoom(this.public.code);
  }

  private handlePlayerArrival(att: AttachedClient, client: Client) {
    const existing = this.public.members.find((m) => m.id === att.deviceId);
    if (existing) {
      existing.displayName = att.displayName;
      const p = this.game.players.find((x) => x.id === att.deviceId);
      if (p) p.displayName = att.displayName;
      return;
    }
    if (this.public.status !== 'lobby') {
      if (this.public.roomPolicy === 'locked') return this.error(client, 'room_locked', 'Room is locked');
      this.enqueueJoinRequest(att.deviceId, att.displayName);
      return this.error(client, 'pending_approval', 'Waiting for host approval');
    }
    if (this.public.roomPolicy === 'locked') return this.error(client, 'room_locked', 'Room is locked');
    if (this.public.roomPolicy === 'approval') {
      this.enqueueJoinRequest(att.deviceId, att.displayName);
      return this.error(client, 'pending_approval', 'Waiting for host approval');
    }
    if (this.public.members.length >= MAX_SEATS) {
      return this.error(client, 'room_full', `Room is full (${MAX_SEATS} players max)`);
    }
    this.public.members.push(this.makeSeat(att.deviceId, att.displayName));
    this.game.players.push(this.makePlayer(att.deviceId, att.displayName));
  }

  private handleIntent(client: Client, intent: Intent) {
    const att = this.attached.get(client.sessionId);
    if (!att) return;
    const isHost = att.role === 'host' && att.deviceId === this.public.hostId;

    if (intent.type === 'request_state') {
      this.sendPublicTo(client);
      this.sendPrivateTo(client, att.deviceId);
      return;
    }

    if (intent.type === 'send_reaction') {
      this.reactions.handleSendReaction(this.public, client.sessionId, att.deviceId, intent.emoji, intent.clientNonce);
      return;
    }

    if (intent.type === 'toggle_ready') {
      if (this.public.status !== 'lobby') return;
      const m = this.public.members.find((x) => x.id === att.deviceId);
      if (!m) return;
      m.isReady = !m.isReady;
      this.broadcastPublic();
      return;
    }

    if (intent.type === 'wordwahala:play') {
      this.handlePlay(client, att.deviceId, intent.placements as Parameters<typeof validateAndScore>[2]);
      return;
    }

    if (intent.type === 'wordwahala:pass') {
      this.handlePass(client, att.deviceId);
      return;
    }

    if (intent.type === 'wordwahala:swap') {
      this.handleSwap(client, att.deviceId, intent.letters);
      return;
    }

    if (intent.type.startsWith('host:')) {
      if (!isHost) return this.error(client, 'forbidden', 'host_only');
      this.handleHostIntent(intent as Extract<Intent, { type: `host:${string}` }>);
      this.broadcastPublic();
      return;
    }
  }

  private handleHostIntent(intent: Extract<Intent, { type: `host:${string}` }>) {
    switch (intent.type) {
      case 'host:start_game': {
        if (this.public.status !== 'lobby') return;
        if (this.game.players.length < 2) return;
        this.public.status = 'playing';
        log('info', 'game_started', { room: this.public.code, gameType: 'word-wahala', players: this.game.players.length });
        this.matchStartedAt = Date.now();
        // Fresh bag, deal racks.
        this.bag = shuffle(buildTileBag());
        const seated = this.game.players.map((p) =>
          makeInitialPlayer(p.id, p.displayName, p.color),
        );
        this.game = createInitialWordWahalaState(seated, this.settings);
        this.game.phase = 'playing';
        for (const p of this.game.players) {
          this.dealRack(p.id);
        }
        this.game.bagSize = this.bag.length;
        this.game.lastAction = 'Word Wahala — first player must cover the center star.';
        this.sendAllPrivate();
        this.armTurnTimer();
        return;
      }
      case 'host:end_game': {
        this.clearTurnTimer();
        this.public.status = 'finished';
        this.game = finishGame({ ...this.game });
        this.persistFinishedMatchOnce();
        return;
      }
      case 'host:play_again': {
        this.clearTurnTimer();
        this.bag = [];
        this.rackBySeat.clear();
        this.privateBySeat.clear();
        this.game = createInitialWordWahalaState(
          this.game.players.map((p) => makeInitialPlayer(p.id, p.displayName, p.color)),
          this.settings,
        );
        this.public.status = 'lobby';
        for (const m of this.public.members) m.isReady = false;
        this.sendAllPrivate();
        return;
      }
      case 'host:kick': {
        const idx = this.public.members.findIndex((m) => m.id === intent.playerId);
        if (idx < 0) return;
        this.public.members.splice(idx, 1);
        this.game.players = this.game.players.filter((p) => p.id !== intent.playerId);
        this.rackBySeat.delete(intent.playerId);
        this.privateBySeat.delete(intent.playerId);
        return;
      }
      case 'host:set_room_policy': {
        this.public.roomPolicy = intent.policy;
        return;
      }
      case 'host:clear_reactions': {
        this.public.reactions = [];
        return;
      }
      case 'host:set_wordwahala_settings': {
        const merged: WordWahalaSettings = { ...this.settings, ...intent.settings };
        // Yarn Battle defaults to 30s timer if host didn't pick one explicitly.
        if (merged.mode === 'yarn_battle' && (merged.turnTimerSec ?? 0) <= 0) {
          merged.turnTimerSec = 30;
        }
        this.settings = merged;
        if (this.public.status === 'lobby') {
          this.game = { ...this.game, settings: this.settings };
        }
        return;
      }
      default:
        return;
    }
  }

  private handlePlay(
    client: Client,
    deviceId: string,
    placements: Parameters<typeof validateAndScore>[2],
  ) {
    if (this.public.status !== 'playing') return this.error(client, 'illegal', 'not_playing');
    if (this.game.phase === 'finished') return this.error(client, 'illegal', 'match_finished');
    const current = this.game.players[this.game.currentPlayerIndex];
    if (!current || current.id !== deviceId) {
      return this.error(client, 'illegal', 'not_your_turn');
    }
    const rack = this.rackBySeat.get(deviceId) ?? [];

    // Verify placements use tiles actually in the rack (multiset check).
    const rackCopy = rack.slice();
    for (const p of placements) {
      const idx = rackCopy.indexOf(p.letter as TileLetter);
      if (idx < 0) return this.error(client, 'illegal', `tile_not_in_rack:${p.letter}`);
      rackCopy.splice(idx, 1);
    }

    const result = validateAndScore(this.game, deviceId, placements);
    if (!result.ok) return this.error(client, 'illegal', result.rejection);

    // Consume tiles from rack, refill from bag.
    const consumed = placements.length;
    const newRack = rackCopy.slice();
    const refill = this.bag.splice(0, Math.min(consumed, this.bag.length));
    newRack.push(...refill);
    this.rackBySeat.set(deviceId, newRack);

    this.game = applyPlay(this.game, deviceId, result.result);
    const player = this.game.players.find((p) => p.id === deviceId);
    if (player) player.rackSize = newRack.length;
    this.game.bagSize = this.bag.length;

    // End conditions: bag empty AND a player emptied their rack.
    if (newRack.length === 0 && this.bag.length === 0) {
      this.game = finishGame(this.game);
      this.public.status = 'finished';
      this.persistFinishedMatchOnce();
    }

    this.sendPrivateForSeat(deviceId);
    this.armTurnTimer();
    this.broadcastPublic();
  }

  private handlePass(client: Client, deviceId: string) {
    if (this.public.status !== 'playing') return this.error(client, 'illegal', 'not_playing');
    const current = this.game.players[this.game.currentPlayerIndex];
    if (!current || current.id !== deviceId) {
      return this.error(client, 'illegal', 'not_your_turn');
    }
    this.game = applyPass(this.game, deviceId);
    if (this.game.phase === 'finished') {
      this.public.status = 'finished';
      this.persistFinishedMatchOnce();
    }
    this.armTurnTimer();
    this.broadcastPublic();
  }

  private handleSwap(client: Client, deviceId: string, letters: string[]) {
    if (this.public.status !== 'playing') return this.error(client, 'illegal', 'not_playing');
    if (this.game.phase === 'finished') return this.error(client, 'illegal', 'match_finished');
    const current = this.game.players[this.game.currentPlayerIndex];
    if (!current || current.id !== deviceId) {
      return this.error(client, 'illegal', 'not_your_turn');
    }
    if (!Array.isArray(letters) || letters.length === 0) {
      return this.error(client, 'illegal', 'no_letters');
    }
    if (letters.length > RACK_SIZE) {
      return this.error(client, 'illegal', 'too_many_letters');
    }
    if (this.bag.length < letters.length) {
      return this.error(client, 'illegal', 'bag_too_low');
    }
    const rack = (this.rackBySeat.get(deviceId) ?? []).slice();
    const removed: TileLetter[] = [];
    for (const l of letters) {
      const idx = rack.indexOf(l as TileLetter);
      if (idx < 0) return this.error(client, 'illegal', `tile_not_in_rack:${l}`);
      removed.push(rack[idx]);
      rack.splice(idx, 1);
    }
    // Draw replacements first, then return swapped tiles to the bag and reshuffle.
    const drawn = this.bag.splice(0, removed.length);
    rack.push(...drawn);
    this.bag = shuffle(this.bag.concat(removed));
    this.rackBySeat.set(deviceId, rack);

    this.game = applySwap(this.game, deviceId, letters.length);
    const player = this.game.players.find((p) => p.id === deviceId);
    if (player) player.rackSize = rack.length;
    this.game.bagSize = this.bag.length;
    if (this.game.phase === 'finished') {
      this.public.status = 'finished';
      this.persistFinishedMatchOnce();
    }
    this.sendPrivateForSeat(deviceId);
    this.armTurnTimer();
    this.broadcastPublic();
  }

  /** (Re)arm the per-turn auto-pass timer if Yarn Battle / turnTimerSec > 0. */
  private armTurnTimer() {
    this.clearTurnTimer();
    if (this.game.phase !== 'playing') {
      this.game.turnEndsAt = null;
      return;
    }
    const sec = this.settings.turnTimerSec ?? 0;
    if (sec <= 0) {
      this.game.turnEndsAt = null;
      return;
    }
    const ms = sec * 1000;
    const endsAt = Date.now() + ms;
    this.game.turnEndsAt = endsAt;
    const token = ++this.turnTimerToken;
    this.turnTimer = setTimeout(() => {
      if (token !== this.turnTimerToken) return;
      if (this.public.status !== 'playing' || this.game.phase !== 'playing') return;
      const cur = this.game.players[this.game.currentPlayerIndex];
      if (!cur) return;
      this.game = applyTimeout(this.game, cur.id);
      if (this.game.phase === 'finished') {
        this.public.status = 'finished';
        this.persistFinishedMatchOnce();
      }
      this.armTurnTimer();
      this.broadcastPublic();
    }, ms);
  }

  private clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.turnTimerToken += 1;
  }

  private dealRack(seatId: string) {
    const need = RACK_SIZE - (this.rackBySeat.get(seatId)?.length ?? 0);
    const drawn = this.bag.splice(0, Math.min(need, this.bag.length));
    const rack = (this.rackBySeat.get(seatId) ?? []).concat(drawn);
    this.rackBySeat.set(seatId, rack);
    const p = this.game.players.find((x) => x.id === seatId);
    if (p) p.rackSize = rack.length;
  }

  private broadcastPublic() {
    this.public.wordWahalaState = this.game;
    this.public.canonicalPhase = projectCanonicalPhaseFromStatus(this.public);
    this.syncRoomDirectory();
    const evt: ServerEvent = { type: 'public_state', state: this.public };
    this.broadcast('event', evt);
  }

  private sendPublicTo(client: Client) {
    this.public.wordWahalaState = this.game;
    this.public.canonicalPhase = projectCanonicalPhaseFromStatus(this.public);
    const evt: ServerEvent = { type: 'public_state', state: this.public };
    client.send('event', evt);
  }

  private sendPrivateTo(client: Client, seatId: string) {
    const rack = this.rackBySeat.get(seatId) ?? [];
    const priv: PrivateSeatState = {
      seatId,
      wordWahalaState: { seatId, rack: rack.slice() },
    };
    this.privateBySeat.set(seatId, priv);
    const evt: ServerEvent = { type: 'private_state', state: priv };
    client.send('event', evt);
  }

  private sendPrivateForSeat(seatId: string) {
    const sessionId = this.sessionByDevice.get(seatId);
    if (!sessionId) return;
    const c = this.clients.find((x) => x.sessionId === sessionId);
    if (!c) return;
    this.sendPrivateTo(c, seatId);
  }

  private sendAllPrivate() {
    for (const c of this.clients) {
      const att = this.attached.get(c.sessionId);
      if (!att) continue;
      this.sendPrivateTo(c, att.deviceId);
    }
  }

  private error(client: Client, code: string, message: string) {
    client.send('event', { type: 'error', code, message } satisfies ServerEvent);
  }

  private makeSeat(id: string, displayName: string): RoomMember {
    return {
      id,
      displayName,
      color: SEAT_COLORS[this.public.members.length % SEAT_COLORS.length],
      isReady: false,
      isHost: false,
    };
  }

  private makePlayer(id: string, displayName: string): WordWahalaPlayerState {
    const seatIdx = this.game.players.length;
    return makeInitialPlayer(id, displayName, SEAT_COLORS[seatIdx % SEAT_COLORS.length]);
  }

  private markPresence(seatId: string, patch: Partial<{ connected: boolean; hidden: boolean; pauseRequested: boolean }>) {
    const now = Date.now();
    const current = this.public.presenceBySeat?.[seatId] ?? {
      connected: false,
      hidden: false,
      lastSeenAt: now,
      pauseRequested: false,
    };
    this.public.presenceBySeat = {
      ...(this.public.presenceBySeat ?? {}),
      [seatId]: { ...current, ...patch, lastSeenAt: now },
    };
  }

  private syncRoomDirectory() {
    upsertRoom({
      code: this.public.code,
      gameType: 'word-wahala',
      status: this.public.status,
      roomPolicy: this.public.roomPolicy,
      players: this.public.members.length,
      maxPlayers: MAX_SEATS,
    });
  }

  private enqueueJoinRequest(deviceId: string, displayName: string) {
    if (!this.public.pendingJoinRequests.find((r) => r.deviceId === deviceId)) {
      const req: PendingJoinRequest = {
        id: this.uuid(),
        deviceId,
        displayName,
        requestedAt: Date.now(),
      };
      this.public.pendingJoinRequests.push(req);
    }
  }

  private uuid(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return (crypto as { randomUUID(): string }).randomUUID();
    }
    return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }

  private persistFinishedMatchOnce() {
    const record = this.buildFinishedMatchRecord();
    if (!record) return;
    if (this.persistedMatchKeys.has(record.matchKey)) {
      log('info', 'persistence_duplicate_suppressed', { room: this.public.code, gameType: 'word-wahala' });
      return;
    }
    this.persistedMatchKeys.add(record.matchKey);
    log('info', 'game_finished', { room: this.public.code, gameType: 'word-wahala', players: record.playerDeviceIds.length });
    void persistFinishedMatch(record)
      .then((status) => log('info', 'persistence_result', { room: this.public.code, gameType: 'word-wahala', status }))
      .catch((err) => log('error', 'persistence_failed', { room: this.public.code, gameType: 'word-wahala', error: err?.message ?? String(err) }));
  }

  private buildFinishedMatchRecord() {
    const players = this.game.players.map((p) => ({ id: p.id, displayName: p.displayName }));
    const winnerDeviceId = this.game.winnerId ?? null;
    if (players.length === 0) return null;
    const playerDeviceIds = players.map((p) => p.id);
    const playerNames = Object.fromEntries(players.map((p) => [p.id, p.displayName]));
    const matchKey = buildMatchKey({ roomCode: this.public.code, gameType: 'word-wahala', winnerDeviceId, playerDeviceIds });
    return {
      roomCode: this.public.code,
      gameType: 'word-wahala' as GameType,
      winnerDeviceId,
      playerDeviceIds,
      playerNames,
      turnCount: this.game.turnNumber,
      durationMs: this.matchStartedAt ? Date.now() - this.matchStartedAt : undefined,
      matchKey,
      hostDisplayId: this.public.hostId || null,
      partyId: this.hostPartyId || this.public.hostId || null,
    };
  }
}
