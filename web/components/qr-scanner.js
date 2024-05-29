/*
* Copyright (c) 2024 Demant A/S
*
* SPDX-License-Identifier: Apache-2.0
*/

/*
* QR Scanner Component
*/

const template = document.createElement('template');
template.innerHTML = `
<style>
div {
	display: block;
	position: relative;
	box-sizing: border-box;
	min-width: 5.14em;
	height: auto;
	margin: 0;
	background: transparent;
	text-align: center;
}

video {
	width: 100%;
	height: auto;
}

button {
	display: block;
	position: relative;
	box-sizing: border-box;
	min-width: 5.14em;
        width: 100%;
	// margin: 0.2em;
	background: transparent;
	text-align: center;
	font: inherit;
	text-transform: uppercase;
	outline: none;
	border: 0;
	border-radius: 5px;
	user-select: none;
	cursor: pointer;
	z-index: 0;
	padding: 0.7em 0.57em;
	box-shadow: 3px 3px 6px 3px gray;
	background-color: var(--background-color, );
	color: black;
	transition: box-shadow 0.1s ease-out;
      }

button:active:not([disabled]) {
	box-shadow: 1px 1px 2px 3px gray;
}

button:disabled {
	color: gray;
	box-shadow: 1px 1px 2px 2px lightgray;
}
</style>
<div id="scanner">
<video id="camera" muted autoplay="autoplay" playsinline="playsinline"></video>
<button id="close">Close</button>
</div>
`;

const base64ToBytes = (base64) => {
	const binString = atob(base64);
	return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

const bytesToBase64 = (bytes) => {
	const binString = Array.from(bytes, (byte) =>
		String.fromCodePoint(byte)).join("");
	return btoa(binString);
}

const addressStringToArray = (str) => {
	return str.split(':').reverse().map(v => Number.parseInt(v, 16));
}

const BROADCAST_AUDIO_URI_SCHEME = 'BLUETOOTH:';

const parseBroadcastURI = (str) => {
	// Check that the string starts with "BLUETOOTH:"
	if (!str.startsWith(BROADCAST_AUDIO_URI_SCHEME)) {
		return [];
	}

	const result = [];

	// split sections (;)
	const sections = str.substring(BROADCAST_AUDIO_URI_SCHEME.length).split(';');

	sections.forEach(section => {
		const [key, value] = section.split(':');

		switch (key) {
			case 'AT': // Address type
			result.push({
				type: key,
				value: Number.parseInt(value)
			});
			break;
			case 'BC': // Broadcast code
			case 'BN': // Broadcast Name
			result.push({
				type: key,
				value: new TextDecoder().decode(base64ToBytes(value))
			});
			break;
			case 'AD':
			const addrStr = value.match(/.{1,2}/g).join(':');
			const addrVal = new Uint8Array(addressStringToArray(addrStr));
			result.push({
				type: key,
				value: {
					addr: addrVal,
					addrStr
				}
			});
			break;
			case 'UUID':
			case 'BI': // Broadcast ID
			case 'PI': // PA interval
			case 'AS': // Advertising SID
			result.push({
				type: key,
				value: Number.parseInt(value, 16)
			})
			break;
			case 'SM':
			// meta data
			break;
		}
	});


	return result;
}

export class QrScanner extends HTMLElement {
	#videoStream
	#decoderActive
	#camera
	#barcodeDetector

	constructor() {
		super();

		const shadowRoot = this.attachShadow({mode: 'open'});
		shadowRoot.appendChild(template.content.cloneNode(true));

		this.startCamera = this.startCamera.bind(this);
		this.stopCamera = this.stopCamera.bind(this);
		this.decodeQr = this.decodeQr.bind(this);
		this.requestClose = this.requestClose.bind(this);
	}

	connectedCallback() {
		this.#camera = this.shadowRoot?.querySelector('#camera');

		this.#barcodeDetector = new window.BarcodeDetector();

		this.shadowRoot?.querySelector('#close').addEventListener('click', this.requestClose);
	}

	async startCamera() {
		const constraints = {video: true, audio: false};
		let stream = await navigator.mediaDevices.getUserMedia(constraints);

		const devices = await navigator.mediaDevices.enumerateDevices();

		const videoDevices = devices.filter(d => d.kind == 'videoinput');

		// Try to find the back camera if using a phone
		const backDevice = videoDevices.find(d => d.label.toLowerCase().includes('back'));

		if (backDevice) {
			constraints.video = {deviceId: backDevice.deviceId};
		}

		stream = await navigator.mediaDevices.getUserMedia(constraints);
		this.#videoStream = stream;

		this.#camera.srcObject = stream;

		this.#decoderActive = true;

		setTimeout(this.decodeQr, 500);
	}

	stopCamera (){
		try {
			if (this.#videoStream){
				this.#videoStream.getTracks().forEach(t => t.stop());
			}
		} catch (e){
			alert(e.message);
		}
	}

	async decodeQr(){
		const barcodes = await this.#barcodeDetector.detect(this.#camera);

		if (barcodes?.length) {
			for (const barcode of barcodes) {
				const decoded = parseBroadcastURI(barcode.rawValue);

				if (decoded?.length) {
					this.#decoderActive = false;
					this.dispatchEvent(new CustomEvent('bau-found', {detail: {decoded, raw:barcode.rawValue}}));
					this.requestClose();
					break;
				}
			}
		}

		if (this.#decoderActive) {
			// Try again in 100ms
			setTimeout(this.decodeQr, 100);
		}
	}

	requestClose() {
		console.log('Request close...');
		this.dispatchEvent(new Event('close'));
	}

}
customElements.define('qr-scanner', QrScanner);
