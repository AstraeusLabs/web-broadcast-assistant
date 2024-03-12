/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export const cobsEncode = (data, zeropad) => {
	if (!(data instanceof Uint8Array)) {
		throw new Error("Input data must be a Uint8Array");
	}

	const res = [0];
	let res_ptr = 0;
	let count = 1;


	const blockDone = last => {
		res[res_ptr] = count;
		res_ptr = res.length;
		if (!last || zeropad) {
			res.push(0);
		}
		count = 1;
	}

	for (const byte of data) {
		if (byte === 0) {
			blockDone(false);
		} else {
			res.push(byte);
			count++;
			if (count === 255) {
				blockDone(false);
			}
		}
	}
	blockDone(true);

	return new Uint8Array(res);
}

export const cobsDecode = (data, zeropad) => {
	if (!(data instanceof Uint8Array)) {
		throw new Error("Input data must be a Uint8Array");
	}

	const res = [];
	let count = 255;

	let tmpVal = 0;

	for (const byte of zeropad ? data.subarray(0, -1) : data) {
		if (tmpVal !== 0) {
			res.push(byte);
		} else {
			if (count !== 255) {
				res.push(0);
			}
			count = tmpVal = byte;
			if (count === 0) {
				break;
			}
		}
		tmpVal--;
	}

	return new Uint8Array(res);
}
