/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { arrayToMsg, msgToArray, MessageType, MessageSubType } from '../lib/message.js';
import { cobsEncode, cobsDecode } from '../lib/cobs.js';

/**
* WebUSB Device Service
*
* Handles USB communication and COBS encoding/decoding of messages
*
* (Early draft)
*
*/

const deviceFilter = { 'vendorId': 0x2fe3, 'productId': 0x00a };

const MAX_BYTES_READ = 4096;

export const WebUSBDeviceService = new class extends EventTarget {
	#device

	constructor() {
		super();

		this.scan = this.scan.bind(this);
		this.sendCMD = this.sendCMD.bind(this);
		this.sendData = this.sendData.bind(this);

		navigator.usb.addEventListener("disconnect", (event) => {
			const { device } = event;

			if (device === this.#device) {
				console.log("Disconnected ", device);
				this.dispatchEvent(new CustomEvent('disconnected', { detail: { device: this.#device }}));
			}
		});

		navigator.usb.addEventListener('connect', evt => this._openDevice(evt.device));
	}

	async reconnectPairedDevices() {
		const availableDevices = await navigator.usb.getDevices();

		if (availableDevices.length) {
		    this._openDevice(availableDevices[0]);
		}
	}

	scan() {
		navigator.usb.requestDevice({ filters: [deviceFilter] })
		.then(selectedDevice => {
			this._openDevice(selectedDevice);
		})
		.catch(error => { console.log(error); });
	}

	readLoop() {
		const {
			endpointNumber
		} = this.#device.configuration.interfaces[0].alternate.endpoints[0]
		this.#device.transferIn(endpointNumber, MAX_BYTES_READ).then(result => {
			const buf = new Uint8Array(result.data.buffer);

			if (buf.length === 0) {
				console.log("Probably rebooted. Disconnecting!");
				this.#device.close();
			}

			this.dispatchEvent(new CustomEvent('raw-data-received', {detail: { buf }}));

			// decode to message
			let decoded = cobsDecode(buf, true);
			const message = arrayToMsg(decoded);
			this.dispatchEvent(new CustomEvent('message', {detail: { message }}));

			this.readLoop();
		}, error => {
			console.log('error', error);
		});
	}

	sendData(data) {
		if (!this.#device) {
			console.warn('Device not connected');
			return;
		}

		const {
			endpointNumber
		} = this.#device.configuration.interfaces[0].alternate.endpoints[1];

		return this.#device.transferOut(endpointNumber, data);
	}

	async sendCMD(message) {
		let arrayIn = msgToArray(message);
		let encoded = cobsEncode(arrayIn, true);

		const result = await this.sendData(encoded);

		if (result.status === "ok") {
			this.dispatchEvent(new CustomEvent('command-sent', {detail: { message }}));
		}
	}

	async _openDevice(device) {
		await device.open()
		if (device.configuration === null) {
			return device.selectConfiguration(1);
		}

		await device.claimInterface(0);

		this.#device = device;

		this.dispatchEvent(new CustomEvent('connected', { detail: { device }}));

		this.readLoop();
	}
}
