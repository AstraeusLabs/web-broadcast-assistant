/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @file
 * @brief WebUSB enabled custom class driver header file
 *
 * Header file for WebUSB enabled custom class driver
 */

#ifndef __WEBUSB_SERIAL_H__
#define __WEBUSB_SERIAL_H__

#include <zephyr/types.h>
#include <zephyr/net/buf.h>
#include "message_handler.h"

/**
 * @brief Initializes WebUSB component
 *
 */
void webusb_init(void);

/**
 * @brief Transmits a USB package
 *
 */
int webusb_transmit(struct net_buf *tx_net_buf);

/**
 * @brief Register message handler callback
 *
 * Function to register message handler callback for handling device messages
 *
 * @param [in] handlers Pointer to WebUSB message handler structure
 */
void webusb_register_message_handler(void (*cb)(struct webusb_message *msg_ptr,
						uint16_t msg_length));

#endif /* __WEBUSB_SERIAL_H__ */
