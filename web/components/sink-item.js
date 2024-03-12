/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { BT_DataType, bufToAddressString } from '../lib/message.js';

/*
* Sink Item Component
*/

const template = document.createElement('template');
template.innerHTML = `
<style>
/* Styles go here */
div {
	display: block;
	position: relative;
	box-sizing: border-box;
	min-width: 5.14em;
	height: 75px;
	margin: 0.2em;
	background: transparent;
	text-align: center;
	border-radius: 5px;
	border: 1px black solid;
	user-select: none;
	cursor: pointer;
	padding: 0.7em 0.57em;
	background-color: var(--background-color, white);
	color: black;
	box-shadow: 3px 3px 6px 3px gray;
	transition: box-shadow 0.5s ease-out;
}

#name {
	position: absolute;
	left: 5px;
	top: 5px;
	font-size: 1.2em;
}

#source {
	position: absolute;
	font-style: italic;
	right: 5px;
	top: 5px;
	font-size: 1.2em;
}

#addr {
	position: absolute;
	left: 5px;
	bottom: 5px;
	font-size: 0.9em;
}

#uuid16s {
	position: absolute;
	left: 5px;
	top: 30px;
	font-size: 0.9em;
}

#rssi {
	position: absolute;
	right: 5px;
	bottom: 5px;
	font-size: 0.9em;
}

#card[state="connected"] {
	background-color: lightgreen;
	box-shadow: 1px 1px 2px 2px gray;
}

#card[state="connecting"] {
	background-color: lightyellow;
	box-shadow: 3px 3px 6px 3px gray;
}

#card[state="failed"] {
	background-color: rgb(255,128,128);
	box-shadow: 3px 3px 6px 3px gray;
}

</style>
<div id="card">
<span id="name"></span>
<span id="source"></span>
<span id="addr"></span>
<span id="uuid16s"></span>
<span id="rssi"></span>
</div>
`;

const addrString = (addr) => {
	if (!addr) {
		return "Unknown address";
	}

	const val = bufToAddressString(addr.value.addr);

	if (addr.type === BT_DataType.BT_DATA_RPA) {
		return `${val} (Unresolved)`;
	} else if (addr.type === BT_DataType.BT_DATA_IDENTITY) {
		return `${val} (Resolved)`;
	}

	return "Unknown address type";
}

export class SinkItem extends HTMLElement {
	#sink
	#cardEl
	#nameEl
	#sourceEl
	#addrEl
	#uuid16sEl
	#rssiEl

	constructor() {
		super();

		this.setModel = this.setModel.bind(this);
		this.refresh = this.refresh.bind(this);

		const shadowRoot = this.attachShadow({mode: 'open'});
		shadowRoot.appendChild(template.content.cloneNode(true));
	}

	connectedCallback() {
		this.#cardEl = this.shadowRoot?.querySelector('#card');
		this.#nameEl = this.shadowRoot?.querySelector('#name');
		this.#sourceEl = this.shadowRoot?.querySelector('#source');
		this.#addrEl = this.shadowRoot?.querySelector('#addr');
		this.#uuid16sEl = this.shadowRoot?.querySelector('#uuid16s');
		this.#rssiEl = this.shadowRoot?.querySelector('#rssi');
	}

	refresh() {
		this.#nameEl.textContent = this.#sink.name;
		this.#addrEl.textContent = `Addr: ${addrString(this.#sink.addr)}`;
		this.#rssiEl.textContent = `RSSI: ${this.#sink.rssi}`;

		// Enable the UUID16 list if needed to see what different sinks provide
		// this.#uuid16sEl.textContent = `UUID16s: [${this.#sink.uuid16s?.map(a => {return '0x'+a.toString(16)})} ]`;

		this.#cardEl.setAttribute('state', this.#sink.state);

		const source = this.#sink.source_added;

		if (!source) {
			if (this.#sink.state === "connected") {
				this.#sourceEl.textContent = "Ready to receive...";
			} else {
				this.#sourceEl.textContent = "";
			}
		} else {
			this.#sourceEl.textContent = source.broadcast_name || source.name || `0x${source.broadcast_id?.toString(16).padStart(6, '0').toUpperCase()}`;
		}
	}

	setModel(sink) {
		this.#sink = sink;

		this.refresh();
	}

	getModel() {
		return this.#sink;
	}
}
customElements.define('sink-item', SinkItem);
