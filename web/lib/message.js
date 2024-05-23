/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { cobsEncode, cobsDecode } from './cobs.js';
import { arrayToHex } from './helpers.js';
import { parse_base } from './bap_base.js';

/**
* This module contains enums and functions related to messages
*
* message format:
*
*              type,           // 1byte, CMD, RES or EVT
*              subType,        // 1byte, e.g. START_SINK_SCAN (CMD/RES) or SINK_FOUND (EVT)
*              seqNo,          // 1byte, (to match CMD & RES, detect missing EVT)
*              payloadSize,    // 2byte, byte length of payload
*              payload         // Nbytes (payload for further processing, Uint8Array)
*
*/

export const MessageType = Object.freeze({
	CMD: 0x01,
	RES: 0x02,
	EVT: 0x03
});

export const MessageSubType = Object.freeze({
	// CMD/RES (MSB = 0)
	START_SINK_SCAN:		0x01,
	START_SOURCE_SCAN:		0x02,
	START_SCAN_ALL:			0x03,
	STOP_SCAN:			0x04,
	CONNECT_SINK:			0x05,
	DISCONNECT_SINK:		0x06,
	ADD_SOURCE:			0x07,
	REMOVE_SOURCE:			0x08,

	RESET:				0x2A,

	// EVT (MSB = 1)
	SINK_FOUND:			0x81,
	SOURCE_FOUND:			0x82,
	SINK_CONNECTED:			0x83,
	SINK_DISCONNECTED:		0x84,
	SOURCE_ADDED:			0x85,
	SOURCE_REMOVED:			0x86,
	NEW_PA_STATE_NOT_SYNCED:	0x87,
	NEW_PA_STATE_INFO_REQ:		0x88,
	NEW_PA_STATE_SYNCED:		0x89,
	NEW_PA_STATE_FAILED:		0x8A,
	NEW_PA_STATE_NO_PAST:		0x8B,
	BIS_SYNCED:			0x8C,
	BIS_UNSYNCED:			0x8D,
	IDENTITY_RESOLVED:		0x8E,
	SOURCE_BASE_FOUND:		0x8F,

	HEARTBEAT:			0xFF,
});

export const BT_DataType = Object.freeze({
	BT_DATA_UUID16_SOME:		0x02,	// uint16[n]
	BT_DATA_UUID16_ALL:		0x03,	// uint16[n]
	BT_DATA_UUID32_SOME:		0x04,	// uint32[n]
	BT_DATA_UUID32_ALL:		0x05,	// uint32[n]

	BT_DATA_NAME_SHORTENED:		0x08,	// utf8 (variable len)
	BT_DATA_NAME_COMPLETE:		0x09,	// utf8 (variable len)

	BT_DATA_SVC_DATA16:		0x16,

	BT_DATA_BROADCAST_NAME:		0x30,	// utf8 (variable len)

	// The following types are created for this app (not standard)
	BT_DATA_BASE:                   0xf7,   // uint8[] (variable len)
	BT_DATA_IDENTITY:		0xf8,   // uint8 (type) + uint8[6] (addr)
	BT_DATA_RPA:			0xf9,   // uint8 (type) + uint8[6] (addr)
	BT_DATA_BROADCAST_ID:		0xfa,	// uint24
	BT_DATA_ERROR_CODE:		0xfb,	// int32
	BT_DATA_PA_INTERVAL:		0xfc,	// uint16
	BT_DATA_SID:			0xfd,	// uint8
	BT_DATA_RSSI:			0xfe,	// int8
});

export const BT_UUID = Object.freeze({
	BT_UUID_BROADCAST_AUDIO:	0x1852,
});

export const msgToArray = msg => {
	// Simple validation
	if (!Object.values(MessageType).includes(msg?.type)) {
		throw new Error(`Message type invalid (${msg?.type})`);
	}

	if (!Object.values(MessageSubType).includes(msg?.subType)) {
		throw new Error(`Message subType invalid (${msg?.subType})`);
	}
	// TBD: Maybe check subType MSB against message type

	// If seqNr is anything but an integer between 0 and 255, default to 0.
	// Note: This also means that it can be omitted and default to 0.
	let seqNo = msg?.seqNo;
	if (!Number.isInteger(seqNo) || seqNo < 0 || seqNo > 255) {
		seqNo = 0;
	}

	// If payloadSize is omitted, it will be set to the length of the payload
	// The payload can be 'undefined' or an Uint8Array, if undefined, length = 0
	let payloadSize = msg?.payloadSize;
	if (payloadSize !== undefined && msg.payload === undefined) {
		throw new Error(`payloadSize must be omitted if payload is omitted`);
	}

	if (msg.payload instanceof Uint8Array) {
		const actSize = msg.payload.length;
		if (payloadSize === undefined) {
			payloadSize = actSize;
		} else if (Number.isInteger(payloadSize)) {
			if (payloadSize !== actSize) {
				throw new Error(`Actual payload size (${actSize})` +
				` != payloadSize (${msg.payloadSize})`);
			}
		} else {
			throw new Error(`Invalid payloadSize (${payloadSize})`);
		}
	} else if (msg.payload === undefined) {
		payloadSize = 0;
	} else {
		throw new Error("If set, payload must be a Uint8Array");
	}

	const header = new Uint8Array([msg.type, msg.subType, seqNo, payloadSize & 0xff, payloadSize >> 8]);

	if (msg.payload instanceof Uint8Array && msg.payload.length !== 0) {
		const msgWithPayload = new Uint8Array(header.length + msg.payload.length);
		msgWithPayload.set(header);
		msgWithPayload.set(msg.payload, header.length);

		return msgWithPayload;
	}

	return header;
}

export const arrayToMsg = data => {
	if (!(data instanceof Uint8Array)) {
		throw new Error("Input data must be a Uint8Array");
	}

	if (data.length < 5) {
		throw new Error(`Array too short (${data.length} < 5)`);
	}

	const payloadSize = data[3] + (data[4] << 8);
	if (data.length !== payloadSize + 5) {
		throw new Error(`Actual payload size (${data.length - 5}) != payloadSize (${payloadSize})`);
	}

	// TODO: Full validation
	console.log('Validation complete...');

	return {
		type: data[0],
		subType: data[1],
		seqNo: data[2],
		payloadSize,
		payload: data.slice(5)
	}
}

const utf8decoder = new TextDecoder();

const addressStringToArray = (str) => {
	return str.split(':').reverse().map(v => Number.parseInt(v, 16));
}

const uintToArray = (num, length) => {
	if (length < 1 || length > 4) {
		throw new Error("Can only handle uint8, 16, 24, 32");
	}

	let outArr = [];

	for (var i = 0; i < length; i++) {
		outArr.push((num >> (8*i)) & 0xff)
	}

	return outArr;
}

const bufToInt = (data, signed) => {
	if (!(data instanceof Uint8Array)) {
		throw new Error("Input data must be a Uint8Array");
	}

	if (data.length < 1 || data.length > 4) {
		throw new Error("Can only handle int8, 16, 24, 32");
	}
	const width = data.length * 8;

	let item = 0;
	let count = 0;
	while(count < data.length) {
		item += data[count] << (8*count);
		count++;
	}

	if (signed) {
		const neg = item & (1 << (width - 1));
		const tmp = (1 << width);
		const min = -tmp;
		return neg ? min + (item & (tmp - 1)) : item;
	}

	return item;
}

const bufToValueArray = (data, itemsize) => {
	// Used to extract uint8, 16, 24 or 32 values
	if (!(data instanceof Uint8Array)) {
		throw new Error("Input data must be a Uint8Array");
	}

	if (itemsize < 1 || itemsize > 4) {
		return [];
	}

	if (data.length % itemsize !== 0) {
		return [];
	}

	const res = [];
	let ptr = 0;
	while (ptr < data.length) {
		let item = 0;
		let count = 0;
		while(count < itemsize) {
			item += data[ptr++] << (8*count);
			count++;
		}
		res.push(item);
	}

	return res;
}

const parseLTVItem = (type, len, value) => {
	// type: uint8 (AD type)
	// len: utin8
	// value: Uint8Array

	if (len === 0 || len != value.length) {
		return;
	}

	const item = { type };
	// For now, just parse the ones we know
	switch (type) {
		case BT_DataType.BT_DATA_NAME_SHORTENED:
		case BT_DataType.BT_DATA_NAME_COMPLETE:
		case BT_DataType.BT_DATA_BROADCAST_NAME:
		item.value = utf8decoder.decode(value);
		break;
		case BT_DataType.BT_DATA_UUID16_SOME:
		case BT_DataType.BT_DATA_UUID16_ALL:
		item.value = bufToValueArray(value, 2);
		break;
		case BT_DataType.BT_DATA_UUID32_SOME:
		case BT_DataType.BT_DATA_UUID32_ALL:
		item.value = bufToValueArray(value, 4);
		break;
		case BT_DataType.BT_DATA_RSSI:
		case BT_DataType.BT_DATA_ERROR_CODE:
		item.value = bufToInt(value, true);
		break;
		case BT_DataType.BT_DATA_BROADCAST_ID:
		case BT_DataType.BT_DATA_PA_INTERVAL:
		case BT_DataType.BT_DATA_SID:
		item.value = bufToInt(value, false);
		break;
		case BT_DataType.BT_DATA_RPA:
		case BT_DataType.BT_DATA_IDENTITY:
		item.value = {
			type: value[0],
			addr: value.slice(1)
		}
		item.value.addrStr = bufToAddressString(item.value.addr);
		const subTypeName = keyName(MessageSubType, type);
		console.log(subTypeName, item.value, bufToAddressString(item.value.addr));
		break;
		case BT_DataType.BT_DATA_BASE:
		item.value = parse_base(value);
		console.log('BASE received', value, JSON.stringify(item.value, null, 2));
		break;
		default:
		item.value = "UNHANDLED";
		break;
	}

	return item;
}

export const bufToAddressString = (data) => {
	if (data.length != 6) {
		return `UNKNOWN ADDRESS`
	}

	return Array.from(data, b => b.toString(16).padStart(2, '0')).reverse().join(':').toUpperCase();
}

/**
* ltvToPayloadArray
*
* @param payload	Uint8Array containing LTV fields
* @returns 		Type Value Array containing decoded fields [{type, value}, ...]
*/
export const ltvToTvArray = payload => {
	const res = [];

	if (!payload) {
		return res;
	}

	// console.log('LTV decode of: ', arrayToHex(payload));
	let ptr = 0;
	// Iterate over the LTV fields and convert to items in array.
	while (ptr < payload.length) {
		const len = payload[ptr++] - 1;
		const type = payload[ptr++];
		if (ptr + len > payload.length) {
			console.warn("Error in LTV structure");
			break;
		}
		const value = payload.subarray(ptr, ptr + len);
		ptr += len;

		const item = parseLTVItem(type, len, value);
		if (item) {
			res.push(item);
		}
	}

	return res;
}

/**
* tvArrayToLtv
*
* @param arr		Type Value Array containing decoded fields [{type, value}, ...]
* @returns 		Uint8Array containing LTV fields
*/
export const tvArrayToLtv = arr => {
	const result = [];

	for (const item of arr) {
		const { type, value } = item;
		let outArr;

		if (type === undefined || value === undefined) {
			// TBD: Throw error?
			continue;
		}

		// TODO: Add handlers for types needed for commands.
		switch (type) {
			case BT_DataType.BT_DATA_RPA:
			case BT_DataType.BT_DATA_IDENTITY:
			outArr = [value.type, ...Array.from(value.addr)];
			break;
			case BT_DataType.BT_DATA_BROADCAST_ID:
			outArr = uintToArray(value, 3);	//uint24
			break;
			case BT_DataType.BT_DATA_PA_INTERVAL:
			outArr = uintToArray(value, 2); //uint16
			break;
			case BT_DataType.BT_DATA_SID:
			outArr = uintToArray(value, 1);	//uint8
			break;
			default:
			// Don't add fields we don't handle yet
			continue;
		}

		const len = outArr.length + 1;

		result.push(len);
		result.push(type);
		result.push(...outArr);
	}

	return new Uint8Array(result);
}

/**
* tvArrayFindItem
*
* @param arr 		Type Value Array [{type, value}, ...] (e.g. output from ltvToArray)
* @param types		Array with Types to search for
* @returns		First element found with type in types
*/
export const tvArrayFindItem = (arr, types) => {
	// This will find and return the first value, matching any type given

	return arr.find(item => types.includes(item.type));
}

const keyName = (obj, val) => {
	return Object.entries(obj).find(i => i[1] === val)?.[0];
}

export const logString = (message, extraInfo) => {
	const ts = (new Date()).toISOString().substring(11,23); // "HH:mm:ss.sss"

	const typeName = keyName(MessageType, message.type);
	const subTypeName = keyName(MessageSubType, message.subType);

	const entries = ltvToTvArray(message.payload);

	const addr = tvArrayFindItem(entries, [
		BT_DataType.BT_DATA_RPA,
		BT_DataType.BT_DATA_IDENTITY
	])?.value;

	let addrStr = "";

	if (addr && addr.addr) {
		addrStr = bufToAddressString(addr.addr);
	}

	const err = tvArrayFindItem(entries, [
		BT_DataType.BT_DATA_ERROR_CODE
	])?.value;

	// TODO: Expand with relevant content
	return `[${ts}] ${typeName} ${subTypeName}${!err ? '' : " ERROR: "+err} ${addrStr}${extraInfo || ''}`;
}
