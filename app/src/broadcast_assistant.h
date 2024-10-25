/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef __BROADCAST_ASSISTANT_H__
#define __BROADCAST_ASSISTANT_H__

#include <zephyr/types.h>
#include <zephyr/bluetooth/gap.h>
#include <zephyr/bluetooth/addr.h>
#include <zephyr/bluetooth/audio/audio.h>

#define BT_DATA_RSSI         (BT_DATA_MANUFACTURER_DATA - 1)
#define BT_DATA_SID          (BT_DATA_MANUFACTURER_DATA - 2)
#define BT_DATA_PA_INTERVAL  (BT_DATA_MANUFACTURER_DATA - 3)
#define BT_DATA_ERROR_CODE   (BT_DATA_MANUFACTURER_DATA - 4)
#define BT_DATA_BROADCAST_ID (BT_DATA_MANUFACTURER_DATA - 5)
#define BT_DATA_RPA          (BT_DATA_MANUFACTURER_DATA - 6)
#define BT_DATA_IDENTITY     (BT_DATA_MANUFACTURER_DATA - 7)
#define BT_DATA_BASE         (BT_DATA_MANUFACTURER_DATA - 8)
#define BT_DATA_SOURCE_ID    (BT_DATA_MANUFACTURER_DATA - 9)
#define BT_DATA_BIS_SYNC     (BT_DATA_MANUFACTURER_DATA - 10)
#define BT_DATA_VOLUME       (BT_DATA_MANUFACTURER_DATA - 11)
#define BT_DATA_MUTE         (BT_DATA_MANUFACTURER_DATA - 12)

enum {
	BROADCAST_ASSISTANT_SCAN_TARGET_SOURCE = BIT(0),
	BROADCAST_ASSISTANT_SCAN_TARGET_SINK = BIT(1),
	BROADCAST_ASSISTANT_SCAN_TARGET_ALL =
		(BROADCAST_ASSISTANT_SCAN_TARGET_SOURCE | BROADCAST_ASSISTANT_SCAN_TARGET_SINK)
};

int start_scan(uint8_t target);
int stop_scanning(void);
int connect_to_sink(bt_addr_le_t *bt_addr_le);
int disconnect_from_sink(bt_addr_le_t *bt_addr_le);
int add_source(uint8_t sid, uint16_t pa_interval, uint32_t broadcast_id, bt_addr_le_t *addr,
	       uint8_t num_subgroups, uint32_t *bis_sync);
int remove_source(uint8_t source_id, uint8_t num_subgroups);
int add_broadcast_code(uint8_t src_id, const uint8_t broadcast_code[BT_AUDIO_BROADCAST_CODE_SIZE]);
int set_volume(bt_addr_le_t *bt_addr_le, uint8_t volume);
int set_mute(bt_addr_le_t *bt_addr_le, uint8_t state);
int broadcast_assistant_init(void);
int disconnect_unpair_all(void);

#endif /* __BROADCAST_ASSISTANT_H__ */
