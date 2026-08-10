import {
  boolean,
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
import type {
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
  'member',
])
export const seasonStatus = pgEnum('season_status', ['draft', 'active', 'complete', 'archived'])
export const inviteStatus = pgEnum('invite_status', ['pending', 'redeemed', 'revoked', 'expired'])
export const revisionStatus = pgEnum('revision_status', ['draft', 'published'])

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

export const runnerCredentials = pgTable(
  'runner_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leagueId: uuid('league_id')
      .notNull()
      .references(() => leagues.id, { onDelete: 'cascade' }),
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
