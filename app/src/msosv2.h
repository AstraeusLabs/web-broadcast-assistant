/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#include <zephyr/sys/byteorder.h>
#include <zephyr/usb/usb_device.h>
#include <zephyr/usb/bos.h>
#include <zephyr/usb/msos_desc.h>

#include "webusb.h"


int msosv2_custom_handle_req(struct usb_setup_packet *pSetup, int32_t *len, uint8_t **data);

int msosv2_vendor_handle_req(struct usb_setup_packet *pSetup, int32_t *len, uint8_t **data);

void msosv2_init(void);

