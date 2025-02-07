/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/audio/audio.h>
#include <zephyr/bluetooth/audio/bap.h>
#include <zephyr/bluetooth/audio/vcp.h>
#include <zephyr/bluetooth/audio/csip.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/byteorder.h>

#include "webusb.h"
#include "message.h"
#include "broadcast_assistant.h"

#include "host/conn_internal.h"
#include "host/hci_core.h"

LOG_MODULE_REGISTER(broadcast_assistant, LOG_LEVEL_INF);

#define BT_NAME_LEN 30
#define INVALID_BROADCAST_ID 0xFFFFFFFFU
#define BIG_SYNC_FAILED 0xFFFFFFFFU

#define PA_SYNC_SKIP                      5
#define PA_SYNC_INTERVAL_TO_TIMEOUT_RATIO 20 /* Set the timeout relative to interval */

#define MAX_NUMBER_OF_SOURCES 50

typedef struct add_broadcast_code_data {
	uint8_t src_id;
	uint8_t broadcast_code[BT_ISO_BROADCAST_CODE_SIZE];
} add_broadcast_code_data_t;

typedef struct source_data {
	bt_addr_le_t addr;
	uint8_t pa_attempt_cd; /* Periodic advertising sync countdown */
} source_data_t;

typedef struct source_data_list {
	uint8_t num;
	uint8_t pa_attempt;
	source_data_t data[MAX_NUMBER_OF_SOURCES];
} source_data_list_t;

source_data_list_t source_data_list;
struct scan_recv_data {
	char bt_name[BT_NAME_LEN];
	uint8_t bt_name_type;
	char broadcast_name[BT_NAME_LEN];
	uint32_t broadcast_id;
	bool set_member;
	bool has_bass;
	bool has_pacs;
	bool has_csis;
};

typedef struct past_available_data {
	uint8_t sid;
	const bt_addr_le_t *addr;
	bool result;
} past_available_data_t;

static bt_addr_le_t csis_members[CONFIG_BT_MAX_CONN];
static uint8_t csis_members_cnt;
static uint8_t csis_set_size;
static uint8_t csis_sirk[BT_CSIP_SIRK_SIZE];

static struct k_mutex source_data_list_mutex;
static struct bt_le_per_adv_sync *pa_sync = NULL;
static volatile bool pa_sync_transfer;

static K_SEM_DEFINE(sem_rem_source, 1U, 1U);
static K_SEM_DEFINE(sem_add_source, 1U, 1U);
static K_SEM_DEFINE(sem_pa_sync, 0U, 1U);

static void broadcast_assistant_discover_cb(struct bt_conn *conn, int err,
					    uint8_t recv_state_count);
static void broadcast_assistant_recv_state_cb(struct bt_conn *conn, int err,
					      const struct bt_bap_scan_delegator_recv_state *state);
static void broadcast_assistant_recv_state_removed_cb(struct bt_conn *conn, uint8_t src_id);
static void broadcast_assistant_add_src_cb(struct bt_conn *conn, int err);
static void broadcast_assistant_mod_src_cb(struct bt_conn *conn, int err);
static void broadcast_assistant_rem_src_cb(struct bt_conn *conn, int err);
static void connected_cb(struct bt_conn *conn, uint8_t err);
static void disconnected_cb(struct bt_conn *conn, uint8_t reason);
static void security_changed_cb(struct bt_conn *conn, bt_security_t level,
				enum bt_security_err err);
static void identity_resolved_cb(struct bt_conn *conn,
				 const bt_addr_le_t *rpa,
				 const bt_addr_le_t *identity);
static void restart_scanning_if_needed(void);
static bool device_found(struct bt_data *data, void *user_data);
static bool scan_for_source(const struct bt_le_scan_recv_info *info, struct net_buf_simple *ad,
			    struct scan_recv_data *sr_data);
static bool scan_for_sink(const struct bt_le_scan_recv_info *info, struct net_buf_simple *ad,
			  struct scan_recv_data *sr_data);
static void scan_recv_cb(const struct bt_le_scan_recv_info *info, struct net_buf_simple *ad);
static void scan_timeout_cb(void);

/* Volume control */
static void vcs_discover_cb(struct bt_vcp_vol_ctlr *vol_ctlr, int err, uint8_t vocs_count, uint8_t aics_count);
static void vcs_write_cb(struct bt_vcp_vol_ctlr *vol_ctlr, int err);
static void vcs_state_cb(struct bt_vcp_vol_ctlr *vol_ctlr, int err, uint8_t volume, uint8_t mute);
static void vcs_flags_cb(struct bt_vcp_vol_ctlr *vol_ctlr, int err, uint8_t flags);
static void vcs_discover_work_handler(struct k_work *work);

/* CSIS */
static void csip_lock_set_cb(int err);
static void csip_release_set_cb(int err);
static void csip_discover_cb(struct bt_conn *conn,
			     const struct bt_csip_set_coordinator_set_member *member, int err,
			     size_t set_count);
static void csip_ordered_access_cb(const struct bt_csip_set_coordinator_set_info *set_info, int err,
				  bool locked, struct bt_csip_set_coordinator_set_member *member);
static void csis_discover_work_handler(struct k_work *work);

static void pa_sync_delete(void);
static void pa_sync_delete_work_handler(struct k_work *work);
static void pa_sync_create_timer_handler(struct k_timer *dummy);
static void reset_csis_data(uint8_t set_size, uint8_t sirk[BT_CSIP_SIRK_SIZE]);

static struct bt_le_scan_cb scan_callbacks = {
	.recv = scan_recv_cb,
	.timeout = scan_timeout_cb,
};

static struct bt_bap_broadcast_assistant_cb broadcast_assistant_callbacks = {
	.discover = broadcast_assistant_discover_cb,
	.recv_state = broadcast_assistant_recv_state_cb,
	.recv_state_removed = broadcast_assistant_recv_state_removed_cb,
	.add_src = broadcast_assistant_add_src_cb,
	.mod_src = broadcast_assistant_mod_src_cb,
	.rem_src = broadcast_assistant_rem_src_cb,
};

BT_CONN_CB_DEFINE(conn_callbacks) = {
	.connected = connected_cb,
	.disconnected = disconnected_cb,
	.security_changed = security_changed_cb,
	.identity_resolved = identity_resolved_cb
};

static struct bt_vcp_vol_ctlr_cb vcp_callbacks = {
	.discover = vcs_discover_cb,
	.vol_down = vcs_write_cb,
	.vol_up = vcs_write_cb,
	.mute = vcs_write_cb,
	.unmute = vcs_write_cb,
	.vol_down_unmute = vcs_write_cb,
	.vol_up_unmute = vcs_write_cb,
	.vol_set = vcs_write_cb,
	.state = vcs_state_cb,
	.flags = vcs_flags_cb,
};

static struct bt_csip_set_coordinator_cb csip_callbacks = {
	.lock_set = csip_lock_set_cb,
	.release_set = csip_release_set_cb,
	.discover = csip_discover_cb,
	.ordered_access = csip_ordered_access_cb,
};

static uint8_t ba_scan_mode;
static uint32_t ba_source_broadcast_id;
static uint8_t ba_source_id; /* Source ID of the receive state */
static struct bt_bap_scan_delegator_recv_state ba_recv_state[CONFIG_BT_MAX_CONN] = {0};
static struct bt_vcp_vol_ctlr *vcs_ctlr;
static struct bt_conn *vcs_conn;
static struct bt_conn *csis_conn;


K_WORK_DEFINE(vcs_discover_work, vcs_discover_work_handler);
K_WORK_DEFINE(csis_discover_work, csis_discover_work_handler);
K_WORK_DEFINE(pa_sync_delete_work, pa_sync_delete_work_handler);

K_TIMER_DEFINE(pa_sync_create_timer, pa_sync_create_timer_handler, NULL);

/*
 * Private functions
 */
static void pa_sync_delete_work_handler(struct k_work *work)
{
	int err;

	if (pa_sync == NULL) {
		LOG_INF("No PA sync to delete");

		return;
	}

	LOG_INF("PA sync delete");
	err = bt_le_per_adv_sync_delete(pa_sync);
	if (err) {
		LOG_ERR("bt_le_per_adv_sync_delete failed (%d)", err);
	} else {
		pa_sync = NULL;
	}
}

static void vcs_discover_work_handler(struct k_work *work)
{
	int err;

	LOG_INF("VCS discover...");
	err = bt_vcp_vol_ctlr_discover(vcs_conn, &vcs_ctlr);
	if (err != 0) {
		LOG_ERR("Failed to discover vcs (err %d)", err);
		vcs_conn = NULL;
	}
}

static void csis_discover_work_handler(struct k_work *work)
{
	int err;

	LOG_INF("CSIS discover...");
	err = bt_csip_set_coordinator_discover(csis_conn);
	if (err != 0) {
		LOG_ERR("bt_csip_set_coordinator_discover failed (err %d)", err);
		csis_conn = NULL;
	}
}

static void pa_sync_create_timer_handler(struct k_timer *dummy)
{
	LOG_WRN("PA sync create timeout");

	/* PA sync create timeout => Delete PA sync */
	k_work_submit(&pa_sync_delete_work);
	k_sem_give(&sem_pa_sync);
}

static void reset_source_data(uint8_t pa_attempt)
{
	k_mutex_lock(&source_data_list_mutex, K_FOREVER);
	for (int i = 0; i < MAX_NUMBER_OF_SOURCES; i++) {
		bt_addr_le_copy(&source_data_list.data[i].addr, BT_ADDR_LE_NONE);
		source_data_list.data[source_data_list.num].pa_attempt_cd = 0;
	}

	source_data_list.num = 0;
	source_data_list.pa_attempt = pa_attempt;
	k_mutex_unlock(&source_data_list_mutex);
}

static source_data_t *source_data_get(const bt_addr_le_t *addr)
{
	source_data_t *source_data = NULL;

	k_mutex_lock(&source_data_list_mutex, K_FOREVER);
	for (int i = 0; i < source_data_list.num; i++) {
		if (bt_addr_le_cmp(addr, &source_data_list.data[i].addr) == 0) {
			source_data = &source_data_list.data[i];
			break;
		}
	}

	k_mutex_unlock(&source_data_list_mutex);

	return source_data;
}

static source_data_t *source_data_add(const bt_addr_le_t *addr, uint8_t sid, uint32_t interval)
{
	source_data_t *source_data = NULL;

	if (source_data_list.num < MAX_NUMBER_OF_SOURCES) {
		char addr_str[BT_ADDR_LE_STR_LEN];

		bt_addr_le_to_str(addr, addr_str, sizeof(addr_str));

		k_mutex_lock(&source_data_list_mutex, K_FOREVER);
		bt_addr_le_copy(&source_data_list.data[source_data_list.num].addr, addr);
		source_data_list.data[source_data_list.num].pa_attempt_cd =
			source_data_list.pa_attempt;

		LOG_INF("Source added (%s), (%u)", addr_str, source_data_list.num);
		source_data = &source_data_list.data[source_data_list.num];

		source_data_list.num++;
		k_mutex_unlock(&source_data_list_mutex);
	}

	return source_data;
}

static void source_data_clr_pa_attempt_cd(const bt_addr_le_t *addr)
{
	k_mutex_lock(&source_data_list_mutex, K_FOREVER);
	for (int i = 0; i < source_data_list.num; i++) {
		if (bt_addr_le_cmp(addr, &source_data_list.data[i].addr) == 0) {
			source_data_list.data[i].pa_attempt_cd = 0;
			break;
		}
	}
	k_mutex_unlock(&source_data_list_mutex);
}

static void broadcast_assistant_discover_cb(struct bt_conn *conn, int err, uint8_t recv_state_count)
{
	const bt_addr_le_t *bt_addr_le;
	char addr_str[BT_ADDR_LE_STR_LEN];
	struct net_buf *evt_msg;

	LOG_INF("Broadcast assistant discover callback (%p, %d, %u)", (void *)conn, err, recv_state_count);
	if (err) {
		err = bt_conn_disconnect(conn, BT_HCI_ERR_REMOTE_USER_TERM_CONN);
		if (err) {
			LOG_ERR("Failed to disconnect (err %d)", err);
		}
		restart_scanning_if_needed();

		return; /* return and wait for disconnected callback (assume no err) */
	}

	/* Succesful connected to sink */
	evt_msg = message_alloc_tx();
	bt_addr_le = bt_conn_get_dst(conn);
	bt_addr_le_to_str(bt_addr_le, addr_str, sizeof(addr_str));
	LOG_DBG("Connected to %s", addr_str);

	/* Bluetooth LE Device Address */
	net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
	net_buf_add_u8(evt_msg, bt_addr_le_is_identity(bt_addr_le) ? BT_DATA_IDENTITY : BT_DATA_RPA);
	net_buf_add_u8(evt_msg, bt_addr_le->type);
	net_buf_add_mem(evt_msg, &bt_addr_le->a, sizeof(bt_addr_t));

	/* error code */
	net_buf_add_u8(evt_msg, 1 /* len of BT_DATA type */ + sizeof(int32_t));
	net_buf_add_u8(evt_msg, BT_DATA_ERROR_CODE);
	net_buf_add_le32(evt_msg, 0 /* OK */);

	message_send_net_buf_event(MESSAGE_SUBTYPE_SINK_CONNECTED, evt_msg);

	/* Discover VCS */
	if (vcs_conn == NULL) {
		vcs_conn = conn;
		k_work_submit(&vcs_discover_work);
	}

	/* Discover CSIS */
	if (csis_conn == NULL) {
		csis_conn = conn;
		k_work_submit(&csis_discover_work);
	}

	restart_scanning_if_needed();
}

static void vcs_discover_cb(struct bt_vcp_vol_ctlr *vol_ctlr, int err, uint8_t vocs_count,
			    uint8_t aics_count)
{
	const bt_addr_le_t *bt_addr_le;
	char addr_str[BT_ADDR_LE_STR_LEN];
	struct net_buf *evt_msg;
	struct bt_conn *conn;

	if (err != 0) {
		LOG_WRN("Volume control service could not be discovered (%d)", err);
		vcs_conn = NULL;

		return;
	}

	if (bt_vcp_vol_ctlr_conn_get(vol_ctlr, &conn) != 0) {
		LOG_ERR("Volume control conn error\n");
		vcs_conn = NULL;

		return;
	}

	LOG_INF("Volume control discover callback (vocs:%u, aics:%u)", vocs_count, aics_count);

	/* Send volume control status message */
	evt_msg = message_alloc_tx();
	bt_addr_le = bt_conn_get_dst(conn);
	bt_addr_le_to_str(bt_addr_le, addr_str, sizeof(addr_str));
	LOG_DBG("Volume discover %s", addr_str);

	/* Bluetooth LE Device Address */
	net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
	net_buf_add_u8(evt_msg,
		       bt_addr_le_is_identity(bt_addr_le) ? BT_DATA_IDENTITY : BT_DATA_RPA);
	net_buf_add_u8(evt_msg, bt_addr_le->type);
	net_buf_add_mem(evt_msg, &bt_addr_le->a, sizeof(bt_addr_t));

	message_send_net_buf_event(MESSAGE_SUBTYPE_VOLUME_CONTROL_FOUND, evt_msg);

	vcs_conn = NULL;
}

static void vcs_write_cb(struct bt_vcp_vol_ctlr *vol_ctlr, int err)
{
	if (err != 0) {
		LOG_WRN("VCP: Write failed (%d)\n", err);
		return;
	}
}

static void vcs_state_cb(struct bt_vcp_vol_ctlr *vol_ctlr, int err, uint8_t volume, uint8_t mute)
{
	const bt_addr_le_t *bt_addr_le;
	char addr_str[BT_ADDR_LE_STR_LEN];
	struct net_buf *evt_msg;
	struct bt_conn *conn;

	LOG_INF("Volume control status: Err %d, Volume %u, mute %u", err, volume, mute);

	if (bt_vcp_vol_ctlr_conn_get(vol_ctlr, &conn) != 0) {
		LOG_ERR("Volume control conn error\n");

		return;
	}

	/* Send volume control status message */
	evt_msg = message_alloc_tx();
	bt_addr_le = bt_conn_get_dst(conn);
	bt_addr_le_to_str(bt_addr_le, addr_str, sizeof(addr_str));
	LOG_DBG("Volume status from %s", addr_str);

	/* Bluetooth LE Device Address */
	net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
	net_buf_add_u8(evt_msg,
		       bt_addr_le_is_identity(bt_addr_le) ? BT_DATA_IDENTITY : BT_DATA_RPA);
	net_buf_add_u8(evt_msg, bt_addr_le->type);
	net_buf_add_mem(evt_msg, &bt_addr_le->a, sizeof(bt_addr_t));

	/* volume */
	net_buf_add_u8(evt_msg, 2);
	net_buf_add_u8(evt_msg, BT_DATA_VOLUME);
	net_buf_add_u8(evt_msg, volume);

	/* mute */
	net_buf_add_u8(evt_msg, 2);
	net_buf_add_u8(evt_msg, BT_DATA_MUTE);
	net_buf_add_u8(evt_msg, mute);

	/* error code */
	net_buf_add_u8(evt_msg, 1 /* len of BT_DATA type */ + sizeof(int32_t));
	net_buf_add_u8(evt_msg, BT_DATA_ERROR_CODE);
	net_buf_add_le32(evt_msg, err);

	message_send_net_buf_event(MESSAGE_SUBTYPE_VOLUME_STATE, evt_msg);
}

static void vcs_flags_cb(struct bt_vcp_vol_ctlr *vol_ctlr, int err, uint8_t flags)
{
	if (err != 0) {
		LOG_WRN("Volume control flags cb err (%d)", err);
		return;
	}

	LOG_INF("Volume control flags 0x%02X", flags);
}

static bool csis_member_is_discovered(const bt_addr_le_t *addr)
{
	for (int i = 0; i < csis_members_cnt; i++) {
		if (bt_addr_le_eq(addr, &csis_members[i])) {

			return true;
		}
	}

	return false;
}

static bool csis_member_found(struct bt_data *data, void *user_data)
{
	if (bt_csip_set_coordinator_is_set_member(csis_sirk, data)) {
		struct scan_recv_data *sr_data = (struct scan_recv_data *)user_data;

		sr_data->set_member = true;

		return false; /* Stop parsing */
	}

	return true; /* Continue parsing */
}

static void csip_lock_set_cb(int err)
{
	if (err != 0) {
		LOG_ERR("Lock sets failed (%d)", err);
		return;
	}

	LOG_INF("Set locked");
}

static void csip_release_set_cb(int err)
{
	if (err != 0) {
		LOG_ERR("Lock sets failed (%d)", err);
		return;
	}

	LOG_INF("Set released");
}

static void csip_discover_cb(struct bt_conn *conn,
			     const struct bt_csip_set_coordinator_set_member *member,
			     int err, size_t set_count)
{
	struct net_buf *evt_msg;
	char addr_str[BT_ADDR_LE_STR_LEN];
	const bt_addr_le_t *bt_addr_le;

	if (err != 0) {
		LOG_ERR("Coordinated Set Identification could not be discovered (%d)", err);
		csis_conn = NULL;

		return;
	}

	if (set_count == 0) {
		LOG_WRN("Device has no sets");
		csis_conn = NULL;

		return;
	}

	LOG_INF("Found %zu sets on member[%u]", set_count, bt_conn_index(conn));

	for (size_t i = 0U; i < set_count; i++) {
		LOG_INF("CSIS[%zu]: %p", i, &member->insts[i]);
		LOG_INF("Rank: %u", member->insts[i].info.rank);
		LOG_INF("Set Size: %u", member->insts[i].info.set_size);
		LOG_INF("Lockable: %u", member->insts[i].info.lockable);
		LOG_HEXDUMP_INF(member->insts[i].info.sirk, BT_CSIP_SIRK_SIZE, "Sirk: ");
	}

	/* Send send set identifier found message */
	evt_msg = message_alloc_tx();
	bt_addr_le = bt_conn_get_dst(conn);
	bt_addr_le_to_str(bt_addr_le, addr_str, sizeof(addr_str));
	LOG_DBG("Set identifier identifier from %s, rank %u, size %u",
		addr_str, member->insts[0].info.rank, member->insts[0].info.set_size);

	/* Bluetooth LE Device Address */
	net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
	net_buf_add_u8(evt_msg,
		       bt_addr_le_is_identity(bt_addr_le) ? BT_DATA_IDENTITY : BT_DATA_RPA);
	net_buf_add_u8(evt_msg, bt_addr_le->type);
	net_buf_add_mem(evt_msg, &bt_addr_le->a, sizeof(bt_addr_t));

	/* rank */
	net_buf_add_u8(evt_msg, 2);
	net_buf_add_u8(evt_msg, BT_DATA_SET_RANK);
	net_buf_add_u8(evt_msg, member->insts[0].info.rank);

	/* set_size */
	net_buf_add_u8(evt_msg, 2);
	net_buf_add_u8(evt_msg, BT_DATA_SET_SIZE);
	net_buf_add_u8(evt_msg, member->insts[0].info.set_size);

	/* sirk */
	net_buf_add_u8(evt_msg, 1 + BT_CSIP_SIRK_SIZE);
	net_buf_add_u8(evt_msg, BT_DATA_SIRK);
	net_buf_add_mem(evt_msg, member->insts[0].info.sirk, BT_CSIP_SIRK_SIZE);

	message_send_net_buf_event(MESSAGE_SUBTYPE_SET_IDENTIFIER_FOUND, evt_msg);

	csis_conn = NULL;
}

static void csip_ordered_access_cb(
	const struct bt_csip_set_coordinator_set_info *set_info, int err,
	bool locked, struct bt_csip_set_coordinator_set_member *member)
{
	if (err) {
		LOG_ERR("Ordered access failed with err %d", err);
	} else if (locked) {
		LOG_WRN("Cannot do ordered access as member %p is locked", member);
	} else {
		LOG_INF("Ordered access procedure finished");
	}
}

static void broadcast_assistant_recv_state_cb(struct bt_conn *conn, int err,
			   const struct bt_bap_scan_delegator_recv_state *state)
{
	struct net_buf *evt_msg;
	enum message_sub_type evt_msg_sub_type;
	const bt_addr_le_t *bt_addr_le;
	bool bis_synced;
	bool bis_sync_changed;

	uint8_t conn_index = bt_conn_index(conn);

	LOG_INF("Broadcast assistant recv_state callback (%p (%u), %d, %u)", (void *)conn,
		conn_index, err, state->src_id);

	if (state->encrypt_state != ba_recv_state[conn_index].encrypt_state) {
		LOG_INF("Going from encrypt state %u to %u",
			ba_recv_state[conn_index].encrypt_state, state->encrypt_state);

		switch (state->encrypt_state) {
		case BT_BAP_BIG_ENC_STATE_NO_ENC:
			LOG_INF("The Broadcast Isochronous Group not encrypted");
			evt_msg_sub_type = MESSAGE_SUBTYPE_NEW_ENC_STATE_NO_ENC;
			break;
		case BT_BAP_BIG_ENC_STATE_BCODE_REQ:
			LOG_INF("The Broadcast Isochronous Group broadcast code requested");
			evt_msg_sub_type = MESSAGE_SUBTYPE_NEW_ENC_STATE_BCODE_REQ;
			break;
		case BT_BAP_BIG_ENC_STATE_DEC:
			LOG_INF("The Broadcast Isochronous Group decrypted");
			evt_msg_sub_type = MESSAGE_SUBTYPE_NEW_ENC_STATE_DEC;
			break;
		case BT_BAP_BIG_ENC_STATE_BAD_CODE:
			LOG_INF("The Broadcast Isochronous Group bad broadcast code");
			evt_msg_sub_type = MESSAGE_SUBTYPE_NEW_ENC_STATE_BAD_CODE;
			LOG_HEXDUMP_INF(state->bad_code, BT_ISO_BROADCAST_CODE_SIZE,
					"bad broadcast code:");
			break;
		default:
			LOG_ERR("Invalid State Transition");
			return;
		}

		evt_msg = message_alloc_tx();

		/* Bluetooth LE Device Address */
		bt_addr_le = bt_conn_get_dst(conn);
		net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
		net_buf_add_u8(evt_msg, bt_addr_le_is_identity(bt_addr_le) ? BT_DATA_IDENTITY : BT_DATA_RPA);
		net_buf_add_u8(evt_msg, bt_addr_le->type);
		net_buf_add_mem(evt_msg, &bt_addr_le->a, sizeof(bt_addr_t));

		/* source id */
		net_buf_add_u8(evt_msg, 2);
		net_buf_add_u8(evt_msg, BT_DATA_SOURCE_ID);
		net_buf_add_u8(evt_msg, state->src_id);

		message_send_net_buf_event(evt_msg_sub_type, evt_msg);
	}

	if (state->pa_sync_state != ba_recv_state[conn_index].pa_sync_state) {
		LOG_INF("Going from PA state %u to %u", ba_recv_state[conn_index].pa_sync_state,
			state->pa_sync_state);

		switch (state->pa_sync_state) {
		case BT_BAP_PA_STATE_NOT_SYNCED:
			LOG_INF("BT_BAP_PA_STATE_NOT_SYNCED");
			evt_msg_sub_type = MESSAGE_SUBTYPE_NEW_PA_STATE_NOT_SYNCED;
			break;
		case BT_BAP_PA_STATE_INFO_REQ:
			LOG_INF("BT_BAP_PA_STATE_INFO_REQ");
			evt_msg_sub_type = MESSAGE_SUBTYPE_NEW_PA_STATE_INFO_REQ;
			if (pa_sync && IS_ENABLED(CONFIG_BT_PER_ADV_SYNC_TRANSFER_SENDER)) {
				LOG_INF("Transfer PA sync");
				err = bt_le_per_adv_sync_transfer(pa_sync, conn, BT_UUID_BASS_VAL);
				if (err != 0) {
					LOG_ERR("Could not transfer periodic adv sync: %d", err);
				}
			}
			break;
		case BT_BAP_PA_STATE_SYNCED:
			LOG_INF("BT_BAP_PA_STATE_SYNCED (src_id = %u)", state->src_id);
			evt_msg_sub_type = MESSAGE_SUBTYPE_NEW_PA_STATE_SYNCED;
			if (pa_sync_transfer) {
				pa_sync_delete(); /* delete pa sync if needed */
				pa_sync_transfer = false;
			}
			break;
		case BT_BAP_PA_STATE_FAILED:
			LOG_INF("BT_BAP_PA_STATE_FAILED");
			evt_msg_sub_type = MESSAGE_SUBTYPE_NEW_PA_STATE_FAILED;
			break;
		case BT_BAP_PA_STATE_NO_PAST:
			LOG_INF("BT_BAP_PA_STATE_NO_PAST");
			evt_msg_sub_type = MESSAGE_SUBTYPE_NEW_PA_STATE_NO_PAST;
			if (pa_sync_transfer) {
				pa_sync_delete(); /* delete pa sync if needed */
				pa_sync_transfer = false;
			}
			break;
		default:
			LOG_ERR("Invalid State Transition");
			return;
		}

		evt_msg = message_alloc_tx();

		/* Bluetooth LE Device Address */
		bt_addr_le = bt_conn_get_dst(conn);
		net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
		net_buf_add_u8(evt_msg, bt_addr_le_is_identity(bt_addr_le) ? BT_DATA_IDENTITY : BT_DATA_RPA);
		net_buf_add_u8(evt_msg, bt_addr_le->type);
		net_buf_add_mem(evt_msg, &bt_addr_le->a, sizeof(bt_addr_t));

		/* broadcast id */
		net_buf_add_u8(evt_msg, 5);
		net_buf_add_u8(evt_msg, BT_DATA_BROADCAST_ID);
		net_buf_add_le32(evt_msg, state->broadcast_id);

		/* source id */
		net_buf_add_u8(evt_msg, 2);
		net_buf_add_u8(evt_msg, BT_DATA_SOURCE_ID);
		net_buf_add_u8(evt_msg, state->src_id);

		message_send_net_buf_event(evt_msg_sub_type, evt_msg);
	}

	for (int i = 0; i < state->num_subgroups; i++) {
		LOG_INF("bis_sync[%d]: %x -> %x", i,
			ba_recv_state[conn_index].subgroups[i].bis_sync,
			state->subgroups[i].bis_sync);
	}

	/* BIG synced? */
	bis_sync_changed = false;
	bis_synced = false;
	for (int i = 0; i < state->num_subgroups; i++) {
		if (state->subgroups[i].bis_sync !=
		    ba_recv_state[conn_index].subgroups[i].bis_sync) {
			/* bis sync changed */
			bis_sync_changed = true;
			if (state->subgroups[i].bis_sync == BIG_SYNC_FAILED) {
				/* Specification not crystal clear on this but it's assumed when one
				 * bis_sync has the value of 0xFFFFFFFF then all bis_sync's are set
				 * this indicating BIG sync failed.
				 */
				LOG_ERR("Failed to sync to BIG!");
				bis_synced = false;
				break;
			}
			bis_synced =
				bis_synced || (state->subgroups[i].bis_sync == 0 ? false : true);
		}
	}

	if (bis_sync_changed) {
		/* BIS sync changed */
		evt_msg_sub_type = bis_synced ? MESSAGE_SUBTYPE_BIS_SYNCED : MESSAGE_SUBTYPE_BIS_NOT_SYNCED;

		LOG_INF("%s", evt_msg_sub_type == MESSAGE_SUBTYPE_BIS_SYNCED
				      ? "MESSAGE_SUBTYPE_BIS_SYNCED"
				      : "MESSAGE_SUBTYPE_BIS_NOT_SYNCED");

		evt_msg = message_alloc_tx();

		/* Bluetooth LE Device Address */
		bt_addr_le = bt_conn_get_dst(conn);
		net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
		net_buf_add_u8(evt_msg,
			       bt_addr_le_is_identity(bt_addr_le) ? BT_DATA_IDENTITY : BT_DATA_RPA);
		net_buf_add_u8(evt_msg, bt_addr_le->type);
		net_buf_add_mem(evt_msg, &bt_addr_le->a, sizeof(bt_addr_t));

		/* broadcast id */
		net_buf_add_u8(evt_msg, 5);
		net_buf_add_u8(evt_msg, BT_DATA_BROADCAST_ID);
		net_buf_add_le32(evt_msg, state->broadcast_id);

		/* source id */
		net_buf_add_u8(evt_msg, 2);
		net_buf_add_u8(evt_msg, BT_DATA_SOURCE_ID);
		net_buf_add_u8(evt_msg, state->src_id);

		message_send_net_buf_event(evt_msg_sub_type, evt_msg);
	}

	/* Store latest recv_state */
	memcpy(&ba_recv_state[conn_index], state, sizeof(struct bt_bap_scan_delegator_recv_state));
}

static void broadcast_assistant_recv_state_removed_cb(struct bt_conn *conn, uint8_t src_id)
{
	LOG_INF("Broadcast assistant recv_state_removed callback (%p, %u)", (void *)conn, src_id);
	message_send_return_code(MESSAGE_TYPE_EVT, MESSAGE_SUBTYPE_SOURCE_REMOVED, 0, 0);
}

static void broadcast_assistant_add_src_cb(struct bt_conn *conn, int err)
{
	const bt_addr_le_t *bt_addr_le;
	char addr_str[BT_ADDR_LE_STR_LEN];
	struct net_buf *evt_msg;

	if (err) {
		LOG_ERR("Broadcast assistant add_src callback (%p, %d)", (void *)conn, err);
	} else {
		LOG_INF("Broadcast assistant add_src callback (%p, %d)", (void *)conn, err);
	}

	k_sem_give(&sem_add_source);

	evt_msg = message_alloc_tx();
	bt_addr_le = bt_conn_get_dst(conn); /* sink addr */
	bt_addr_le_to_str(bt_addr_le, addr_str, sizeof(addr_str));
	LOG_DBG("Source added for %s", addr_str);

	/* Bluetooth LE Device Address */
	net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
	net_buf_add_u8(evt_msg, bt_addr_le_is_identity(bt_addr_le) ? BT_DATA_IDENTITY : BT_DATA_RPA);
	net_buf_add_u8(evt_msg, bt_addr_le->type);
	net_buf_add_mem(evt_msg, &bt_addr_le->a, sizeof(bt_addr_t));

	/* broadcast id */
	net_buf_add_u8(evt_msg, 5);
	net_buf_add_u8(evt_msg, BT_DATA_BROADCAST_ID);
	net_buf_add_le32(evt_msg, ba_source_broadcast_id);
	/* error code */
	net_buf_add_u8(evt_msg, 1 /* len of BT_DATA type */ + sizeof(int32_t));
	net_buf_add_u8(evt_msg, BT_DATA_ERROR_CODE);
	net_buf_add_le32(evt_msg, err);

	message_send_net_buf_event(MESSAGE_SUBTYPE_SOURCE_ADDED, evt_msg);
}

static void broadcast_assistant_mod_src_cb(struct bt_conn *conn, int err)
{
	if (err) {
		LOG_ERR("BASS modify source (err: %d)", err);
		return;
	}

	LOG_INF("BASS modify source (bis_sync = 0, pa_sync = false) ok -> Now remove source (%u)",
		ba_source_id);

	err = bt_bap_broadcast_assistant_rem_src(conn, ba_source_id);
	if (err) {
		LOG_ERR("BASS remove source (err: %d)", err);
	}
}

static void broadcast_assistant_rem_src_cb(struct bt_conn *conn, int err)
{
	if (err) {
		LOG_ERR("BASS remove source (err: %d)", err);
	} else {
		LOG_INF("BASS remove source (err: %d)", err);
	}

	k_sem_give(&sem_rem_source);
}

static void connected_cb(struct bt_conn *conn, uint8_t err)
{
	LOG_INF("Broadcast assistant connected callback (%p, err:%d)", (void *)conn, err);

	if (err) {
		LOG_ERR("Connected error (err %d)", err);
	} else {
		err = bt_conn_set_security(conn, BT_SECURITY_L2 | BT_SECURITY_FORCE_PAIR);
		if (err) {
			LOG_ERR("Setting security failed (err %d)", err);

			uint8_t disconnect_err = bt_conn_disconnect(conn, BT_HCI_ERR_REMOTE_USER_TERM_CONN);
			if (disconnect_err) {
				LOG_ERR("Failed to disconnect (err %d)", disconnect_err);
			}
		}
	}

	if (err) {
		const bt_addr_le_t *bt_addr_le;
		struct net_buf *evt_msg;

		evt_msg = message_alloc_tx();
		bt_addr_le = bt_conn_get_dst(conn);
		/* Bluetooth LE Device Address */
		net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
		net_buf_add_u8(evt_msg, bt_addr_le_is_identity(bt_addr_le) ? BT_DATA_IDENTITY : BT_DATA_RPA);
		net_buf_add_u8(evt_msg, bt_addr_le->type);
		net_buf_add_mem(evt_msg, &bt_addr_le->a, sizeof(bt_addr_t));
		/* error code */
		net_buf_add_u8(evt_msg, 1 /* len of BT_DATA type */ + sizeof(int32_t));
		net_buf_add_u8(evt_msg, BT_DATA_ERROR_CODE);
		net_buf_add_le32(evt_msg, err);

		bt_conn_unref(conn);

		message_send_net_buf_event(MESSAGE_SUBTYPE_SINK_CONNECTED, evt_msg);
		restart_scanning_if_needed();
	}
}

static void disconnected_cb(struct bt_conn *conn, uint8_t reason)
{
	const bt_addr_le_t *bt_addr_le;
	struct net_buf *evt_msg;

	LOG_INF("Broadcast assistant disconnected callback (%p, reason:%d)", (void *)conn, reason);

	bt_addr_le = bt_conn_get_dst(conn);
	evt_msg = message_alloc_tx();
	/* Bluetooth LE Device Address */
	net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
	net_buf_add_u8(evt_msg, bt_addr_le_is_identity(bt_addr_le) ? BT_DATA_IDENTITY : BT_DATA_RPA);
	net_buf_add_u8(evt_msg, bt_addr_le->type);
	net_buf_add_mem(evt_msg, &bt_addr_le->a, sizeof(bt_addr_t));
	/* error code */
	net_buf_add_u8(evt_msg, 1 /* len of BT_DATA type */ + sizeof(int32_t));
	net_buf_add_u8(evt_msg, BT_DATA_ERROR_CODE);
	net_buf_add_le32(evt_msg, 0 /* OK */);

	bt_conn_unref(conn);

	message_send_net_buf_event(MESSAGE_SUBTYPE_SINK_DISCONNECTED, evt_msg);
}

static void security_changed_cb(struct bt_conn *conn, bt_security_t level, enum bt_security_err err)
{
	LOG_INF("Broadcast assistant security_changed callback (%p, %d, err:%d)", (void *)conn, level, err);

	if (err == BT_SECURITY_ERR_SUCCESS) {
		/* Connected and paired. Do BAP broadcast assistant discover */
		LOG_INF("Broadcast assistant discover...");
		err = bt_bap_broadcast_assistant_discover(conn);
		if (err) {
			LOG_ERR("Failed to broadcast assistant discover (err %d)", err);
			err = bt_conn_disconnect(conn, BT_HCI_ERR_REMOTE_USER_TERM_CONN);
			if (err) {
				LOG_ERR("Failed to disconnect (err %d)", err);
			}
		}
	} else {
		LOG_ERR("Failed to change security (err %d)", err);
		err = bt_conn_disconnect(conn, BT_HCI_ERR_REMOTE_USER_TERM_CONN);
		if (err) {
			LOG_ERR("Failed to disconnect (err %d)", err);
		}
	}

	if (err) {
		restart_scanning_if_needed();
	}
}

static void identity_resolved_cb(struct bt_conn *conn, const bt_addr_le_t *rpa,
				 const bt_addr_le_t *identity) {
	char rpa_str[BT_ADDR_LE_STR_LEN];
	char identity_str[BT_ADDR_LE_STR_LEN];

	bt_addr_le_to_str(rpa, rpa_str, sizeof(rpa_str));
	bt_addr_le_to_str(identity, identity_str, sizeof(identity_str));
	LOG_INF("Identity resolved %s -> %s", rpa_str, identity_str);

	enum message_sub_type evt_msg_sub_type;
	struct net_buf *evt_msg;

	evt_msg_sub_type = MESSAGE_SUBTYPE_IDENTITY_RESOLVED;
	evt_msg = message_alloc_tx();

	net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
	net_buf_add_u8(evt_msg, BT_DATA_RPA);
	net_buf_add_u8(evt_msg, rpa->type);
	net_buf_add_mem(evt_msg, &rpa->a, sizeof(bt_addr_t));

	net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
	net_buf_add_u8(evt_msg, BT_DATA_IDENTITY);
	net_buf_add_u8(evt_msg, identity->type);
	net_buf_add_mem(evt_msg, &identity->a, sizeof(bt_addr_t));

	message_send_net_buf_event(evt_msg_sub_type, evt_msg);
}

static void restart_scanning_if_needed(void)
{
	int err;

	if (ba_scan_mode) {
		LOG_INF("Restart scanning");
		err = bt_le_scan_start(BT_LE_SCAN_PASSIVE, NULL);
		if (err) {
			LOG_ERR("Scanning failed to start (err %d)", err);
			ba_scan_mode = BROADCAST_ASSISTANT_SCAN_IDLE;
		}
	}
}

static bool device_found(struct bt_data *data, void *user_data)
{
	struct scan_recv_data *sr_data = (struct scan_recv_data *)user_data;
	struct bt_uuid_16 adv_uuid;

	switch (data->type) {
	case BT_DATA_NAME_SHORTENED:
	case BT_DATA_NAME_COMPLETE:
		memcpy(sr_data->bt_name, data->data, MIN(data->data_len, BT_NAME_LEN - 1));
		sr_data->bt_name_type = data->type == BT_DATA_NAME_SHORTENED
						? BT_DATA_NAME_SHORTENED
						: BT_DATA_NAME_COMPLETE;
		return true;
	case BT_DATA_BROADCAST_NAME:
		memcpy(sr_data->broadcast_name, data->data, MIN(data->data_len, BT_NAME_LEN - 1));
		return true;
	case BT_DATA_SVC_DATA16:
		if (data->data_len < BT_UUID_SIZE_16) {
			return true;
		}
		if (!bt_uuid_create(&adv_uuid.uuid, data->data, BT_UUID_SIZE_16)) {
			return true;
		}
		/* Check for BASS */
		if (bt_uuid_cmp(&adv_uuid.uuid, BT_UUID_BASS) == 0) {
			sr_data->has_bass = true;

			return true;
		}
		/* Check for Broadcast ID */
		if (bt_uuid_cmp(&adv_uuid.uuid, BT_UUID_BROADCAST_AUDIO) == 0) {
			if (data->data_len >= BT_UUID_SIZE_16 + BT_AUDIO_BROADCAST_ID_SIZE) {
				sr_data->broadcast_id = sys_get_le24(data->data + BT_UUID_SIZE_16);
			}

			return true;
		}

		return true;
	case BT_DATA_UUID16_SOME:
	case BT_DATA_UUID16_ALL:
		/* NOTE: According to the BAP 1.0.1 Spec,
		 * Section 3.9.2. Additional Broadcast Audio Scan Service requirements,
		 * If the Scan Delegator implements a Broadcast Sink, it should also
		 * advertise a Service Data field containing the Broadcast Audio
		 * Scan Service (BASS) UUID.
		 *
		 * However, it seems that this is not the case with the sinks available
		 * while developing this sample application.  Therefore, we instead,
		 * search for the existence of BASS and PACS in the list of service UUIDs,
		 * which does seem to exist in the sinks available.
		 */

		/* Check for BASS and PACS */
		if (data->data_len % sizeof(uint16_t) != 0U) {
			LOG_ERR("UUID16 AD malformed");
			return true;
		}

		for (size_t i = 0; i < data->data_len; i += sizeof(uint16_t)) {
			const struct bt_uuid *uuid;
			uint16_t u16;

			memcpy(&u16, &data->data[i], sizeof(u16));
			uuid = BT_UUID_DECLARE_16(sys_le16_to_cpu(u16));

			if (bt_uuid_cmp(uuid, BT_UUID_BASS) == 0) {
				sr_data->has_bass = true;
				continue;
			}

			if (bt_uuid_cmp(uuid, BT_UUID_PACS) == 0) {
				sr_data->has_pacs = true;
				continue;
			}
		}

		return true;
	case BT_DATA_CSIS_RSI:
		sr_data->has_csis = true;

		return true;
	default:
		return true;
	}
}

static bool base_search(struct bt_data *data, void *user_data)
{
	const struct bt_bap_base *base = bt_bap_base_get_base_from_ad(data);

	/* Base is NULL if the data does not contain a valid BASE */
	if (base == NULL) {
		return true;
	}

	/* Base found */
	*(bool *)user_data = true;

#if 1 /* TODO: Test. Remove later */
	uint32_t bis_indexes = 0U;
	int subgroup_count;

	subgroup_count = bt_bap_base_get_subgroup_count(base);
	if (bt_bap_base_get_bis_indexes(base, &bis_indexes)) {
		LOG_ERR("bt_bap_base_get_bis_indexes error");
	}

	LOG_INF("BASE found (subgroup_count %d, bis_indexes 0x%08x)", subgroup_count, bis_indexes);
#endif

	return false;
}

static void pa_synced_cb(struct bt_le_per_adv_sync *sync,
			 struct bt_le_per_adv_sync_synced_info *info)
{
	LOG_INF("PA sync %p synced", (void *)sync);

	k_timer_stop(&pa_sync_create_timer);
	k_sem_give(&sem_pa_sync);
}

static void pa_recv_cb(struct bt_le_per_adv_sync *sync,
		       const struct bt_le_per_adv_sync_recv_info *info, struct net_buf_simple *buf)
{
	bool base_found = false;
	char addr_str[BT_ADDR_LE_STR_LEN];

	bt_addr_le_to_str(info->addr, addr_str, sizeof(addr_str));
	LOG_INF("PA receive %p, %s", (void *)sync, addr_str);

	if (sync != pa_sync) {
		return;
	}

	bt_data_parse(buf, base_search, (void *)&base_found);

	if (base_found) {
		enum message_sub_type evt_msg_sub_type;
		struct net_buf *evt_msg;

		LOG_INF("BASE found");
		source_data_clr_pa_attempt_cd(info->addr);

		evt_msg_sub_type = MESSAGE_SUBTYPE_SOURCE_BASE_FOUND;
		evt_msg = message_alloc_tx();

		net_buf_add_u8(evt_msg, buf->len + 1);
		net_buf_add_u8(evt_msg, BT_DATA_BASE);
		net_buf_add_mem(evt_msg, buf->data, buf->len);

		/* Append data from struct bt_le_scan_recv_info (BT addr) */
		/* Bluetooth LE Device Address */
		net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
		net_buf_add_u8(evt_msg,
			       bt_addr_le_is_identity(info->addr) ? BT_DATA_IDENTITY : BT_DATA_RPA);
		net_buf_add_u8(evt_msg, info->addr->type);
		net_buf_add_mem(evt_msg, &info->addr->a, sizeof(bt_addr_t));

		message_send_net_buf_event(evt_msg_sub_type, evt_msg);

		if (pa_sync != NULL && !pa_sync_transfer) {
			pa_sync_delete();
		}
	}
}

static void pa_term_cb(struct bt_le_per_adv_sync *sync,
		       const struct bt_le_per_adv_sync_term_info *info)
{
	LOG_INF("PA terminated %p %u", (void *)sync, info->reason);

	k_sem_give(&sem_pa_sync);
}

static void pa_biginfo_cb(struct bt_le_per_adv_sync *sync, const struct bt_iso_biginfo *biginfo)
{
	enum message_sub_type evt_msg_sub_type;
	struct net_buf *evt_msg;

	LOG_INF("BIGinfo received (num_bis = %u), %s", biginfo->num_bis,
		biginfo->encryption ? "encrypted" : "not encrypted");

	evt_msg_sub_type = MESSAGE_SUBTYPE_SOURCE_BIG_INFO;
	evt_msg = message_alloc_tx();

	/* Bluetooth LE Device Address */
	net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
	net_buf_add_u8(evt_msg,
		       bt_addr_le_is_identity(biginfo->addr) ? BT_DATA_IDENTITY : BT_DATA_RPA);
	net_buf_add_u8(evt_msg, biginfo->addr->type);
	net_buf_add_mem(evt_msg, &biginfo->addr->a, sizeof(bt_addr_t));

	net_buf_add_u8(evt_msg, 1 + 18 /* sizeof num_bis .. encryption fields */);
	net_buf_add_u8(evt_msg, BT_DATA_BIG_INFO);
	net_buf_add_u8(evt_msg, biginfo->num_bis);
	net_buf_add_u8(evt_msg, biginfo->sub_evt_count);
	net_buf_add_le16(evt_msg, biginfo->iso_interval);
	net_buf_add_u8(evt_msg, biginfo->burst_number);
	net_buf_add_u8(evt_msg, biginfo->offset);
	net_buf_add_u8(evt_msg, biginfo->rep_count);
	net_buf_add_le16(evt_msg, biginfo->max_pdu);
	net_buf_add_le32(evt_msg, biginfo->sdu_interval);
	net_buf_add_le16(evt_msg, biginfo->max_sdu);
	net_buf_add_u8(evt_msg, biginfo->phy);
	net_buf_add_u8(evt_msg, biginfo->framing);
	net_buf_add_u8(evt_msg, biginfo->encryption ? 1 : 0);

	message_send_net_buf_event(evt_msg_sub_type, evt_msg);
}

static struct bt_le_per_adv_sync_cb pa_synced_callbacks = {
	.synced = pa_synced_cb,
	.recv = pa_recv_cb,
	.term = pa_term_cb,
	.biginfo = pa_biginfo_cb,
};

static uint16_t interval_to_sync_timeout(uint16_t pa_interval)
{
	uint16_t pa_timeout;

	if (pa_interval == BT_BAP_PA_INTERVAL_UNKNOWN) {
		/* Use maximum value to maximize chance of success */
		pa_timeout = BT_GAP_PER_ADV_MAX_TIMEOUT;
	} else {
		uint32_t interval_ms;
		uint32_t timeout;

		/* Add retries and convert to unit in 10's of ms */
		interval_ms = BT_GAP_PER_ADV_INTERVAL_TO_MS(pa_interval);
		timeout = (interval_ms * PA_SYNC_INTERVAL_TO_TIMEOUT_RATIO) / 10;

		/* Enforce restraints */
		pa_timeout = CLAMP(timeout, BT_GAP_PER_ADV_MIN_TIMEOUT, BT_GAP_PER_ADV_MAX_TIMEOUT);
	}

	return pa_timeout;
}

static void pa_sync_delete(void)
{
	k_timer_stop(&pa_sync_create_timer);
	k_work_submit(&pa_sync_delete_work);
}

static int pa_sync_create(bt_addr_le_t *addr, uint8_t sid, uint32_t interval)
{
	struct bt_le_per_adv_sync_param per_adv_sync_param = {0};

	bt_addr_le_copy(&per_adv_sync_param.addr, addr);
	per_adv_sync_param.options = BT_LE_PER_ADV_SYNC_OPT_FILTER_DUPLICATE;
	per_adv_sync_param.sid = sid;
	per_adv_sync_param.skip = PA_SYNC_SKIP;
	per_adv_sync_param.timeout = interval_to_sync_timeout(interval);

	uint16_t create_timeout_duration_ms;

	create_timeout_duration_ms = per_adv_sync_param.timeout * 10U;
	LOG_INF("PA sync create timeout set to %u ms", create_timeout_duration_ms);
	k_timer_start(&pa_sync_create_timer, K_MSEC(create_timeout_duration_ms), K_NO_WAIT);

	return bt_le_per_adv_sync_create(&per_adv_sync_param, &pa_sync);
}

static bool scan_for_source(const struct bt_le_scan_recv_info *info, struct net_buf_simple *ad,
			    struct scan_recv_data *sr_data)
{
	/* Scan for Broadcast Source */

	sr_data->broadcast_id = INVALID_BROADCAST_ID;

	/* We are only interested in non-connectable periodic advertisers */
	if ((info->adv_props & BT_GAP_ADV_PROP_CONNECTABLE) != 0 || info->interval == 0) {

		return false;
	}

	bt_data_parse(ad, device_found, (void *)sr_data);

	if (sr_data->broadcast_id != INVALID_BROADCAST_ID) {
		LOG_DBG("Broadcast Source Found [name, b_name, b_id] = [\"%s\", \"%s\", 0x%06x]",
			sr_data->bt_name, sr_data->broadcast_name, sr_data->broadcast_id);

		source_data_t *source_data;

		source_data = source_data_get(info->addr);
		if (source_data == NULL) {
			/* New source */
			source_data = source_data_add(info->addr, info->sid, info->interval);
		}

		/* Already PA syncing */
		if (pa_sync == NULL) {
			/* Source data alvailable and PA sync allowed? */
			if (source_data != NULL && source_data->pa_attempt_cd > 0) {
				LOG_INF("PA sync create (b_id = 0x%06x, \"%s\", cd = %u)",
					sr_data->broadcast_id, sr_data->broadcast_name,
					source_data->pa_attempt_cd);
				int err = pa_sync_create(&source_data->addr, info->sid,
							 info->interval);
				if (err != 0) {
					LOG_INF("Could not create Broadcast PA sync: %d", err);
				} else {
					source_data->pa_attempt_cd--;
				}
			}
		}

		return true;
	}

	return false;
}

static bool scan_for_sink(const struct bt_le_scan_recv_info *info, struct net_buf_simple *ad,
			  struct scan_recv_data *sr_data)
{
	/* Scan for Broadcast Sink */

	/* We are only interested in connectable advertisers */
	if ((info->adv_props & BT_GAP_ADV_PROP_CONNECTABLE) == 0) {

		return false;
	}

	bt_data_parse(ad, device_found, (void *)sr_data);

	if (sr_data->has_bass) {
		char addr_str[BT_ADDR_LE_STR_LEN];

		bt_addr_le_to_str(info->addr, addr_str, sizeof(addr_str));
		LOG_INF("Broadcast Sink Found: [\"%s\", %s]%s", sr_data->bt_name, addr_str,
			sr_data->has_csis ? ", CSIS" : "");

		return true;
	}

	return false;
}

static bool scan_for_csis_member(const struct bt_le_scan_recv_info *info, struct net_buf_simple *ad,
				 struct scan_recv_data *sr_data)
{
	/* Scan for CSIS member */

	/* We are only interested in connectable advertisers */
	if ((info->adv_props & BT_GAP_ADV_PROP_CONNECTABLE) == 0) {

		return false;
	}

	/* Scanning for set members */
	bt_data_parse(ad, csis_member_found, (void *)sr_data);

	if (sr_data->set_member) {
		char addr_str[BT_ADDR_LE_STR_LEN];

		bt_addr_le_to_str(info->addr, addr_str, sizeof(addr_str));

		if (csis_member_is_discovered(info->addr)) {
			LOG_WRN("Set member already found, %s", addr_str);

			return false;
		}

		bt_addr_le_copy(&csis_members[csis_members_cnt++], info->addr);
		LOG_INF("Set member found (%u / %u), %s", csis_members_cnt, csis_set_size,
			addr_str);

		return true;
	}

	return false;
}

static void scan_recv_cb(const struct bt_le_scan_recv_info *info, struct net_buf_simple *ad)
{
	if (ba_scan_mode & BROADCAST_ASSISTANT_SCAN_SOURCE) {
		struct scan_recv_data sr_data = {0};
		struct net_buf_simple ad_clone;

		/* Clone needed for the event message because bt_data_parse consumes ad data */
		net_buf_simple_clone(ad, &ad_clone);
		if (scan_for_source(info, &ad_clone, &sr_data)) {
			enum message_sub_type evt_msg_sub_type;
			struct net_buf *evt_msg;

			/* broadcast source found */
			evt_msg_sub_type = MESSAGE_SUBTYPE_SOURCE_FOUND;
			evt_msg = message_alloc_tx();

			net_buf_add_mem(evt_msg, ad->data, ad->len);

			/* Append data from struct bt_le_scan_recv_info (RSSI, BT addr, ..) */
			/* RSSI */
			net_buf_add_u8(evt_msg, 2);
			net_buf_add_u8(evt_msg, BT_DATA_RSSI);
			net_buf_add_u8(evt_msg, info->rssi);
			/* Bluetooth LE Device Address */
			net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
			net_buf_add_u8(evt_msg, bt_addr_le_is_identity(info->addr) ? BT_DATA_IDENTITY : BT_DATA_RPA);
			net_buf_add_u8(evt_msg, info->addr->type);
			net_buf_add_mem(evt_msg, &info->addr->a, sizeof(bt_addr_t));
			/* BT name */
			net_buf_add_u8(evt_msg, strlen(sr_data.bt_name) + 1);
			net_buf_add_u8(evt_msg, sr_data.bt_name_type);
			net_buf_add_mem(evt_msg, &sr_data.bt_name, strlen(sr_data.bt_name));

			/* sid */
			net_buf_add_u8(evt_msg, 2);
			net_buf_add_u8(evt_msg, BT_DATA_SID);
			net_buf_add_u8(evt_msg, info->sid);
			/* pa interval */
			net_buf_add_u8(evt_msg, 3);
			net_buf_add_u8(evt_msg, BT_DATA_PA_INTERVAL);
			net_buf_add_le16(evt_msg, info->interval);
			/* broadcast id */
			net_buf_add_u8(evt_msg, 5);
			net_buf_add_u8(evt_msg, BT_DATA_BROADCAST_ID);
			net_buf_add_le32(evt_msg, sr_data.broadcast_id);

			message_send_net_buf_event(evt_msg_sub_type, evt_msg);
		}
	}

	if (ba_scan_mode & BROADCAST_ASSISTANT_SCAN_SINK) {
		struct scan_recv_data sr_data = {0};
		struct net_buf_simple ad_clone;

		/* Clone needed for the event message because bt_data_parse consumes ad data */
		net_buf_simple_clone(ad, &ad_clone);
		if (scan_for_sink(info, &ad_clone, &sr_data)) {
			enum message_sub_type evt_msg_sub_type;
			struct net_buf *evt_msg;

			/* broadcast sink found */
			evt_msg_sub_type = MESSAGE_SUBTYPE_SINK_FOUND;
			evt_msg = message_alloc_tx();

			net_buf_add_mem(evt_msg, ad->data, ad->len);

			/* Append data from struct bt_le_scan_recv_info (RSSI, BT addr, ..) */
			/* RSSI */
			net_buf_add_u8(evt_msg, 2);
			net_buf_add_u8(evt_msg, BT_DATA_RSSI);
			net_buf_add_u8(evt_msg, info->rssi);
			/* Bluetooth LE Device Address */
			net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
			net_buf_add_u8(evt_msg, bt_addr_le_is_identity(info->addr) ? BT_DATA_IDENTITY : BT_DATA_RPA);
			net_buf_add_u8(evt_msg, info->addr->type);
			net_buf_add_mem(evt_msg, &info->addr->a, sizeof(bt_addr_t));
			/* BT name */
			net_buf_add_u8(evt_msg, strlen(sr_data.bt_name) + 1);
			net_buf_add_u8(evt_msg, sr_data.bt_name_type);
			net_buf_add_mem(evt_msg, &sr_data.bt_name, strlen(sr_data.bt_name));

			message_send_net_buf_event(evt_msg_sub_type, evt_msg);
		}
	}

	if (ba_scan_mode & BROADCAST_ASSISTANT_SCAN_CSIS) {
		struct scan_recv_data sr_data = {0};
		struct net_buf_simple ad_clone;

		/* Clone needed for the event message because bt_data_parse consumes ad data */
		net_buf_simple_clone(ad, &ad_clone);
		if (scan_for_csis_member(info, &ad_clone, &sr_data)) {
			enum message_sub_type evt_msg_sub_type;
			struct net_buf *evt_msg;

			/* csis member found */
			evt_msg_sub_type = MESSAGE_SUBTYPE_SET_MEMBER_FOUND;
			evt_msg = message_alloc_tx();

			net_buf_add_mem(evt_msg, ad->data, ad->len);

			/* Bluetooth LE Device Address */
			net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
			net_buf_add_u8(evt_msg, bt_addr_le_is_identity(info->addr) ? BT_DATA_IDENTITY : BT_DATA_RPA);
			net_buf_add_u8(evt_msg, info->addr->type);
			net_buf_add_mem(evt_msg, &info->addr->a, sizeof(bt_addr_t));

			message_send_net_buf_event(evt_msg_sub_type, evt_msg);

			if (csis_members_cnt == csis_set_size) {
				LOG_INF("All members found");

				/* Restore previous scan mode */
				ba_scan_mode = ba_scan_mode & ~BROADCAST_ASSISTANT_SCAN_CSIS;
				if (ba_scan_mode == BROADCAST_ASSISTANT_SCAN_IDLE) {
					int err = bt_le_scan_stop();
					if (err) {
						LOG_ERR("bt_le_scan_stop failed with %d", err);
					}
				}
			}
		}
	}
}

static void scan_timeout_cb(void)
{
	LOG_INF("Scan timeout");

	ba_scan_mode = BROADCAST_ASSISTANT_SCAN_IDLE;

	message_send_return_code(MESSAGE_TYPE_EVT, MESSAGE_SUBTYPE_STOP_SCAN, 0, 0);

}

static void add_csis_member(struct bt_conn *conn, void *data)
{
	char addr_str[BT_ADDR_LE_STR_LEN];
	const bt_addr_le_t *bt_addr_le;

	bt_addr_le = bt_conn_get_dst(conn);
	bt_addr_le_to_str(bt_addr_le, addr_str, sizeof(addr_str));
	LOG_INF("Adding %s to set", addr_str);

	bt_addr_le_copy(&csis_members[csis_members_cnt++], bt_addr_le);
}

static void reset_csis_data(uint8_t set_size, uint8_t sirk[BT_CSIP_SIRK_SIZE])
{
	LOG_INF("Reset CSIS data (set size: %u) ...", set_size);
	LOG_HEXDUMP_INF(sirk, BT_CSIP_SIRK_SIZE, "sirk:");

	csis_set_size = set_size;
	memcpy(csis_sirk, sirk, BT_CSIP_SIRK_SIZE);
	/* Reset and populate based on current connections */
	memset(csis_members, 0, sizeof(csis_members));
	csis_members_cnt = 0;
	/* Assume all connected devices are set members */
	bt_conn_foreach(BT_CONN_TYPE_LE, add_csis_member, NULL);
}

static void disconnect(struct bt_conn *conn, void *data)
{
	char addr_str[BT_ADDR_LE_STR_LEN];
	int err;

	bt_addr_le_to_str(bt_conn_get_dst(conn), addr_str, sizeof(addr_str));

	LOG_INF("Disconnecting from %s", addr_str);
	err = bt_conn_disconnect(conn, BT_HCI_ERR_REMOTE_USER_TERM_CONN);
	if (err) {
		LOG_INF("Failed to disconnect from %s", addr_str);
	}
}

static void add_source_foreach_sink(struct bt_conn *conn, void *data)
{
	int err;
	struct bt_conn_info info;

	const struct bt_bap_broadcast_assistant_add_src_param *param =
		(struct bt_bap_broadcast_assistant_add_src_param *)data;

	err = bt_conn_get_info(conn, &info);
	if (err) {
		LOG_ERR("Failed to get conn info (err %d)", err);
	}

	if (info.state != BT_CONN_STATE_CONNECTED) {
		LOG_WRN("Skip adding broadcast source for this conn %p (not connected)",
			(void *)conn);
		return;
	}

	LOG_INF("Adding broadcast source for this conn %p ...", (void *)conn);

	err = k_sem_take(&sem_add_source, SYS_TIMEOUT_MS(2000));
	if (err != 0) {
		LOG_ERR("sem_add_source timed out");
	}

	/* Clear recv_state */
	memset(&ba_recv_state[bt_conn_index(conn)], 0,
	       sizeof(struct bt_bap_scan_delegator_recv_state));

	err = bt_bap_broadcast_assistant_add_src(conn, param);
	if (err) {
		LOG_ERR("Failed to add source (err %d)", err);
	}
}

static void remove_source_foreach_sink(struct bt_conn *conn, void *data)
{
	int err;
	struct bt_conn_info info;

	const struct bt_bap_broadcast_assistant_mod_src_param *param =
		(struct bt_bap_broadcast_assistant_mod_src_param *)data;

	err = bt_conn_get_info(conn, &info);
	if (err) {
		LOG_ERR("Failed to get conn info (err %d)", err);
	}

	if (info.state != BT_CONN_STATE_CONNECTED) {
		LOG_WRN("Skip removing broadcast source for this conn %p (not connected)",
			(void *)conn);
		return;
	}

	LOG_INF("Removing broadcast source for this conn %p ...", (void *)conn);

	err = k_sem_take(&sem_rem_source, SYS_TIMEOUT_MS(2000));
	if (err != 0) {
		LOG_ERR("sem_rem_source timed out");
	}
	err = bt_bap_broadcast_assistant_mod_src(conn, param);
	if (err) {
		LOG_ERR("Failed to modify source (err %d)", err);
	}
}

static void add_broadcast_code_foreach_sink(struct bt_conn *conn, void *data)
{
	int err;
	struct bt_conn_info info;

	add_broadcast_code_data_t *add_broadcast_code_data = (add_broadcast_code_data_t *)data;

	err = bt_conn_get_info(conn, &info);
	if (err) {
		LOG_ERR("Failed to get conn info (err %d)", err);
	}

	if (info.state != BT_CONN_STATE_CONNECTED) {
		LOG_WRN("Skip adding broadcast code for this conn %p (not connected)",
			(void *)conn);
		return;
	}

	LOG_INF("Adding broadcast code for this conn %p ...", (void *)conn);

	err = bt_bap_broadcast_assistant_set_broadcast_code(
		conn, add_broadcast_code_data->src_id, add_broadcast_code_data->broadcast_code);
	if (err) {
		LOG_ERR("Failed to add broadcast code (err %d)", err);
	}
}

static bool past_available(const struct bt_conn *conn,
			   const bt_addr_le_t *adv_addr,
			   uint8_t sid)
{
	if (IS_ENABLED(CONFIG_BT_PER_ADV_SYNC_TRANSFER_SENDER)) {
		LOG_INF("%p remote %s PAST, local %s PAST", (void *)conn,
			BT_FEAT_LE_PAST_RECV(conn->le.features) ? "supports" : "does not support",
			BT_FEAT_LE_PAST_SEND(bt_dev.le.features) ? "supports" : "does not support");

		return BT_FEAT_LE_PAST_RECV(conn->le.features) &&
		       BT_FEAT_LE_PAST_SEND(bt_dev.le.features) /*&&
		       bt_le_per_adv_sync_lookup_addr(adv_addr, sid) != NULL*/;
	} else {
		return false;
	}
}

static void check_past_available_foreach_sink(struct bt_conn *conn, void *data)
{
	past_available_data_t *past_available_data = (past_available_data_t *)data;
	bool result;

	result = past_available(conn, past_available_data->addr, past_available_data->sid);

	LOG_INF("PAST available: %s", result ? "YES" : "NO");
}

/*
 * Public functions
 */

int broadcast_assistant_start_scan(uint8_t mode, uint8_t set_size, uint8_t sirk[BT_CSIP_SIRK_SIZE],
				   uint8_t pa_attempt)
{
	/* Scan already ongoing? */
	if (ba_scan_mode == BROADCAST_ASSISTANT_SCAN_IDLE) {
		int err = bt_le_scan_start(BT_LE_SCAN_PASSIVE, NULL);
		if (err) {
			LOG_ERR("Scanning failed to start (err %d)", err);
			return err;
		}
	}

	if (mode == BROADCAST_ASSISTANT_SCAN_SOURCE) {
		reset_source_data(pa_attempt);
	} else if (mode == BROADCAST_ASSISTANT_SCAN_CSIS) {
		reset_csis_data(set_size, sirk);
	}

	ba_scan_mode = ba_scan_mode | mode;

	LOG_INF("Scanning started (mode: 0x%08x)", ba_scan_mode);

	return 0;
}

int broadcast_assistant_stop_scanning(void)
{
	if (ba_scan_mode == BROADCAST_ASSISTANT_SCAN_IDLE) {
		/* No scan ongoing */
		return 0;
	}

	int err = bt_le_scan_stop();
	if (err) {
		LOG_ERR("bt_le_scan_stop failed with %d", err);
		return err;
	}

	ba_scan_mode = BROADCAST_ASSISTANT_SCAN_IDLE;

	LOG_INF("Scanning stopped");

	pa_sync_delete(); /* delete pa sync if needed */

	return 0;
}

int broadcast_assistant_disconnect_unpair_all(void)
{
	int err = 0;

	LOG_INF("Disconnecting and unpairing all devices");

	bt_conn_foreach(BT_CONN_TYPE_LE, disconnect, NULL);

	LOG_INF("Disconnecting complete");

	err = bt_unpair(BT_ID_DEFAULT, BT_ADDR_LE_ANY);
	if (err) {
		LOG_ERR("bt_unpair failed with %d", err);
	}

	LOG_INF("Unpair complete");

	return 0;
}

int broadcast_assistant_connect_to_sink(bt_addr_le_t *bt_addr_le)
{
	struct bt_conn *conn;
	char addr_str[BT_ADDR_LE_STR_LEN];
	int err;
	struct bt_conn_le_create_param create_param = {
		.options = (BT_CONN_LE_OPT_NONE),
		.interval = (BT_GAP_SCAN_FAST_INTERVAL),
		.window = (BT_GAP_SCAN_FAST_INTERVAL),
		.interval_coded = 0,
		.window_coded = 0,
		.timeout = 1000, /* ms * 10 */
	};
	const struct bt_le_conn_param *param =
		BT_LE_CONN_PARAM(BT_GAP_INIT_CONN_INT_MIN, BT_GAP_INIT_CONN_INT_MAX, 0, 800);

	LOG_INF("Connect to sink...");

	/* Stop scanning if needed */
	if (ba_scan_mode) {
		LOG_INF("Stop scanning");
		err = bt_le_scan_stop();
		if (err) {
			LOG_ERR("bt_le_scan_stop failed %d", err);
			return err;
		}
	}

	pa_sync_delete(); /* delete pa sync if needed */

	k_sleep(K_MSEC(100)); /* sleep added to improve robustness */

	bt_addr_le_to_str(bt_addr_le, addr_str, sizeof(addr_str));
	LOG_INF("Connecting to %s...", addr_str);

	err = bt_conn_le_create(bt_addr_le, &create_param, param, &conn);
	if (err) {
		LOG_ERR("Failed creating connection (err=%d)", err);
		restart_scanning_if_needed();

		return err;
	}

	LOG_INF("Conn = %p (idx = %u)", (void *)conn, bt_conn_index(conn));

	return 0;
}

int broadcast_assistant_disconnect_from_sink(bt_addr_le_t *bt_addr_le)
{
	struct bt_conn *conn;
	char addr_str[BT_ADDR_LE_STR_LEN];

	bt_addr_le_to_str(bt_addr_le, addr_str, sizeof(addr_str));
	conn = bt_conn_lookup_addr_le(BT_ID_DEFAULT, bt_addr_le);

	LOG_INF("Disconnecting from %s %p...", addr_str, (void *)conn);

	if (conn) {
		int err;

		err = bt_conn_disconnect(conn, BT_HCI_ERR_REMOTE_USER_TERM_CONN);
		if (err) {
			struct net_buf *evt_msg;

			LOG_ERR("Failed to disconnect (err %d)", err);
			evt_msg = message_alloc_tx();
			/* Bluetooth LE Device Address */
			net_buf_add_u8(evt_msg, 1 + BT_ADDR_LE_SIZE);
			net_buf_add_u8(evt_msg, bt_addr_le_is_identity(bt_addr_le) ? BT_DATA_IDENTITY : BT_DATA_RPA);
			net_buf_add_u8(evt_msg, bt_addr_le->type);
			net_buf_add_mem(evt_msg, &bt_addr_le->a, sizeof(bt_addr_t));
			/* error code */
			net_buf_add_u8(evt_msg, 1 /* len of BT_DATA type */ + sizeof(int32_t));
			net_buf_add_u8(evt_msg, BT_DATA_ERROR_CODE);
			net_buf_add_le32(evt_msg, err);

			message_send_net_buf_event(MESSAGE_SUBTYPE_SINK_DISCONNECTED, evt_msg);
		}

		bt_conn_unref(conn);

		err = bt_unpair(BT_ID_DEFAULT, bt_addr_le);
		if (err) {
			LOG_ERR("bt_unpair failed with %d", err);
		}
	}

	return 0;
}

int broadcast_assistant_add_source(uint8_t sid, uint16_t pa_interval, uint32_t broadcast_id,
				   bt_addr_le_t *addr, uint8_t num_subgroups, uint32_t *bis_sync)
{
	LOG_INF("Adding broadcast source (%u)...", broadcast_id);

	int err;
	struct bt_bap_bass_subgroup subgroup[CONFIG_BT_BAP_BASS_MAX_SUBGROUPS] = {{0}};
	struct bt_bap_broadcast_assistant_add_src_param param = {0};
	past_available_data_t past_available_data = {.sid = sid, .addr = addr, .result = true};

	bt_conn_foreach(BT_CONN_TYPE_LE, check_past_available_foreach_sink, &past_available_data);

	/* If past available - sync first before adding src */
	if (past_available_data.result) {
		LOG_INF("PAST available");

		k_sem_reset(&sem_pa_sync);

		if (pa_sync != NULL) {
			pa_sync_delete();
			/* Wait for PA sync stopped */
			k_sem_take(&sem_pa_sync, K_FOREVER);
		}

		if (pa_sync == NULL) {
			err = pa_sync_create(addr, sid, pa_interval);
			if (err != 0) {
				LOG_ERR("Could not create Broadcast PA sync: %d", err);
			} else {
				pa_sync_transfer = true;
				/* Wait for PA synced */
				k_sem_take(&sem_pa_sync, K_FOREVER);
			}
		}
	}

	LOG_INF("Add source");

	num_subgroups = MIN(num_subgroups, CONFIG_BT_BAP_BASS_MAX_SUBGROUPS);
	for (int i = 0; i < num_subgroups; i++) {
		subgroup[i].bis_sync = bis_sync[i];
	}

	if (num_subgroups == 0) {
		num_subgroups = 1;
		subgroup[0].bis_sync = BT_BAP_BIS_SYNC_NO_PREF;
		LOG_WRN("num_subgroups argument is 0. Change to 1 and set bis sync no pref");
	} else {
		for (int i = 0; i < num_subgroups; i++) {
			LOG_INF("bis_sync[%d]: %x", i, subgroup[i].bis_sync);
		}
	}

	bt_addr_le_copy(&param.addr, addr);
	param.adv_sid = sid;
	param.pa_interval = pa_interval;
	param.broadcast_id = broadcast_id;
	param.pa_sync = true;

	/* keep broadcast_id as global variable (used by source added callback) */
	ba_source_broadcast_id = broadcast_id;

	LOG_INF("adv_sid = %u, pa_interval = %u, broadcast_id = 0x%08x, num_subgroups = %u",
		param.adv_sid, param.pa_interval, param.broadcast_id, num_subgroups);

	param.num_subgroups = num_subgroups;
	param.subgroups = subgroup;

	bt_conn_foreach(BT_CONN_TYPE_LE, add_source_foreach_sink, &param);

	return 0;
}

int broadcast_assistant_pa_sync(bt_addr_le_t *addr, uint8_t sid, uint16_t interval)
{
	LOG_INF("PA sync to broadcast source...");

	source_data_t *source_data;
	int err;

	source_data = source_data_get(addr);
	if (source_data == NULL) {
		LOG_ERR("Unknown source data");

		return -EINVAL;
	}

	if (pa_sync != NULL) {
		LOG_ERR("Already PA syncing");

		return -EBUSY;
	}


	LOG_INF("PA sync create");

	err = pa_sync_create(&source_data->addr, sid, interval);
	if (err != 0) {
		LOG_ERR("Could not create Broadcast PA sync: %d", err);

		return err;
	}

	return 0;
}

int broadcast_assistant_remove_source(uint8_t source_id, uint8_t num_subgroups)
{
	LOG_INF("Removing broadcast source (%u, %u)...", source_id, num_subgroups);

	struct bt_bap_bass_subgroup subgroup[CONFIG_BT_BAP_BASS_MAX_SUBGROUPS] = {
		{0}}; /* bis_sync = 0 */
	struct bt_bap_broadcast_assistant_mod_src_param param = {0};

	num_subgroups = MIN(num_subgroups, CONFIG_BT_BAP_BASS_MAX_SUBGROUPS);
	if (num_subgroups == 0) {
		num_subgroups = 1;
		LOG_WRN("num_subgroups argument is 0. Change to 1");
	}
	param.src_id = source_id;
	param.pa_sync = false; /* stop sync to periodic advertisements */
	param.pa_interval = BT_BAP_PA_INTERVAL_UNKNOWN;
	param.num_subgroups = num_subgroups;
	param.subgroups = subgroup;

	/* store source ID globally. Used by broadcast_assistant_mod_src_cb */
	ba_source_id = source_id;

	/* FIXME: Incase source id is not the same foreach sink then this will not work */
	bt_conn_foreach(BT_CONN_TYPE_LE, remove_source_foreach_sink, &param);

	return 0;
}

int broadcast_assistant_add_broadcast_code(
	uint8_t src_id, const uint8_t broadcast_code[BT_ISO_BROADCAST_CODE_SIZE])
{
	add_broadcast_code_data_t add_broadcast_code_data;

	LOG_INF("Adding broadcast code for src %u ...", src_id);
	LOG_HEXDUMP_INF(broadcast_code, BT_ISO_BROADCAST_CODE_SIZE, "broadcast code:");

	add_broadcast_code_data.src_id = src_id;
	memcpy(add_broadcast_code_data.broadcast_code, broadcast_code, BT_ISO_BROADCAST_CODE_SIZE);

	/* FIXME: Incase source id is not the same foreach sink then this will not work */
	bt_conn_foreach(BT_CONN_TYPE_LE, add_broadcast_code_foreach_sink, &add_broadcast_code_data);

	return 0;
}

int broadcast_assistant_set_volume(bt_addr_le_t *bt_addr_le, uint8_t volume)
{
	struct bt_conn *conn;
	struct bt_vcp_vol_ctlr *vol_ctlr;
	int err;

	conn = bt_conn_lookup_addr_le(BT_ID_DEFAULT, bt_addr_le);
	if (!conn) {
		LOG_ERR("Failed to lookup connection");

		return -EINVAL;
	}

	vol_ctlr = bt_vcp_vol_ctlr_get_by_conn(conn);
	bt_conn_unref(conn);

	if (vol_ctlr == NULL) {
		char addr_str[BT_ADDR_LE_STR_LEN];

		bt_addr_le_to_str(bt_addr_le, addr_str, sizeof(addr_str));
		LOG_ERR("No volume control for %s", addr_str);

		return -EINVAL;
	}

	err = bt_vcp_vol_ctlr_set_vol(vol_ctlr, volume);
	if (err != 0) {
		LOG_ERR("Failed to set volume (err %d)", err);

		return -EINVAL;
	}

	return 0;
}

int broadcast_assistant_set_mute(bt_addr_le_t *bt_addr_le, uint8_t state)
{
	struct bt_conn *conn;
	struct bt_vcp_vol_ctlr *vol_ctlr;
	int err;

	conn = bt_conn_lookup_addr_le(BT_ID_DEFAULT, bt_addr_le);
	if (!conn) {
		LOG_ERR("Failed to lookup connection");

		return -EINVAL;
	}

	vol_ctlr = bt_vcp_vol_ctlr_get_by_conn(conn);
	bt_conn_unref(conn);

	if (vol_ctlr == NULL) {
		char addr_str[BT_ADDR_LE_STR_LEN];

		bt_addr_le_to_str(bt_addr_le, addr_str, sizeof(addr_str));
		LOG_ERR("No volume control for %s", addr_str);

		return -EINVAL;
	}

	err = (state == BT_VCP_STATE_UNMUTED) ? bt_vcp_vol_ctlr_unmute(vol_ctlr)
					      : bt_vcp_vol_ctlr_mute(vol_ctlr);
	if (err != 0) {
		LOG_ERR("Failed to set mute state (err %d)", err);

		return -EINVAL;
	}

	return 0;
}

int broadcast_assistant_reset(void)
{
	broadcast_assistant_stop_scanning();
	broadcast_assistant_disconnect_unpair_all();

	return 0;
}

int broadcast_assistant_init(void)
{
	int err = bt_enable(NULL);
	if (err) {
		LOG_ERR("Bluetooth init failed (err %d)", err);

		return err;
	}

	LOG_INF("Bluetooth initialized");

	bt_le_scan_cb_register(&scan_callbacks);
	bt_le_per_adv_sync_cb_register(&pa_synced_callbacks);
	bt_bap_broadcast_assistant_register_cb(&broadcast_assistant_callbacks);
	bt_vcp_vol_ctlr_cb_register(&vcp_callbacks);
	bt_csip_set_coordinator_register_cb(&csip_callbacks);
	LOG_INF("Bluetooth scan callback registered");

	k_mutex_init(&source_data_list_mutex);
	ba_scan_mode = BROADCAST_ASSISTANT_SCAN_IDLE;

	return 0;
}
