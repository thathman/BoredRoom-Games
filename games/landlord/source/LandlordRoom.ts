// LandlordRoom — Oga Landlord (Naija Monopoly).
// Authoritative server room for the ported Monopoly engine.
// Phase loop:
//   lobby → rolling → (awaiting_buy | card_drawn | turn_end)
//                  → rolling (on doubles)
//                  → finished (last solvent player wins)

import { Client, Room } from '@colyseus/core';
import {
  DEFAULT_LANDLORD_SETTINGS,
  DEFAULT_REACTION_POLICY,
  DEFAULT_TAUNT_POLICY,
  GameType,
  Intent,
  JoinAuth,
  LandlordPublicState,
  LandlordSettings,
  PROTOCOL_VERSION,
  PrivateSeatState,
  PendingJoinRequest,
  PublicRoomState,
  RoomMember,
  ServerEvent,
  createInitialLandlordState,
  startLandlord,
  landlordRollAndMove,
  landlordBuy,
  landlordDecline,
  landlordAckCard,
  landlordPayJailFine,
  landlordUseJailCard,
  landlordEndTurn,
  landlordBuildHouse,
  landlordSellHouse,
  landlordMortgage,
  landlordUnmortgage,
  landlordCreateDecks,
  landlordPlaceAuctionBid,
  landlordPassAuctionBid,
  landlordProposeTrade,
  landlordCancelTrade,
  landlordRespondToTrade,
} from '../../../shared/src/contracts/index.js';
import { createReactionStats } from '../../../shared/src/reactions/policy.js';
import { ReactionSubsystem } from './reactions.js';
import { hostTokenStore } from '../auth/hostTokens.js';
import { buildMatchKey, persistFinishedMatch } from '../matchPersistence.js';
import { log } from '../logger.js';
import { setCanonicalPhase } from './_base.js';
import { removeRoom, upsertRoom } from '../roomDirectory.js';
import { clearPauseRequests, clearPauseState, markPresence, uuid } from './_shared.js';

const LANDLORD_MAX_SEATS = 4;
const SEAT_COLORS = ['red', 'green', 'yellow', 'blue'] as const;

interface AttachedClient {
  deviceId: string;
  role: 'host' | 'player';
  effectiveRole: 'host' | 'player' | 'crowd';
  displayName: string;
}

export class LandlordRoom extends Room {
  private public!: PublicRoomState;
  private privateBySeat = new Map<string, PrivateSeatState>();
  private attached = new Map<string, AttachedClient>();
  private sessionByDevice = new Map<string, string>();

  private reactions!: ReactionSubsystem;

  private landlord!: LandlordPublicState;
  private decks = landlordCreateDecks();
  private settings: LandlordSettings = { ...DEFAULT_LANDLORD_SETTINGS };
  private hostPartyId: string | null = null;
  private matchStartedAt = 0;
  private persistedMatchKeys = new Set<string>();

  override onCreate(options: { code?: string; gameType?: GameType; partyId?: string }) {
    const code = (options?.code ?? 'TEMP').toUpperCase();
    this.roomId = code;
    this.hostPartyId = typeof options?.partyId === 'string' && options.partyId.length > 0 ? options.partyId : null;

    this.landlord = createInitialLandlordState([], this.settings);

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
      maxPlayers: LANDLORD_MAX_SEATS,
      roomSettings: {
        aiAssistance: true,
        maxPlayers: LANDLORD_MAX_SEATS,
        whotPenaltyStreaks: false,
        reactionBursts: true,
      },
      gameType: 'landlord',
      landlordState: this.landlord,
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
    log('info', 'room_instance_created', { room: code, gameType: 'landlord' });
  }

  override async onAuth(_client: Client, options: JoinAuth) {
    if (!options || options.protocolVersion !== PROTOCOL_VERSION) throw new Error('protocol_mismatch');
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
      effectiveRole: options.role === 'host' ? 'host' : 'player',
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
      markPresence(this.public, att.deviceId, { connected: true, hidden: false, pauseRequested: false });
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
    if (att.role === 'player') markPresence(this.public, att.deviceId, { connected: false });
  }

  override onDispose() {
    hostTokenStore.release(this.public.code);
    removeRoom(this.public.code);
  }

  // ── arrival ───────────────────────────────────────────────────────────
  private handlePlayerArrival(att: AttachedClient, client: Client) {
    const existing = this.public.members.find((m) => m.id === att.deviceId);
    if (existing) {
      existing.displayName = att.displayName;
      this.syncPlayerName(att.deviceId, att.displayName);
      att.effectiveRole = (existing.role ?? (existing.isSpectator ? 'crowd' : 'player')) as
        | 'host'
        | 'player'
        | 'crowd';
      return;
    }
    if (this.public.roomPolicy === 'locked') return this.error(client, 'room_locked', 'Room is locked');
    if (this.public.roomPolicy === 'approval' && this.public.status === 'lobby') {
      this.enqueueJoinRequest(att.deviceId, att.displayName);
      this.error(client, 'pending_approval', 'Waiting for host approval');
      return;
    }

    const playerSeats = this.public.members.filter((m) => (m.role ?? 'player') === 'player').length;
    const seatsFull = playerSeats >= LANDLORD_MAX_SEATS;
    const midGame = this.public.status !== 'lobby';

    if (seatsFull || midGame) {
      this.public.members.push(this.makeSeat(att.deviceId, att.displayName, 'crowd'));
      att.effectiveRole = 'crowd';
      return;
    }

    const color = SEAT_COLORS[playerSeats % SEAT_COLORS.length];
    this.public.members.push(this.makeSeat(att.deviceId, att.displayName, 'player', color));
    this.landlord.players.push({
      id: att.deviceId,
      displayName: att.displayName,
      color,
      position: 0,
      money: this.settings.startingCash,
      propertyIds: [],
      jailed: false,
      jailTurnsLeft: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      totalRolls: 0,
      totalDoubles: 0,
    });
    att.effectiveRole = 'player';
  }

  // ── intents ───────────────────────────────────────────────────────────
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
    // Auction + trade intents have different actor rules from turn intents.
    if (intent.type === 'landlord:bid' || intent.type === 'landlord:bid_pass') {
      if (att.effectiveRole === 'crowd') return this.error(client, 'forbidden', 'crowd_cannot_play');
      if (this.public.status !== 'playing') return this.error(client, 'illegal', 'not_playing');
      if (this.landlord.phase !== 'auction' || !this.landlord.auction) {
        return this.error(client, 'illegal', 'not_auction_phase');
      }
      if (this.landlord.auction.currentBidderId !== att.deviceId) {
        return this.error(client, 'illegal', 'not_your_bid');
      }
      if (intent.type === 'landlord:bid') {
        this.landlord = landlordPlaceAuctionBid(this.landlord, att.deviceId, intent.amount);
      } else {
        this.landlord = landlordPassAuctionBid(this.landlord, att.deviceId);
      }
      if (this.landlord.winnerId) {
        this.public.status = 'finished';
        this.persistFinishedMatchOnce();
      }
      this.broadcastPublic();
      return;
    }

    if (intent.type === 'landlord:propose_trade' || intent.type === 'landlord:cancel_trade') {
      if (att.effectiveRole === 'crowd') return this.error(client, 'forbidden', 'crowd_cannot_play');
      if (this.public.status !== 'playing') return this.error(client, 'illegal', 'not_playing');
      if (this.landlord.currentPlayerId !== att.deviceId) {
        return this.error(client, 'illegal', 'not_your_turn');
      }
      if (intent.type === 'landlord:propose_trade') {
        this.landlord = landlordProposeTrade(
          this.landlord,
          {
            fromId: att.deviceId,
            toId: intent.toId,
            cashFromOfferer: intent.cashFromOfferer,
            offererPropertyIds: intent.offererPropertyIds,
            targetPropertyIds: intent.targetPropertyIds,
            offererJailCards: intent.offererJailCards,
            targetJailCards: intent.targetJailCards,
          },
          uuid(),
        );
      } else {
        this.landlord = landlordCancelTrade(this.landlord, att.deviceId);
      }
      this.broadcastPublic();
      return;
    }

    if (intent.type === 'landlord:respond_trade') {
      if (att.effectiveRole === 'crowd') return this.error(client, 'forbidden', 'crowd_cannot_play');
      if (this.public.status !== 'playing') return this.error(client, 'illegal', 'not_playing');
      if (!this.landlord.pendingTrade || this.landlord.pendingTrade.toId !== att.deviceId) {
        return this.error(client, 'illegal', 'not_trade_target');
      }
      this.landlord = landlordRespondToTrade(this.landlord, att.deviceId, intent.accept);
      this.broadcastPublic();
      return;
    }

    if (
      intent.type === 'landlord:roll' ||
      intent.type === 'landlord:buy' ||
      intent.type === 'landlord:decline' ||
      intent.type === 'landlord:ack_card' ||
      intent.type === 'landlord:pay_jail_fine' ||
      intent.type === 'landlord:use_jail_card' ||
      intent.type === 'landlord:end_turn' ||
      intent.type === 'landlord:build' ||
      intent.type === 'landlord:sell_house' ||
      intent.type === 'landlord:mortgage' ||
      intent.type === 'landlord:unmortgage'
    ) {
      if (att.effectiveRole === 'crowd') return this.error(client, 'forbidden', 'crowd_cannot_play');
      if (this.public.status !== 'playing') return this.error(client, 'illegal', 'not_playing');
      if (this.landlord.currentPlayerId !== att.deviceId) return this.error(client, 'illegal', 'not_your_turn');

      switch (intent.type) {
        case 'landlord:roll': {
          if (this.landlord.phase !== 'rolling') return this.error(client, 'illegal', 'not_rolling_phase');
          const r = landlordRollAndMove(this.landlord, this.decks);
          this.landlord = r.state;
          break;
        }
        case 'landlord:buy': {
          if (this.landlord.phase !== 'awaiting_buy') return this.error(client, 'illegal', 'not_buy_phase');
          this.landlord = landlordBuy(this.landlord);
          break;
        }
        case 'landlord:decline': {
          if (this.landlord.phase !== 'awaiting_buy') return this.error(client, 'illegal', 'not_buy_phase');
          this.landlord = landlordDecline(this.landlord);
          break;
        }
        case 'landlord:ack_card': {
          if (this.landlord.phase !== 'card_drawn') return this.error(client, 'illegal', 'not_card_phase');
          this.landlord = landlordAckCard(this.landlord, this.decks);
          break;
        }
        case 'landlord:pay_jail_fine': {
          if (this.landlord.phase !== 'rolling') return this.error(client, 'illegal', 'not_rolling_phase');
          this.landlord = landlordPayJailFine(this.landlord);
          break;
        }
        case 'landlord:use_jail_card': {
          if (this.landlord.phase !== 'rolling') return this.error(client, 'illegal', 'not_rolling_phase');
          this.landlord = landlordUseJailCard(this.landlord);
          break;
        }
        case 'landlord:end_turn': {
          if (this.landlord.phase !== 'turn_end') return this.error(client, 'illegal', 'not_turn_end');
          this.landlord = landlordEndTurn(this.landlord);
          break;
        }
        case 'landlord:build': {
          this.landlord = landlordBuildHouse(this.landlord, intent.propertyId);
          break;
        }
        case 'landlord:sell_house': {
          this.landlord = landlordSellHouse(this.landlord, intent.propertyId);
          break;
        }
        case 'landlord:mortgage': {
          this.landlord = landlordMortgage(this.landlord, intent.propertyId);
          break;
        }
        case 'landlord:unmortgage': {
          this.landlord = landlordUnmortgage(this.landlord, intent.propertyId);
          break;
        }
      }
      // Reflect winner into public.status and persist on first finish.
      if (this.landlord.winnerId) {
        this.public.status = 'finished';
        this.persistFinishedMatchOnce();
      }
      this.broadcastPublic();
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
        if (this.landlord.players.length < 1) return;
        this.public.status = 'playing';
        log('info', 'game_started', { room: this.public.code, gameType: 'landlord', players: this.landlord.players.length });
        clearPauseState(this.public);
        clearPauseRequests(this.public);
        this.matchStartedAt = Date.now();
        this.decks = landlordCreateDecks();
        setCanonicalPhase(this.public, 'game_intro');
        this.landlord = startLandlord(this.landlord);
        return;
      }
      case 'host:end_game': {
        this.public.status = 'finished';
        this.landlord.phase = 'finished';
        this.persistFinishedMatchOnce();
        return;
      }
      case 'host:play_again':
        this.resetForRematch();
        return;
      case 'host:set_landlord_settings': {
        if (this.public.status !== 'lobby') return;
        const s = intent.settings ?? {};
        this.settings = {
          ...this.settings,
          maxPlayers: clampInt(s.maxPlayers, 2, LANDLORD_MAX_SEATS, this.settings.maxPlayers),
          startingCash: clampInt(s.startingCash, 500, 5000, this.settings.startingCash),
        };
        // Reflect cash changes to seated players (lobby-only).
        for (const p of this.landlord.players) p.money = this.settings.startingCash;
        return;
      }
      case 'host:kick': {
        const idx = this.public.members.findIndex((m) => m.id === intent.playerId);
        if (idx < 0) return;
        this.public.members.splice(idx, 1);
        this.landlord.players = this.landlord.players.filter((p) => p.id !== intent.playerId);
        if (this.landlord.players.length > 0) {
          this.landlord.currentPlayerIndex = this.landlord.currentPlayerIndex % this.landlord.players.length;
          this.landlord.currentPlayerId = this.landlord.players[this.landlord.currentPlayerIndex].id;
        }
        return;
      }
      case 'host:set_room_policy':
        this.public.roomPolicy = intent.policy;
        return;
      case 'host:clear_reactions':
        this.public.reactions = [];
        return;
      default:
        return;
    }
  }

  private resetForRematch() {
    const seatedPlayers = this.landlord.players.map((p) => ({
      id: p.id, displayName: p.displayName, color: p.color, isBot: p.isBot,
    }));
    this.decks = landlordCreateDecks();
    this.landlord = createInitialLandlordState(seatedPlayers, this.settings);
    this.public.status = 'lobby';
    clearPauseState(this.public);
    clearPauseRequests(this.public);
  }

  // ── projection ────────────────────────────────────────────────────────
  private broadcastPublic() {
    this.public.landlordState = this.landlord;
    this.applyCanonicalPhase();
    this.syncRoomDirectory();
    const evt: ServerEvent = { type: 'public_state', state: this.public };
    this.broadcast('event', evt);
  }
  private sendPublicTo(client: Client) {
    this.public.landlordState = this.landlord;
    this.applyCanonicalPhase();
    client.send('event', { type: 'public_state', state: this.public } satisfies ServerEvent);
  }
  private applyCanonicalPhase() {
    const p = this.landlord.phase;
    let next: 'lobby' | 'game_intro' | 'round_active' | 'round_resolution' | 'game_over';
    if (this.public.status === 'finished' || p === 'finished') next = 'game_over';
    else if (p === 'lobby') next = 'lobby';
    else if (p === 'turn_end') next = 'round_resolution';
    else next = 'round_active';
    setCanonicalPhase(this.public, next);
  }
  private sendPrivateTo(client: Client, seatId: string) {
    const base = this.privateBySeat.get(seatId) ?? { seatId };
    client.send('event', { type: 'private_state', state: { ...base } } satisfies ServerEvent);
  }
  private error(client: Client, code: string, message: string) {
    client.send('event', { type: 'error', code, message } satisfies ServerEvent);
  }

  // ── helpers ───────────────────────────────────────────────────────────
  private makeSeat(id: string, displayName: string, role: 'player' | 'crowd' = 'player', color?: string): RoomMember {
    return {
      id,
      displayName,
      color: color ?? SEAT_COLORS[this.public.members.length % SEAT_COLORS.length],
      isReady: false,
      isHost: false,
      isSpectator: role === 'crowd',
      role,
    };
  }
  private syncPlayerName(id: string, displayName: string) {
    const p = this.landlord.players.find((x) => x.id === id);
    if (p) p.displayName = displayName;
  }
  private syncRoomDirectory() {
    upsertRoom({
      code: this.public.code,
      gameType: 'landlord',
      status: this.public.status,
      roomPolicy: this.public.roomPolicy,
      players: this.public.members.length,
      maxPlayers: LANDLORD_MAX_SEATS,
    });
  }
  private enqueueJoinRequest(deviceId: string, displayName: string) {
    if (!this.public.pendingJoinRequests.find((r) => r.deviceId === deviceId)) {
      const req: PendingJoinRequest = {
        id: uuid(),
        deviceId,
        displayName,
        requestedAt: Date.now(),
      };
      this.public.pendingJoinRequests.push(req);
    }
  }

  private persistFinishedMatchOnce() {
    const record = this.buildFinishedMatchRecord();
    if (!record) return;
    if (this.persistedMatchKeys.has(record.matchKey)) {
      log('info', 'persistence_duplicate_suppressed', { room: this.public.code, gameType: 'landlord' });
      return;
    }
    this.persistedMatchKeys.add(record.matchKey);
    log('info', 'game_finished', { room: this.public.code, gameType: 'landlord', players: record.playerDeviceIds.length });
    void persistFinishedMatch(record)
      .then((status) => log('info', 'persistence_result', { room: this.public.code, gameType: 'landlord', status }))
      .catch((err) => log('error', 'persistence_failed', { room: this.public.code, gameType: 'landlord', error: err?.message ?? String(err) }));
  }

  private buildFinishedMatchRecord() {
    const players = this.landlord.players.map((p) => ({ id: p.id, displayName: p.displayName }));
    const winnerDeviceId = this.landlord.winnerId ?? null;
    if (players.length === 0) return null;
    const playerDeviceIds = players.map((p) => p.id);
    const playerNames = Object.fromEntries(players.map((p) => [p.id, p.displayName]));
    const matchKey = buildMatchKey({ roomCode: this.public.code, gameType: 'landlord', winnerDeviceId, playerDeviceIds });
    return {
      roomCode: this.public.code,
      gameType: 'landlord' as GameType,
      winnerDeviceId,
      playerDeviceIds,
      playerNames,
      turnCount: this.landlord.turnNumber ?? undefined,
      durationMs: this.matchStartedAt ? Date.now() - this.matchStartedAt : undefined,
      matchKey,
      hostDisplayId: this.public.hostId || null,
      partyId: this.hostPartyId || this.public.hostId || null,
    };
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
