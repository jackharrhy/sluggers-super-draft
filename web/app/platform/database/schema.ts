import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type {
  ContentPackManifest,
  RunnerCapabilities,
  RunnerComponentHealth,
  RulesetRevision,
  StatProfileRevision,
  TeamLineupRevision,
} from '@starworks/contracts'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

export const leagueStatus = pgEnum('league_status', ['active', 'archived'])
export const leagueRole = pgEnum('league_role', [
  'owner',
  'administrator',
  'commissioner',
  'manager',
  'league_admin',
  'scorekeeper',
  'runner_operator',
  'member',
])
export const seasonStatus = pgEnum('season_status', ['draft', 'active', 'complete', 'archived'])
export const inviteStatus = pgEnum('invite_status', ['pending', 'redeemed', 'revoked', 'expired'])
export const revisionStatus = pgEnum('revision_status', ['draft', 'published'])
export const runnerStationStatus = pgEnum('runner_station_status', ['active', 'revoked'])
export const runnerRuntimeState = pgEnum('runner_runtime_state', ['idle', 'preparing', 'running', 'recovering', 'degraded'])
export const matchStatus = pgEnum('match_status', ['scheduled', 'in_progress', 'provisional', 'confirmed', 'cancelled'])
export const matchAttemptStatus = pgEnum('match_attempt_status', ['queued', 'leased', 'running', 'provisional', 'confirmed', 'cancelled', 'failed', 'review'])
export const runnerLeaseStatus = pgEnum('runner_lease_status', ['active', 'released', 'expired', 'revoked'])
export const runnerFailureKind = pgEnum('runner_failure_kind', ['game-crash', 'runner-crash', 'bridge-failure', 'build-failure'])
export const attemptLifecycleEventType = pgEnum('attempt_lifecycle_event_type', ['queued', 'claimed', 'renewed', 'started', 'completed', 'cancelled', 'failed', 'lease-expired', 'station-revoked'])
export const chemistryRelationship = pgEnum('chemistry_relationship', ['positive', 'negative'])
export const draftStatus = pgEnum('draft_status', [
  'setup',
  'active',
  'paused',
  'completed',
  'cancelled',
])
export const draftOrderMode = pgEnum('draft_order_mode', ['snake', 'linear'])
export const draftPickSource = pgEnum('draft_pick_source', [
  'manager',
  'commissioner',
  'automatic',
])
export const draftPickStatus = pgEnum('draft_pick_status', ['active', 'reversed'])
export const draftEventType = pgEnum('draft_event_type', [
  'created',
  'started',
  'paused',
  'resumed',
  'pick-made',
  'pick-reversed',
  'clock-expired',
  'completed',
  'cancelled',
])
export const leagueDeadlineKind = pgEnum('league_deadline_kind', ['trade', 'roster', 'lineup'])
export const tradeProposalStatus = pgEnum('trade_proposal_status', [
  'pending',
  'applied',
  'rejected',
  'cancelled',
])
export const tradeDecision = pgEnum('trade_decision', ['approved', 'rejected'])
export const rosterTransactionKind = pgEnum('roster_transaction_kind', [
  'trade',
  'commissioner',
])
export const telemetryObservationSource = pgEnum('telemetry_observation_source', [
  'bridge-hook',
  'memory-observation',
  'synthetic',
])
export const telemetryDerivationStatus = pgEnum('telemetry_derivation_status', [
  'ready',
  'review',
])
export const telemetryCorrectionEntity = pgEnum('telemetry_correction_entity', [
  'team',
  'character',
])
export const discordNotificationStatus = pgEnum('discord_notification_status', [
  'pending',
  'sent',
  'failed',
])

export const people = pgTable('people', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  isSiteAdmin: boolean('is_site_admin').notNull().default(false),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  ...timestamps,
})

export const discordIdentities = pgTable(
  'discord_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    discordUserId: text('discord_user_id').notNull(),
    username: text('username').notNull(),
    avatarHash: text('avatar_hash'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('discord_identities_discord_user_id_unique').on(table.discordUserId),
    index('discord_identities_person_id_index').on(table.personId),
  ],
)

export const leagues = pgTable('leagues', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: leagueStatus('status').notNull().default('active'),
  createdByPersonId: uuid('created_by_person_id')
    .notNull()
    .references(() => people.id),
  ...timestamps,
})

export const leagueMemberships = pgTable(
  'league_memberships',
  {
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.leagueId, table.personId] }),
    index('league_memberships_person_id_index').on(table.personId),
  ],
)

export const leagueMembershipRoles = pgTable(
  'league_membership_roles',
  {
    leagueId: uuid('league_id').notNull(),
    personId: uuid('person_id').notNull(),
    role: leagueRole('role').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedByPersonId: uuid('granted_by_person_id').references(() => people.id),
  },
  (table) => [
    primaryKey({ columns: [table.leagueId, table.personId, table.role] }),
    foreignKey({
      columns: [table.leagueId, table.personId],
      foreignColumns: [leagueMemberships.leagueId, leagueMemberships.personId],
      name: 'league_membership_roles_membership_fk',
    }).onDelete('cascade'),
  ],
)

export const publicationSettings = pgTable('publication_settings', {
  leagueId: uuid('league_id')
    .primaryKey()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  leagueVisible: boolean('league_visible').notNull().default(false),
  standingsVisible: boolean('standings_visible').notNull().default(false),
  statsVisible: boolean('stats_visible').notNull().default(false),
  draftVisible: boolean('draft_visible').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const discordNotificationSettings = pgTable('discord_notification_settings', {
  leagueId: uuid('league_id')
    .primaryKey()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').notNull(),
  configuredByPersonId: uuid('configured_by_person_id')
    .notNull()
    .references(() => people.id),
  ...timestamps,
}, (table) => [
  check('discord_notification_settings_channel_id_check', sql`${table.channelId} ~ '^[0-9]{17,20}$'`),
])

export const discordNotificationOutbox = pgTable('discord_notification_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id')
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  message: text('message').notNull(),
  status: discordNotificationStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex('discord_notification_outbox_dedupe_unique').on(table.leagueId, table.dedupeKey),
  index('discord_notification_outbox_delivery_index').on(table.leagueId, table.status, table.createdAt),
  check('discord_notification_outbox_attempts_check', sql`${table.attempts} >= 0`),
  check('discord_notification_outbox_event_type_check', sql`length(${table.eventType}) between 3 and 100`),
  check('discord_notification_outbox_message_check', sql`length(${table.message}) between 1 and 1800`),
])

export const seasons = pgTable(
  'seasons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: seasonStatus('status').notNull().default('draft'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique('seasons_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('seasons_league_id_slug_unique').on(table.leagueId, table.slug),
  ],
)

export const conferences = pgTable(
  'conferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    seasonId: uuid('season_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    color: text('color'),
    ...timestamps,
  },
  (table) => [
    unique('conferences_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('conferences_league_season_slug_unique').on(
      table.leagueId,
      table.seasonId,
      table.slug,
    ),
    foreignKey({
      columns: [table.leagueId, table.seasonId],
      foreignColumns: [seasons.leagueId, seasons.id],
      name: 'conferences_league_season_fk',
    }).onDelete('cascade'),
  ],
)

export const divisions = pgTable(
  'divisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    seasonId: uuid('season_id').notNull(),
    conferenceId: uuid('conference_id'),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('divisions_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('divisions_league_season_slug_unique').on(
      table.leagueId,
      table.seasonId,
      table.slug,
    ),
    foreignKey({
      columns: [table.leagueId, table.seasonId],
      foreignColumns: [seasons.leagueId, seasons.id],
      name: 'divisions_league_season_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.conferenceId],
      foreignColumns: [conferences.leagueId, conferences.id],
      name: 'divisions_league_conference_fk',
    }),
  ],
)

export const venues = pgTable(
  'venues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    gameVenueId: text('game_venue_id'),
    ...timestamps,
  },
  (table) => [
    unique('venues_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('venues_league_id_slug_unique').on(table.leagueId, table.slug),
  ],
)

export const leagueTeams = pgTable(
  'league_teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    seasonId: uuid('season_id').notNull(),
    conferenceId: uuid('conference_id'),
    managerPersonId: uuid('manager_person_id'),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    abbreviation: text('abbreviation'),
    color: text('color'),
    ...timestamps,
  },
  (table) => [
    unique('league_teams_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('league_teams_league_season_slug_unique').on(
      table.leagueId,
      table.seasonId,
      table.slug,
    ),
    foreignKey({
      columns: [table.leagueId, table.seasonId],
      foreignColumns: [seasons.leagueId, seasons.id],
      name: 'league_teams_league_season_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.conferenceId],
      foreignColumns: [conferences.leagueId, conferences.id],
      name: 'league_teams_league_conference_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.managerPersonId],
      foreignColumns: [leagueMemberships.leagueId, leagueMemberships.personId],
      name: 'league_teams_league_manager_fk',
    }),
  ],
)

export const gameCharacters = pgTable(
  'game_characters',
  {
    gameId: text('game_id').notNull(),
    characterId: text('character_id').notNull(),
    displayName: text('display_name').notNull(),
    isCaptain: boolean('is_captain').notNull().default(false),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.characterId] }),
    index('game_characters_game_display_name_index').on(table.gameId, table.displayName),
  ],
)

export const gameCharacterChemistry = pgTable(
  'game_character_chemistry',
  {
    gameId: text('game_id').notNull(),
    characterAId: text('character_a_id').notNull(),
    characterBId: text('character_b_id').notNull(),
    relationship: chemistryRelationship('relationship').notNull(),
    source: text('source').notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.characterAId, table.characterBId] }),
    check(
      'game_character_chemistry_canonical_pair_check',
      sql`${table.characterAId} < ${table.characterBId}`,
    ),
    foreignKey({
      columns: [table.gameId, table.characterAId],
      foreignColumns: [gameCharacters.gameId, gameCharacters.characterId],
      name: 'game_character_chemistry_character_a_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.gameId, table.characterBId],
      foreignColumns: [gameCharacters.gameId, gameCharacters.characterId],
      name: 'game_character_chemistry_character_b_fk',
    }).onDelete('cascade'),
  ],
)

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    role: leagueRole('role').notNull(),
    status: inviteStatus('status').notNull().default('pending'),
    createdByPersonId: uuid('created_by_person_id')
      .notNull()
      .references(() => people.id),
    redeemedByPersonId: uuid('redeemed_by_person_id').references(() => people.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invitations_token_hash_unique').on(table.tokenHash),
    index('invitations_league_id_index').on(table.leagueId),
  ],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_person_id_index').on(table.personId),
  ],
)

export const oauthAttempts = pgTable(
  'oauth_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionHash: text('transaction_hash').notNull(),
    stateHash: text('state_hash').notNull(),
    codeVerifier: text('code_verifier').notNull(),
    invitationId: uuid('invitation_id').references(() => invitations.id, { onDelete: 'set null' }),
    returnTo: text('return_to').notNull().default('/'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('oauth_attempts_transaction_hash_unique').on(table.transactionHash),
    uniqueIndex('oauth_attempts_state_hash_unique').on(table.stateHash),
  ],
)

export const runnerStations = pgTable(
  'runner_stations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: runnerStationStatus('status').notNull().default('active'),
    capabilities: jsonb('capabilities').$type<RunnerCapabilities>(),
    componentHealth: jsonb('component_health').$type<RunnerComponentHealth>().notNull().default({}),
    runtimeState: runnerRuntimeState('runtime_state').notNull().default('idle'),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique('runner_stations_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('runner_stations_league_id_name_unique').on(table.leagueId, table.name),
  ],
)

export const runnerCredentials = pgTable(
  'runner_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    stationId: uuid('station_id'),
    name: text('name').notNull(),
    secretHash: text('secret_hash').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdByPersonId: uuid('created_by_person_id')
      .notNull()
      .references(() => people.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('runner_credentials_league_id_name_unique').on(table.leagueId, table.name),
    foreignKey({
      columns: [table.leagueId, table.stationId],
      foreignColumns: [runnerStations.leagueId, runnerStations.id],
      name: 'runner_credentials_station_fk',
    }),
  ],
)

export const auditRecords = pgTable(
  'audit_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').references(() => leagues.id, { onDelete: 'set null' }),
    actorPersonId: uuid('actor_person_id').references(() => people.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_records_league_occurred_at_index').on(table.leagueId, table.occurredAt),
    index('audit_records_actor_occurred_at_index').on(table.actorPersonId, table.occurredAt),
  ],
)

export const importReferences = pgTable(
  'import_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceEntityType: text('source_entity_type').notNull(),
    sourceEntityId: text('source_entity_id').notNull(),
    targetEntityType: text('target_entity_type').notNull(),
    targetEntityId: uuid('target_entity_id').notNull(),
    sourceContentHash: text('source_content_hash').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('import_references_source_identity_unique').on(
      table.leagueId,
      table.source,
      table.sourceEntityType,
      table.sourceEntityId,
    ),
    index('import_references_target_index').on(
      table.leagueId,
      table.targetEntityType,
      table.targetEntityId,
    ),
  ],
)

export const statProfiles = pgTable(
  'stat_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('stat_profiles_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('stat_profiles_league_id_slug_unique').on(table.leagueId, table.slug),
  ],
)

export const statProfileRevisions = pgTable(
  'stat_profile_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    profileId: uuid('profile_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    status: revisionStatus('status').notNull().default('draft'),
    name: text('name').notNull(),
    definitions: jsonb('definitions')
      .$type<StatProfileRevision['definitions']>()
      .notNull(),
    characterValues: jsonb('character_values')
      .$type<StatProfileRevision['characterValues']>()
      .notNull(),
    basedOnRevisionId: uuid('based_on_revision_id'),
    createdByPersonId: uuid('created_by_person_id')
      .notNull()
      .references(() => people.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    unique('stat_profile_revisions_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('stat_profile_revisions_profile_number_unique').on(
      table.leagueId,
      table.profileId,
      table.revisionNumber,
    ),
    foreignKey({
      columns: [table.leagueId, table.profileId],
      foreignColumns: [statProfiles.leagueId, statProfiles.id],
      name: 'stat_profile_revisions_profile_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.basedOnRevisionId],
      foreignColumns: [table.leagueId, table.id],
      name: 'stat_profile_revisions_based_on_fk',
    }),
  ],
)

export const drafts = pgTable(
  'drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    seasonId: uuid('season_id').notNull(),
    statProfileRevisionId: uuid('stat_profile_revision_id').notNull(),
    gameId: text('game_id').notNull().default('RMBE01'),
    name: text('name').notNull(),
    status: draftStatus('status').notNull().default('setup'),
    orderMode: draftOrderMode('order_mode').notNull().default('snake'),
    rounds: integer('rounds').notNull(),
    pickSeconds: integer('pick_seconds').notNull().default(120),
    currentPickNumber: integer('current_pick_number').notNull().default(1),
    turnStartedAt: timestamp('turn_started_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    version: integer('version').notNull().default(0),
    createdByPersonId: uuid('created_by_person_id')
      .notNull()
      .references(() => people.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique('drafts_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('drafts_league_season_name_unique').on(
      table.leagueId,
      table.seasonId,
      table.name,
    ),
    check('drafts_rounds_check', sql`${table.rounds} between 1 and 18`),
    check('drafts_pick_seconds_check', sql`${table.pickSeconds} between 15 and 86400`),
    check('drafts_current_pick_check', sql`${table.currentPickNumber} > 0`),
    foreignKey({
      columns: [table.leagueId, table.seasonId],
      foreignColumns: [seasons.leagueId, seasons.id],
      name: 'drafts_season_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.statProfileRevisionId],
      foreignColumns: [statProfileRevisions.leagueId, statProfileRevisions.id],
      name: 'drafts_stat_profile_revision_fk',
    }),
  ],
)

export const draftSlots = pgTable(
  'draft_slots',
  {
    leagueId: uuid('league_id').notNull(),
    draftId: uuid('draft_id').notNull(),
    position: integer('position').notNull(),
    teamId: uuid('team_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.leagueId, table.draftId, table.position] }),
    uniqueIndex('draft_slots_draft_team_unique').on(
      table.leagueId,
      table.draftId,
      table.teamId,
    ),
    check('draft_slots_position_check', sql`${table.position} > 0`),
    foreignKey({
      columns: [table.leagueId, table.draftId],
      foreignColumns: [drafts.leagueId, drafts.id],
      name: 'draft_slots_draft_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.teamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'draft_slots_team_fk',
    }),
  ],
)

export const draftPicks = pgTable(
  'draft_picks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    draftId: uuid('draft_id').notNull(),
    pickNumber: integer('pick_number').notNull(),
    roundNumber: integer('round_number').notNull(),
    slotPosition: integer('slot_position').notNull(),
    teamId: uuid('team_id').notNull(),
    characterId: text('character_id').notNull(),
    pickedByPersonId: uuid('picked_by_person_id')
      .notNull()
      .references(() => people.id),
    source: draftPickSource('source').notNull(),
    status: draftPickStatus('status').notNull().default('active'),
    reason: text('reason'),
    selectedAt: timestamp('selected_at', { withTimezone: true }).notNull(),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
  },
  (table) => [
    unique('draft_picks_league_id_id_unique').on(table.leagueId, table.id),
    check('draft_picks_number_check', sql`${table.pickNumber} > 0`),
    check('draft_picks_round_check', sql`${table.roundNumber} > 0`),
    check('draft_picks_slot_check', sql`${table.slotPosition} > 0`),
    uniqueIndex('draft_picks_active_number_unique')
      .on(table.leagueId, table.draftId, table.pickNumber)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('draft_picks_active_character_unique')
      .on(table.leagueId, table.draftId, table.characterId)
      .where(sql`${table.status} = 'active'`),
    foreignKey({
      columns: [table.leagueId, table.draftId],
      foreignColumns: [drafts.leagueId, drafts.id],
      name: 'draft_picks_draft_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.draftId, table.slotPosition],
      foreignColumns: [draftSlots.leagueId, draftSlots.draftId, draftSlots.position],
      name: 'draft_picks_slot_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.teamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'draft_picks_team_fk',
    }),
  ],
)

export const draftQueues = pgTable(
  'draft_queues',
  {
    leagueId: uuid('league_id').notNull(),
    draftId: uuid('draft_id').notNull(),
    teamId: uuid('team_id').notNull(),
    characterId: text('character_id').notNull(),
    rank: integer('rank').notNull(),
    updatedByPersonId: uuid('updated_by_person_id')
      .notNull()
      .references(() => people.id),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.leagueId, table.draftId, table.teamId, table.characterId] }),
    uniqueIndex('draft_queues_team_rank_unique').on(
      table.leagueId,
      table.draftId,
      table.teamId,
      table.rank,
    ),
    check('draft_queues_rank_check', sql`${table.rank} > 0`),
    foreignKey({
      columns: [table.leagueId, table.draftId],
      foreignColumns: [drafts.leagueId, drafts.id],
      name: 'draft_queues_draft_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.teamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'draft_queues_team_fk',
    }).onDelete('cascade'),
  ],
)

export const draftEvents = pgTable(
  'draft_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    draftId: uuid('draft_id').notNull(),
    sequence: integer('sequence').notNull(),
    eventType: draftEventType('event_type').notNull(),
    actorPersonId: uuid('actor_person_id')
      .notNull()
      .references(() => people.id),
    teamId: uuid('team_id'),
    pickId: uuid('pick_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('draft_events_draft_sequence_unique').on(
      table.leagueId,
      table.draftId,
      table.sequence,
    ),
    foreignKey({
      columns: [table.leagueId, table.draftId],
      foreignColumns: [drafts.leagueId, drafts.id],
      name: 'draft_events_draft_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.pickId],
      foreignColumns: [draftPicks.leagueId, draftPicks.id],
      name: 'draft_events_pick_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.teamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'draft_events_team_fk',
    }),
    index('draft_events_draft_occurred_index').on(
      table.leagueId,
      table.draftId,
      table.occurredAt,
    ),
  ],
)

export const rulesets = pgTable(
  'rulesets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('rulesets_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('rulesets_league_id_slug_unique').on(table.leagueId, table.slug),
  ],
)

export const rulesetRevisions = pgTable(
  'ruleset_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    rulesetId: uuid('ruleset_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    status: revisionStatus('status').notNull().default('draft'),
    name: text('name').notNull(),
    settings: jsonb('settings').$type<RulesetRevision['settings']>().notNull(),
    basedOnRevisionId: uuid('based_on_revision_id'),
    createdByPersonId: uuid('created_by_person_id')
      .notNull()
      .references(() => people.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    unique('ruleset_revisions_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('ruleset_revisions_ruleset_number_unique').on(
      table.leagueId,
      table.rulesetId,
      table.revisionNumber,
    ),
    foreignKey({
      columns: [table.leagueId, table.rulesetId],
      foreignColumns: [rulesets.leagueId, rulesets.id],
      name: 'ruleset_revisions_ruleset_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.basedOnRevisionId],
      foreignColumns: [table.leagueId, table.id],
      name: 'ruleset_revisions_based_on_fk',
    }),
  ],
)

export const contentPacks = pgTable(
  'content_packs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    createdByPersonId: uuid('created_by_person_id')
      .notNull()
      .references(() => people.id),
    ...timestamps,
  },
  (table) => [
    unique('content_packs_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('content_packs_league_slug_unique').on(table.leagueId, table.slug),
  ],
)

export const contentAssets = pgTable(
  'content_assets',
  {
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
    sha256: text('sha256').notNull(),
    objectKey: text('object_key').notNull(),
    mediaType: text('media_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    displayName: text('display_name').notNull(),
    uploadedByPersonId: uuid('uploaded_by_person_id')
      .notNull()
      .references(() => people.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.leagueId, table.sha256] }),
    uniqueIndex('content_assets_object_key_unique').on(table.objectKey),
    check('content_assets_sha256_check', sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
    check('content_assets_size_check', sql`${table.sizeBytes} > 0`),
  ],
)

export const contentPackRevisions = pgTable(
  'content_pack_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    contentPackId: uuid('content_pack_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    status: revisionStatus('status').notNull().default('draft'),
    statProfileRevisionId: uuid('stat_profile_revision_id').notNull(),
    rulesetRevisionId: uuid('ruleset_revision_id').notNull(),
    adapterVersion: text('adapter_version').notNull(),
    mainDolSha256: text('main_dol_sha256').notNull(),
    statCharacterIds: jsonb('stat_character_ids').$type<string[]>().notNull().default([]),
    manifest: jsonb('manifest').$type<ContentPackManifest>(),
    manifestSha256: text('manifest_sha256'),
    basedOnRevisionId: uuid('based_on_revision_id'),
    createdByPersonId: uuid('created_by_person_id')
      .notNull()
      .references(() => people.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    unique('content_pack_revisions_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('content_pack_revisions_number_unique').on(
      table.leagueId,
      table.contentPackId,
      table.revisionNumber,
    ),
    check('content_pack_revisions_number_check', sql`${table.revisionNumber} > 0`),
    check('content_pack_revisions_dol_hash_check', sql`${table.mainDolSha256} ~ '^[a-f0-9]{64}$'`),
    foreignKey({
      columns: [table.leagueId, table.contentPackId],
      foreignColumns: [contentPacks.leagueId, contentPacks.id],
      name: 'content_pack_revisions_pack_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.statProfileRevisionId],
      foreignColumns: [statProfileRevisions.leagueId, statProfileRevisions.id],
      name: 'content_pack_revisions_stat_profile_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.rulesetRevisionId],
      foreignColumns: [rulesetRevisions.leagueId, rulesetRevisions.id],
      name: 'content_pack_revisions_ruleset_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.basedOnRevisionId],
      foreignColumns: [table.leagueId, table.id],
      name: 'content_pack_revisions_based_on_fk',
    }),
  ],
)

export const contentPackAssetAssignments = pgTable(
  'content_pack_asset_assignments',
  {
    leagueId: uuid('league_id').notNull(),
    contentPackRevisionId: uuid('content_pack_revision_id').notNull(),
    characterId: text('character_id').notNull(),
    slot: text('slot').notNull(),
    assetSha256: text('asset_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.leagueId, table.contentPackRevisionId, table.characterId, table.slot],
    }),
    check('content_pack_asset_assignments_slot_check', sql`${table.slot} in ('icon', 'portrait', 'model', 'texture')`),
    foreignKey({
      columns: [table.leagueId, table.contentPackRevisionId],
      foreignColumns: [contentPackRevisions.leagueId, contentPackRevisions.id],
      name: 'content_pack_asset_assignments_revision_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.assetSha256],
      foreignColumns: [contentAssets.leagueId, contentAssets.sha256],
      name: 'content_pack_asset_assignments_asset_fk',
    }),
  ],
)

export const rosterRevisions = pgTable(
  'roster_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    teamId: uuid('team_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    status: revisionStatus('status').notNull().default('draft'),
    rosterCharacterIds: jsonb('roster_character_ids').$type<string[]>().notNull(),
    basedOnRevisionId: uuid('based_on_revision_id'),
    createdByPersonId: uuid('created_by_person_id')
      .notNull()
      .references(() => people.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    unique('roster_revisions_league_id_id_unique').on(table.leagueId, table.id),
    unique('roster_revisions_league_team_id_unique').on(
      table.leagueId,
      table.teamId,
      table.id,
    ),
    uniqueIndex('roster_revisions_team_number_unique').on(
      table.leagueId,
      table.teamId,
      table.revisionNumber,
    ),
    foreignKey({
      columns: [table.leagueId, table.teamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'roster_revisions_team_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.teamId, table.basedOnRevisionId],
      foreignColumns: [table.leagueId, table.teamId, table.id],
      name: 'roster_revisions_based_on_fk',
    }),
  ],
)

export const leagueDeadlines = pgTable(
  'league_deadlines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    seasonId: uuid('season_id').notNull(),
    kind: leagueDeadlineKind('kind').notNull(),
    closesAt: timestamp('closes_at', { withTimezone: true }).notNull(),
    note: text('note'),
    createdByPersonId: uuid('created_by_person_id')
      .notNull()
      .references(() => people.id),
    ...timestamps,
  },
  (table) => [
    unique('league_deadlines_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('league_deadlines_season_kind_unique').on(
      table.leagueId,
      table.seasonId,
      table.kind,
    ),
    foreignKey({
      columns: [table.leagueId, table.seasonId],
      foreignColumns: [seasons.leagueId, seasons.id],
      name: 'league_deadlines_season_fk',
    }).onDelete('cascade'),
  ],
)

export const tradeProposals = pgTable(
  'trade_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    seasonId: uuid('season_id').notNull(),
    proposerTeamId: uuid('proposer_team_id').notNull(),
    counterpartyTeamId: uuid('counterparty_team_id').notNull(),
    status: tradeProposalStatus('status').notNull().default('pending'),
    message: text('message'),
    proposedByPersonId: uuid('proposed_by_person_id')
      .notNull()
      .references(() => people.id),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique('trade_proposals_league_id_id_unique').on(table.leagueId, table.id),
    check(
      'trade_proposals_distinct_teams_check',
      sql`${table.proposerTeamId} <> ${table.counterpartyTeamId}`,
    ),
    foreignKey({
      columns: [table.leagueId, table.seasonId],
      foreignColumns: [seasons.leagueId, seasons.id],
      name: 'trade_proposals_season_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.proposerTeamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'trade_proposals_proposer_team_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.counterpartyTeamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'trade_proposals_counterparty_team_fk',
    }),
    index('trade_proposals_league_status_index').on(table.leagueId, table.status, table.proposedAt),
  ],
)

export const tradeItems = pgTable(
  'trade_items',
  {
    leagueId: uuid('league_id').notNull(),
    proposalId: uuid('proposal_id').notNull(),
    characterId: text('character_id').notNull(),
    fromTeamId: uuid('from_team_id').notNull(),
    toTeamId: uuid('to_team_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.leagueId, table.proposalId, table.characterId] }),
    check('trade_items_distinct_teams_check', sql`${table.fromTeamId} <> ${table.toTeamId}`),
    foreignKey({
      columns: [table.leagueId, table.proposalId],
      foreignColumns: [tradeProposals.leagueId, tradeProposals.id],
      name: 'trade_items_proposal_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.fromTeamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'trade_items_from_team_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.toTeamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'trade_items_to_team_fk',
    }),
  ],
)

export const tradeApprovals = pgTable(
  'trade_approvals',
  {
    leagueId: uuid('league_id').notNull(),
    proposalId: uuid('proposal_id').notNull(),
    teamId: uuid('team_id').notNull(),
    decision: tradeDecision('decision').notNull(),
    decidedByPersonId: uuid('decided_by_person_id')
      .notNull()
      .references(() => people.id),
    reason: text('reason'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.leagueId, table.proposalId, table.teamId] }),
    foreignKey({
      columns: [table.leagueId, table.proposalId],
      foreignColumns: [tradeProposals.leagueId, tradeProposals.id],
      name: 'trade_approvals_proposal_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.teamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'trade_approvals_team_fk',
    }),
  ],
)

export const rosterTransactions = pgTable(
  'roster_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    seasonId: uuid('season_id').notNull(),
    kind: rosterTransactionKind('kind').notNull(),
    sourceId: uuid('source_id'),
    characterId: text('character_id').notNull(),
    fromTeamId: uuid('from_team_id'),
    toTeamId: uuid('to_team_id'),
    fromBeforeRosterRevisionId: uuid('from_before_roster_revision_id'),
    fromAfterRosterRevisionId: uuid('from_after_roster_revision_id'),
    toBeforeRosterRevisionId: uuid('to_before_roster_revision_id'),
    toAfterRosterRevisionId: uuid('to_after_roster_revision_id'),
    actorPersonId: uuid('actor_person_id')
      .notNull()
      .references(() => people.id),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'roster_transactions_team_change_check',
      sql`${table.fromTeamId} is not null or ${table.toTeamId} is not null`,
    ),
    foreignKey({
      columns: [table.leagueId, table.seasonId],
      foreignColumns: [seasons.leagueId, seasons.id],
      name: 'roster_transactions_season_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.fromTeamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'roster_transactions_from_team_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.toTeamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'roster_transactions_to_team_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.fromBeforeRosterRevisionId],
      foreignColumns: [rosterRevisions.leagueId, rosterRevisions.id],
      name: 'roster_transactions_from_before_roster_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.fromAfterRosterRevisionId],
      foreignColumns: [rosterRevisions.leagueId, rosterRevisions.id],
      name: 'roster_transactions_from_after_roster_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.toBeforeRosterRevisionId],
      foreignColumns: [rosterRevisions.leagueId, rosterRevisions.id],
      name: 'roster_transactions_to_before_roster_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.toAfterRosterRevisionId],
      foreignColumns: [rosterRevisions.leagueId, rosterRevisions.id],
      name: 'roster_transactions_to_after_roster_fk',
    }),
    index('roster_transactions_league_occurred_index').on(
      table.leagueId,
      table.occurredAt,
    ),
  ],
)

export const lineupRevisions = pgTable(
  'lineup_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    teamId: uuid('team_id').notNull(),
    rosterRevisionId: uuid('roster_revision_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    status: revisionStatus('status').notNull().default('draft'),
    lineup: jsonb('lineup').$type<TeamLineupRevision['lineup']>().notNull(),
    basedOnRevisionId: uuid('based_on_revision_id'),
    createdByPersonId: uuid('created_by_person_id')
      .notNull()
      .references(() => people.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    unique('lineup_revisions_league_id_id_unique').on(table.leagueId, table.id),
    unique('lineup_revisions_league_team_id_unique').on(
      table.leagueId,
      table.teamId,
      table.id,
    ),
    uniqueIndex('lineup_revisions_team_number_unique').on(
      table.leagueId,
      table.teamId,
      table.revisionNumber,
    ),
    foreignKey({
      columns: [table.leagueId, table.teamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'lineup_revisions_team_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.teamId, table.rosterRevisionId],
      foreignColumns: [rosterRevisions.leagueId, rosterRevisions.teamId, rosterRevisions.id],
      name: 'lineup_revisions_roster_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.teamId, table.basedOnRevisionId],
      foreignColumns: [table.leagueId, table.teamId, table.id],
      name: 'lineup_revisions_based_on_fk',
    }),
  ],
)

export const matchLineupOverrides = pgTable(
  'match_lineup_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    matchId: uuid('match_id').notNull(),
    teamId: uuid('team_id').notNull(),
    baseLineupRevisionId: uuid('base_lineup_revision_id').notNull(),
    effectiveLineup: jsonb('effective_lineup')
      .$type<TeamLineupRevision['lineup']>()
      .notNull(),
    createdByPersonId: uuid('created_by_person_id')
      .notNull()
      .references(() => people.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('match_lineup_overrides_match_team_unique').on(
      table.leagueId,
      table.matchId,
      table.teamId,
    ),
    foreignKey({
      columns: [table.leagueId, table.teamId, table.baseLineupRevisionId],
      foreignColumns: [lineupRevisions.leagueId, lineupRevisions.teamId, lineupRevisions.id],
      name: 'match_lineup_overrides_lineup_fk',
    }),
  ],
)

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    seasonId: uuid('season_id').notNull(),
    homeTeamId: uuid('home_team_id').notNull(),
    awayTeamId: uuid('away_team_id').notNull(),
    status: matchStatus('status').notNull().default('scheduled'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    createdByPersonId: uuid('created_by_person_id')
      .notNull()
      .references(() => people.id),
    ...timestamps,
  },
  (table) => [
    unique('matches_league_id_id_unique').on(table.leagueId, table.id),
    check('matches_distinct_teams_check', sql`${table.homeTeamId} <> ${table.awayTeamId}`),
    foreignKey({
      columns: [table.leagueId, table.seasonId],
      foreignColumns: [seasons.leagueId, seasons.id],
      name: 'matches_season_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.homeTeamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'matches_home_team_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.awayTeamId],
      foreignColumns: [leagueTeams.leagueId, leagueTeams.id],
      name: 'matches_away_team_fk',
    }),
    index('matches_league_status_scheduled_index').on(table.leagueId, table.status, table.scheduledAt),
  ],
)

export const matchAttempts = pgTable(
  'match_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    matchId: uuid('match_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    status: matchAttemptStatus('status').notNull().default('queued'),
    correlationId: uuid('correlation_id').notNull(),
    attemptNonce: text('attempt_nonce').notNull(),
    requiredGameBuildSha256: text('required_game_build_sha256').notNull(),
    statProfileRevisionId: uuid('stat_profile_revision_id').notNull(),
    rulesetRevisionId: uuid('ruleset_revision_id').notNull(),
    homeRosterRevisionId: uuid('home_roster_revision_id').notNull(),
    homeLineupRevisionId: uuid('home_lineup_revision_id').notNull(),
    awayRosterRevisionId: uuid('away_roster_revision_id').notNull(),
    awayLineupRevisionId: uuid('away_lineup_revision_id').notNull(),
    dynamicRuleOverrides: jsonb('dynamic_rule_overrides').$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    failureKind: runnerFailureKind('failure_kind'),
    createdByPersonId: uuid('created_by_person_id')
      .notNull()
      .references(() => people.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedByPersonId: uuid('confirmed_by_person_id').references(() => people.id),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('match_attempts_league_id_id_unique').on(table.leagueId, table.id),
    check('match_attempts_positive_number_check', sql`${table.attemptNumber} > 0`),
    check('match_attempts_nonce_check', sql`${table.attemptNonce} ~ '^[A-Za-z0-9_-]{32,128}$'`),
    check('match_attempts_build_hash_check', sql`${table.requiredGameBuildSha256} ~ '^[a-f0-9]{64}$'`),
    uniqueIndex('match_attempts_match_number_unique').on(table.leagueId, table.matchId, table.attemptNumber),
    foreignKey({
      columns: [table.leagueId, table.matchId],
      foreignColumns: [matches.leagueId, matches.id],
      name: 'match_attempts_match_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.homeRosterRevisionId],
      foreignColumns: [rosterRevisions.leagueId, rosterRevisions.id],
      name: 'match_attempts_home_roster_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.homeLineupRevisionId],
      foreignColumns: [lineupRevisions.leagueId, lineupRevisions.id],
      name: 'match_attempts_home_lineup_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.awayRosterRevisionId],
      foreignColumns: [rosterRevisions.leagueId, rosterRevisions.id],
      name: 'match_attempts_away_roster_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.awayLineupRevisionId],
      foreignColumns: [lineupRevisions.leagueId, lineupRevisions.id],
      name: 'match_attempts_away_lineup_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.statProfileRevisionId],
      foreignColumns: [statProfileRevisions.leagueId, statProfileRevisions.id],
      name: 'match_attempts_stat_profile_fk',
    }),
    foreignKey({
      columns: [table.leagueId, table.rulesetRevisionId],
      foreignColumns: [rulesetRevisions.leagueId, rulesetRevisions.id],
      name: 'match_attempts_ruleset_fk',
    }),
    index('match_attempts_league_status_created_index').on(table.leagueId, table.status, table.createdAt),
  ],
)

export const runnerLeases = pgTable(
  'runner_leases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    matchAttemptId: uuid('match_attempt_id').notNull(),
    runnerStationId: uuid('runner_station_id').notNull(),
    status: runnerLeaseStatus('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastRenewedAt: timestamp('last_renewed_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('runner_leases_league_id_id_unique').on(table.leagueId, table.id),
    uniqueIndex('runner_leases_attempt_unique').on(table.leagueId, table.matchAttemptId),
    uniqueIndex('runner_leases_active_station_unique')
      .on(table.leagueId, table.runnerStationId)
      .where(sql`${table.status} = 'active'`),
    foreignKey({
      columns: [table.leagueId, table.matchAttemptId],
      foreignColumns: [matchAttempts.leagueId, matchAttempts.id],
      name: 'runner_leases_attempt_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.runnerStationId],
      foreignColumns: [runnerStations.leagueId, runnerStations.id],
      name: 'runner_leases_station_fk',
    }),
    index('runner_leases_station_status_index').on(table.leagueId, table.runnerStationId, table.status),
  ],
)

export const attemptLifecycleEvents = pgTable(
  'attempt_lifecycle_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    matchAttemptId: uuid('match_attempt_id').notNull(),
    runnerStationId: uuid('runner_station_id'),
    eventType: attemptLifecycleEventType('event_type').notNull(),
    failureKind: runnerFailureKind('failure_kind'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.leagueId, table.matchAttemptId],
      foreignColumns: [matchAttempts.leagueId, matchAttempts.id],
      name: 'attempt_lifecycle_events_attempt_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.runnerStationId],
      foreignColumns: [runnerStations.leagueId, runnerStations.id],
      name: 'attempt_lifecycle_events_station_fk',
    }),
    index('attempt_lifecycle_events_attempt_recorded_index').on(table.leagueId, table.matchAttemptId, table.recordedAt),
  ],
)

export const telemetryEvents = pgTable(
  'telemetry_events',
  {
    leagueId: uuid('league_id').notNull(),
    matchId: uuid('match_id').notNull(),
    matchAttemptId: uuid('match_attempt_id').notNull(),
    sequence: integer('sequence').notNull(),
    frame: integer('frame').notNull(),
    protocolVersion: integer('protocol_version').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    eventType: text('event_type').notNull(),
    observationSource: telemetryObservationSource('observation_source').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    adapterVersion: text('adapter_version').notNull(),
    gameBuildSha256: text('game_build_sha256').notNull(),
    stateFingerprint: text('state_fingerprint'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.leagueId, table.matchAttemptId, table.sequence] }),
    check('telemetry_events_positive_sequence_check', sql`${table.sequence} > 0`),
    check('telemetry_events_nonnegative_frame_check', sql`${table.frame} >= 0`),
    check('telemetry_events_protocol_version_check', sql`${table.protocolVersion} > 0`),
    check('telemetry_events_build_hash_check', sql`${table.gameBuildSha256} ~ '^[a-f0-9]{64}$'`),
    foreignKey({
      columns: [table.leagueId, table.matchId],
      foreignColumns: [matches.leagueId, matches.id],
      name: 'telemetry_events_match_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.matchAttemptId],
      foreignColumns: [matchAttempts.leagueId, matchAttempts.id],
      name: 'telemetry_events_attempt_fk',
    }).onDelete('cascade'),
    index('telemetry_events_attempt_frame_index').on(
      table.leagueId,
      table.matchAttemptId,
      table.frame,
    ),
  ],
)

export const telemetryCorrections = pgTable(
  'telemetry_corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    matchAttemptId: uuid('match_attempt_id').notNull(),
    entityType: telemetryCorrectionEntity('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    statPath: text('stat_path').notNull(),
    beforeValue: integer('before_value').notNull(),
    afterValue: integer('after_value').notNull(),
    actorPersonId: uuid('actor_person_id')
      .notNull()
      .references(() => people.id),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('telemetry_corrections_reason_check', sql`length(trim(${table.reason})) >= 3`),
    check('telemetry_corrections_path_check', sql`${table.statPath} ~ '^[a-z][a-zA-Z0-9.]{1,99}$'`),
    foreignKey({
      columns: [table.leagueId, table.matchAttemptId],
      foreignColumns: [matchAttempts.leagueId, matchAttempts.id],
      name: 'telemetry_corrections_attempt_fk',
    }).onDelete('cascade'),
    index('telemetry_corrections_attempt_created_index').on(
      table.leagueId,
      table.matchAttemptId,
      table.createdAt,
      table.id,
    ),
  ],
)

export const telemetryDerivations = pgTable(
  'telemetry_derivations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id').notNull(),
    matchId: uuid('match_id').notNull(),
    matchAttemptId: uuid('match_attempt_id').notNull(),
    derivationVersion: integer('derivation_version').notNull(),
    inputDigest: text('input_digest').notNull(),
    status: telemetryDerivationStatus('status').notNull(),
    issues: jsonb('issues').$type<string[]>().notNull().default([]),
    boxScore: jsonb('box_score').$type<Record<string, unknown>>().notNull(),
    sourceFirstSequence: integer('source_first_sequence').notNull(),
    sourceLastSequence: integer('source_last_sequence').notNull(),
    eventCount: integer('event_count').notNull(),
    correctionCount: integer('correction_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('telemetry_derivations_input_unique').on(
      table.leagueId,
      table.matchAttemptId,
      table.derivationVersion,
      table.inputDigest,
    ),
    check('telemetry_derivations_version_check', sql`${table.derivationVersion} > 0`),
    check('telemetry_derivations_digest_check', sql`${table.inputDigest} ~ '^[a-f0-9]{64}$'`),
    check('telemetry_derivations_sequences_check', sql`${table.sourceFirstSequence} > 0 and ${table.sourceLastSequence} >= ${table.sourceFirstSequence}`),
    check('telemetry_derivations_counts_check', sql`${table.eventCount} > 0 and ${table.correctionCount} >= 0`),
    foreignKey({
      columns: [table.leagueId, table.matchId],
      foreignColumns: [matches.leagueId, matches.id],
      name: 'telemetry_derivations_match_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.leagueId, table.matchAttemptId],
      foreignColumns: [matchAttempts.leagueId, matchAttempts.id],
      name: 'telemetry_derivations_attempt_fk',
    }).onDelete('cascade'),
    index('telemetry_derivations_attempt_created_index').on(
      table.leagueId,
      table.matchAttemptId,
      table.createdAt,
    ),
  ],
)
