/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import './components/sink-device-list.js';
import './components/source-device-list.js';
import {QrScanner} from './components/qr-scanner.js';
import './components/heart-beat.js';

import * as AssistantModel from './models/assistant-model.js';
import { WebUSBDeviceService } from './services/webusb-device-service.js';
import {
	logString,
	MessageType,
	MessageSubType,
} from './lib/message.js';

const template = document.createElement('template');
template.innerHTML = `
<style>
.flex-container {
	display: flex;
	font-family: sans-serif;
	font-optical-sizing: auto;
	font-weight: 400;
	font-style: normal;

	padding-bottom: 100px;
}

.activity-container {
	position: fixed;
	width: 100vw;
	bottom: 10px;
	display: flex;
	height: auto;

	font-family: sans-serif;
	font-optical-sizing: auto;
	font-weight: 400;
	font-style: normal;
}

.content {
	margin: auto;
	position: relative;
	width: 90%;
	max-width: 700px;
}

.col {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.row {
	display: flex;
	flex-direction: row;
	gap: 10px;
	align-items: center
}

.right-align { margin-left: auto; }

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

.textbox {
	box-sizing: border-box;
	border: 1px solid darkgray;

	background: rgba(255, 255, 255, 0.8);
	backdrop-filter: blur;
	box-shadow: 3px 3px 6px 3px lightgray;

	height: 5em;
	overflow-y: auto;
	white-space: pre-line;
	font-family: monospace;
	font-size: smaller;
	transition: height 0.2s ease-out;
}

@media(hover: hover) and (pointer: fine) {
	.textbox:hover {
		height: 30em;
	}

	button:hover:not([disabled]) {
		background-color: #F0F0F0;
	}
}

.textbox.expanded {
	height: 30em;
}

.textbox.expanded {
	border: 2px solid black;
}

#qrscannerbox {
	display: flex;
	position: fixed;
	left: 0;
	top: 0;
	width: 100vw;
	height: 100vh;

	background: rgba(255, 255, 255, 0.8);
	backdrop-filter: blur(10px);

	z-index: 900;
}

#qrscannerbox.hidden {
	display: none;
}

.qrscannercontent {
	margin: auto;
	position: relative;
	width: 90%;
	max-width: 500px;
}

#splashbox {
	display: flex;
	position: fixed;
	left: 0;
	top: 0;
	width: 100vw;
	height: 100vh;

	background: rgba(255, 255, 255, 0.8);
	backdrop-filter: blur(10px);

	z-index: 1000;
}

#splashbox.hidden {
	display: none;
}

.splashcontent {
	margin: auto;
	position: relative;
	width: 90%;
	max-width: 500px;
}



</style>

<div class="flex-container">
	<div class="content">
		<div class="col">
			<div class="row">
			<h2>WebUSB Broadcast Assistant</h2>
			<div class="right-align">
			<heartbeat-indicator></heartbeat-indicator>
			</div>
			</div>

			<div class="row">
			<button id="sink_scan">Discover<br>Sinks</button>
			<button id='stop_scan'>Stop<br>Scanning</button>
			<button id="source_scan">Discover<br>Sources</button>
			</div>

			<!-- broadcast sink components... -->
			<sink-device-list></sink-device-list>

			<!-- broadcast source components... -->
			<source-device-list></source-device-list>
			<button id="qr_scan">Broadcast Audio URI QR Scan</button>
		</div>
	</div>
</div>

<div class="activity-container">
	<div class="content">
		<div class="col">
			<div id="activity" class="textbox"></div>
		</div>
	</div>
</div>

<div id="qrscannerbox" class="hidden">
	<div class="qrscannercontent">
		<div class="col">
			<h2>Scan Broadcast Audio URI</h2>
			<qr-scanner></qr-scanner>
		</div>
	</div>
</div>

<div id="splashbox">
	<div class="splashcontent">
		<div class="col">
			<h2>WebUSB Broadcast Assistant</h2>
			<button id='connect'>Connect to WebUSB device</button>
		</div>
	</div>
</div>

`;

export class MainApp extends HTMLElement {
	#scanSinkButton
	#scanSourceButton
	#stopScanButton
	#qrScanButton
	#model
	#pageState
	#qrScanner

	constructor() {
		super();

		this.#pageState = new Map();

		for (let [name, value] of new URLSearchParams(location.search).entries()) {
			this.#pageState.set(name, value);

			console.log("STATE", name, value);
		}

		this.initializeModels();

		const shadowRoot = this.attachShadow({mode: 'open'});

		this.sendReset = this.sendReset.bind(this);
		this.scanStopped = this.scanStopped.bind(this);
		this.sinkScanStarted = this.sinkScanStarted.bind(this);
		this.sourceScanStarted = this.sourceScanStarted.bind(this);
		this.sendStopScan = this.sendStopScan.bind(this);
		this.sendStartSinkScan = this.sendStartSinkScan.bind(this);
		this.sendStartSourceScan = this.sendStartSourceScan.bind(this);
		this.doQrScan = this.doQrScan.bind(this);
		this.closeQrScanner = this.closeQrScanner.bind(this);
		this.bauFound = this.bauFound.bind(this);
	}

	initializeModels() {
		console.log("Initialize Models...");

		this.#model = AssistantModel.initializeAssistantModel(WebUSBDeviceService);
	}

	initializeLogging(el) {
		if (!(el instanceof HTMLElement)) {
			return;
		}

		let lastLogMsg;

		const filterLog = message => {
			// Filter frequent messages to avoid flooding activity log
			if ((message.type === MessageType.EVT) &&
			    (message.subType === MessageSubType.HEARTBEAT)) {
				return true;
			}

			if (lastLogMsg) {
				if (message.type === MessageType.EVT && lastLogMsg.type === MessageType.EVT) {
					if (message.subType === lastLogMsg.subType &&
					    [MessageSubType.SINK_FOUND, MessageSubType.SOURCE_FOUND].includes(message.subType)) {
						return true;
					    }
				}
			}

			lastLogMsg = message;
			return false;
		}

		const addToLog = evt => {
			const { message } = evt.detail;

			if (filterLog(message)) {
				// Filter this message from the activity log
				return;
			}

			let extraInfo;
			if ([MessageSubType.SINK_FOUND, MessageSubType.SOURCE_FOUND].includes(message.subType)) {
				extraInfo = " (silencing similar...)";
			}

			const logStr = logString(message, extraInfo);

			// TBD: Change the crude prepend if performing bad on large content
			el.textContent = logStr + '\n' + el.textContent;
			console.log(logStr);
		}

		WebUSBDeviceService.addEventListener('message', addToLog);
		WebUSBDeviceService.addEventListener('command-sent', addToLog);

		el.addEventListener('click', () => {
			el.classList.toggle('expanded');
		});
	}

	connectedCallback() {
		console.log("connectedCallback - MainApp");

		this.shadowRoot?.appendChild(template.content.cloneNode(true));

		const button = this.shadowRoot?.querySelector('#connect');
		button?.addEventListener('click', WebUSBDeviceService.scan);

		const splashbox = this.shadowRoot?.querySelector('#splashbox');
		WebUSBDeviceService.addEventListener('connected', () => { splashbox?.classList.add('hidden') });
		WebUSBDeviceService.addEventListener('disconnected', () => { splashbox?.classList.remove('hidden') });

		WebUSBDeviceService.addEventListener('connected', this.sendReset);

		this.#stopScanButton = this.shadowRoot?.querySelector('#stop_scan');
		this.#stopScanButton.addEventListener('click', this.sendStopScan);
		this.#stopScanButton.addEventListener('click', this.sendStopScan);
		// this.#stopScanButton.disabled = true;

		this.#scanSinkButton = this.shadowRoot?.querySelector('#sink_scan');
		this.#scanSinkButton.addEventListener('click', this.sendStartSinkScan);
		// this.#scanSinkButton.disabled = true;

		this.#scanSourceButton = this.shadowRoot?.querySelector('#source_scan');
		this.#scanSourceButton.addEventListener('click', this.sendStartSourceScan);
		// this.#scanSourceButton.disabled = true;

		this.#qrScanButton = this.shadowRoot?.querySelector('#qr_scan');
		this.#qrScanButton.addEventListener('click', this.doQrScan);
		this.#qrScanner = this.shadowRoot?.querySelector('qr-scanner');
		this.#qrScanner.addEventListener('close', this.closeQrScanner);
		this.#qrScanner.addEventListener('bau-found', this.bauFound);

		this.#model.addEventListener('scan-stopped', this.scanStopped);
		this.#model.addEventListener('sink-scan-started', this.sinkScanStarted);
		this.#model.addEventListener('source-scan-started', this.sourceScanStarted);

		const activityLog = this.shadowRoot?.querySelector('#activity');
		if (this.#pageState.get('log') === 'y') {
			this.initializeLogging(activityLog);
		} else {
			activityLog?.remove();
		}

		const heartbeat = this.shadowRoot?.querySelector('heartbeat-indicator');
		if (this.#pageState.get('heartbeat') !== 'y') {
			heartbeat?.remove();
		}


		WebUSBDeviceService.reconnectPairedDevices();
	}

	sendReset() {
		this.#model.resetBA();
	}

	scanStopped() {
		console.log("Scan Stopped");

		this.#stopScanButton.disabled = true;
		this.#scanSinkButton.disabled = false;
		this.#scanSourceButton.disabled = false;
	}

	sinkScanStarted() {
		console.log("Sink Scan Started");

		this.#stopScanButton.disabled = false;
		this.#scanSinkButton.disabled = true;
		this.#scanSourceButton.disabled = false;
	}

	sourceScanStarted() {
		console.log("Source Scan Started");

		this.#stopScanButton.disabled = false;
		this.#scanSinkButton.disabled = false;
		this.#scanSourceButton.disabled = true;
	}

	sendStopScan() {
		console.log("Clicked Stop Scan");

		this.#model.stopScan();

		this.#stopScanButton.disabled = true;
	}


	sendStartSinkScan() {
		console.log("Clicked Start Sink Scan");

		this.#model.startSinkScan();

		this.#scanSinkButton.disabled = true;
	}

	sendStartSourceScan() {
		console.log("Clicked Start Source Scan");

		this.#model.startSourceScan();

		this.#scanSourceButton.disabled = true;
	}

	doQrScan() {
		console.log("Clicked QR Scan");

		const qrscannerbox = this.shadowRoot?.querySelector('#qrscannerbox');

		qrscannerbox?.classList.remove('hidden');

		this.#qrScanner.startCamera();
	}

	closeQrScanner() {
		this.#qrScanner.stopCamera();

		const qrscannerbox = this.shadowRoot?.querySelector('#qrscannerbox');

		qrscannerbox?.classList.add('hidden');
	}

	bauFound(evt) {
		const {decoded, raw} = evt.detail;

		console.log('BAU', raw, decoded);

		this.#model.addSourceFromBroadcastAudioURI(decoded);
	}
}
customElements.define('main-app', MainApp);
