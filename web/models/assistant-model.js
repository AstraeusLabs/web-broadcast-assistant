/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import {
	MessageType,
	MessageSubType,
	BT_DataType,
	ltvToTvArray,
	tvArrayToLtv,
	tvArrayFindItem
} from '../lib/message.js';
import { compareTypedArray } from '../lib/helpers.js';

/**
* Assistant Model
*
* Keeps state info on sources & sinks
* Handles commands, responses and events
*
*/

/**
* Source device structure
*
*
* 	bt_name: string | undefined,
* 	broadcast_name: string | undefined
* 	broadcast_id: uint24, (UNIQUE IDENTIFIER)
* 	rssi: int8
*
*
* Sink device structure
*
*
* 	bt_addr: string | undefined, (UNIQUE IDENTIFIER)
* 	bt_name: string | undefined,
* 	connection_state: boolean,
* 	security_level: uint8,
* 	bass_state: idle | configured | streaming,
* 	broadcast_id: uint24,
* 	rssi: int8
*
*/

class AssistantModel extends EventTarget {
	#service
	#sinks
	#sources

	constructor(service) {
		super();

		this.#service = service;
		this.#sinks = [];
		this.#sources = [];

		this.serviceMessageHandler = this.serviceMessageHandler.bind(this);

		this.addListeners();
	}

	addListeners() {
		this.#service.addEventListener('connected', evt => {
			console.log('AssistantModel registered Service as connected');
			this.serviceIsConnected = true;
		});
		this.#service.addEventListener('disconnected', evt => {
			console.log('AssistantModel registered Service as disconnected');
			this.serviceIsConnected = false;
		});
		this.#service.addEventListener('message', this.serviceMessageHandler);
	}

	handleHeartbeat(message) {
		console.log(`Handle Heartbeat`);
		const payloadArray = ltvToTvArray(message.payload);
		console.log('Payload', payloadArray);

		const heartbeat_cnt = message.seqNo;

		this.dispatchEvent(new CustomEvent('heartbeat-received', {detail: heartbeat_cnt}));
	}

	addSourceFromBroadcastAudioURI(parsedCode) {
		const source = {};

		// Fetch address type (AT)
		const atToken = parsedCode.find(t => t.type === 'AT');

		// Assume 'random'/'random static' AT if not specified
		let addressType = 1;
		if (atToken && atToken.value !== undefined) {
			addressType = atToken.value;
		}

		parsedCode.forEach(token => {
			switch(token.type) {
				case 'AD':
					source.addr = {
						value: {
							...token.value,
							type: addressType
						},
						type: BT_DataType.BT_DATA_IDENTITY
					}
					break;
				case 'BN':
					source.broadcast_name = token.value;
					break;
				case 'BI':
					source.broadcast_id = token.value;
					break;
				case 'PI':
					source.pa_interval = token.value;
					break;
				case 'AS':
					source.sid = token.value;
					break;
			}
		});

		console.log(source);

		let existingSource = this.#sources.find(i => compareTypedArray(i.addr.value.addr, source.addr.value.addr));
		if (!existingSource) {
			this.#sources.push(source)
			this.dispatchEvent(new CustomEvent('source-found', {detail: { source }}));
		} else {
			console.log('Broadcast Audio URI already added');
		}

		// Always start playing source automatically when scanning QR code
		this.addSource(source);
	}

	handleSourceFound(message) {
		console.log(`Handle found Source`);

		const payloadArray = ltvToTvArray(message.payload);
		// console.log('Payload', payloadArray);

		const addr = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_IDENTITY,
			BT_DataType.BT_DATA_RPA
		]);

		if (!addr) {
			// TBD: Throw exception?
			return;
		}

		const rssi = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_RSSI
		])?.value;

		// TODO: Handle Broadcast ID parsing in message.js and attach to 'source'

		// If device already exists, just update RSSI, otherwise add to list
		let source = this.#sources.find(i => compareTypedArray(i.addr.value.addr, addr.value.addr));
		if (!source) {
			source = {
				addr,
				rssi,
				name: tvArrayFindItem(payloadArray, [
					BT_DataType.BT_DATA_NAME_SHORTENED,
					BT_DataType.BT_DATA_NAME_COMPLETE
				])?.value,
				broadcast_name: tvArrayFindItem(payloadArray, [
					BT_DataType.BT_DATA_BROADCAST_NAME
				])?.value,
				broadcast_id: tvArrayFindItem(payloadArray, [
					BT_DataType.BT_DATA_BROADCAST_ID
				])?.value,
				pa_interval: tvArrayFindItem(payloadArray, [
					BT_DataType.BT_DATA_PA_INTERVAL
				])?.value,
				sid: tvArrayFindItem(payloadArray, [
					BT_DataType.BT_DATA_SID
				])?.value
			}

			this.#sources.push(source)
			this.dispatchEvent(new CustomEvent('source-found', {detail: { source }}));
		} else {
			source.rssi = rssi;
			this.dispatchEvent(new CustomEvent('source-updated', {detail: { source }}));
		}
	}

	handleSourceBIGInfo(message) {
		console.log(`Handle Source BIG Info`);

		const payloadArray = ltvToTvArray(message.payload);
		// console.log('Payload', payloadArray);

		const addr = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_IDENTITY,
			BT_DataType.BT_DATA_RPA
		]);

		if (!addr) {
			// TBD: Throw exception?
			return;
		}

		const big_info = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_BIG_INFO
		])?.value;

		let source = this.#sources.find(i => compareTypedArray(i.addr.value.addr, addr.value.addr));
		if (source && big_info) {
			if (source.big_info) {
				// Already stored, bail out
				return;
			}
			source.big_info = big_info;
			this.dispatchEvent(new CustomEvent('big-info-updated', {detail: { source }}));
		}
	}

	handleSourceBase(message) {
		console.log(`Handle Source BASE`);

		const payloadArray = ltvToTvArray(message.payload);
		// console.log('Payload', payloadArray);

		const addr = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_IDENTITY,
			BT_DataType.BT_DATA_RPA
		]);

		if (!addr) {
			// TBD: Throw exception?
			return;
		}

		const base = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_BASE
		])?.value;

		let source = this.#sources.find(i => compareTypedArray(i.addr.value.addr, addr.value.addr));
		if (source && base) {
			if (source.base) {
				// Already stored, bail out
				return;
			}
			source.base = base;
			this.dispatchEvent(new CustomEvent('base-updated', {detail: { source }}));
		}
	}

	handleBISSync(message, isSynced) {
		console.log(`Handle BIS Sync`);

		const payloadArray = ltvToTvArray(message.payload);

		const sink_addr = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_IDENTITY,
			BT_DataType.BT_DATA_RPA
		]);

		if (!sink_addr) {
			// TBD: Throw exception?
			return;
		}

		const err = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_ERROR_CODE
		])?.value;

		const broadcast_id = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_BROADCAST_ID
		])?.value

		const source_id = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_SOURCE_ID
		])?.value

		// If device already exists, just update RSSI, otherwise add to list
		let sink = this.#sinks.find(i => compareTypedArray(i.addr.value.addr, sink_addr.value.addr));
		if (!sink) {
			console.warn("BIS Sync w/ unknown sink addr:", sink_addr);
			return;
		}

		let source = this.#sources.find(i => i.broadcast_id === broadcast_id);
		if (!source) {
			console.warn("Unknown source with broadcast ID:", broadcast_id?.toString(16).padStart(6, '0'));
			return;
		}

		let syncState = isSynced ? "selected" : undefined;

		this.#sources.forEach( s => {
			s.state = source === s ? syncState : undefined;
			this.dispatchEvent(new CustomEvent('source-updated', {detail: { source: s }}));
		});

		if (isSynced) {
			sink.source_added = source;
			sink.synced_source_id = source_id;
			console.log(`Sink '${sink.name} synced to source '${source.name}/${source.broadcast_name}' with source_id=${source_id}`)
		} else {
			sink.source_added = undefined;
			sink.synced_source_id = undefined;
		}

		this.dispatchEvent(new CustomEvent('sink-updated', {detail: { sink }}));
	}

	handleSinkFound(message) {
		console.log(`Handle found Sink`);

		const payloadArray = ltvToTvArray(message.payload);
		// console.log('Payload', payloadArray);

		const addr = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_IDENTITY,
			BT_DataType.BT_DATA_RPA
		]);

		if (!addr) {
			// TBD: Throw exception?
			return;
		}

		const rssi = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_RSSI
		])?.value;

		// If device already exists, just update RSSI, otherwise add to list
		let sink = this.#sinks.find(i => compareTypedArray(i.addr.value.addr, addr.value.addr));
		if (!sink) {
			sink = {
				addr,
				rssi,
				name: tvArrayFindItem(payloadArray, [
					BT_DataType.BT_DATA_NAME_SHORTENED,
					BT_DataType.BT_DATA_NAME_COMPLETE
				])?.value,
				uuid16s: tvArrayFindItem(payloadArray, [
					BT_DataType.BT_DATA_UUID16_ALL,
					BT_DataType.BT_DATA_UUID16_SOME,
				])?.value || []
			}

			this.#sinks.push(sink)
			this.dispatchEvent(new CustomEvent('sink-found', {detail: { sink }}));
		} else {
			sink.rssi = rssi;
			this.dispatchEvent(new CustomEvent('sink-updated', {detail: { sink }}));
		}
	}

	handleSinkConnectivityEvt(message) {
		console.log(`Handle connected/disconnected Sink`);

		const payloadArray = ltvToTvArray(message.payload);
		const addr = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_IDENTITY,
			BT_DataType.BT_DATA_RPA
		]);
		if (!addr) {
			// TBD: Throw exception?
			return;
		}

		const err = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_ERROR_CODE
		])?.value;

		// If device already exists, just update RSSI, otherwise add to list
		let sink = this.#sinks.find(i => compareTypedArray(i.addr.value.addr, addr.value.addr));

		if (!sink) {
			console.warn("Unknown sink connected with addr:", addr.value.addrStr);
		} else {
			if (err !== 0) {
				console.log("Error code", err);
				sink.state = "failed";
				this.dispatchEvent(new CustomEvent('sink-updated', {detail: { sink }}));
			} else {
				if (message.subType === MessageSubType.SINK_CONNECTED) {
					sink.state = "connected";

					const pairingInProgress = window["setPairingInProgress"];
					const pairedSetMembers = window["pairedSetMembers"];

					if (pairingInProgress) {
						window["pairedSetMembers"] = pairedSetMembers + 1;

						if (window["pairedSetMembers"] == window["set_size"]) {
							this.dispatchEvent(new CustomEvent('csis-pairing-complete'));
						}
					}

					this.dispatchEvent(new CustomEvent('sink-updated', {detail: { sink }}));
				} else if (message.subType === MessageSubType.SINK_DISCONNECTED) {
					const index = this.#sinks.indexOf(sink);
					if (index !== -1) {
						this.#sinks.splice(index, 1);
					}

					this.dispatchEvent(new CustomEvent('sink-disconnected', {detail: { sink }}));
				} else {
					console.warn("Unknown message subType:", message.subType);
				}
			}
		}
	}

	handleVolumeState(message) {
		console.log(`Handle Volume State`);

		const payloadArray = ltvToTvArray(message.payload);

		console.log(payloadArray);

		const addr = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_IDENTITY,
			BT_DataType.BT_DATA_RPA
		]);
		if (!addr) {
			// TBD: Throw exception?
			return;
		}

		const volume = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_VOLUME
		])?.value;

		const mute = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_MUTE
		])?.value;

		console.log(`Volume = ${volume}, mute = ${mute}`);

		// TODO: Reflect in UI when available.
	}

	handleVolumeControlFound(message) {
		console.log(`Handle Volume Control Found`);

		const payloadArray = ltvToTvArray(message.payload);

		console.log(payloadArray);

		const addr = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_IDENTITY,
			BT_DataType.BT_DATA_RPA
		]);
		if (!addr) {
			// TBD: Throw exception?
			return;
		}

		// TODO: Use UI to set volume instead of fixed values
		const sink = this.#sinks.find(i => compareTypedArray(i.addr.value.addr, addr.value.addr));
		if (!sink) {
			console.warn("Volume control found w/ unknown sink addr:",addr);
			return;
		}
		setTimeout(() => {
			// Delayed setVolume to prevent comm issue
			console.log('Set volume to 170');
			this.setVolume(sink, 170);
		}, 500);
	}

	handleSetIndentifierFound(message) {
		console.log(`Handle Set Indentifier Found`);

		const payloadArray = ltvToTvArray(message.payload);

		console.log(payloadArray);

		const addr = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_IDENTITY,
			BT_DataType.BT_DATA_RPA
		]);
		if (!addr) {
			// TBD: Throw exception?
			return;
		}

		const set_size = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_SET_SIZE
		])?.value;

		const rank = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_SET_RANK
		])?.value;

		const sirk = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_SIRK
		])?.value;

		console.log(`Set size = ${set_size}, rank = ${rank}, sirk = ${sirk}`);
		const sink = this.#sinks.find(i => compareTypedArray(i.addr.value.addr, addr.value.addr));

		if (sink) {
		    sink.csis = {
			sirk,
			rank,
			set_size
		    };
		}

		this.dispatchEvent(new CustomEvent('sirk-found', {detail: {sirk, set_size}}));
	}

	handleSetMemberFound(message) {
		console.log(`Handle Set Member Found`);

		const payloadArray = ltvToTvArray(message.payload);

		console.log(payloadArray);

		const addr = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_IDENTITY,
			BT_DataType.BT_DATA_RPA
		]);
		if (!addr) {
			// TBD: Throw exception?
			return;
		}

		// Send Connect : Note, if the connect fails, we should rely on FW to send new "found" event
		this.connectSink({addr});

		console.log(`Set member = ${addr}`);
	}

	handleSinkConnectivityRes(message) {
		console.log(`Handle Sink Connectivity Response`);
		// TODO: Tie RES to actual call (could be another sink)

		const payloadArray = ltvToTvArray(message.payload);

		const err = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_ERROR_CODE
		])?.value;

		if (err !== 0) {
			let sink = this.#sinks.find(i => i.state === "connecting");
			if (!sink) {
				console.warn("Unknown sink connected with addr:", addr.value.addr);
			} else {
				console.log("Error code", err);
				sink.state = "failed";
				this.dispatchEvent(new CustomEvent('sink-updated', {detail: { sink }}));
			}
		}
	}

	handleIdentityResolved(message) {
		console.log("Handle Identity Resolved");
		console.log(message);

		const payloadArray = ltvToTvArray(message.payload);
		console.log(payloadArray);

		const addrIdentity = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_IDENTITY
		]);
		console.log(addrIdentity)
		if (!addrIdentity) {
			console.warn("No Identity Address found in Identity Resolved handling");
			return;
		}

		const addrRPA = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_RPA
		]);

		if (!addrRPA) {
			console.warn("No RPA Address found in Identity Resolved handling");
			return;
		}

		let sink = this.#sinks.find(i => compareTypedArray(i.addr.value.addr, addrRPA.value.addr));
		if (!sink) {
			console.warn("Unknown sink had its identity resolved:", addrRPA.value.addr);
		} else {
			sink.addr = addrIdentity;
			this.dispatchEvent(new CustomEvent('sink-updated', {detail: { sink }}));
		}
	}

	handleStartSetMemberScanRes(message) {
		console.log("Handle Start Set Member Scan Res");

		const payloadArray = ltvToTvArray(message.payload);

		const err = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_ERROR_CODE
		])?.value;

		if (err !== 0) {
			console.log("Error code", err);
		}
	}

	handleRES(message) {
		console.log(`Response message with subType 0x${message.subType.toString(16)}`);

		switch (message.subType) {
			case MessageSubType.START_SINK_SCAN:
			console.log('START_SINK_SCAN response received');
			this.dispatchEvent(new CustomEvent('sink-scan-started'));
			break;
			case MessageSubType.START_SOURCE_SCAN:
			console.log('START_SOURCE_SCAN response received');
			this.dispatchEvent(new CustomEvent('source-scan-started'));
			break;
			case MessageSubType.STOP_SCAN:
			console.log('STOP_SCAN response received');
			this.dispatchEvent(new CustomEvent('scan-stopped'));
			break;
			case MessageSubType.CONNECT_SINK:
			console.log('CONNECT_SINK response received');
			this.handleSinkConnectivityRes(message);
			break;
			case MessageSubType.ADD_SOURCE:
			console.log('ADD_SOURCE response received');
			// NOOP/TODO
			break;
			case MessageSubType.BIG_BCODE:
			console.log('BIG_BCODE response received');
			this.dispatchEvent(new CustomEvent('scan-stopped'));
			break;
			case MessageSubType.RESET:
			console.log('RESET response received');
			this.dispatchEvent(new CustomEvent('scan-stopped'));
			break;
			case MessageSubType.START_SET_MEMBER_SCAN:
			console.log('START_SET_MEMBER_SCAN response received');
			this.handleStartSetMemberScanRes(message);
			break;
			default:
			console.log(`Missing handler for RES subType 0x${message.subType.toString(16)}`);
		}

	}

	handleEVT(message) {
		console.log(`Event with subType 0x${message.subType.toString(16)}`);

		switch (message.subType) {
			case MessageSubType.HEARTBEAT:
			this.handleHeartbeat(message);
			break;
			case MessageSubType.SINK_FOUND:
			this.handleSinkFound(message);
			break;
			case MessageSubType.SINK_CONNECTED:
			case MessageSubType.SINK_DISCONNECTED:
			this.handleSinkConnectivityEvt(message);
			break;
			case MessageSubType.SOURCE_FOUND:
			this.handleSourceFound(message);
			break;
			case MessageSubType.SOURCE_BIG_INFO:
			this.handleSourceBIGInfo(message);
			break;
			case MessageSubType.SOURCE_BASE_FOUND:
			this.handleSourceBase(message);
			break;
			case MessageSubType.SOURCE_ADDED:
			console.log("Source Added");
			break;
			case MessageSubType.STOP_SCAN:
			console.log('STOP_SCAN response received');
			this.dispatchEvent(new CustomEvent('scan-stopped'));
			break;
			case MessageSubType.SOURCE_ADDED:
			console.log('SOURCE_ADDED response received');
			this.dispatchEvent(new CustomEvent('source-added'));
			break;
			case MessageSubType.SOURCE_REMOVED:
			console.log('SOURCE_REMOVED response received');
			this.dispatchEvent(new CustomEvent('source-removed'));
			break;
			case MessageSubType.NEW_PA_STATE_NOT_SYNCED:
			// TODO: Add secondary visual feedback that we are PA un-synced
			case MessageSubType.NEW_PA_STATE_SYNCED:
			// TODO: Add secondary visual feedback that we are PA synced
			case MessageSubType.NEW_PA_STATE_INFO_REQ:
			case MessageSubType.NEW_PA_STATE_FAILED:
			case MessageSubType.NEW_PA_STATE_NO_PAST:
			break;
			case MessageSubType.BIS_SYNCED:
			this.handleBISSync(message, true);
			break;
			case MessageSubType.BIS_UNSYNCED:
			this.handleBISSync(message, false);
			break;
			case MessageSubType.IDENTITY_RESOLVED:
			this.handleIdentityResolved(message);
			break;
			case MessageSubType.SOURCE_BIG_ENC_BCODE_REQ:
			console.log('Add broadcast code');
			this.getBroadcastCode(message);
			break;
			case MessageSubType.SOURCE_BIG_ENC_NO_BAD_CODE:
			console.log('No/Bad broadcast code');
			this.getBroadcastCode(message);
			break;
			case MessageSubType.SINK_VOLUME_STATE:
			console.log('Volume state');
			this.handleVolumeState(message);
			break;
			case MessageSubType.SINK_VOLUME_CONTROL_FOUND:
			console.log('Volume control found');
			this.handleVolumeControlFound(message);
			break;
			case MessageSubType.SINK_SET_IDENTIFIER_FOUND:
			console.log('Set indentifier found');
			this.handleSetIndentifierFound(message);
			break;
			case MessageSubType.SET_MEMBER_FOUND:
			console.log('Set member found');
			this.handleSetMemberFound(message);
			default:
			console.log(`Missing handler for EVT subType 0x${message.subType.toString(16)}`);
		}
	}

	serviceMessageHandler(evt) {
		const { message } = evt.detail;

		if (!message) {
			console.warn("No message in event!");
			return;
		}

		if (message.type !== MessageType.EVT && message.type !== MessageType.RES) {
			console.log(`Unknown message type ${message.type}`);
			return;
		}

		switch (message.type) {
			case MessageType.RES:
			this.handleRES(message);
			break;
			case MessageType.EVT:
			this.handleEVT(message);
			break;
			default:
			console.log(`Could not interpret message with type ${message.type}`);
		}
	}

	resetBA() {
		console.log("Sending Reset CMD")

		const message = {
			type: Number(MessageType.CMD),
			subType: MessageSubType.RESET,
			seqNo: 123,
			payload: new Uint8Array([])
		};

		this.#service.sendCMD(message)

		// Also reset the UI
		this.dispatchEvent(new Event('reset'));
		this.#sinks = [];
		this.#sources = [];
	}

	startHeartbeat() {
		console.log("Sending Heartbeat CMD")

		const message = {
			type: Number(MessageType.CMD),
			subType: MessageSubType.HEARTBEAT,
			seqNo: 123,
			payload: new Uint8Array([])
		};

		this.#service.sendCMD(message)
	}

	startSinkScan() {
		this.clearSinkList();

		console.log("Sending Start Sink Scan CMD")

		const message = {
			type: Number(MessageType.CMD),
			subType: MessageSubType.START_SINK_SCAN,
			seqNo: 123,
			payload: new Uint8Array([])
		};

		this.#service.sendCMD(message)
	}

	startSourceScan() {
		this.clearSourceList();

		console.log("Sending Start Source Scan CMD")

		const message = {
			type: Number(MessageType.CMD),
			subType: MessageSubType.START_SOURCE_SCAN,
			seqNo: 123,
			payload: new Uint8Array([])
		};

		this.#service.sendCMD(message)
	}

	stopScan() {
		console.log("Sending Stop Scan CMD")

		const message = {
			type: Number(MessageType.CMD),
			subType: MessageSubType.STOP_SCAN,
			seqNo: 123,
			payload: new Uint8Array([])
		};

		this.#service.sendCMD(message)
	}

	addSource(source) {
		console.log("Sending Add Source CMD");

		const { addr } = source;

		if (!addr) {
			throw Error("Address not found in source object!");
		}

		const sidItem = { type: BT_DataType.BT_DATA_SID, value: source.sid };
		console.log(sidItem);

		const intervalItem = { type: BT_DataType.BT_DATA_PA_INTERVAL, value: source.pa_interval };
		console.log(intervalItem);

		const bidItem = { type: BT_DataType.BT_DATA_BROADCAST_ID, value: source.broadcast_id };
		console.log(bidItem);

		const tvArr = [
			{ type: BT_DataType.BT_DATA_SID, value: source.sid },
			{ type: BT_DataType.BT_DATA_PA_INTERVAL, value: source.pa_interval },
			{ type: BT_DataType.BT_DATA_BROADCAST_ID, value: source.broadcast_id },
			addr,
		];

		// If the source has BASE information and there is more than one subgroup,
		// send 0's for all subgroups except the chosen, which will be 0xFFFFFFFF (no pref)
		// (or specific bitmask, but commented out for now)
		if (source.base?.subgroups?.length) {
			const value = [];

			source.base?.subgroups?.forEach(sg => {
				if (sg.isSelected) {
					// For each BIS in Subgroup, set bit corresponding to index
					let bis_sync = 0;
					sg.bises?.forEach(bis => {
						if (bis.index) {
							bis_sync += 1 << (bis.index-1);
						}
					});
					// Setting more than one bit or NO_PREF confuses some earbuds
					// so for now, just send NO_PREF and let the earbud determine
					// LEFT or RIGHT from channel allocation.
					bis_sync = 0xFFFFFFFF;  // Comment this out to go back to bitmask
					value.push(bis_sync);
				} else {
					value.push(0);
				}
			});

			tvArr.push({ type: BT_DataType.BT_DATA_BIS_SYNC, value });

			console.log("BIS SYNC TO", value);
		}

		const payload = tvArrayToLtv(tvArr);

		console.log('Add Source payload', payload)

		const message = {
			type: Number(MessageType.CMD),
			subType: MessageSubType.ADD_SOURCE,
			seqNo: 123,
			payload
		};

		this.#service.sendCMD(message);
	}

	getBroadcastCode(message) {
		console.log("Query for Broadcast Code");

		const payloadArray = ltvToTvArray(message.payload);

		console.log(payloadArray);

		const sink_addr = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_IDENTITY,
			BT_DataType.BT_DATA_RPA
		]);

		if (!sink_addr) {
			// TBD: Throw exception?
			return;
		}

		const err = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_ERROR_CODE
		])?.value;

		const broadcast_id = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_BROADCAST_ID
		])?.value

		const source_id = tvArrayFindItem(payloadArray, [
			BT_DataType.BT_DATA_SOURCE_ID
		])?.value

		let sink = this.#sinks.find(i => compareTypedArray(i.addr.value.addr, sink_addr.value.addr));
		if (!sink) {
			console.warn("BCODE request w/ unknown sink addr:", sink_addr);
			return;
		}

		console.log(`BCODE request: Sink=${sink.name}, source_id=${source_id}`);

		this.dispatchEvent(new CustomEvent('bc-request', {detail: {sink , source_id}}));
	}

	sendBroadcastCode(arr, source_id) {
		console.log("Sending Broadcast Code CMD");

		const tvArr = [
			{ type: BT_DataType.BT_DATA_SOURCE_ID, value: source_id },
			{ type: BT_DataType.BT_DATA_BROADCAST_CODE, value: arr },
		];

		const payload = tvArrayToLtv(tvArr);

		console.log('Add Broadcast Code payload', payload)

		const message = {
			type: Number(MessageType.CMD),
			subType: MessageSubType.BIG_BCODE,
			seqNo: 123,
			payload
		};

		this.#service.sendCMD(message);
	}

	removeSource(source) {
		// TODO: support selecting sink in web and firmware.
		//       for now FW removes on connected sink(s)
		console.log("Sending Remove Source CMD");

		// Look through connected and playing/synced sinks to find a source ID
		// TODO: Call this for each connected and synced sink if we move multi connection handling
		// to the web code.
		let sink = this.#sinks.find(i => i.source_added);

		if (!sink) {
			console.log("No playing sink found!");
			return;
		}

		const tvArr = [
			{ type: BT_DataType.BT_DATA_SOURCE_ID, value: sink.synced_source_id }
		];

		// If there are multiple subgroups on the synced source, add array of zeros (len=num subgroups)
		if (source.base?.subgroups?.length) {
			tvArr.push({ type: BT_DataType.BT_DATA_BIS_SYNC, value: new Array(source.base?.subgroups?.length).fill(0) });
		}

		const payload = tvArrayToLtv(tvArr);

		console.log('tvArr and payload', tvArr, payload);

		const message = {
			type: Number(MessageType.CMD),
			subType: MessageSubType.REMOVE_SOURCE,
			seqNo: 123,
			payload
		};

		this.#service.sendCMD(message);
	}

	connectSink(sink) {
		console.log("Sending Connect Sink CMD");

		const { addr } = sink;

		if (!addr) {
			throw Error("Address not found in sink object!");
		}

		const payload = tvArrayToLtv([addr]);

		console.log('addr payload', payload);

		const message = {
			type: Number(MessageType.CMD),
			subType: MessageSubType.CONNECT_SINK,
			seqNo: 123,
			payload
		};

		this.#service.sendCMD(message);

		sink.state = "connecting";
		this.dispatchEvent(new CustomEvent('sink-updated', {detail: { sink }}));
	}

	disconnectSink(sink) {
		console.log("Sending Disconnect Sink CMD");

		const { addr } = sink;

		if (!addr) {
			throw Error("Address not found in sink object!");
		}

		const payload = tvArrayToLtv([addr]);

		console.log('addr payload', payload);

		const message = {
			type: Number(MessageType.CMD),
			subType: MessageSubType.DISCONNECT_SINK,
			seqNo: 123,
			payload
		};

		this.#service.sendCMD(message);
	}

	setVolume(sink, volume) {
		console.log("Set Volume on Sink CMD");

		const { addr } = sink;

		if (!addr) {
			throw Error("Address not found in sink object!");
		}

		const tvArr = [
			{ type: BT_DataType.BT_DATA_VOLUME, value: volume },
			addr
		];

		const payload = tvArrayToLtv(tvArr);

		const message = {
			type: Number(MessageType.CMD),
			subType: MessageSubType.SET_VOLUME,
			seqNo: 123,
			payload
		};

		this.#service.sendCMD(message);
	}

	setMute(sink, state) {
		console.log("Set Mute/Unmute on Sink CMD");

		const { addr } = sink;

		if (!addr) {
			throw Error("Address not found in sink object!");
		}

		const payload = tvArrayToLtv([addr]);

		const message = {
			type: Number(MessageType.CMD),
			subType: state ? MessageSubType.MUTE : MessageSubType.UNMUTE,
			seqNo: 123,
			payload
		};

		this.#service.sendCMD(message);
	}

	handlePrefoundSetMembers(set_size, sirk) {
		console.log("Connect to already found CSIS set members");

		const connected_set_members = this.#sinks.filter(i => (i.csis && compareTypedArray(i.csis.sirk, sirk) && i.state === "connected"));
		const unconnected_set_members = this.#sinks.filter(i => (i.csis && compareTypedArray(i.csis.sirk, sirk) && i.state ==! "connected"));

		window["pairedSetMembers"] = connected_set_members.length;

		// If we already discovered members that are not connected yet, connect to them now
		unconnected_set_members.forEach( s => { this.connectSink(s); });

		// In case all other members were already connected before, then we just need to send off event that we are done
		const pairedSetMembers = window["pairedSetMembers"];

		if (pairedSetMembers == set_size) {
			this.dispatchEvent(new CustomEvent('csis-pairing-complete'));
		}
	}

	findSetMembers(set_size, sirk) {
		console.log("Connect CSIS set members CMD");

		const tvArr = [
			{ type: BT_DataType.BT_DATA_SET_SIZE, value: set_size },
			{ type: BT_DataType.BT_DATA_SIRK, value: sirk },
		];

		const payload = tvArrayToLtv(tvArr);

		const message = {
			type: Number(MessageType.CMD),
			subType: MessageSubType.START_SET_MEMBER_SCAN,
			seqNo: 123,
			payload
		};

		this.#service.sendCMD(message);
	}

	clearSinkList() {
		this.#sinks = this.#sinks.filter(i => (i.state === "connected"));
		console.log(`Sink list cleared`);

		this.dispatchEvent(new CustomEvent('sink-list-cleared'));
	}

	clearSourceList() {
		this.#sources = this.#sources.filter(i => i.state === "selected");
		console.log(`Source list cleared`);

		this.dispatchEvent(new CustomEvent('source-list-cleared'));
	}
}

let _instance = null;

export const initializeAssistantModel = deviceService => {
	if (!_instance) {
		_instance = new AssistantModel(deviceService);
	}
	return _instance;
}

export const getInstance = () => {
	if (!_instance) {
		throw Error("AssistantModel not instantiated...");
	}
	return _instance;
}
