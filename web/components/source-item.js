/*
 * Copyright (c) 2024 Demant A/S
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { BT_DataType, bufToAddressString } from '../lib/message.js';

/*
* Source Item Component
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
	height: 100px;
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

#addr {
	position: absolute;
	left: 5px;
	top: 30px;
	font-size: 0.9em;
}

#broadcast_name {
	position: absolute;
	top: 5px;
	font-size: 1.2em;
}

#broadcast_id {
	position: absolute;
	left: 5px;
	bottom: 5px;
	font-size: 0.9em;
}

#rssi {
	position: absolute;
	right: 5px;
	bottom: 5px;
	font-size: 0.9em;
}

#base {
	position: absolute;
	left: 5px;
	bottom: 25px;
	font-size: 0.9em;
}

#card[state="selected"] {
	background-color: lightgreen;
	box-shadow: 1px 1px 2px 2px gray;
}
</style>
<div id="card">
<span id="name"></span>
<span id="broadcast_name"></span>
<span id="addr"></span>
<span id="broadcast_id"></span>
<span id="rssi"></span>
<span id="base">BASE:</span>
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

export class SourceItem extends HTMLElement {
	#source
	#cardEl
	#nameEl
	#broadcastNameEl
	#addrEl
	#broadcastIdEl
	#rssiEl
	#baseEl

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
		this.#broadcastNameEl = this.shadowRoot?.querySelector('#broadcast_name');
		this.#addrEl = this.shadowRoot?.querySelector('#addr');
		this.#broadcastIdEl = this.shadowRoot?.querySelector('#broadcast_id');
		this.#rssiEl = this.shadowRoot?.querySelector('#rssi');
		this.#baseEl = this.shadowRoot?.querySelector('#base');
	}

	baseInfoString(base) {
		let result = "BASE: ";

		if (!base) {
			result += "Pending...";
		} else {
			// Subgroups
			let sg_count = 0;
			base.subgroups?.forEach(subgroup => {
				let sg_str = `SG[${sg_count}]:(`;
				const str_tk = [];
				const freq = subgroup.codec_data?.find(i => i.name === "SamplingFrequency")?.value;
				if (freq) {
					str_tk.push(`Freq: ${freq}Hz`);
				}
				str_tk.push(`BIS_CNT=${subgroup.bises?.length || 0}`)
				sg_str += str_tk.join(', ');
				sg_str += ")";

				console.log(sg_str);
				result += sg_str;

				sg_count++;
			})
		}

		return result;
	}

	refresh() {
		// Set name (and more...)
		this.#nameEl.textContent = this.#source.name;
		this.#broadcastNameEl.textContent = this.#source.broadcast_name;
		this.#addrEl.textContent = `Addr: ${addrString(this.#source.addr)}`;
		this.#rssiEl.textContent = `RSSI: ${this.#source.rssi}`;
		this.#baseEl.textContent = this.baseInfoString(this.#source.base);
		this.#broadcastIdEl.textContent = `Broadcast ID: 0x${
			this.#source.broadcast_id?.toString(16).padStart(6, '0').toUpperCase()}`;

		this.#cardEl.setAttribute('state', this.#source.state);
	}

	setModel(source) {
		this.#source = source;

		this.refresh();
	}

	getModel() {
		return this.#source;
	}
}
customElements.define('source-item', SourceItem);
