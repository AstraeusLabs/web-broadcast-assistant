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
#card {
	display: flex;
	flex-direction: column;
	row-gap: 5px;
	position: relative;
	box-sizing: border-box;
	min-width: 5.14em;
	min-height: 75px;
	text-align: center;
	user-select: none;
	cursor: pointer;
	padding: 0.7em;
	background-color: var(--background-color, white);
	color: #333333;
}

.row {
	display: flex;
	align-items: center;
	flex-direction: row;
	flex-grow: 1;
}

.col {
	display: flex;
	flex-direction: column;
	row-gap: 5px;
	flex-grow: 1;
}

#name {
	text-align: left;
	font-weight: bolder;
}

#source {
	text-align: left;
	font-style: italic;
}

#source.hidden {
	display: none;
}

#state {
	text-align: right;
	font-weight: bolder;
	color: #666666;
	flex-grow: 1;
}

#state[state="connected"] {
	color: var(--color-green, green);
}

#state[state="connecting"] {
	color: var(--color-blue, blue);
}

#state[state="failed"] {
	color: var(--color-red, rgb(255,128,128));
}

#addr {
	font-size: 0.9em;
	text-align: left;
	flex-grow: 1;
}

#rssi {
	font-size: 0.9em;
	text-align: right;
	flex-grow: 1;
}

.details {
	display: var(--display-details, none);
}

</style>
<div id="card">
 <div class="row">
  <div class="col">
   <span id="name"></span>
   <span id="source" class="hidden">Some source</span>
  </div>
  <span id="state">Not connected</span>
 </div>
 <div class="row details">
  <span id="addr"></span>
  <span id="rssi"></span>
 </div>
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
	#nameEl
	#stateEl
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
		this.#nameEl = this.shadowRoot?.querySelector('#name');
		this.#stateEl = this.shadowRoot?.querySelector('#state');
		this.#sourceEl = this.shadowRoot?.querySelector('#source');
		this.#addrEl = this.shadowRoot?.querySelector('#addr');
		this.#rssiEl = this.shadowRoot?.querySelector('#rssi');
	}

	refresh() {
		this.#nameEl.textContent = this.#sink.name;
		this.#addrEl.textContent = `Addr: ${addrString(this.#sink.addr)}`;
		this.#rssiEl.textContent = `RSSI: ${this.#sink.rssi}`;

		this.#stateEl.setAttribute('state', this.#sink.state);

		const source = this.#sink.source_added;

		if (!source) {
			if (this.#sink.state === "failed") {
				this.#stateEl.textContent = "Failed";
			} else if (this.#sink.state === "connecting") {
				this.#stateEl.textContent = "Connecting";
			} else if (this.#sink.state === "connected") {
				this.#stateEl.textContent = "Connected";
				this.#sourceEl.textContent = "Select an Auracast";
				this.#sourceEl.classList.remove('hidden');
			} else {
				// TODO: Keep remembering in list on disconnect (future)
				this.#stateEl.textContent = "Not connected";
				this.#sourceEl.textContent = "";
				this.#sourceEl.classList.add('hidden');
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
