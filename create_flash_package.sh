#!/usr/bin/env bash

nrfutil pkg generate --hw-version 52 --sd-req=0x00 --application ./build/nrf52840dongle/app/zephyr/zephyr.hex --application-version 1 build_dongle.zip
