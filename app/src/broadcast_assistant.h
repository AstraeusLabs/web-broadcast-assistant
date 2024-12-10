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
#include <zephyr/bluetooth/audio/csip.h>

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
#define BT_DATA_SIRK         (BT_DATA_MANUFACTURER_DATA - 13)
#define BT_DATA_SET_SIZE     (BT_DATA_MANUFACTURER_DATA - 14)
#define BT_DATA_SET_RANK     (BT_DATA_MANUFACTURER_DATA - 15)

enum {
	BROADCAST_ASSISTANT_SCAN_IDLE = 0,
	BROADCAST_ASSISTANT_SCAN_SOURCE = BIT(0),
	BROADCAST_ASSISTANT_SCAN_SINK = BIT(1),
	BROADCAST_ASSISTANT_SCAN_CSIS = BIT(2),
};

int broadcast_assistant_start_scan(uint8_t mode, uint8_t set_size, uint8_t sirk[BT_CSIP_SIRK_SIZE]);
int broadcast_assistant_stop_scanning(void);
int broadcast_assistant_disconnect_unpair_all(void);
int broadcast_assistant_connect_to_sink(bt_addr_le_t *bt_addr_le);
int broadcast_assistant_disconnect_from_sink(bt_addr_le_t *bt_addr_le);
int broadcast_assistant_add_source(uint8_t sid, uint16_t pa_interval, uint32_t broadcast_id,
				   bt_addr_le_t *addr, uint8_t num_subgroups, uint32_t *bis_sync);
int broadcast_assistant_remove_source(uint8_t source_id, uint8_t num_subgroups);
int broadcast_assistant_add_broadcast_code(
	uint8_t src_id, const uint8_t broadcast_code[BT_AUDIO_BROADCAST_CODE_SIZE]);
int broadcast_assistant_set_volume(bt_addr_le_t *bt_addr_le, uint8_t volume);
int broadcast_assistant_set_mute(bt_addr_le_t *bt_addr_le, uint8_t state);
int broadcast_assistant_reset(void);
int broadcast_assistant_init(void);

#endif /* __BROADCAST_ASSISTANT_H__ */
