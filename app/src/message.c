/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#include <zephyr/types.h>
#include <zephyr/logging/log.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/byteorder.h>
#include <zephyr/net_buf.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/audio/bap.h>
#include <zephyr/bluetooth/audio/vcp.h>

#include "webusb.h"
#include "broadcast_assistant.h"
#include "heartbeat.h"
#include "message.h"

LOG_MODULE_REGISTER(message_handler, LOG_LEVEL_INF);

NET_BUF_POOL_DEFINE(command_tx_msg_pool, CONFIG_TX_MSG_MAX_MESSAGES,
		    sizeof(struct webusb_message) + CONFIG_TX_MSG_MAX_PAYLOAD_LEN, 0, NULL);

#define DEFAULT_PA_SYNC_ATTEMPT 0

struct webusb_ltv_data {
	uint8_t adv_sid;
	uint16_t pa_interval;
	uint32_t broadcast_id;
	bt_addr_le_t addr;
	uint8_t src_id;
	uint8_t volume;
	uint8_t broadcast_code[BT_ISO_BROADCAST_CODE_SIZE];
	uint8_t num_subgroups;
	uint32_t bis_sync[CONFIG_BT_BAP_BASS_MAX_SUBGROUPS];
	uint8_t csis_set_size;
	uint8_t csis_sirk[BT_CSIP_SIRK_SIZE];
	uint8_t pa_sync_attempt;
};

static struct webusb_ltv_data parsed_ltv_data;

static void message_log_ltv(uint8_t *data, uint16_t data_len);
static void message_prepend_header(struct net_buf *buf, enum message_type mtype,
				   enum message_sub_type stype, uint8_t seq_no, uint16_t len);

#define LTV_STR_LEN 1024

static void message_log_ltv(uint8_t *data, uint16_t data_len)
{
	char ltv_str[LTV_STR_LEN] = {0};

	/* Log message payload (ltv format) */
	for (int i = 0; i < data_len;) {
		uint8_t ltv_len = *data++;
		char *ch_ptr = &ltv_str[0];

		/* length */
		sprintf(ch_ptr, "[ L:%02x ", ltv_len);
		ch_ptr += 7;
		if (ltv_len > 0) {
			/* type */
			sprintf(ch_ptr, "T:%02x ", *data++);
			ch_ptr += 5;
			if (ltv_len > 1) {
				/* value */
				for (int j = 1; j < ltv_len; j++) {
					sprintf(ch_ptr, "%02x ", *data++);
					ch_ptr += 3;
				}
			}
		}
		sprintf(ch_ptr, "]");
		ch_ptr += 1;
		i += (ltv_len + 1);

		LOG_DBG("%s", ltv_str);
	}
}

static bool message_ltv_found(struct bt_data *data, void *user_data)
{
	struct webusb_ltv_data *_parsed = (struct webusb_ltv_data *)user_data;

	LOG_DBG("Found LTV structure with type %u, len = %u", data->type, data->data_len);

	switch (data->type) {
	case BT_DATA_SID:
		LOG_DBG("BT_DATA_SID");
		_parsed->adv_sid = data->data[0];
		return true;
	case BT_DATA_PA_INTERVAL:
		_parsed->pa_interval = sys_get_le16(data->data);
		LOG_DBG("BT_DATA_PA_INTERVAL");
		return true;
	case BT_DATA_BROADCAST_ID:
		_parsed->broadcast_id = sys_get_le24(data->data);
		LOG_DBG("BT_DATA_BROADCAST_ID");
		return true;
	case BT_DATA_RPA:
	case BT_DATA_IDENTITY:
		char addr_str[BT_ADDR_LE_STR_LEN];
		_parsed->addr.type = data->data[0];
		memcpy(&_parsed->addr.a, &data->data[1], sizeof(bt_addr_t));
		bt_addr_le_to_str(&_parsed->addr, addr_str, sizeof(addr_str));
		LOG_DBG("Addr: %s", addr_str);
		return true;
	case BT_DATA_SOURCE_ID:
		_parsed->src_id = data->data[0];
		LOG_DBG("src_id: %u", _parsed->src_id);
		return true;
	case BT_DATA_BROADCAST_CODE:
		memcpy(&_parsed->broadcast_code, &data->data[0], BT_ISO_BROADCAST_CODE_SIZE);
		LOG_HEXDUMP_DBG(_parsed->broadcast_code, BT_ISO_BROADCAST_CODE_SIZE,
				"broadcast code:");
		return true;
	case BT_DATA_BIS_SYNC:
		_parsed->num_subgroups = data->data_len / sizeof(_parsed->bis_sync[0]);
		memcpy(&_parsed->bis_sync, &data->data[0], data->data_len);
		LOG_HEXDUMP_DBG(_parsed->bis_sync, data->data_len, "bis_sync:");
		return true;
	case BT_DATA_VOLUME:
		_parsed->volume = data->data[0];
		LOG_DBG("volume: %u", _parsed->src_id);
		return true;
	case BT_DATA_SIRK:
		memcpy(&_parsed->csis_sirk, &data->data[0], BT_CSIP_SIRK_SIZE);
		LOG_HEXDUMP_DBG(_parsed->csis_sirk, BT_CSIP_SIRK_SIZE, "sirk:");
		return true;
	case BT_DATA_SET_SIZE:
		_parsed->csis_set_size = data->data[0];
		LOG_DBG("CSIS set size: %u", _parsed->csis_set_size);
		return true;
	case BT_DATA_PA_SYNC_ATTEMPT:
		_parsed->pa_sync_attempt = data->data[0];
		LOG_DBG("PA sync attemp: %u", _parsed->pa_sync_attempt);
		return true;
	default:
		LOG_DBG("Unknown type");
	}

	return false;
}

static void message_prepend_header(struct net_buf *buf, enum message_type mtype,
				   enum message_sub_type stype, uint8_t seq_no, uint16_t len)
{
	net_buf_push_le16(buf, len);
	net_buf_push_u8(buf, seq_no);
	net_buf_push_u8(buf, stype);
	net_buf_push_u8(buf, mtype);
}

struct net_buf* message_alloc_tx(void)
{
	struct net_buf *tx_net_buf;

	tx_net_buf = net_buf_alloc(&command_tx_msg_pool, K_NO_WAIT);
	if (!tx_net_buf) {
		return NULL;
	}

	// Reserve headroom for the webusb msg header
	net_buf_reserve(tx_net_buf, sizeof(struct webusb_message));

	return tx_net_buf;
}

void message_send_no_paylod(enum message_type mtype, enum message_sub_type stype, uint8_t seq_no)
{
	struct net_buf *tx_net_buf;
	int ret;

	tx_net_buf = message_alloc_tx();
	if (!tx_net_buf) {
		LOG_ERR("Failed to allocate net_buf");
	}

	message_prepend_header(tx_net_buf, mtype, stype, seq_no, 0);
	message_log_ltv(&tx_net_buf->data[0], tx_net_buf->len);

	ret = webusb_transmit(tx_net_buf);
	if (ret != 0) {
		LOG_ERR("Failed to send message (err=%d)", ret);
	}
}

void message_send_return_code(enum message_type mtype, enum message_sub_type stype, uint8_t seq_no,
			      int32_t rc)
{
	struct net_buf *tx_net_buf;
	uint16_t msg_payload_length;
	int ret;

	LOG_INF("send simple message(%d, %d, %u, %d)", mtype, stype, seq_no, rc);

	tx_net_buf = message_alloc_tx();
	if (!tx_net_buf) {
		LOG_ERR("Failed to allocate net_buf");
	}

	/* Append error code payload */
	net_buf_add_u8(tx_net_buf, 5);
	net_buf_add_u8(tx_net_buf, BT_DATA_ERROR_CODE);
	net_buf_add_le32(tx_net_buf, rc);
	msg_payload_length = tx_net_buf->len;

	message_prepend_header(tx_net_buf, mtype, stype, seq_no, msg_payload_length);
	message_log_ltv(&tx_net_buf->data[0], tx_net_buf->len);

	ret = webusb_transmit(tx_net_buf);
	if (ret != 0) {
		LOG_ERR("Failed to send message (err=%d)", ret);
	}
}

void message_send_net_buf_event(enum message_sub_type stype, struct net_buf *tx_net_buf)
{
	int ret;

	message_prepend_header(tx_net_buf, MESSAGE_TYPE_EVT, stype, 0, tx_net_buf->len);
	message_log_ltv(&tx_net_buf->data[0], tx_net_buf->len);

	LOG_DBG("send_net_buf_event(stype: %d, len: %zu)", stype, tx_net_buf->len);

	ret = webusb_transmit(tx_net_buf);
	if (ret != 0) {
		LOG_ERR("Failed to send message (err=%d)", ret);
	}
}

void message_handler(struct webusb_message *msg_ptr, uint16_t msg_length)
{
	if (msg_ptr == NULL) {
		LOG_ERR("Null msg_ptr");
		return;
	}

	/*uint8_t msg_type = msg_ptr->type;*/
	uint8_t msg_sub_type = msg_ptr->sub_type;
	uint8_t msg_seq_no = msg_ptr->seq_no;
	int32_t msg_rc = 0;
	struct net_buf_simple msg_net_buf;

	msg_net_buf.data = msg_ptr->payload;
	msg_net_buf.len = msg_ptr->length;
	msg_net_buf.size = CONFIG_TX_MSG_MAX_PAYLOAD_LEN;
	msg_net_buf.__buf = msg_ptr->payload;

	memset(&parsed_ltv_data, 0, sizeof(parsed_ltv_data));
	parsed_ltv_data.pa_sync_attempt = DEFAULT_PA_SYNC_ATTEMPT;
	bt_data_parse(&msg_net_buf, message_ltv_found, (void *)&parsed_ltv_data);

	switch (msg_sub_type) {
	case MESSAGE_SUBTYPE_HEARTBEAT:
		/* Toogle heartbeat mode */
		heartbeat_toggle();
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_HEARTBEAT, msg_seq_no,
					 0);
		break;

	case MESSAGE_SUBTYPE_START_SINK_SCAN:
		LOG_DBG("START_SINK_SCAN (len %u)", msg_length);
		msg_rc = broadcast_assistant_start_scan(BROADCAST_ASSISTANT_SCAN_SINK,
							0 /* not used*/, 0 /* not used*/,
							0 /* not used*/);
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_START_SINK_SCAN,
					 msg_seq_no, msg_rc);
		break;

	case MESSAGE_SUBTYPE_START_SOURCE_SCAN:
		LOG_DBG("START_SOURCE_SCAN (len %u)", msg_length);
		msg_rc = broadcast_assistant_start_scan(BROADCAST_ASSISTANT_SCAN_SOURCE,
							0 /* not used*/, 0 /* not used*/,
							parsed_ltv_data.pa_sync_attempt);
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_START_SOURCE_SCAN,
					 msg_seq_no, msg_rc);
		break;

	case MESSAGE_SUBTYPE_START_ALL_SCAN:
		LOG_DBG("START_ALL_SCAN (len %u)", msg_length);
		/* Currently not supported */
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_START_ALL_SCAN,
					 msg_seq_no, -1);
		break;

	case MESSAGE_SUBTYPE_START_CSIS_SCAN:
		LOG_DBG("START_CSIS_SCAN (len %u)", msg_length);
		msg_rc = broadcast_assistant_start_scan(BROADCAST_ASSISTANT_SCAN_CSIS,
							parsed_ltv_data.csis_set_size,
							parsed_ltv_data.csis_sirk, 0 /* not used*/);
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_START_CSIS_SCAN,
					 msg_seq_no, msg_rc);
		break;

	case MESSAGE_SUBTYPE_STOP_SCAN:
		LOG_DBG("STOP_SCAN");
		msg_rc = broadcast_assistant_stop_scanning();
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_STOP_SCAN, msg_seq_no,
					 msg_rc);
		break;

	case MESSAGE_SUBTYPE_CONNECT_SINK:
		LOG_DBG("CONNECT_SINK (len %u)", msg_length);
		msg_rc = broadcast_assistant_connect_to_sink(&parsed_ltv_data.addr);
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_CONNECT_SINK, msg_seq_no,
					 msg_rc);
		break;

	case MESSAGE_SUBTYPE_DISCONNECT_SINK:
		LOG_DBG("DISCONNECT_SINK (len %u)", msg_length);
		msg_rc = broadcast_assistant_disconnect_from_sink(&parsed_ltv_data.addr);
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_DISCONNECT_SINK,
					 msg_seq_no, msg_rc);
		break;

	case MESSAGE_SUBTYPE_ADD_SOURCE:
		LOG_DBG("ADD_SOURCE (len %u)", msg_length);
		msg_rc = broadcast_assistant_add_source(
			parsed_ltv_data.adv_sid, parsed_ltv_data.pa_interval,
			parsed_ltv_data.broadcast_id, &parsed_ltv_data.addr,
			parsed_ltv_data.num_subgroups, parsed_ltv_data.bis_sync);
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_ADD_SOURCE, msg_seq_no,
					 msg_rc);
		break;

	case MESSAGE_SUBTYPE_PA_SYNC:
		LOG_DBG("PA_SYNC (len %u)", msg_length);
		msg_rc = broadcast_assistant_pa_sync(&parsed_ltv_data.addr, parsed_ltv_data.adv_sid,
						     parsed_ltv_data.pa_interval);
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_PA_SYNC, msg_seq_no,
					 msg_rc);
		break;

	case MESSAGE_SUBTYPE_REMOVE_SOURCE:
		LOG_DBG("REMOVE_SOURCE (len %u)", msg_length);
		msg_rc = broadcast_assistant_remove_source(parsed_ltv_data.src_id,
							   parsed_ltv_data.num_subgroups);
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_REMOVE_SOURCE,
					 msg_seq_no, msg_rc);
		break;

	case MESSAGE_SUBTYPE_BIG_BCODE:
		LOG_DBG("BIG_BCODE (len %u)", msg_length);
		msg_rc = broadcast_assistant_add_broadcast_code(parsed_ltv_data.src_id,
								parsed_ltv_data.broadcast_code);
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_BIG_BCODE, msg_seq_no,
					 msg_rc);
		break;

	case MESSAGE_SUBTYPE_SET_VOLUME:
		LOG_DBG("SET_VOLUME (vol %u, len %u)", parsed_ltv_data.volume, msg_length);
		msg_rc = broadcast_assistant_set_volume(&parsed_ltv_data.addr,
							parsed_ltv_data.volume);
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_SET_VOLUME, msg_seq_no,
					 msg_rc);
		break;

	case MESSAGE_SUBTYPE_MUTE:
		LOG_DBG("MUTE (len %u)", msg_length);
		msg_rc = broadcast_assistant_set_mute(&parsed_ltv_data.addr, BT_VCP_STATE_MUTED);
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_MUTE, msg_seq_no,
					 msg_rc);
		break;

	case MESSAGE_SUBTYPE_UNMUTE:
		LOG_DBG("UNMUTE (len %u)", msg_length);
		msg_rc = broadcast_assistant_set_mute(&parsed_ltv_data.addr, BT_VCP_STATE_UNMUTED);
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_UNMUTE, msg_seq_no,
					 msg_rc);
		break;

	case MESSAGE_SUBTYPE_RESET:
		LOG_DBG("RESET (len %u)", msg_length);
		msg_rc = broadcast_assistant_reset();
		message_send_return_code(MESSAGE_TYPE_RES, MESSAGE_SUBTYPE_RESET, msg_seq_no,
					 msg_rc);
		heartbeat_stop(); // Stop heartbeat if active
		break;

	default:
		// Unrecognized message
		message_send_return_code(MESSAGE_TYPE_RES, msg_sub_type, msg_seq_no, -1);
		break;
	}
}
