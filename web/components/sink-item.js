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
div {
	display: grid;
	grid-template-columns: 1fr 1fr;
	row-gap: 5px;
	position: relative;
	box-sizing: border-box;
	min-width: 5.14em;
	min-height: 75px;
	margin: 0.2em;
	text-align: center;
	user-select: none;
	cursor: pointer;
	padding: 0.7em 0.57em;
	background-color: var(--background-color, white);
	color: #333333;
}

#name {
	font-size: 1.2em;
	text-align: left;
}

#source {
	font-size: 1.2em;
	text-align: right;
}

#addr {
	font-size: 0.9em;
	text-align: left;
}

#rssi {
	font-size: 0.9em;
	text-align: right;
}

#card[state="connected"] {
	background-color: lightgreen;
}

#card[state="connecting"] {
	background-color: lightyellow;
}

#card[state="failed"] {
	background-color: rgb(255,128,128);
}

</style>
<div id="card">
<span id="name"></span>
<span id="source"></span>
<span id="addr"></span>
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
		this.#rssiEl = this.shadowRoot?.querySelector('#rssi');
	}

	refresh() {
		this.#nameEl.textContent = this.#sink.name;
		this.#addrEl.textContent = `Addr: ${addrString(this.#sink.addr)}`;
		this.#rssiEl.textContent = `RSSI: ${this.#sink.rssi}`;

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
