/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef __HEARTBEAT_H__
#define __HEARTBEAT_H__

#include <zephyr/types.h>

void heartbeat_start(void);
void heartbeat_stop(void);
void heartbeat_toggle(void);
void heartbeat_init(void);

#endif /* __HEARTBEAT_H__ */
