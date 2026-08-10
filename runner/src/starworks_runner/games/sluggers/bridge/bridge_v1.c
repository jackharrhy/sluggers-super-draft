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

typedef struct {
    volatile sw_u64 sequence;
    volatile sw_u64 frame;
    volatile sw_u8 attempt_nonce_digest[32];
    volatile sw_u16 event_type;
    volatile sw_u16 payload_size;
    volatile sw_u32 flags;
    volatile sw_u64 payload_value;
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
    volatile StarworksEventV1 events[64];
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

/*
 * This is the single function a reviewed, expected-byte-guarded game hook
 * calls once per frame. The target hook address is intentionally not guessed:
 * it must be derived from a lawful RMBE01 base and reviewed before release.
 */
void StarworksBridgeTick(void) {
    volatile StarworksBridgeV1 *bridge =
        (volatile StarworksBridgeV1 *)SW_BRIDGE_ADDRESS;
    volatile StarworksEventV1 *event;

    if (bridge->magic != SW_MAGIC ||
        bridge->protocol_version != SW_PROTOCOL_VERSION) {
        return;
    }

    bridge->heartbeat += 1;
    if (bridge->request_epoch == bridge->acknowledged_epoch) {
        return;
    }

    bridge->producer_sequence = 0;
    bridge->consumer_sequence = 0;
    bridge->dropped_events = 0;
    bridge->state = SW_STATE_ACTIVE;
    StarworksPublishBarrier();
    bridge->acknowledged_epoch = bridge->request_epoch;

    event = &bridge->events[0];
    event->sequence = 0;
    event->frame = bridge->heartbeat;
    StarworksCopyDigest(event->attempt_nonce_digest,
                        bridge->attempt_nonce_digest);
    event->event_type = SW_EVENT_SYNTHETIC;
    event->payload_size = 8;
    event->flags = 0;
    event->payload_value = 1;

    StarworksPublishBarrier();
    event->sequence = 1;
    StarworksPublishBarrier();
    bridge->producer_sequence = 1;
}
