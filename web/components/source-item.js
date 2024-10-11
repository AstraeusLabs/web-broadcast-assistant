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
#card {
	display: grid;
	grid-template-columns: 1fr 1fr;
	row-gap: 10px;
	position: relative;
	box-sizing: border-box;
	min-width: 5.14em;
	min-height: 50px;
	margin: 0.2em;
	margin-top: 13px;
	text-align: center;
	user-select: none;
	cursor: pointer;
	padding: 0.7em 0.57em;
	color: #333333;
}

#name {
	font-size: 1.2em;
	text-align: left;
	align-content: center;
}

#state {
	text-align: right;
	font-weight: bolder;
	color: #666666;
	flex-grow: 1;
	align-content: center;
}

#addr {
	grid-column: 1 / 3;
	font-size: 0.9em;
	text-align: left;
}

#bt_name {
	grid-column: 1 / 3;
	font-size: 0.9em;
	text-align: left;
}

#broadcast_name {
	grid-column: 1 / 3;
	font-size: 0.9em;
	text-align: left;
}

#broadcast_id {
	font-size: 0.9em;
	text-align: left;
}

#rssi {
	font-size: 0.9em;
	text-align: right;
}


.subgroup {
	border: 1px solid #73b9fa;
	border-radius: 5px;
	box-sizing: border-box;
	padding: 8px;
	text-align: left;
}

.subgroup.selected {
	background: #73b9fa;
}

#subgroups {
	display: flex;
	flex-direction: column;
	grid-column: 1 / 3;
	font-size: 0.9em;
	row-gap: 5px;
	height: fit-content;
}

.details {
	display: var(--display-details, inherit);
}


</style>
<div id="card">
<span id="name"></span>
<span id="state">PLAY</span>
<span id="bt_name" class="details"></span>
<span id="broadcast_name" class="details"></span>
<span id="addr" class="details"></span>
<span id="broadcast_id" class="details"></span>
<span id="rssi" class="details"></span>
<div id="subgroups"></div>
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
	#stateEl
	#btNameEl
	#broadcastNameEl
	#addrEl
	#broadcastIdEl
	#rssiEl
	#subgroupsEl

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
		this.#stateEl = this.shadowRoot?.querySelector('#state');
		this.#btNameEl = this.shadowRoot?.querySelector('#bt_name');
		this.#broadcastNameEl = this.shadowRoot?.querySelector('#broadcast_name');
		this.#addrEl = this.shadowRoot?.querySelector('#addr');
		this.#broadcastIdEl = this.shadowRoot?.querySelector('#broadcast_id');
		this.#rssiEl = this.shadowRoot?.querySelector('#rssi');
		this.#subgroupsEl = this.shadowRoot?.querySelector('#subgroups');
	}

	refreshSubgroups(base) {
		this.#subgroupsEl.innerHTML = '';

		const handleSelectSubgroup = (evt) => {
			const el = evt.target;
			base.subgroups?.forEach((subgroup, idx) => {
				subgroup.isSelected = idx === el.subgroupIdx ? true : false;
			});
			// 'Select' item in UI
			this.#subgroupsEl.querySelectorAll('.subgroup').forEach(sgEl => {
				sgEl.classList.toggle('selected', el.subgroupIdx === sgEl.subgroupIdx);
			});
			evt.stopPropagation();
		}

		if (!base) {
			return;
		} else {
			base.subgroups?.forEach((subgroup, idx) => {
				subgroup.isSelected = idx === 0 ? true : false;
				// find/grab relevant meta & codec cfg info
				const item = document.createElement('div');
				item.addEventListener('click', handleSelectSubgroup);
				item.subgroupIdx = idx;
				item.classList.add('subgroup');
				item.classList.toggle('selected', subgroup.isSelected);

				let sg_str = `#${idx} (${subgroup.bises?.length || 0} channel(s)):`;
				const str_tk = [];
				const freq = subgroup.codec_data?.find(i => i.name === "SamplingFrequency")?.value;
				if (freq) {
					str_tk.push(`${freq/1000}KHz`);
				}
				const lang = subgroup.codec_meta?.find(i => i.name === "Language")?.value;
				if (lang) {
					str_tk.push(`Lang: ${lang}`);
				}
				sg_str += str_tk.join(', ');

				item.textContent = sg_str;
				this.#subgroupsEl.appendChild(item);
			});
		}
	}

	refresh() {
		// Set name (and more...)
		this.#nameEl.textContent = this.#source.broadcast_name ||
					   this.#source.name ||
					   `0x${this.#source.broadcast_id?.toString(16).padStart(6, '0').toUpperCase()}`;
		this.#btNameEl.textContent = this.#source.name;
		this.#broadcastNameEl.textContent = this.#source.broadcast_name;
		this.#addrEl.textContent = `Addr: ${addrString(this.#source.addr)}`;
		this.#rssiEl.textContent = `RSSI: ${this.#source.rssi}`;
		this.#broadcastIdEl.textContent = `Broadcast ID: 0x${
			this.#source.broadcast_id?.toString(16).padStart(6, '0').toUpperCase()}${
				this.#source?.big_info?.encryption ? " [ENCRYPTED]" : ""
			}`;

		this.#stateEl.textContent = this.#source.state === "selected" ? "STOP" : "PLAY";
	}

	baseUpdated() {
		this.refreshSubgroups(this.#source.base);
	}

	bigInfoUpdated() {
		// TODO: Show more data
		this.refresh();
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
