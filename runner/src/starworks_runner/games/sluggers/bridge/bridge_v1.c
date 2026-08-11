/*
 * Starworks bridge v1 clean-room source.
 *
 * This file implements only the protocol defined by Starworks. It contains no
 * Nintendo code and no code copied from existing Sluggers tools. A trusted
 * release build may compile it with the reviewed Wii injection toolchain and
 * publish only the resulting hash-pinned artifact to runners.
 */

typedef unsigned char sw_u8;
typedef unsigned short sw_u16;
typedef unsigned int sw_u32;
typedef unsigned long long sw_u64;

#define SW_BRIDGE_ADDRESS 0x80001900u
#define SW_MAGIC 0x53574231u
#define SW_PROTOCOL_VERSION 1u
#define SW_STATE_ACTIVE 2u
#define SW_EVENT_SYNTHETIC 1u
#define SW_EVENT_GAME_STARTED 2u
#define SW_EVENT_INNING_STARTED 3u
#define SW_EVENT_BATTER_CHANGED 4u
#define SW_EVENT_PITCHER_CHANGED 5u
#define SW_EVENT_PLATE_APPEARANCE_ENDED 6u
#define SW_EVENT_SUBSTITUTION 7u
#define SW_EVENT_GAME_ENDED 8u
#define SW_EVENT_BRIDGE_WARNING 9u
#define SW_EVENT_CAPACITY 32u
#define SW_EVENT_PAYLOAD_SIZE 24u
#define SW_CONFIGURATION_MAGIC 0x53574331u
#define SW_CONFIGURATION_VERSION 1u
#define SW_CONFIGURATION_SIZE 88u
#define SW_CONFIGURATION_OFFSET 0xA8u
#define SW_CONFIGURATION_REQUESTED_EPOCH 0x08u
#define SW_CONFIGURATION_RUNTIME_APPLIED_EPOCH 0x0Cu
#define SW_CONFIGURATION_LINEUP_APPLIED_EPOCH 0x10u
#define SW_CONFIGURATION_LINEUP_APPLIED_MASK 0x14u
#define SW_CONFIGURATION_RULES 0x18u
#define SW_CONFIGURATION_AWAY_CAPTAIN 0x1Cu
#define SW_CONFIGURATION_HOME_CAPTAIN 0x1Du
#define SW_CONFIGURATION_AWAY_TEAM 0x20u
#define SW_CONFIGURATION_HOME_TEAM 0x3Bu
#define SW_CONFIGURATION_EXECUTION_MODE 0x56u
#define SW_CONFIGURATION_STADIUM_ID 0x57u
#define SW_UNSET_RULE 0xFFu
#define SW_EXECUTION_CPU_VS_CPU 1u
#define SW_LINEUP_MASK_CPU_CONTROL 4u
#define SW_CPU_ACTIVATION_INPUT_ADDRESS 0x81317BB0u
#define SW_CPU_ACTIVATION_CHORD 0x1800u
#define SW_STADIUM_ID_ADDRESS 0x811F769Du
#define SW_STADIUM_TIME_ADDRESS 0x811F769Eu
#define SW_STADIUM_TIME_COPY_ADDRESS 0x811F769Fu

typedef struct {
    volatile sw_u64 sequence;
    volatile sw_u64 frame;
    volatile sw_u8 attempt_nonce_digest[32];
    volatile sw_u16 event_type;
    volatile sw_u16 payload_size;
    volatile sw_u32 flags;
    volatile sw_u8 payload[SW_EVENT_PAYLOAD_SIZE];
} StarworksEventV1;

typedef struct {
    volatile sw_u32 magic;
    volatile sw_u16 protocol_version;
    volatile sw_u16 header_size;
    volatile sw_u32 total_size;
    volatile sw_u32 flags;
    volatile sw_u8 adapter_build_digest[32];
    volatile sw_u8 game_build_digest[32];
    volatile sw_u8 attempt_nonce_digest[32];
    volatile sw_u64 heartbeat;
    volatile sw_u64 producer_sequence;
    volatile sw_u64 consumer_sequence;
    volatile sw_u32 dropped_events;
    volatile sw_u16 event_capacity;
    volatile sw_u16 event_size;
    volatile sw_u32 state;
    volatile sw_u32 last_error;
    volatile sw_u64 request_epoch;
    volatile sw_u64 acknowledged_epoch;
    volatile sw_u8 reserved[88];
    volatile StarworksEventV1 events[SW_EVENT_CAPACITY];
} StarworksBridgeV1;

static void StarworksCopyDigest(volatile sw_u8 *destination,
                                volatile const sw_u8 *source) {
    sw_u32 index;
    for (index = 0; index < 32; ++index) {
        destination[index] = source[index];
    }
}

static void StarworksPublishBarrier(void) {
    __asm__ volatile("sync" ::: "memory");
}

static void StarworksPublishEvent(volatile StarworksBridgeV1 *bridge,
                                  sw_u16 event_type,
                                  volatile const sw_u8 *payload,
                                  sw_u16 payload_size,
                                  sw_u32 flags) {
    volatile StarworksEventV1 *event;
    sw_u64 sequence;
    sw_u32 index;

    if (bridge->state != SW_STATE_ACTIVE || payload_size > SW_EVENT_PAYLOAD_SIZE) {
        return;
    }
    sequence = bridge->producer_sequence + 1u;
    if (sequence - bridge->consumer_sequence > SW_EVENT_CAPACITY) {
        bridge->dropped_events += 1u;
        return;
    }
    event = &bridge->events[(sequence - 1u) % SW_EVENT_CAPACITY];
    event->sequence = 0;
    event->frame = bridge->heartbeat;
    StarworksCopyDigest(event->attempt_nonce_digest,
                        bridge->attempt_nonce_digest);
    event->event_type = event_type;
    event->payload_size = payload_size;
    event->flags = flags;
    for (index = 0; index < SW_EVENT_PAYLOAD_SIZE; ++index) {
        event->payload[index] = index < payload_size ? payload[index] : 0;
    }
    StarworksPublishBarrier();
    event->sequence = sequence;
    StarworksPublishBarrier();
    bridge->producer_sequence = sequence;
}

void StarworksEmitGameStarted(void) {
    volatile StarworksBridgeV1 *bridge =
        (volatile StarworksBridgeV1 *)SW_BRIDGE_ADDRESS;
    volatile sw_u8 payload[1] = {0};
    StarworksPublishEvent(bridge, SW_EVENT_GAME_STARTED, payload, 0, 0);
}

void StarworksEmitInningStarted(sw_u8 inning, sw_u8 half) {
    volatile StarworksBridgeV1 *bridge =
        (volatile StarworksBridgeV1 *)SW_BRIDGE_ADDRESS;
    volatile sw_u8 payload[2] = {inning, half};
    StarworksPublishEvent(bridge, SW_EVENT_INNING_STARTED, payload, 2, 0);
}

void StarworksEmitCharacterChanged(sw_u16 event_type, sw_u8 character,
                                   sw_u8 side) {
    volatile StarworksBridgeV1 *bridge =
        (volatile StarworksBridgeV1 *)SW_BRIDGE_ADDRESS;
    volatile sw_u8 payload[2] = {character, side};
    if (event_type == SW_EVENT_BATTER_CHANGED ||
        event_type == SW_EVENT_PITCHER_CHANGED) {
        StarworksPublishEvent(bridge, event_type, payload, 2, 0);
    }
}

void StarworksEmitPlateAppearanceEnded(
    sw_u8 batter, sw_u8 pitcher, sw_u8 side, sw_u8 result,
    sw_u8 outs_recorded, sw_u8 rbi, sw_u8 error_by, sw_u8 scorer_count,
    sw_u8 scorer_0, sw_u8 scorer_1, sw_u8 scorer_2, sw_u8 scorer_3) {
    volatile StarworksBridgeV1 *bridge =
        (volatile StarworksBridgeV1 *)SW_BRIDGE_ADDRESS;
    volatile sw_u8 payload[12] = {
        batter, pitcher, side, result, outs_recorded, rbi, error_by,
        scorer_count, scorer_0, scorer_1, scorer_2, scorer_3
    };
    StarworksPublishEvent(
        bridge, SW_EVENT_PLATE_APPEARANCE_ENDED, payload, 12, 0);
}

void StarworksEmitSubstitution(sw_u8 incoming, sw_u8 outgoing,
                               sw_u8 position, sw_u8 side) {
    volatile StarworksBridgeV1 *bridge =
        (volatile StarworksBridgeV1 *)SW_BRIDGE_ADDRESS;
    volatile sw_u8 payload[4] = {incoming, outgoing, position, side};
    StarworksPublishEvent(bridge, SW_EVENT_SUBSTITUTION, payload, 4, 0);
}

void StarworksEmitGameEnded(sw_u16 away_runs, sw_u16 home_runs,
                            sw_u8 reason) {
    volatile StarworksBridgeV1 *bridge =
        (volatile StarworksBridgeV1 *)SW_BRIDGE_ADDRESS;
    volatile sw_u8 payload[5] = {
        (sw_u8)(away_runs >> 8), (sw_u8)away_runs,
        (sw_u8)(home_runs >> 8), (sw_u8)home_runs, reason
    };
    StarworksPublishEvent(bridge, SW_EVENT_GAME_ENDED, payload, 5, 0);
}

void StarworksEmitWarning(sw_u8 code, sw_u32 dropped_events) {
    volatile StarworksBridgeV1 *bridge =
        (volatile StarworksBridgeV1 *)SW_BRIDGE_ADDRESS;
    volatile sw_u8 payload[5] = {
        code, (sw_u8)(dropped_events >> 24), (sw_u8)(dropped_events >> 16),
        (sw_u8)(dropped_events >> 8), (sw_u8)dropped_events
    };
    StarworksPublishEvent(bridge, SW_EVENT_BRIDGE_WARNING, payload, 5, 0);
}

static volatile sw_u8 *StarworksConfiguration(void) {
    return (volatile sw_u8 *)(SW_BRIDGE_ADDRESS + SW_CONFIGURATION_OFFSET);
}

static sw_u32 StarworksConfigurationIsValid(volatile sw_u8 *configuration) {
    volatile sw_u32 *magic = (volatile sw_u32 *)configuration;
    volatile sw_u16 *version = (volatile sw_u16 *)(configuration + 4);
    volatile sw_u16 *size = (volatile sw_u16 *)(configuration + 6);
    volatile sw_u32 *requested_epoch =
        (volatile sw_u32 *)(configuration + SW_CONFIGURATION_REQUESTED_EPOCH);
    return *magic == SW_CONFIGURATION_MAGIC &&
           *version == SW_CONFIGURATION_VERSION &&
           *size == SW_CONFIGURATION_SIZE && *requested_epoch != 0;
}

static void StarworksWriteRuntimeConfiguration(
    volatile sw_u8 *configuration) {
    volatile sw_u8 *rules;

    rules = configuration + SW_CONFIGURATION_RULES;
    if (rules[0] != SW_UNSET_RULE) {
        *(volatile sw_u8 *)0x80794328u = rules[0];
    }
    if (rules[1] != SW_UNSET_RULE) {
        *(volatile sw_u8 *)0x80794329u = rules[1];
    }
    if (rules[2] != SW_UNSET_RULE) {
        *(volatile sw_u8 *)0x8079432Au = rules[2];
    }
    if (rules[3] != SW_UNSET_RULE) {
        *(volatile sw_u8 *)0x8079432Bu = rules[3];
    }
    *(volatile sw_u8 *)0x811F76ACu =
        configuration[SW_CONFIGURATION_AWAY_CAPTAIN];
    *(volatile sw_u8 *)0x811F76ADu =
        configuration[SW_CONFIGURATION_HOME_CAPTAIN];
    *(volatile sw_u8 *)SW_STADIUM_ID_ADDRESS =
        configuration[SW_CONFIGURATION_STADIUM_ID];
    *(volatile sw_u8 *)SW_STADIUM_TIME_ADDRESS = 0u;
    *(volatile sw_u8 *)SW_STADIUM_TIME_COPY_ADDRESS = 0u;
}

static void StarworksApplyRuntimeConfiguration(void) {
    volatile sw_u8 *configuration = StarworksConfiguration();
    volatile sw_u32 *requested_epoch;
    volatile sw_u32 *applied_epoch;

    if (!StarworksConfigurationIsValid(configuration)) {
        return;
    }
    requested_epoch =
        (volatile sw_u32 *)(configuration + SW_CONFIGURATION_REQUESTED_EPOCH);
    applied_epoch = (volatile sw_u32 *)(
        configuration + SW_CONFIGURATION_RUNTIME_APPLIED_EPOCH);
    /* Menus rewrite these game-owned values while advancing. Reassert the
       immutable attempt configuration every frame, then use applied_epoch as
       the one-time acknowledgement that the bridge accepted it. */
    StarworksWriteRuntimeConfiguration(configuration);
    if (*applied_epoch == *requested_epoch) {
        return;
    }
    StarworksPublishBarrier();
    *applied_epoch = *requested_epoch;
}

/*
 * Apply an immutable Starworks lineup at the reviewed RMBE01 selection hook.
 * The game's r14 value is not a strict enum: one selects the home team and
 * every other observed value selects the away team. This deliberately matches
 * the branch semantics of the reviewed MSS-AutoTeam implementation.
 */
sw_u32 StarworksApplyTeamSelection(volatile sw_u8 *selection,
                                   sw_u32 team_selector) {
    volatile sw_u8 *configuration = StarworksConfiguration();
    volatile sw_u8 *team;
    volatile sw_u32 *requested_epoch;
    volatile sw_u32 *lineup_epoch;
    volatile sw_u32 *lineup_mask;
    sw_u32 index;

    if (!StarworksConfigurationIsValid(configuration)) {
        return 0;
    }
    /* The game initializes these globals after boot. Reassert them at the
       reviewed roster boundary so match setup is atomic with team injection. */
    StarworksWriteRuntimeConfiguration(configuration);
    team = configuration +
           (team_selector == 1 ? SW_CONFIGURATION_HOME_TEAM
                               : SW_CONFIGURATION_AWAY_TEAM);
    for (index = 0; index < 9; ++index) {
        volatile sw_u8 *entry = team + index * 3;
        if (entry[0] > 76 || entry[1] > 8 || entry[2] > 8) {
            return 0;
        }
    }
    for (index = 0; index < 9; ++index) {
        volatile sw_u8 *entry = team + index * 3;
        volatile sw_u8 *slot = selection + entry[1] * 16;
        slot[1] = entry[0];
        slot[12] = entry[2];
    }
    requested_epoch =
        (volatile sw_u32 *)(configuration + SW_CONFIGURATION_REQUESTED_EPOCH);
    lineup_epoch = (volatile sw_u32 *)(
        configuration + SW_CONFIGURATION_LINEUP_APPLIED_EPOCH);
    lineup_mask = (volatile sw_u32 *)(
        configuration + SW_CONFIGURATION_LINEUP_APPLIED_MASK);
    *lineup_mask |= team_selector == 1 ? 2u : 1u;
    StarworksPublishBarrier();
    *lineup_epoch = *requested_epoch;
    return 1;
}

/*
 * Make both sides CPU-controlled without installing a Gecko code. The reviewed
 * Minus+A activation value is retained as a menu-safe boundary: applying CPU
 * control as soon as lineups exist steals the controller while Next is still
 * selected. The hook receives the reviewed game-owned state pointer and
 * preserves the original instruction in its trampoline. Bit 2 of
 * lineup_applied_mask is an observable receipt that activation occurred.
 */
void StarworksApplyCpuControl(volatile sw_u8 *state) {
    volatile sw_u8 *configuration = StarworksConfiguration();
    volatile sw_u32 *lineup_mask;

    if (!StarworksConfigurationIsValid(configuration) ||
        configuration[SW_CONFIGURATION_EXECUTION_MODE] !=
            SW_EXECUTION_CPU_VS_CPU) {
        return;
    }
    lineup_mask = (volatile sw_u32 *)(
        configuration + SW_CONFIGURATION_LINEUP_APPLIED_MASK);
    /* This hook is also reached by menu-owned controller state. Taking CPU
       control before both immutable teams are installed prevents the roster
       screen from receiving the A press that commits Random Fill and reaches
       the reviewed team-selection hook. */
    if ((*lineup_mask & 3u) != 3u) {
        return;
    }
    if (*(volatile sw_u16 *)SW_CPU_ACTIVATION_INPUT_ADDRESS !=
        SW_CPU_ACTIVATION_CHORD) {
        return;
    }
    *(volatile sw_u32 *)(state + 0x18u) = 0xFFFFFFFFu;
    *lineup_mask |= SW_LINEUP_MASK_CPU_CONTROL;
    StarworksPublishBarrier();
}

/*
 * This is the single function a reviewed, expected-byte-guarded game hook
 * calls once per frame. The target hook address is intentionally not guessed:
 * it must be derived from a lawful RMBE01 base and reviewed before release.
 */
void StarworksBridgeTick(void) {
    volatile StarworksBridgeV1 *bridge =
        (volatile StarworksBridgeV1 *)SW_BRIDGE_ADDRESS;
    volatile sw_u8 payload[8] = {0, 0, 0, 0, 0, 0, 0, 1};

    if (bridge->magic != SW_MAGIC ||
        bridge->protocol_version != SW_PROTOCOL_VERSION) {
        return;
    }

    bridge->heartbeat += 1;
    StarworksApplyRuntimeConfiguration();
    if (bridge->request_epoch == bridge->acknowledged_epoch) {
        return;
    }

    bridge->producer_sequence = 0;
    bridge->consumer_sequence = 0;
    bridge->dropped_events = 0;
    bridge->state = SW_STATE_ACTIVE;
    StarworksPublishBarrier();
    bridge->acknowledged_epoch = bridge->request_epoch;

    StarworksPublishEvent(bridge, SW_EVENT_SYNTHETIC, payload, 8, 0);
}
