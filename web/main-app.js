/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import './components/sink-device-list.js';
import './components/source-device-list.js';
import {QrScanner} from './components/qr-scanner.js';
import {BroadcastCodeQuery} from './components/broadcast-code-query.js';
import './components/heart-beat.js';

import * as AssistantModel from './models/assistant-model.js';
import { StorageModel } from './models/storage-model.js';
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
	background: #e0edf9;
	text-align: center;
	font: inherit;
	xxxtext-transform: uppercase;
	outline: none;
	border: 0;
	border-radius: 5px;
	user-select: none;
	cursor: pointer;
	z-index: 0;
	padding: 0.7em 0.57em;
	box-shadow: 1px 6px 8px lightgray;
	color: #333333;
	transition: box-shadow 0.1s ease-out;
      }

button:active:not([disabled]) {
	box-shadow: 1px 1px 2px 3px lightgray;
}

button:disabled {
	color: gray;
	box-shadow: 1px 1px 2px 2px lightgray;
	background: white;
}

.textbox {
	box-sizing: border-box;
	border: 1px solid darkgray;

	background: rgba(255, 255, 255, 0.8);
	backdrop-filter: blur;
	box-shadow: 1px 6px 8px lightgray;

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

.storage.hidden {
	display: none;
}

</style>

<div class="flex-container">
	<div class="content">
		<div class="col">
			<div class="row">
			<h2>Broadcast Assistant</h2>
			<div class="right-align">
			<heartbeat-indicator></heartbeat-indicator>
			</div>
			</div>

			<div class="row">
			<button id="sink_scan">Search for<br>Devices</button>
			<button id='stop_scan'>Stop<br>Scanning</button>
			<button id="source_scan">Search for<br>Auracasts</button>
			</div>

			<!-- broadcast sink components... -->
			<sink-device-list></sink-device-list>

			<!-- broadcast source components... -->
			<source-device-list></source-device-list>
			<button id="qr_scan">
			<svg width="30px" height="30px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 9h6V3H3zm1-5h4v4H4zm1 1h2v2H5zm10 4h6V3h-6zm1-5h4v4h-4zm1 1h2v2h-2zM3 21h6v-6H3zm1-5h4v4H4zm1 1h2v2H5zm15 2h1v2h-2v-3h1zm0-3h1v1h-1zm0-1v1h-1v-1zm-10 2h1v4h-1v-4zm-4-7v2H4v-1H3v-1h3zm4-3h1v1h-1zm3-3v2h-1V3h2v1zm-3 0h1v1h-1zm10 8h1v2h-2v-1h1zm-1-2v1h-2v2h-2v-1h1v-2h3zm-7 4h-1v-1h-1v-1h2v2zm6 2h1v1h-1zm2-5v1h-1v-1zm-9 3v1h-1v-1zm6 5h1v2h-2v-2zm-3 0h1v1h-1v1h-2v-1h1v-1zm0-1v-1h2v1zm0-5h1v3h-1v1h-1v1h-1v-2h-1v-1h3v-1h-1v-1zm-9 0v1H4v-1zm12 4h-1v-1h1zm1-2h-2v-1h2zM8 10h1v1H8v1h1v2H8v-1H7v1H6v-2h1v-2zm3 0V8h3v3h-2v-1h1V9h-1v1zm0-4h1v1h-1zm-1 4h1v1h-1zm3-3V6h1v1z"/><path fill="none" d="M0 0h24v24H0z"/></svg>
			<span style="position: relative; bottom: 0.5em">Scan Auracast QR-code</span></button>

			<!-- storage buttons, enable with store=y -->
			<div class="row storage hidden">
			<button id="storage_clear">Clear<br>storage</button>
			<button id='storage_download'>Download<br>storage</button>
			</div>
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
			<h2>Scan Auracast QR-code</h2>
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

<div id="bc-query" class="hidden">
	<broadcast-code-query></broadcast-code-query>
</div>

`;

export class MainApp extends HTMLElement {
	#scanSinkButton
	#scanSourceButton
	#stopScanButton
	#qrScanButton
	#model
	#storage
	#pageState
	#qrScanner
	#bcQuery

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
		this.requestBC = this.requestBC.bind(this);
		this.bcReceived = this.bcReceived.bind(this);
	}

	initializeModels() {
		console.log("Initialize Models...");

		this.#model = AssistantModel.initializeAssistantModel(WebUSBDeviceService);

		this.#storage = new StorageModel(this.#model);
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

		this.#bcQuery = this.shadowRoot?.querySelector('broadcast-code-query');
		this.#model.addEventListener('bc-request', this.requestBC);
		this.#bcQuery.addEventListener('bc-received', this.bcReceived);

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

		const storageUI = this.shadowRoot?.querySelector('.storage');
		if (this.#pageState.get('storage') === 'y') {
			storageUI?.classList.remove('hidden');

			this.shadowRoot?.querySelector('#storage_clear')?.
				addEventListener('click', () => this.#storage.clear('source'));
			this.shadowRoot?.querySelector('#storage_download')?.
				addEventListener('click', evt => {
					this.#storage.download('source')});
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

	requestBC(evt) {
		const {sink, source_id} = evt.detail;

		console.log('Request BC');

		this.#bcQuery.queryBCCode(source_id);
	}

	bcReceived(evt) {
		const {arr, source_id} = evt.detail;
		console.log('Recevied BC');

		this.#model.sendBroadcastCode(arr, source_id);
	}
}
customElements.define('main-app', MainApp);
