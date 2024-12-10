/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file
 * @brief Sample app for a WebUSB Broadcast Assistant
 */

#include <zephyr/usb/usb_device.h>

#include "webusb.h"
#include "msosv2.h"
#include "broadcast_assistant.h"
#include "heartbeat.h"
#include "message.h"

LOG_MODULE_REGISTER(main, LOG_LEVEL_INF);

int main(void)
{
	int ret;

	LOG_INF("web-broadcast-assistants starting");

	/* Initialize WebUSB component */
	msosv2_init();
	webusb_init();

	/* Set the message handler */
	webusb_register_message_handler(&message_handler);

	heartbeat_init();

	ret = usb_enable(NULL);
	if (ret != 0) {
		LOG_ERR("Failed to enable USB");
		return ret;
	}

	/* Bluetooth initialization */
	ret = broadcast_assistant_init();
	if (ret != 0) {
		LOG_ERR("Failed to initialise broadcast assistant");
		return ret;
	}

	return 0;
}
