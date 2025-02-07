/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#include <zephyr/types.h>
#include <zephyr/logging/log.h>
#include <zephyr/net_buf.h>

#include "message.h"

static bool heartbeat_on;
static uint8_t heartbeat_cnt;

static void heartbeat_timeout_handler(struct k_timer *dummy_p);
K_TIMER_DEFINE(heartbeat_timer, heartbeat_timeout_handler, NULL);

static void heartbeat_timeout_handler(struct k_timer *timer)
{
	message_send_no_paylod(MESSAGE_TYPE_EVT, MESSAGE_SUBTYPE_HEARTBEAT, heartbeat_cnt++);
}

void heartbeat_start(void)
{
	if (!heartbeat_on) {
		// Start generating heartbeats every second
		heartbeat_on = true;
		k_timer_start(&heartbeat_timer, K_SECONDS(1), K_SECONDS(1));
	}
}

void heartbeat_stop(void)
{
	if (heartbeat_on) {
		heartbeat_on = false;
		k_timer_stop(&heartbeat_timer);
	}
}

void heartbeat_toggle(void)
{
	if (!heartbeat_on) {
		heartbeat_start();
	} else {
		heartbeat_stop();
	}
}

void heartbeat_init(void)
{
	heartbeat_on = false;
	k_timer_init(&heartbeat_timer, heartbeat_timeout_handler, NULL);
}
